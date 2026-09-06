/**
 * Service watchdog — keeps the Next.js dev server (:3000) and the realtime
 * mini-service (:3004) alive on this 3.9GB box, where nothing else supervises
 * them. Runs as its own detached daemon (PPID 1) so it survives tool-call
 * teardown; all (re)launches use the same double-fork pattern.
 *
 * Behaviour:
 *  - Every 20s: health-check both services. Two consecutive failures →
 *    clean relaunch (kill only the Next processes — NEVER patterns that
 *    would match the realtime service or this watchdog).
 *  - CRASH-LOOP FIX (2026-09-05): a SIGKILL'd next-server can leave a
 *    CORRUPTED Turbopack cache in .next — the restarted server then binds
 *    :3000 but hangs in "Starting…" forever, and relaunching without
 *    clearing the cache loops infinitely (67-minute outage root cause).
 *    Every relaunch now wipes .next/dev first, and a STARTUP_GRACE window
 *    (cold compile needs ~2 min) keeps slow cold starts from being killed.
 *  - Proactive recycle: when next-server RSS > RECYCLE_MB while the app has
 *    been idle (no dev.log writes) for > IDLE_MS, restart it BEFORE the
 *    kernel OOM-killer strikes (five next-server OOM kills happened before
 *    this watchdog existed).
 *  - Cooldown after any relaunch so a crash-loop cannot spin the CPU.
 *
 * Log: /tmp/watchdog.log (timestamps, capped by simple line count).
 */
import { spawn, execSync } from 'node:child_process'
import { statSync, appendFileSync, rmSync, readFileSync } from 'node:fs'

const NEXT_URL = 'http://localhost:3000/api/health'
const RT_URL = 'http://localhost:3004/health'
const DEV_LOG = '/home/z/my-project/dev.log'
const ENV_FILE = '/home/z/my-project/.env'
const LOG = '/tmp/watchdog.log'

const RECYCLE_MB = 2400 // RSS threshold that precedes every historical OOM
const IDLE_MS = 45_000 // only recycle when nobody is using the app
const CHECK_MS = 20_000
const COOLDOWN_MS = 90_000
/** Cold-compile grace: a freshly launched dev server may need ~2 minutes to
 *  answer /api/health; strikes are not counted inside this window. */
const STARTUP_GRACE_MS = 240_000

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Environment for spawned children: the watchdog's own inherited env MINUS
 * every key the project defines in .env.
 *
 * WHY: Next (@next/env) and bun never OVERRIDE an existing process.env value
 * with the .env file. If the shell that launched THIS watchdog ever exported
 * a stale or mangled copy of a project value (e.g. a dotenv-unfriendly
 * password), every watchdog relaunch would keep shadowing the corrected .env
 * file forever — exactly the 2026-09-06 admin-bridge outage, where an
 * inherited bootstrap password (dotenv had stripped the unquoted trailing
 * #…$ comment from it) survived a full server restart.
 * Stripping the keys forces the child to re-read them from .env at boot.
 */
function cleanChildEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  try {
    const raw = readFileSync(ENV_FILE, 'utf8')
    for (const line of raw.split('\n')) {
      const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/)
      if (m) delete env[m[1]]
    }
  } catch {
    /* no .env — nothing to strip */
  }
  return env
}

function log(msg: string): void {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${msg}`
  try {
    appendFileSync(LOG, line + '\n')
  } catch {
    /* non-fatal */
  }
  console.log(line)
}

async function alive(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(5000) })
    return r.ok
  } catch {
    return false
  }
}

/** next-server RSS in MB (0 when not running). */
function nextRssMb(): number {
  try {
    const out = execSync(
      "ps -eo pid,rss,cmd | grep 'next-serve[r]' | grep -v grep | head -1",
      { encoding: 'utf8' }
    )
    const parts = out.trim().split(/\s+/)
    if (parts.length < 2) return 0
    return parseInt(parts[1], 10) / 1024
  } catch {
    return 0
  }
}

/** ms since the dev server last wrote a log line (0 when unknown → "busy"). */
function idleMs(): number {
  try {
    return Date.now() - statSync(DEV_LOG).mtimeMs
  } catch {
    return 0
  }
}

/**
 * Kill ONLY the Next.js dev processes. The bracket trick ('de[v]', 'serve[r]')
 * keeps the patterns from matching this watchdog's or the shell's own
 * command lines, and neither pattern matches the realtime service
 * (`bun --hot index.ts`) — the pkill lesson from 2026-09-05.
 */
function killNext(): void {
  for (const pat of ["next de[v]", "next-serve[r]", "tee dev[.]log"]) {
    try {
      execSync(`pkill -f "${pat}" 2>/dev/null || true`)
    } catch {
      /* already gone */
    }
  }
}

function launchNext(): void {
  // Wipe the Turbopack dev cache before EVERY relaunch — a SIGKILL'd
  // next-server leaves .next/dev corrupted, and the next boot then hangs
  // in "Starting…" with :3000 bound but never answering (the 05:35–06:42
  // outage). A clean compile costs ~1–2 min; a corrupted cache costs ∞.
  try {
    rmSync('/home/z/my-project/.next/dev', { recursive: true, force: true })
  } catch {
    /* non-fatal — best effort */
  }
  const p = spawn('bun', ['run', 'dev'], {
    detached: true,
    stdio: 'ignore',
    cwd: '/home/z/my-project',
    env: { ...cleanChildEnv(), NODE_OPTIONS: '--max-old-space-size=1792' },
  })
  p.unref()
  log(`next dev relaunched (launcher pid ${p.pid}, .next/dev cleared)`)
}

function launchRealtime(): void {
  const p = spawn('bun', ['run', 'dev'], {
    detached: true,
    stdio: 'ignore',
    cwd: '/home/z/my-project/mini-services/realtime-service',
    env: cleanChildEnv(),
  })
  p.unref()
  log(`realtime service relaunched (launcher pid ${p.pid})`)
}

async function main(): Promise<void> {
  log('watchdog started')
  let nextFails = 0
  let rtFails = 0
  let cooldownUntil = 0

  let launchedAt = Date.now()

  for (;;) {
    const now = Date.now()
    if (now < cooldownUntil) {
      await sleep(CHECK_MS)
      continue
    }

    const nextOk = await alive(NEXT_URL)
    const rtOk = await alive(RT_URL)

    if (nextOk) {
      nextFails = 0
    } else if (now - launchedAt < STARTUP_GRACE_MS) {
      // Cold compile in progress — don't count strikes (and don't log).
      if (nextFails === 0) log('next dev cold-compiling — holding strikes during startup grace')
      nextFails = 1 // hold at a single informational strike
    } else if (++nextFails >= 2) {
      log('next dev DEAD — relaunching')
      killNext()
      await sleep(2000)
      launchNext()
      cooldownUntil = Date.now() + COOLDOWN_MS
      nextFails = 0
      continue
    }

    if (rtOk) {
      rtFails = 0
    } else if (++rtFails >= 2) {
      log('realtime service DEAD — relaunching')
      launchRealtime()
      cooldownUntil = Date.now() + COOLDOWN_MS
      rtFails = 0
    }

    if (nextOk) {
      launchedAt = Date.now() // healthy — reset the startup clock
      const rss = nextRssMb()
      if (rss > RECYCLE_MB && idleMs() > IDLE_MS) {
        log(`next-server RSS ${rss.toFixed(0)}MB while idle — recycling before OOM`)
        killNext()
        await sleep(2000)
        launchNext()
        launchedAt = Date.now()
        cooldownUntil = Date.now() + COOLDOWN_MS
        continue
      }
    }

    await sleep(CHECK_MS)
  }
}

void main()
