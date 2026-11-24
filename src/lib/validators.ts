import { z } from 'zod'

export const usernameSchema = z
  .string()
  .trim()
  .min(3, 'Username must be at least 3 characters.')
  .max(24, 'Username must be at most 24 characters.')
  .regex(/^[a-zA-Z0-9_.]+$/, 'Username can only contain letters, numbers, dots and underscores.')

/** Reserved handles no member may register — prevents admin/system
 *  impersonation through confusing usernames. Compared case-insensitively. */
export const RESERVED_USERNAMES = new Set([
  'admin', 'administrator', 'moderator', 'mod', 'staff', 'support', 'help',
  'official', 'owner', 'root', 'system', 'security', 'team', 'ceo', 'me',
  'muxamil', 'muxamil_admin', 'muxamil.ai', 'muxamil_ai', 'everyone', 'here',
])

export function isReservedUsername(username: string): boolean {
  return RESERVED_USERNAMES.has(username.trim().toLowerCase())
}

export function usernameProblem(username: string): string | null {
  const parsed = usernameSchema.safeParse(username)
  if (!parsed.success) return parsed.error.issues[0]?.message ?? 'Invalid username.'
  if (isReservedUsername(parsed.data)) return 'That username is reserved.'
  return null
}

export const registerSchema = z.object({
  fullName: z.string().trim().min(2, 'Please enter your full name.').max(60, 'Name is too long.'),
  username: usernameSchema,
  email: z.string().trim().email('Please enter a valid email address.'),
  password: z.string().min(8, 'Password must be at least 8 characters.').max(72, 'Password is too long.'),
})

export const loginSchema = z.object({
  email: z.string().trim().email('Please enter a valid email address.'),
  password: z.string().min(1, 'Please enter your password.'),
})

/** Optional profile/community image URL — null clears the image, any
 *  non-null value must be http(s) (these URLs are rendered as <img src>;
 *  platform uploads always return Supabase storage http(s) URLs, so a
 *  `javascript:`/`data:` value is never legitimate). */
const imageUrlSchema = z
  .string()
  .trim()
  .max(2000)
  .refine((v) => /^https?:\/\//i.test(v), 'Image URL must be a valid http(s) URL.')
  .nullable()
  .optional()

export const profileUpdateSchema = z.object({
  fullName: z.string().trim().min(2, 'Name must be at least 2 characters.').max(60).optional(),
  username: usernameSchema.optional(),
  bio: z.string().trim().max(280, 'Bio must be 280 characters or fewer.').optional(),
  avatarUrl: imageUrlSchema,
  bannerUrl: imageUrlSchema,
  /** Crop/zoom/focal metadata for the profile photo + banner (0..1 focal,
   *  1..4 zoom) — stored in mux_profiles.appearance, originals preserved. */
  avatarFit: z
    .object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), scale: z.number().min(1).max(4) })
    .nullable()
    .optional(),
  avatarOriginalUrl: imageUrlSchema,
  bannerFit: z
    .object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), scale: z.number().min(1).max(4) })
    .nullable()
    .optional(),
  bannerOriginalUrl: imageUrlSchema,
})

export const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1, 'Please enter your current password.'),
  newPassword: z
    .string()
    .min(8, 'New password must be at least 8 characters.')
    .max(72, 'New password is too long.'),
})

export const communitySchema = z.object({
  name: z.string().trim().min(3, 'Community name must be at least 3 characters.').max(60, 'Community name is too long.'),
  description: z.string().trim().max(1000, 'Description must be 1000 characters or fewer.').optional(),
  avatarUrl: imageUrlSchema,
  coverUrl: imageUrlSchema,
})

/** ISO timestamp helper (accepts any parseable ISO 8601 string). */
const isoTimestamp = z
  .string()
  .trim()
  .refine((v) => !isNaN(Date.parse(v)), 'Please provide a valid date.')

/** Attachment url validator — http(s) only (uploads return storage URLs; the
 *  UI renders attachment urls as <a href>, so `javascript:` would be XSS). */
const attachmentUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(2000)
  .refine((v) => /^https?:\/\//i.test(v), 'Attachment URL must be a valid http(s) URL.')

/** Attachment descriptor — shared by official posts, community posts and the
 *  admin post PATCH route so every write path validates identically. */
export const attachmentSchema = z.object({
  url: attachmentUrlSchema,
  fileName: z.string().trim().min(1).max(200),
  mimeType: z.string().trim().max(120),
  fileSize: z.number().int().min(1),
  fileType: z.enum(['image', 'video', 'audio', 'pdf', 'document']),
})

export const officialPostSchema = z.object({
  title: z.string().trim().min(3, 'Title must be at least 3 characters.').max(120, 'Title must be at most 120 characters.'),
  content: z.string().trim().min(1, 'Post cannot be empty.').max(8000, 'Post must be 8000 characters or fewer.'),
  linkUrl: z.string().trim().max(500).optional(),
  attachments: z.array(attachmentSchema)
    .max(12, 'A post can have at most 12 attachments.')
    .optional(),
  /** published (default) | draft | scheduled (requires future publishedAt). */
  status: z.enum(['published', 'draft', 'scheduled']).optional(),
  /** Required (and must be in the future) when status='scheduled'. */
  publishedAt: isoTimestamp.optional(),
  /** mux_categories id — null clears the assignment. */
  categoryId: z.string().uuid('Category not found.').nullable().optional(),
  /** Pin the post to the top of the feed. */
  isPinned: z.boolean().optional(),
  /** CTA buttons — stored as mux_post_attachments rows with file_type='cta'. */
  ctaButtons: z
    .array(
      z.object({
        label: z.string().trim().min(1, 'Button label cannot be empty.').max(60, 'Button label is too long.'),
        url: z.string().trim().min(1).max(2000, 'Button URL is too long.'),
      })
    )
    .max(4, 'A post can have at most 4 buttons.')
    .optional(),
})

/** Member comment create — @mentions are parsed out of content server-side. */
export const commentCreateSchema = z.object({
  content: z.string().trim().min(1, 'Comment cannot be empty.').max(2000, 'Comment must be 2000 characters or fewer.'),
  parentId: z.string().uuid('Parent comment not found.').nullable().optional(),
})

export const communityPostSchema = z.object({
  title: z.string().trim().min(3, 'Title must be at least 3 characters.').max(120, 'Title must be at most 120 characters.'),
  content: z.string().trim().min(1, 'Post cannot be empty.').max(8000, 'Post must be 8000 characters or fewer.'),
  linkUrl: z.string().trim().max(500).optional(),
  attachments: z.array(attachmentSchema)
    .max(12, 'A post can have at most 12 attachments.')
    .optional(),
})

export const messageSchema = z.object({
  content: z.string().trim().max(4000, 'Message is too long.').optional(),
  /**
   * Attachment URLs must be http(s) — uploads always come back as Supabase
   * storage public/signed URLs, and the chat UI renders attachmentUrl as an
   * <a href> / <img src>, so a `javascript:` value would be stored XSS.
   */
  attachmentUrl: z
    .string()
    .trim()
    .max(3000)
    .refine((v) => /^https?:\/\//i.test(v), 'Attachment URL must be a valid http(s) URL.')
    .optional(),
  attachmentName: z.string().trim().max(200).optional(),
  messageType: z.enum(['text', 'image', 'file', 'audio']).optional(),
  /**
   * Store order context (requirement 24): when present, the message carries a
   * product/order card. The id is re-verified server-side (the sender must own
   * the order, admins may reference any) — never trusted from the client.
   */
  orderId: z
    .string()
    .trim()
    .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'Invalid order reference.')
    .optional(),
})

/** Verified-user DM message create — text and/or one attachment, optionally a
 *  quoted reply. Text is 1–2000 chars when the message has text at all. */
export const dmAttachmentSchema = z.object({
  url: z
    .string()
    .trim()
    .min(1)
    .max(3000)
    .refine((v) => /^https?:\/\//i.test(v), 'Attachment URL must be a valid http(s) URL.'),
  fileName: z.string().trim().min(1).max(200),
  mimeType: z.string().trim().min(1).max(120),
  fileSize: z.number().int().min(1).max(100 * 1024 * 1024),
  fileType: z.enum(['image', 'video', 'audio', 'pdf', 'document']),
  /** Voice message flag (display only; audio attachments). */
  voice: z.boolean().optional(),
  /** Duration in seconds (voice messages). */
  duration: z.number().min(0).max(7200).optional(),
})

export const dmMessageSchema = z
  .object({
    body: z.string().trim().max(2000, 'Message must be 2000 characters or fewer.').optional(),
    attachment: dmAttachmentSchema.optional(),
    replyToId: z.string().uuid('Invalid reply target.').optional(),
  })
  .refine((v) => (v.body !== undefined && v.body.length > 0) || !!v.attachment, {
    message: 'Message cannot be empty.',
  })

/** Chat control toggles (pin / mute / archive / mark-unread a conversation). */
export const dmConversationSettingsSchema = z.object({
  pinned: z.boolean().optional(),
  muted: z.boolean().optional(),
  archived: z.boolean().optional(),
  markUnread: z.boolean().optional(),
})

/** Edit one of the caller's own DM messages (text portion only).
 *  Text may be emptied when the message carries an attachment; the route
 *  enforces that a message always keeps text or an attachment. */
export const dmMessageEditSchema = z.object({
  body: z.string().max(2000, 'Message must be 2000 characters or fewer.'),
})

/** Forward a DM message into 1–5 of the caller's existing conversations. */
export const dmForwardSchema = z.object({
  conversationIds: z
    .array(z.string().uuid('Invalid conversation.'))
    .min(1, 'Choose at least one conversation.')
    .max(5, 'You can forward to at most 5 chats at once.'),
})

/** Admin-side per-user messaging restriction. */
export const chatRestrictionSchema = z.object({
  restricted: z.boolean(),
  reason: z.string().trim().max(300, 'Reason must be 300 characters or fewer.').optional(),
})

/** Report reasons (member + message reports). */
export const reportSchema = z.object({
  reportedUserId: z.string().uuid('Invalid user.'),
  messageId: z.string().uuid('Invalid message.').nullable().optional(),
  conversationId: z.string().uuid('Invalid conversation.').nullable().optional(),
  reason: z.enum(['spam', 'harassment', 'inappropriate', 'impersonation', 'other']),
  details: z.string().trim().max(500, 'Details must be 500 characters or fewer.').optional(),
})

/** Admin report resolution. */
export const reportResolutionSchema = z.object({
  status: z.enum(['resolved', 'dismissed']),
})

/** Reaction emoji — single emoji, no arbitrary text. */
export const reactionSchema = z.object({
  emoji: z
    .string()
    .trim()
    .min(1)
    .max(16)
    .refine((v) => /^\p{Extended_Pictographic}(\uFE0F|\u200D\p{Extended_Pictographic})*$/u.test(v), {
      message: 'Reactions must be a single emoji.',
    }),
})

/** Only http(s) links are ever accepted or rendered. */
export function sanitizeLink(raw: string): string | null {
  try {
    const url = new URL(raw.trim())
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return url.toString()
    }
    return null
  } catch {
    return null
  }
}
