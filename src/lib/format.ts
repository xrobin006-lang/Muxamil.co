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

/** Compact engagement numbers: 950 → "950", 1200 → "1.2K", 3400000 → "3.4M". */
export function formatCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0'
  if (n < 1000) return String(Math.round(n))
  const compact = (value: number, suffix: string): string => {
    const rounded = value >= 100 ? Math.round(value) : Number(value.toFixed(1))
    // 999.5K rounds up to 1M (never "1000K") — same for M → B.
    if (rounded >= 1000) return suffix === 'K' ? '1M' : '1B'
    return `${rounded}${suffix}`
  }
  if (n < 1_000_000) return compact(n / 1000, 'K')
  if (n < 1_000_000_000) return compact(n / 1_000_000, 'M')
  return compact(n / 1_000_000_000, 'B')
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
