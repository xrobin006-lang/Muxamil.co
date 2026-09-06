/** Friendly relative timestamps: Just now · 5 min · Today 2:30 PM · Yesterday · Aug 25 */
export function timeAgo(iso: string): string {
  const date = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)

  if (diffMin < 1) return 'Just now'
  if (diffMin < 60) return `${diffMin} min`

  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

  if (sameDay(date, now)) {
    return `Today, ${formatTime(date)}`
  }

  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (sameDay(date, yesterday)) {
    return `Yesterday, ${formatTime(date)}`
  }

  if (diffMs < 365 * 24 * 3600 * 1000) {
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  }
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

export function formatFullDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

/**
 * THE centralized compact number formatter — the single presentation format
 * for every user-visible counter in the app (likes, views, followers,
 * following, members, CTA, analytics, notifications…).
 *
 * 999 → "999" · 1000 → "1K" · 1200 → "1.2K" · 1500 → "1.5K" · 9999 → "10K"
 * 10000 → "10K" · 125000 → "125K" · 1M · 1.2M · 10M · 100M · 1B · 1.2B ·
 * 10B · 100B · 1T.
 *
 * Presentation only — the underlying database number is never rounded or
 * mutated; exact values stay available via tooltips / toLocaleString().
 */
export function formatCount(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0'
  if (n < 1000) return String(Math.round(n))
  const tiers: [number, string][] = [
    [1e12, 'T'],
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K'],
  ]
  for (const [scale, suffix] of tiers) {
    if (n >= scale) {
      const value = n / scale
      // 1–2 significant decimals: 1.2K, 1.5K, 10K, 125K — never "1.0K".
      const rounded = value >= 100 ? Math.round(value) : Math.round(value * 10) / 10
      return `${rounded}${suffix}`
    }
  }
  return String(Math.round(n))
}

export function formatBytes(bytes: number): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let n = bytes
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`
}
