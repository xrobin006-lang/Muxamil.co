/**
 * PRODUCT TYPE REGISTRY — the schema-driven engine behind the dynamic store.
 * ---------------------------------------------------------------------------
 * One source of truth shared by the Admin Product Builder (conditional form
 * fields) and the storefront product page (type-specific detail sections).
 *
 * Adding a product type in the future = adding ONE entry here. No UI code
 * changes anywhere — the admin form, the public detail page, the category
 * tabs and the search facets all render from these definitions.
 *
 * PURE + CLIENT-SAFE: no server imports (unlike src/lib/store.ts). Both
 * client components and API routes may import this file.
 */

/** Value shapes a metadata field can hold (stored in product config jsonb). */
export type ProductMetadataValue = string | number | string[] | ProductStep[]

/** One step of a step-by-step tutorial product. */
export type ProductStep = {
  title: string
  text: string
}

/** Field input kinds the admin builder knows how to render. */
export type ProductFieldType = 'text' | 'number' | 'textarea' | 'select' | 'tags' | 'steps'

export type ProductFieldDef = {
  key: string
  label: string
  type: ProductFieldType
  emoji?: string
  placeholder?: string
  hint?: string
  /** Options for `select` fields. */
  options?: string[]
}

export type ProductTypeDef = {
  slug: string
  name: string
  emoji: string
  blurb: string
  fields: ProductFieldDef[]
}

/**
 * The seeded type catalogue. Intentionally data-driven: every field below is
 * rendered generically by the builder + detail page, so this list can grow
 * with the store without touching component code.
 */
export const PRODUCT_TYPES: ProductTypeDef[] = [
  {
    slug: 'app',
    name: 'App / Software',
    emoji: '📱',
    blurb: 'Applications, tools and software releases with version details.',
    fields: [
      { key: 'version', label: 'Version', type: 'text', emoji: '🏷️', placeholder: 'e.g. 2.4.1' },
      { key: 'fileSize', label: 'File size', type: 'text', emoji: '💾', placeholder: 'e.g. 78 MB' },
      {
        key: 'platform',
        label: 'Platform',
        type: 'select',
        emoji: '🖥️',
        options: ['Android', 'Windows', 'macOS', 'Linux', 'iOS', 'Web', 'Cross-platform'],
      },
      { key: 'requirements', label: 'Requirements', type: 'text', emoji: '⚙️', placeholder: 'e.g. Android 8.0+, 4GB RAM' },
      { key: 'changelog', label: "What's new in this version", type: 'textarea', emoji: '📝', placeholder: 'Latest changes, fixes and improvements…' },
    ],
  },
  {
    slug: 'course',
    name: 'Course / Bundle',
    emoji: '🎓',
    blurb: 'Video courses, learning bundles and structured programs.',
    fields: [
      { key: 'duration', label: 'Total duration', type: 'text', emoji: '⏱️', placeholder: 'e.g. 12h 30m' },
      { key: 'lessons', label: 'Lessons / modules', type: 'number', emoji: '📚', placeholder: '24' },
      {
        key: 'level',
        label: 'Difficulty level',
        type: 'select',
        emoji: '📶',
        options: ['Beginner', 'Intermediate', 'Advanced', 'All levels'],
      },
      { key: 'language', label: 'Language', type: 'text', emoji: '🗣️', placeholder: 'e.g. English / Urdu' },
      { key: 'includes', label: "What's included", type: 'tags', emoji: '✅', hint: 'Press Enter after each item', placeholder: 'Video lessons, Worksheets…' },
    ],
  },
  {
    slug: 'guide',
    name: 'Guide / E-book',
    emoji: '📚',
    blurb: 'PDFs, e-books, methods and written knowledge products.',
    fields: [
      { key: 'format', label: 'File format', type: 'select', emoji: '📄', options: ['PDF', 'Video', 'Audio', 'Interactive', 'Mixed'] },
      { key: 'pages', label: 'Pages / length', type: 'number', emoji: '🔢', placeholder: '48' },
      { key: 'author', label: 'Author', type: 'text', emoji: '✍️', placeholder: 'Original author or creator' },
      { key: 'readTime', label: 'Estimated read time', type: 'text', emoji: '⌛', placeholder: 'e.g. 35 min' },
    ],
  },
  {
    slug: 'trick',
    name: 'Tricks / Tips',
    emoji: '💡',
    blurb: 'Digital tricks, tips and quick methods for apps and platforms.',
    fields: [
      { key: 'platform', label: 'Where it works', type: 'text', emoji: '🎯', placeholder: 'e.g. Android, Instagram, WhatsApp' },
      {
        key: 'difficulty',
        label: 'Difficulty',
        type: 'select',
        emoji: '📶',
        options: ['Easy', 'Medium', 'Advanced'],
      },
    ],
  },
  {
    slug: 'tool',
    name: 'Tool / Utility',
    emoji: '🛠️',
    blurb: 'Digital tools, utilities and creator software.',
    fields: [
      { key: 'version', label: 'Version', type: 'text', emoji: '🏷️', placeholder: 'e.g. 1.0.2' },
      {
        key: 'platform',
        label: 'Platform',
        type: 'select',
        emoji: '🖥️',
        options: ['Android', 'Windows', 'macOS', 'Linux', 'iOS', 'Web', 'Cross-platform'],
      },
      { key: 'fileSize', label: 'File size', type: 'text', emoji: '💾', placeholder: 'e.g. 15 MB' },
    ],
  },
  {
    slug: 'bundle',
    name: 'Bundle / Resources',
    emoji: '📦',
    blurb: 'Multi-product bundles and curated resource packs.',
    fields: [
      { key: 'items', label: 'Items in this bundle', type: 'number', emoji: '🧺', placeholder: '6' },
      { key: 'includes', label: "What's included", type: 'tags', emoji: '✅', hint: 'Press Enter after each item', placeholder: 'Courses, Tools, Templates…' },
      { key: 'formats', label: 'Formats', type: 'tags', emoji: '🗂️', hint: 'Press Enter after each item', placeholder: 'APK, PDF, ZIP…' },
    ],
  },
  {
    slug: 'tutorial',
    name: 'Step-by-Step Tutorial',
    emoji: '🧭',
    blurb: 'Numbered walkthroughs — readers follow along one step at a time.',
    fields: [
      {
        key: 'steps',
        label: 'Tutorial steps',
        type: 'steps',
        emoji: '🪜',
        hint: 'Each step gets a title, instructions and an optional screenshot.',
      },
    ],
  },
  {
    slug: 'membership',
    name: 'Membership / Subscription',
    emoji: '⭐',
    blurb: 'Premium access plans, community memberships and subscriptions.',
    fields: [
      { key: 'plan', label: 'Plan name', type: 'text', emoji: '🏷️', placeholder: 'e.g. Premium Access' },
      {
        key: 'validity',
        label: 'Validity',
        type: 'select',
        emoji: '📆',
        options: ['1 Month', '3 Months', '6 Months', '1 Year', 'Lifetime'],
      },
      { key: 'includes', label: 'What access includes', type: 'tags', emoji: '🎁', hint: 'Press Enter after each item', placeholder: 'Premium groups, Early access…' },
      { key: 'delivery', label: 'How access is delivered', type: 'textarea', emoji: '🚚', placeholder: 'Explain how the buyer receives access after purchase…' },
    ],
  },
  {
    slug: 'license',
    name: 'License Key',
    emoji: '🔑',
    blurb: 'Software license keys and activation codes.',
    fields: [
      { key: 'delivery', label: 'Key delivery method', type: 'select', emoji: '📤', options: ['Instant after order', 'Sent via chat', 'Sent via email'] },
      { key: 'activation', label: 'Activation instructions', type: 'textarea', emoji: '🧩', placeholder: 'How to redeem / activate the key…' },
      { key: 'seats', label: 'Seats / devices', type: 'number', emoji: '💺', placeholder: '1' },
    ],
  },
  {
    slug: 'template',
    name: 'Template / Graphics',
    emoji: '🎨',
    blurb: 'Design templates, graphics packs and creative assets.',
    fields: [
      { key: 'formats', label: 'File formats', type: 'tags', emoji: '🗂️', hint: 'Press Enter after each item', placeholder: 'PSD, AI, Figma…' },
      { key: 'compatibility', label: 'Compatible with', type: 'text', emoji: '🧷', placeholder: 'e.g. Photoshop 2021+, Illustrator' },
      { key: 'license', label: 'Usage license', type: 'select', emoji: '📜', options: ['Personal', 'Commercial', 'Extended'] },
    ],
  },
  {
    slug: 'prompt_pack',
    name: 'Prompt Pack',
    emoji: '✨',
    blurb: 'Curated AI prompt collections for tools like Midjourney and ChatGPT.',
    fields: [
      { key: 'tools', label: 'Compatible tools', type: 'tags', emoji: '🤖', hint: 'Press Enter after each item', placeholder: 'Midjourney, ChatGPT, Claude…' },
      { key: 'promptCount', label: 'Number of prompts', type: 'number', emoji: '💯', placeholder: '150' },
      { key: 'sample', label: 'Sample prompt', type: 'textarea', emoji: '👀', placeholder: 'Show one prompt as a preview…' },
    ],
  },
  {
    slug: 'other',
    name: 'Other / Custom',
    emoji: '📦',
    blurb: 'Anything else — add your own custom fields below.',
    fields: [],
  },
]

export const DEFAULT_PRODUCT_TYPE = 'other'

const TYPE_MAP = new Map(PRODUCT_TYPES.map((t) => [t.slug, t]))

/** Look up a type definition (null for unknown/absent types). */
export function productTypeDef(slug: string | null | undefined): ProductTypeDef | null {
  if (!slug) return null
  return TYPE_MAP.get(slug) ?? null
}

/** True when the slug is one of the registered types. */
export function isKnownProductType(slug: string | null | undefined): boolean {
  return !!slug && TYPE_MAP.has(slug)
}

/** Human label for a type slug (falls back to a provided label or "Product"). */
export function productTypeLabel(slug: string | null | undefined, fallback?: string | null): string {
  const def = productTypeDef(slug)
  if (def) return def.name
  return fallback && fallback.trim() ? fallback.trim() : 'Product'
}

/** Emoji for a type slug (falls back to 📦). */
export function productTypeEmoji(slug: string | null | undefined): string {
  return productTypeDef(slug)?.emoji ?? '📦'
}

/** Options array for the admin "Product Type" select. */
export const PRODUCT_TYPE_OPTIONS = PRODUCT_TYPES.map((t) => ({ value: t.slug, label: `${t.emoji}  ${t.name}` }))

/** Field keys allowed for a type slug (empty for free-form "other"). */
export function productTypeFieldKeys(slug: string | null | undefined): Set<string> {
  const def = productTypeDef(slug)
  return new Set(def?.fields.map((f) => f.key) ?? [])
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

export type BadgeDef = { key: string; label: string; emoji: string }

/** Visual badge catalogue (featured is mirrored from the legacy boolean). */
export const BADGE_DEFS: BadgeDef[] = [
  { key: 'featured', label: 'Featured', emoji: '⭐' },
  { key: 'trending', label: 'Popular', emoji: '🔥' },
  { key: 'new', label: 'New', emoji: '🆕' },
  { key: 'premium', label: 'Premium', emoji: '💎' },
]

export const BADGE_KEYS = BADGE_DEFS.map((b) => b.key)

export function badgeDef(key: string): BadgeDef | null {
  return BADGE_DEFS.find((b) => b.key === key) ?? null
}

// ---------------------------------------------------------------------------
// Metadata helpers (shared by the builder, the detail page and validation)
// ---------------------------------------------------------------------------

/** Readable one-line value for a metadata field (cards, tooltips). */
export function metadataValueToString(value: ProductMetadataValue | undefined): string | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'string') return value.trim() ? value.trim() : null
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null
  if (Array.isArray(value)) {
    if (value.length === 0) return null
    // Tag lists join naturally; step lists summarise their count.
    if (typeof value[0] === 'string') return (value as string[]).join(', ')
    return `${value.length} step${value.length === 1 ? '' : 's'}`
  }
  return null
}

/** Field definitions relevant for a product (empty for free-form types). */
export function fieldsForType(slug: string | null | undefined): ProductFieldDef[] {
  return productTypeDef(slug)?.fields ?? []
}
