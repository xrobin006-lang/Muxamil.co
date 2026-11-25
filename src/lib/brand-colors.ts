/**
 * BRAND COLORS — pure helpers shared by the server (layout CSS injection,
 * config validation) and the admin UI (live preview). No imports allowed
 * here: this module must stay client-bundle safe.
 *
 * Design safety (spec): the admin only picks a PRIMARY and an ACCENT hex.
 * Every derived value (foregrounds, dark-mode variants, accent tints) is
 * computed here with WCAG relative-luminance math so random combinations
 * can never break readability.
 */

export const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/

/** Parse "#rrggbb" → [r,g,b] (0-255). Returns null for anything else. */
function hexToRgb(hex: string): [number, number, number] | null {
  if (!HEX_COLOR_RE.test(hex)) return null
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ]
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

/** WCAG relative luminance (0 = black, 1 = white). */
export function relativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex)
  if (!rgb) return 0
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio between two hex colors (1..21). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

/** Mix `hex` toward `target` by `amount` (0 = unchanged, 1 = target). */
export function mixHex(hex: string, target: string, amount: number): string {
  const a = hexToRgb(hex)
  const b = hexToRgb(target)
  if (!a || !b) return hex
  const t = Math.min(1, Math.max(0, amount))
  return rgbToHex(
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  )
}

/** Black or white — whichever reads better on `hex`. */
export function readableForeground(hex: string): string {
  return contrastRatio(hex, '#ffffff') >= contrastRatio(hex, '#0c1210') ? '#ffffff' : '#0c1210'
}

/** Shift a color's luminance toward `target` until it passes `max`/`min`. */
function clampLuminance(hex: string, target: 'white' | 'black', limit: number): string {
  let out = hex
  for (let i = 1; i <= 10; i++) {
    const l = relativeLuminance(out)
    if (target === 'white' ? l >= limit : l <= limit) break
    out = mixHex(hex, target === 'white' ? '#ffffff' : '#000000', i / 10)
  }
  return out
}

export type BrandColorChoices = { primary: string | null; accent: string | null }

/**
 * The CSS that applies the admin's brand colors. Injected once in the root
 * layout (SSR — no flash). Only the variables the two picked colors actually
 * control are overridden; everything else keeps the built-in theme, so the
 * existing design system (spacing, radii, typography, components) is intact.
 *
 * Primary → --primary / --primary-foreground / --ring / --sidebar-primary(-foreground)
 * Accent  → --accent / --accent-foreground (soft tint surfaces + their text)
 */
export function brandColorCss(colors: BrandColorChoices): string | null {
  const p = colors.primary && HEX_COLOR_RE.test(colors.primary) ? colors.primary.toLowerCase() : null
  const a = colors.accent && HEX_COLOR_RE.test(colors.accent) ? colors.accent.toLowerCase() : null
  if (!p && !a) return null

  const rules: string[] = []
  const darkRules: string[] = []

  if (p) {
    // Light mode: use the picked color as-is with a contrast-checked fg.
    rules.push(
      `--primary:${p}`,
      `--primary-foreground:${readableForeground(p)}`,
      `--ring:${p}`,
      `--sidebar-primary:${p}`,
      `--sidebar-primary-foreground:${readableForeground(p)}`,
    )
    // Dark mode: brighten very dark picks so they still pop on dark surfaces.
    const pd = relativeLuminance(p) < 0.32 ? mixHex(p, '#ffffff', 0.3) : p
    darkRules.push(
      `--primary:${pd}`,
      `--primary-foreground:${readableForeground(pd)}`,
      `--ring:${pd}`,
      `--sidebar-primary:${pd}`,
      `--sidebar-primary-foreground:${readableForeground(pd)}`,
    )
    // RGB triplets for rgba() consumers (e.g. the DM "new messages" pulse)
    // so every glow follows the brand instead of a stale hardcoded color.
    const pr = hexToRgb(p)
    if (pr) rules.push(`--primary-rgb:${pr.join(' ')}`)
    const pdr = hexToRgb(pd)
    if (pdr) darkRules.push(`--primary-rgb:${pdr.join(' ')}`)
  }

  if (a) {
    // Accent stays a SOFT TINT of the pick (like the built-in theme's accent):
    // 10% color on white (light) / 20% color on near-black (dark), with the
    // foreground darkened/lightened enough to stay readable on that tint.
    const lightBg = mixHex(a, '#ffffff', 0.9)
    const lightFg = clampLuminance(a, 'black', 0.34)
    rules.push(`--accent:${lightBg}`, `--accent-foreground:${lightFg}`)
    const darkBg = mixHex(a, '#0b0f0e', 0.82)
    const darkFg = clampLuminance(a, 'white', 0.78)
    darkRules.push(`--accent:${darkBg}`, `--accent-foreground:${darkFg}`)
  }

  const out: string[] = []
  if (rules.length) out.push(`:root{${rules.join(';')}}`)
  if (darkRules.length) out.push(`.dark{${darkRules.join(';')}}`)
  return out.join('\n') || null
}

/** Approximation of the built-in emerald primary — picker/preview default only. */
export const DEFAULT_PRIMARY_HEX = '#0f9457'

/** Approximation of the built-in soft emerald accent — picker/preview default only. */
export const DEFAULT_ACCENT_HEX = '#e6f4ec'
