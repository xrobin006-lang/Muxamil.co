import { supabase, freshId, nowIso } from '@/lib/supabase'
import type { PaymentMethodDTO, StorePaymentsDTO } from '@/lib/types'

/**
 * STORE PAYMENTS — the admin-managed payment-method configuration that powers
 * the checkout flow (Store → Buy Now → Select payment method → payment
 * instructions → TID + screenshot proof).
 *
 * STORAGE: one existing generic `homepage_sections` row — EXACTLY the same
 * no-DDL convention as the Store settings ('store'), categories
 * ('store_categories') and pages ('store_pages'):
 *
 *   key     = 'store_payments'
 *   title   = 'Store Payments'
 *   enabled = payments master ON/OFF (checkout still works read-only when off:
 *             the customer is told to contact support instead)
 *   config  = { enabled, note, methods: PaymentMethodConfig[] }
 *
 * QR images live in the EXISTING public bucket 'mux-post-images' under
 * store-assets/payments/ (same pattern as the store branding assets).
 */

export const STORE_PAYMENTS_KEY = 'store_payments'

/** Max methods / field caps (admin-managed volume — one row either way). */
const MAX_METHODS = 10
const MAX_LABEL = 40
const MAX_ACCOUNT_NAME = 80
const MAX_ACCOUNT_NUMBER = 60
const MAX_INSTRUCTIONS = 500
const MAX_NOTE = 400

/** Logo + QR upload caps (mirror the branding-image policy). */
export const PAYMENT_QR_MAX_BYTES = 4 * 1024 * 1024
export const PAYMENT_QR_ALLOWED_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}
export const PAYMENT_LOGO_MAX_BYTES = PAYMENT_QR_MAX_BYTES
export const PAYMENT_LOGO_ALLOWED_MIME: Record<string, string> = PAYMENT_QR_ALLOWED_MIME

/** Internal config shape (admin side — includes the storage path). */
export type PaymentMethodConfig = {
  id: string
  label: string
  emoji: string
  accountName: string
  accountNumber: string
  instructions: string | null
  logo: { url: string; path: string } | null
  qr: { url: string; path: string } | null
  active: boolean
  order: number
}

export type StorePaymentsConfig = {
  enabled: boolean
  note: string | null
  methods: PaymentMethodConfig[]
}

type SectionRow = {
  id: string
  key: string
  title: string
  enabled: boolean | null
  display_order: number | null
  config: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

const METHOD_ID_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/

/** Tolerant method normalization (≤10, unique ids, sane field caps). */
export function readPaymentMethods(v: unknown): PaymentMethodConfig[] {
  if (!Array.isArray(v)) return []
  const out: PaymentMethodConfig[] = []
  const seen = new Set<string>()
  for (const item of v.slice(0, MAX_METHODS)) {
    if (!item || typeof item !== 'object') continue
    const m = item as Record<string, unknown>
    const id = typeof m.id === 'string' ? m.id.trim().toLowerCase().slice(0, 40) : ''
    const label = typeof m.label === 'string' ? m.label.trim().slice(0, MAX_LABEL) : ''
    if (!METHOD_ID_RE.test(id) || !label || seen.has(id)) continue
    seen.add(id)
    const qrRaw = m.qr
    let qr: { url: string; path: string } | null = null
    if (qrRaw && typeof qrRaw === 'object') {
      const q = qrRaw as { url?: unknown; path?: unknown }
      if (typeof q.url === 'string' && /^https?:\/\//i.test(q.url)) {
        qr = { url: q.url, path: typeof q.path === 'string' ? q.path : '' }
      }
    }
    const logoRaw = m.logo
    let logo: { url: string; path: string } | null = null
    if (logoRaw && typeof logoRaw === 'object') {
      const l = logoRaw as { url?: unknown; path?: unknown }
      if (typeof l.url === 'string' && /^https?:\/\//i.test(l.url)) {
        logo = { url: l.url, path: typeof l.path === 'string' ? l.path : '' }
      }
    }
    out.push({
      id,
      label,
      emoji: typeof m.emoji === 'string' && m.emoji.trim() ? m.emoji.trim().slice(0, 8) : '💳',
      accountName: typeof m.accountName === 'string' ? m.accountName.trim().slice(0, MAX_ACCOUNT_NAME) : '',
      accountNumber: typeof m.accountNumber === 'string' ? m.accountNumber.trim().slice(0, MAX_ACCOUNT_NUMBER) : '',
      instructions:
        typeof m.instructions === 'string' && m.instructions.trim()
          ? m.instructions.trim().slice(0, MAX_INSTRUCTIONS)
          : null,
      logo,
      qr,
      active: m.active !== false,
      order:
        typeof m.order === 'number' && Number.isFinite(m.order)
          ? Math.min(Math.max(Math.floor(m.order), 0), 999)
          : out.length + 1,
    })
  }
  return out.sort((a, b) => a.order - b.order || a.label.localeCompare(b.label))
}

function rowToConfig(row: SectionRow | null): StorePaymentsConfig {
  const c = (row?.config ?? {}) as Record<string, unknown>
  const methods = readPaymentMethods(c.methods)
  return {
    // Master switch: the config flag wins; `enabled` on the row mirrors it.
    enabled: c.enabled !== false && row?.enabled !== false,
    note: typeof c.note === 'string' && c.note.trim() ? c.note.trim().slice(0, MAX_NOTE) : null,
    methods,
  }
}

async function findPaymentsRow(): Promise<SectionRow | null> {
  const { data, error } = await supabase
    .from('homepage_sections')
    .select('id,key,title,enabled,display_order,config,created_at,updated_at')
    .eq('key', STORE_PAYMENTS_KEY)
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data as unknown as SectionRow) ?? null
}

/** The full admin-side config (never throws — defaults when missing). */
export async function readStorePaymentsConfig(): Promise<StorePaymentsConfig> {
  const row = await findPaymentsRow()
  return rowToConfig(row)
}

/** The customer-side shape for the checkout page (active methods only). */
export async function readStorePaymentsForCheckout(): Promise<StorePaymentsDTO> {
  const config = await readStorePaymentsConfig()
  return {
    enabled: config.enabled,
    note: config.note,
    methods: config.methods
      .filter((m) => m.active && m.accountNumber.trim().length > 0)
      .map((m) => ({
        id: m.id,
        label: m.label,
        emoji: m.emoji,
        accountName: m.accountName,
        accountNumber: m.accountNumber,
        instructions: m.instructions,
        logoUrl: m.logo?.url ?? null,
        qrUrl: m.qr?.url ?? null,
        active: true,
        order: m.order,
      })),
  }
}

/** One active method by id (checkout proof submission re-validates server-side). */
export async function findActivePaymentMethod(
  methodId: string,
): Promise<PaymentMethodConfig | null> {
  if (typeof methodId !== 'string' || !METHOD_ID_RE.test(methodId)) return null
  const config = await readStorePaymentsConfig()
  return config.methods.find((m) => m.id === methodId && m.active) ?? null
}

async function writePaymentsRow(config: StorePaymentsConfig): Promise<void> {
  const payload = {
    enabled: config.enabled,
    note: config.note,
    methods: config.methods,
  } as unknown as Record<string, unknown>
  const existing = await findPaymentsRow()
  if (!existing) {
    const { error } = await supabase.from('homepage_sections').insert({
      id: freshId(),
      key: STORE_PAYMENTS_KEY,
      title: 'Store Payments',
      subtitle: null,
      enabled: config.enabled,
      display_order: 0,
      config: payload,
      created_at: nowIso(),
      updated_at: nowIso(),
    })
    if (error) throw new Error(error.message)
  } else {
    const { error } = await supabase
      .from('homepage_sections')
      .update({ config: payload, enabled: config.enabled, updated_at: nowIso() })
      .eq('key', STORE_PAYMENTS_KEY)
    if (error) throw new Error(error.message)
  }
}

/** Validate + replace the whole payments config (admin-only callers). */
export async function writeStorePaymentsConfig(input: {
  enabled?: boolean
  note?: string | null
  methods?: unknown
}): Promise<StorePaymentsConfig> {
  const current = await readStorePaymentsConfig()

  const enabled = typeof input.enabled === 'boolean' ? input.enabled : current.enabled

  let note = current.note
  if (input.note !== undefined) {
    note = typeof input.note === 'string' && input.note.trim() ? input.note.trim().slice(0, MAX_NOTE) : null
  }

  let methods = current.methods
  if (input.methods !== undefined) {
    if (input.methods === null) {
      methods = []
    } else if (Array.isArray(input.methods)) {
      if (input.methods.length > MAX_METHODS) {
        throw new Error(`At most ${MAX_METHODS} payment methods are supported.`)
      }
      // Preserve existing QR pointers when the admin payload omits them.
      const byId = new Map(current.methods.map((m) => [m.id, m]))
      const parsed: PaymentMethodConfig[] = []
      const seen = new Set<string>()
      for (const raw of input.methods) {
        if (!raw || typeof raw !== 'object') continue
        const m = raw as Record<string, unknown>
        const id = typeof m.id === 'string' ? m.id.trim().toLowerCase().slice(0, 40) : ''
        const label = typeof m.label === 'string' ? m.label.trim().slice(0, MAX_LABEL) : ''
        if (!METHOD_ID_RE.test(id)) {
          throw new Error('Every payment method needs a valid id (lowercase letters, numbers, dashes).')
        }
        if (seen.has(id)) {
          throw new Error(`Duplicate payment method id "${id}".`)
        }
        if (label.length < 2) {
          throw new Error('Every payment method needs a label of at least 2 characters.')
        }
        seen.add(id)
        const accountName =
          typeof m.accountName === 'string' ? m.accountName.trim().slice(0, MAX_ACCOUNT_NAME) : ''
        const accountNumber =
          typeof m.accountNumber === 'string' ? m.accountNumber.trim().slice(0, MAX_ACCOUNT_NUMBER) : ''
        if (!accountName || !accountNumber) {
          throw new Error(`Method "${label}" needs both an account name and an account number.`)
        }
        const instructions =
          typeof m.instructions === 'string' && m.instructions.trim()
            ? m.instructions.trim().slice(0, MAX_INSTRUCTIONS)
            : null
        // Logo + QR pointers: keep the existing ones unless the payload
        // explicitly replaces them (the upload endpoints manage them).
        // Returns a valid pointer, null (explicit clear), or undefined (absent
        // → preserve the stored one).
        const readPointer = (v: unknown): { url: string; path: string } | null | undefined => {
          if (v === null) return null
          if (v && typeof v === 'object' && typeof (v as { url?: unknown }).url === 'string') {
            const p = v as { url: string; path?: unknown }
            if (/^https?:\/\//i.test(p.url)) {
              return { url: p.url, path: typeof p.path === 'string' ? p.path : '' }
            }
          }
          return undefined
        }
        const existing = byId.get(id)
        const logoNext = readPointer(m.logo)
        const logo = logoNext === undefined ? (existing?.logo ?? null) : logoNext
        const qrNext = readPointer(m.qr)
        const qr = qrNext === undefined ? (existing?.qr ?? null) : qrNext
        parsed.push({
          id,
          label,
          emoji: typeof m.emoji === 'string' && m.emoji.trim() ? m.emoji.trim().slice(0, 8) : '💳',
          accountName,
          accountNumber,
          instructions,
          logo,
          qr,
          active: m.active !== false,
          order:
            typeof m.order === 'number' && Number.isFinite(m.order)
              ? Math.min(Math.max(Math.floor(m.order), 0), 999)
              : parsed.length + 1,
        })
      }
      methods = parsed.sort((a, b) => a.order - b.order || a.label.localeCompare(b.label))
    } else {
      throw new Error('Payment methods must be a list.')
    }
  }

  const next: StorePaymentsConfig = { enabled, note, methods }
  await writePaymentsRow(next)
  return readStorePaymentsConfig()
}

/** Attach (or clear) a QR image on one method — upload done by the caller. */
export async function writePaymentMethodQr(
  methodId: string,
  qr: { url: string; path: string } | null,
): Promise<PaymentMethodConfig | null> {
  const current = await readStorePaymentsConfig()
  const idx = current.methods.findIndex((m) => m.id === methodId)
  if (idx === -1) return null
  const methods = current.methods.map((m) => (m.id === methodId ? { ...m, qr } : m))
  await writePaymentsRow({ ...current, methods })
  return methods.find((m) => m.id === methodId) ?? null
}

/** The current QR pointer of a method (for replace/remove storage cleanup). */
export async function readPaymentMethodQr(
  methodId: string,
): Promise<{ url: string; path: string } | null> {
  const current = await readStorePaymentsConfig()
  return current.methods.find((m) => m.id === methodId)?.qr ?? null
}

/** Attach (or clear) a LOGO image on one method — upload done by the caller. */
export async function writePaymentMethodLogo(
  methodId: string,
  logo: { url: string; path: string } | null,
): Promise<PaymentMethodConfig | null> {
  const current = await readStorePaymentsConfig()
  const idx = current.methods.findIndex((m) => m.id === methodId)
  if (idx === -1) return null
  const methods = current.methods.map((m) => (m.id === methodId ? { ...m, logo } : m))
  await writePaymentsRow({ ...current, methods })
  return methods.find((m) => m.id === methodId) ?? null
}

/** The current LOGO pointer of a method (for replace/remove storage cleanup). */
export async function readPaymentMethodLogo(
  methodId: string,
): Promise<{ url: string; path: string } | null> {
  const current = await readStorePaymentsConfig()
  return current.methods.find((m) => m.id === methodId)?.logo ?? null
}
