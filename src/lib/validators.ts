import { z } from 'zod'

export const usernameSchema = z
  .string()
  .trim()
  .min(3, 'Username must be at least 3 characters.')
  .max(24, 'Username must be at most 24 characters.')
  .regex(/^[a-zA-Z0-9_.]+$/, 'Username can only contain letters, numbers, dots and underscores.')

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

export const profileUpdateSchema = z.object({
  fullName: z.string().trim().min(2, 'Name must be at least 2 characters.').max(60).optional(),
  username: usernameSchema.optional(),
  bio: z.string().trim().max(280, 'Bio must be 280 characters or fewer.').optional(),
  avatarUrl: z.string().trim().max(2000).nullable().optional(),
  bannerUrl: z.string().trim().max(2000).nullable().optional(),
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
  avatarUrl: z.string().trim().max(2000).nullable().optional(),
  coverUrl: z.string().trim().max(2000).nullable().optional(),
})

/** ISO timestamp helper (accepts any parseable ISO 8601 string). */
const isoTimestamp = z
  .string()
  .trim()
  .refine((v) => !isNaN(Date.parse(v)), 'Please provide a valid date.')

export const officialPostSchema = z.object({
  title: z.string().trim().min(3, 'Title must be at least 3 characters.').max(120, 'Title must be at most 120 characters.'),
  content: z.string().trim().min(1, 'Post cannot be empty.').max(8000, 'Post must be 8000 characters or fewer.'),
  linkUrl: z.string().trim().max(500).optional(),
  attachments: z
    .array(
      z.object({
        url: z.string().trim().min(1).max(2000),
        fileName: z.string().trim().min(1).max(200),
        mimeType: z.string().trim().max(120),
        fileSize: z.number().int().min(1),
        fileType: z.enum(['image', 'video', 'audio', 'pdf', 'document']),
      })
    )
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

export const communityPostSchema = z.object({
  title: z.string().trim().min(3, 'Title must be at least 3 characters.').max(120, 'Title must be at most 120 characters.'),
  content: z.string().trim().min(1, 'Post cannot be empty.').max(8000, 'Post must be 8000 characters or fewer.'),
  linkUrl: z.string().trim().max(500).optional(),
  attachments: z
    .array(
      z.object({
        url: z.string().trim().min(1).max(2000),
        fileName: z.string().trim().min(1).max(200),
        mimeType: z.string().trim().max(120),
        fileSize: z.number().int().min(1),
        fileType: z.enum(['image', 'video', 'audio', 'pdf', 'document']),
      })
    )
    .max(12, 'A post can have at most 12 attachments.')
    .optional(),
})

export const messageSchema = z.object({
  content: z.string().trim().max(4000, 'Message is too long.').optional(),
  attachmentUrl: z.string().trim().max(3000).optional(),
  attachmentName: z.string().trim().max(200).optional(),
  messageType: z.enum(['text', 'image', 'file', 'audio']).optional(),
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
