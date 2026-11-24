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
  /** Banner focal point — drives the responsive cover display. */
  bannerFit: { x: number; y: number; scale: number } | null
  /** DP crop metadata (editor start position for re-adjustment). */
  avatarFit: { x: number; y: number; scale: number } | null
  /** Stored originals for lossless re-cropping. */
  avatarOriginalUrl: string | null
  bannerOriginalUrl: string | null
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

// ---------------------------------------------------------------------------
// Projects — a separate admin-managed content type on Explore (NOT categories)
// ---------------------------------------------------------------------------

/** An external link attached to a project (label + validated http(s) URL). */
export type ProjectLink = {
  label: string
  url: string
}

/** Public project shape — slugs identify projects; internal IDs never leak. */
export type ProjectDTO = {
  slug: string
  name: string
  shortDescription: string | null
  description: string | null
  logoUrl: string | null
  bannerUrl: string | null
  websiteUrl: string | null
  videoUrl: string | null
  additionalLinks: ProjectLink[]
  featured: boolean
}

/** Admin-only project shape — includes management fields. */
export type AdminProjectDTO = ProjectDTO & {
  id: string
  published: boolean
  displayOrder: number
  createdAt: string
  updatedAt: string
}

// ---------------------------------------------------------------------------
// Store — a separate commerce content type (products + orders), distinct from
// Categories / Projects / Posts. See src/lib/store.ts for the storage model.
// ---------------------------------------------------------------------------

/**
 * Public product shape — slugs identify products; internal IDs never leak.
 * The v2 marketplace fields (type/metadata/links/badges/tags/screenshots/
 * trust/downloads/rating) are all additive: products created before the
 * upgrade simply carry neutral defaults (type null, empty arrays, 0).
 */
export type ProductLinkDTO = {
  id: string
  label: string
  url: string
  kind: 'primary' | 'mirror'
  /** Archive/file password — only returned by the download endpoint. */
  password: string | null
  expiresAt: string | null
  direct: boolean
}

export type ProductVerificationDTO = {
  status: 'verified' | 'pending' | 'unverified'
  note: string | null
  url: string | null
}

export type ProductReviewDTO = {
  id: string
  rating: number
  comment: string | null
  createdAt: string
  author: { id: string; fullName: string; username: string; avatarUrl: string | null }
}

export type ProductDTO = {
  slug: string
  name: string
  shortDescription: string | null
  description: string | null
  productType: string | null
  features: string[]
  price: number | null
  /** Optional "old" price — rendered struck-through with a discount pill. */
  compareAtPrice: number | null
  currency: string
  availability: 'available' | 'unavailable'
  deliveryInfo: string | null
  terms: string | null
  websiteUrl: string | null
  imageUrl: string | null
  featured: boolean
  // ---- headless CMS (additive) ----
  /** Store category id (managed in Admin → Store → Categories). */
  category: string | null
  /** "What's Included" list (detail sidebar). */
  includes: string[]
  /** FAQ entries (detail FAQ tab). */
  faq: ProductFaqItemDTO[]
  /** "How it works" steps (any product type; tutorials may also use metadata steps). */
  steps: import('@/lib/store/product-types').ProductStep[]
  // ---- marketplace v2 (additive) ----
  /** Registry slug driving the dynamic form/detail rendering. */
  type: string | null
  /** Type-specific fields (validated against the registry server-side). */
  metadata: Record<string, import('@/lib/store/product-types').ProductMetadataValue>
  /** Download links (passwords stripped in public listings; expired filtered). */
  links: ProductLinkDTO[]
  /** Visual badges — always includes 'featured' when the featured flag is on. */
  badges: string[]
  tags: string[]
  screenshots: string[]
  credits: string | null
  verification: ProductVerificationDTO | null
  readFirst: string | null
  downloads: number
  ratingAvg: number | null
  ratingCount: number
  customHeader: string | null
  customFooter: string | null
  createdAt: string
  updatedAt: string
}

/** One admin-managed FAQ entry (question + answer). */
export type ProductFaqItemDTO = {
  q: string
  a: string
}

/** Admin-only product shape — includes management fields. */
export type AdminProductDTO = ProductDTO & {
  id: string
  published: boolean
  displayOrder: number
  /** When set (and not yet published): the product goes live automatically. */
  scheduledAt: string | null
}

/** Store branding + switches (admin-controlled name — never hard-coded). */
export type StoreSettingsDTO = {
  on: boolean
  name: string
  description: string | null
  logoUrl: string | null
  bannerUrl: string | null
  /** Optional phone-sized banner — falls back to the desktop banner when absent. */
  mobileBannerUrl: string | null
  /** Banner focal points (object-position %) — null = centered. */
  bannerPosition: { x: number; y: number } | null
  mobileBannerPosition: { x: number; y: number } | null
  currency: string
  whatsapp: string | null
  ordersEnabled: boolean
  // ---- headless CMS (additive) ----
  heroBadge: string | null
  heroTitle: string | null
  heroSubtitle: string | null
  footerText: string | null
  contactEmail: string | null
  faviconUrl: string | null
  socialLinks: StoreSocialLinkDTO[]
  seo: { title: string | null; description: string | null; keywords: string | null }
  updatedAt: string
}

/** One admin-managed social link (footer "Connect" column). */
export type StoreSocialLinkDTO = {
  platform: string
  label: string
  url: string
}

/** One admin-managed store category (pills + filters + product assignment). */
export type StoreCategoryDTO = {
  id: string
  name: string
  emoji: string
  blurb: string | null
  active: boolean
  order: number
}

/** One editable page (Admin → Store → Settings → Page Builder). */
export type StorePageDTO = {
  title: string
  body: string
  updatedAt: string | null
}

export type StorePagesDTO = {
  about: StorePageDTO
  contact: StorePageDTO
  privacy: StorePageDTO
}

/** One customer order (user_activity action='store.order'). */
export type StoreOrderDTO = {
  id: string
  userId: string
  orderNo: number
  productId: string
  productSlug: string
  productName: string
  productImage: string | null
  price: number | null
  currency: string
  status: 'inquiry' | 'pending' | 'processing' | 'delivered' | 'completed' | 'cancelled'
  paymentStatus: 'pending' | 'received'
  conversationId: string | null
  messageIds: string[]
  createdAt: string
  updatedAt?: string
  // ---- checkout flow (additive; present on payment-verified orders) ----
  /** Purchase state machine: pending_payment → under_review → approved → redeemed (⇄ rejected). */
  checkoutState?: import('@/lib/store-format').CheckoutState | null
  /** Payment method label snapshot (e.g. "EasyPaisa") — set at proof submission. */
  paymentMethodLabel?: string | null
  /** Customer-submitted transaction id (TID). */
  transactionId?: string | null
  /** Whether a payment screenshot is attached (the file itself is served via a
   *  fresh signed URL only on the dedicated order endpoints — never in lists). */
  hasScreenshot?: boolean
  /** Freshly-minted signed screenshot URL (present only on single-order GETs). */
  screenshotUrl?: string | null
  /** Admin's rejection reason (checkoutState === 'rejected'). */
  rejectionReason?: string | null
  /** When the customer submitted their payment proof. */
  paymentSubmittedAt?: string | null
  /** When the admin approved/rejected the payment. */
  reviewedAt?: string | null
}

/** One admin-configured payment method (checkout "Select payment method"). */
export type PaymentMethodDTO = {
  id: string
  label: string
  emoji: string
  accountName: string
  accountNumber: string
  instructions: string | null
  qrUrl: string | null
  /** Optional method logo (admin-uploaded) — shown on the checkout cards. */
  logoUrl: string | null
  active: boolean
  order: number
}

/** The payments configuration surfaced to the checkout page. */
export type StorePaymentsDTO = {
  enabled: boolean
  note: string | null
  methods: PaymentMethodDTO[]
}

/** Compact order card embedded into chat messages and order lists. */
export type OrderCardDTO = {
  id: string
  orderNo: number
  productId: string
  productSlug: string
  productName: string
  productImage: string | null
  price: number | null
  currency: string
  status: StoreOrderDTO['status']
  paymentStatus: StoreOrderDTO['paymentStatus']
  createdAt: string
}

/** Admin store analytics bundle (all aggregates, no raw rows). */
export type StoreAnalyticsDTO = {
  totals: {
    products: number
    published: number
    drafts: number
    scheduled: number
    orders: number
    openOrders: number
    sales: number
    revenueReceived: number
    revenueOrdered: number
    customers: number
    users: number
    downloads: number
    reviews: number
    avgRating: number | null
  }
  daily: {
    downloads: { date: string; count: number }[]
    orders: { date: string; count: number }[]
  }
  top: {
    id: string
    slug: string
    name: string
    imageUrl: string | null
    downloads: number
    orders: number
    ratingAvg: number | null
  }[]
  recentOrders: (StoreOrderDTO & {
    customer: { id: string; fullName: string; username: string; avatarUrl: string | null }
  })[]
  recentReviews: {
    id: string
    rating: number
    comment: string | null
    createdAt: string
    productName: string
    productSlug: string
    author: { id: string; fullName: string; username: string; avatarUrl: string | null }
  }[]
}

/** Username of the dedicated AI system account (never a real person). */
export const AI_ACCOUNT_USERNAME = 'muxamil.ai'

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
  /** Real member activity (never modified by display overrides).
   *  ADMIN-ONLY: omitted from member-facing responses so members cannot
   *  compute the display overrides — only admin endpoints/routes include it. */
  viewsReal?: number
  likesReal?: number
  commentsCount: number
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

export type CommentDTO = {
  id: string
  postId: string
  parentId: string | null
  content: string
  isHidden: boolean
  /** True when authored by the AI system account. */
  isAi: boolean
  likesCount: number
  isLiked: boolean
  createdAt: string
  updatedAt: string
  author: {
    id: string
    fullName: string
    username: string
    avatarUrl: string | null
    isVerified: boolean
    role: string
  }
  replies?: CommentDTO[]
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
  messageType: 'text' | 'image' | 'file' | 'audio' | 'order'
  attachmentUrl: string | null
  attachmentName: string | null
  readAt: string | null
  createdAt: string
  /** Present on order messages (attachmentType='order') — the product/order
   *  context card rendered inside the chat bubble (server-enriched). */
  order?: OrderCardDTO | null
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

// ---------------------------------------------------------------------------
// Verified-user direct messages (template `conversations` /
// `conversation_participants` / `messages` tables, category 'verified_dm').
// Completely separate from the member↔admin chat (mux_*) above.
// ---------------------------------------------------------------------------

/** The other side of a DM conversation, as shown on rows and thread headers. */
export type DmUserDTO = {
  id: string
  fullName: string
  username: string
  avatarUrl: string | null
  isVerified: boolean
  /** 'active' | 'blocked' — blocked peers can no longer exchange messages. */
  status: string
  /** Last activity (socket connect/disconnect maintained) — null unknown. */
  lastActiveAt: string | null
}

/** Attachment carried by a DM message (signed URL minted at read time). */
export type DmAttachmentDTO = {
  fileType: 'image' | 'video' | 'audio' | 'pdf' | 'document'
  fileName: string
  mimeType: string
  fileSize: number
  url: string
  /** Voice message — rendered as a voice bubble with duration. */
  voice: boolean
  /** Duration in seconds when known (voice messages). */
  duration: number | null
}

/** Quoted reply context rendered inside a bubble. */
export type DmReplyToDTO = {
  id: string
  senderId: string
  senderName: string
  /** Short text preview — media labels for attachment messages. */
  preview: string
  isMine: boolean
}

/** Aggregated reactions on one DM message. */
export type DmReactionDTO = {
  emoji: string
  count: number
  /** The viewer's own reaction (exactly one emoji per user per message). */
  mine: boolean
}

/** One DM conversation row in the member's inbox. */
export type DmConversationDTO = {
  id: string
  otherUser: DmUserDTO
  /** Last activity time (newest message, else the conversation's updated_at). */
  lastMessageAt: string
  /** Newest message preview (null before the first message). */
  lastMessage: string | null
  lastMessageSenderId: string | null
  unreadCount: number
  /** Per-viewer chat controls (stored in the viewer's profile appearance). */
  pinned: boolean
  muted: boolean
  archived: boolean
  /** True when either side blocks the other (composer is replaced). */
  blockedByMe: boolean
  blockedMe: boolean
  /** Manually marked unread by the viewer (dot badge, no number). */
  markedUnread: boolean
}

/** One message inside a DM thread. */
export type DmMessageDTO = {
  id: string
  conversationId: string
  senderId: string
  content: string
  createdAt: string
  sender: {
    id: string
    fullName: string
    avatarUrl: string | null
    isVerified: boolean
  } | null
  /** Attachment metadata with a freshly signed URL (null for text-only). */
  attachment: DmAttachmentDTO | null
  /** Quoted reply target (resolved server-side; null when not a reply). */
  replyTo: DmReplyToDTO | null
  /** Soft-delete tombstone time — content is stripped for deleted messages. */
  deletedAt: string | null
  /** Reactions aggregated across both participants. */
  reactions: DmReactionDTO[]
  /** When the sender last edited this message (null when never edited). */
  editedAt: string | null
  /** Original sender's display name when this message was forwarded here. */
  forwardedFrom: string | null
}

/**
 * Admin-controlled communication feature switches (feature_flags rows).
 * Every flag defaults to ON when its row is missing; a present-but-disabled
 * row is a deliberate admin action and is always honored server-side.
 */
export type DmFeatureFlags = {
  memberChat: boolean
  newConversations: boolean
  imageMessages: boolean
  videoMessages: boolean
  fileMessages: boolean
  voiceMessages: boolean
  reactions: boolean
  messageEditing: boolean
  messageDeletion: boolean
  forwarding: boolean
  linkPreviews: boolean
  readReceipts: boolean
  onlineStatus: boolean
  lastSeen: boolean
  typing: boolean
  blocking: boolean
  reporting: boolean
}

/** Search hit inside a DM conversation (jump-to-message). */
export type DmMessageSearchHit = {
  id: string
  senderId: string
  createdAt: string
  snippet: string
}

/** Lightweight public member profile used for @mention resolution. */
export type MentionUserDTO = {
  id: string
  fullName: string
  username: string
  avatarUrl: string | null
  isVerified: boolean
  role: 'admin' | 'user'
}

/** Admin-side report row (user_activity action='dm.report'). */
export type ReportDTO = {
  id: string
  reporter: { id: string; fullName: string; username: string; avatarUrl: string | null } | null
  reported: { id: string; fullName: string; username: string; avatarUrl: string | null } | null
  messageId: string | null
  conversationId: string | null
  reason: string
  details: string | null
  /** Message snippet when the report targets a DM message. */
  messageSnippet: string | null
  status: 'open' | 'resolved' | 'dismissed'
  createdAt: string
  resolvedAt: string | null
}

export type NotificationDTO = {
  id: string
  type: string
  message: string
  relatedId: string | null
  entitySlug?: string | null
  isRead: boolean
  createdAt: string
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
  /** Master switch: can members start/send member-to-member DMs? */
  member_chat_enabled: boolean
  /** Enabled platform social links (mux_social_links) — landing/footer. */
  social_links?: { title: string; url: string; platform: string; icon: string | null }[]
  /** Communication feature switches (link previews etc.). */
  dm_flags?: DmFeatureFlags
  // ---- website branding (additive) ----
  favicon_url?: string | null
  short_name?: string | null
  tagline?: string | null
  footer_text?: string | null
  og_image?: string | null
  brand_colors?: { primary: string | null; accent: string | null } | null
}

/** Admin-side website branding (public URLs only — paths stay server-side). */
export type SiteBrandingDTO = {
  shortName: string | null
  tagline: string | null
  browserTitle: string | null
  metaDescription: string | null
  footerText: string | null
  logoUrl: string | null
  faviconUrl: string | null
  ogImageUrl: string | null
  colors: { primary: string | null; accent: string | null }
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
  /** Master switch for member-to-member chat (feature_flags.member_chat). */
  memberChatEnabled: boolean
  /** Granular communication controls (feature_flags dm_* rows). */
  dmFlags: DmFeatureFlags
  /** Website branding (logo/favicon/OG/identity/colors) — additive. */
  branding?: SiteBrandingDTO
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
    memberReplies: number
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
    comments: number
  }[]
  topCategories: { id: string; name: string; postsCount: number; viewsReal: number }[]
}


/** Approved reaction tokens used by the Muxamil production database. */
export const REACTION_TYPES = [
  'like', 'love', 'haha', 'wow', 'sad', 'fire',
] as const

export type ReactionType = (typeof REACTION_TYPES)[number]

export const REACTION_EMOJI_MAP: Record<string, string> = {
  like: '\u{1F44D}',
  love: '\u2764\uFE0F',
  haha: '\u{1F602}',
  wow: '\u{1F62E}',
  sad: '\u{1F622}',
  fire: '\u{1F525}',
  party: '\u{1F389}',
  clap: '\u{1F44F}',
}

export function reactionEmoji(token: string): string {
  return REACTION_EMOJI_MAP[token] ?? '\u{1F44D}'
}

export type NotificationPrefsDTO = {
  newPosts: boolean
  likes: boolean
  mentions: boolean
  messages: boolean
  updatedAt: string | null
}
export type FollowerOverrideDTO = {
  userId: string
  fullName: string
  username: string | null
  real: number
  displayed: number
  adjustment: number
  overrideReady: boolean
}
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