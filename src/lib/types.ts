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

export type PostDTO = {
  id: string
  title: string
  content: string
  postType: string // article | announcement | tutorial | image | video | pdf | link | audio
  linkUrl: string | null
  status: string // published | draft
  isPublished: boolean
  createdAt: string
  updatedAt: string
  author: {
    id: string
    fullName: string
    username: string
    avatarUrl: string | null
    role: string
  }
  attachments: AttachmentDTO[]
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
