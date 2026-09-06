// Shared API types used by both server routes and the client app.

export type ApiError = { error: string }

export type SessionUser = {
  id: string
  email: string
  fullName: string
  username: string
  avatarUrl: string | null
  bannerUrl: string | null
  bio: string
  role: 'admin' | 'user'
  isVerified: boolean
  isBlocked: boolean
  createdAt: string
}

export type AttachmentDTO = {
  id: string
  fileType: 'image' | 'video' | 'audio' | 'pdf' | 'document' | 'link'
  fileName: string
  url: string | null
  mimeType: string
  fileSize: number
  linkUrl: string | null
}

/** CTA button on a post — stored as mux_post_attachments rows with file_type='cta'. */
export type CtaButtonDTO = {
  id: string
  label: string
  /** Exact destination URL as entered by the admin (query params preserved). */
  url: string
  sortOrder: number
}

export type CategoryDTO = {
  id: string
  name: string
  slug: string
  description: string | null
  color: string | null
  /** Lucide icon name (e.g. "Smartphone") — rendered client-side. */
  icon: string | null
  sortOrder: number
  isActive: boolean
  /** Only present in admin listings. */
  postsCount?: number
}

/** Username of the dedicated AI system account (never a real person). */
export const AI_ACCOUNT_USERNAME = 'muxamil.ai'

/**
 * Reaction types (spec §20/§71). The live v2 data stores TEXT TOKENS in
 * mux_post_reactions.emoji, and the DB CHECK constraint
 * (mux_post_reactions_emoji_check) allows EXACTLY these six values —
 * probed live. Widening the picker needs a DB CHECK constraint change
 * (DDL the API keys cannot perform), so the app allowlist stays 1:1
 * with the database.
 */
export const REACTION_TYPES = [
  'like', 'love', 'haha', 'wow', 'sad', 'fire',
] as const
export type ReactionType = (typeof REACTION_TYPES)[number]

/** Display emoji per reaction token. */
export const REACTION_EMOJI_MAP: Record<string, string> = {
  like: '👍',
  love: '❤️',
  haha: '😂',
  wow: '😮',
  sad: '😢',
  fire: '🔥',
  party: '🎉',
  clap: '👏',
  hundred: '💯',
  think: '🤔',
}

/** Emoji for a reaction token (fallback 👍 for unknown/legacy values). */
export function reactionEmoji(token: string): string {
  return REACTION_EMOJI_MAP[token] ?? '👍'
}

export type ReactionSummaryDTO = {
  emoji: string
  count: number
}

/** Polls are NOT a feature of Muxamil.co — every poll type, DTO and route
 *  was removed. mux_polls/mux_poll_options/mux_poll_votes rows stay dormant
 *  in the database (RLS default-deny blocks direct writes). */

export type PostDTO = {
  id: string
  title: string
  content: string
  postType: string // article | announcement | tutorial | image | video | pdf | link | audio
  linkUrl: string | null
  status: string // published | draft | scheduled
  isPublished: boolean
  isPinned: boolean
  publishedAt: string | null
  createdAt: string
  updatedAt: string
  /** Displayed engagement numbers (real + admin adjustment). */
  viewsCount: number
  likesCount: number
  /** Real member activity (never modified by display overrides). */
  viewsReal: number
  likesReal: number
  /**
   * Non-hidden replies authored by the AI system account. Members see this
   * as the subtle "AI response" disclosure (spec §32) — never a raw comment
   * thread (the Comments feature does not exist anywhere, spec §7/§9).
   */
  aiCommentsCount: number
  /**
   * The AI system account's reaction token on this post, when it has one
   * (null = none). This is AI ACTIVITY surfaced via the AI-activity
   * disclosure — it is NOT a member like and never mixes with likes_count
   * (real member likes) or the admin display override.
   */
  aiReaction: string | null
  category: { id: string; name: string; slug: string; color: string | null } | null
  /** Per-requesting-user state (false for anonymous). */
  isLiked: boolean
  isSaved: boolean
  author: {
    id: string
    fullName: string
    username: string
    avatarUrl: string | null
    role: string
  }
  attachments: AttachmentDTO[]
  ctaButtons: CtaButtonDTO[]
}

/** A single read-only AI-assistant activity item (spec §32 disclosure).
 *  Comments are NOT a product feature — this DTO describes ONLY rows
 *  authored by the muxamil.ai system account; nothing else is ever exposed. */
export type AiActivityItemDTO = {
  id: string
  postId: string
  content: string
  createdAt: string
  author: {
    id: string
    fullName: string
    username: string
    avatarUrl: string | null
  }
}

export type CommunityPostDTO = {
  id: string
  communityId: string
  title: string
  content: string
  status: 'pending' | 'approved' | 'rejected'
  rejectionReason: string | null
  reviewedAt: string | null
  createdAt: string
  updatedAt: string
  attachments: AttachmentDTO[]
}

export type CommunityDTO = {
  id: string
  name: string
  description: string
  avatarUrl: string | null
  coverUrl: string | null
  isActive: boolean
  membersCount: number
  createdAt: string
  owner: {
    id: string
    fullName: string
    username: string
    avatarUrl: string | null
    isVerified: boolean
  }
}

export type MessageDTO = {
  id: string
  conversationId: string
  senderId: string
  senderName: string
  senderAvatar: string | null
  senderRole: 'admin' | 'user'
  content: string
  messageType: 'text' | 'image' | 'file' | 'audio'
  attachmentUrl: string | null
  attachmentName: string | null
  readAt: string | null
  createdAt: string
}

export type ConversationDTO = {
  id: string
  userId: string
  userFullName: string
  username: string
  userAvatar: string | null
  isUserVerified: boolean
  isUserBlocked: boolean
  lastMessageAt: string
  lastMessage: string | null
  lastMessageSenderRole: string | null
  unreadCount: number
}

export type NotificationDTO = {
  id: string
  type: string
  message: string
  relatedId: string | null
  /** Post slug for new_post notifications (deep link /?post={id}). */
  entitySlug: string | null
  isRead: boolean
  createdAt: string
}

/** Per-user notification preferences (mux_notification_prefs; defaults true).
 *  DTO field `likes` maps to the physical `reactions` column — the label
 *  changed with the product (members like, no longer react); no data move.
 *  The historical `replies` column stays in the DB (defaults true) but has no
 *  product surface: the Comments feature does not exist, so no notification
 *  type gates on it anymore. */
export type NotificationPrefsDTO = {
  newPosts: boolean
  likes: boolean
  mentions: boolean
  messages: boolean
  updatedAt: string | null
}

/** Web-push registration state for the UI. */
export type PushStatusDTO = {
  supported: boolean
  subscribed: boolean
  /** False when subscription storage (compat store) is unreachable. */
  persistenceReady: boolean
}

/** Admin follower-management panel contract (spec §31/§32/§68). */
export type FollowerOverrideDTO = {
  userId: string
  fullName: string
  username: string | null
  /** REAL follower count — derived from mux_follows, never modified. */
  real: number
  /** Displayed value = real + adjustment (never negative). */
  displayed: number
  /** Admin-set signed adjustment (0 = no override). */
  adjustment: number
  /** False when the override storage (compat store) is unreachable. */
  overrideReady: boolean
}

export type AdminStats = {
  totalUsers: number
  verifiedUsers: number
  blockedUsers: number
  totalPosts: number
  pendingPosts: number
  approvedPosts: number
  rejectedPosts: number
  unreadMessages: number
  activeCommunities: number
  totalCommunities: number
  totalNotifications: number
}

/** Public branding + gates served to signed-in members (feed welcome strip). */
export type PublicSettings = {
  platform_name: string
  site_description: string
  logo_url: string | null
  support_email: string | null
  registration_enabled: boolean
  maintenance_mode: boolean
  /** Enabled platform social links (mux_social_links) — landing/footer. */
  social_links?: { title: string; url: string; platform: string; icon: string | null }[]
}

/** Admin platform settings (mux_site_settings row). */
export type PlatformSettings = {
  siteName: string
  siteDescription: string
  supportEmail: string | null
  registrationEnabled: boolean
  maintenanceMode: boolean
  communityApprovalRequired: boolean
  verificationEnabled: boolean
  contactEnabled: boolean
  updatedAt: string
}

export type AuditLogDTO = {
  id: string
  actorId: string | null
  actorName: string | null
  action: string
  /** "{targetType}:{targetId}" e.g. "user:uuid" — may be a plain word. */
  target: string | null
  metadata: Record<string, unknown> | null
  createdAt: string
}

export type SeriesPoint = { date: string; count: number }

/** Private admin analytics — every number comes from real stored data. */
export type AnalyticsDTO = {
  range: { from: string; to: string }
  totals: {
    totalMembers: number
    verifiedMembers: number
    newMembers: number
    activeMembers: number
    blockedMembers: number
    totalPosts: number
    publishedPosts: number
    draftPosts: number
    scheduledPosts: number
    realViews: number
    displayedViews: number
    realLikes: number
    displayedLikes: number
    aiReplies: number
    savedCount: number
    followCount: number
    ctaClicks: number
  }
  viewsSeries: SeriesPoint[]
  signupsSeries: SeriesPoint[]
  topPosts: {
    id: string
    title: string
    viewsReal: number
    viewsDisplayed: number
    likesReal: number
  }[]
  topCategories: { id: string; name: string; postsCount: number; viewsReal: number }[]
  /** Most recent AI automation jobs (auto_reply / auto_reaction), newest first.
   *  Read-only admin visibility into what the AI assistant actually did —
   *  job type, provider, trigger, the target post and when it ran. */
  aiJobs: {
    id: string
    jobType: 'auto_reply' | 'auto_reaction' | string
    provider: string | null
    triggerSource: string | null
    postId: string | null
    postTitle: string | null
    createdAt: string
  }[]
}
