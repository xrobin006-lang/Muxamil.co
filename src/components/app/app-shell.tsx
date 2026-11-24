'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Bell,
  BellRing,
  MessageSquare,
  MessageCircle,
  Home,
  Users,
  User as UserIcon,
  Settings as SettingsIcon,
  ShieldCheck,
  ShieldAlert,
  UsersRound,
  LayoutDashboard,
  FileText,
  UserCheck,
  CheckCircle2,
  MessagesSquare,
  LogOut,
  Menu,
  ChevronLeft,
  Radio,
  Compass,
  Bookmark,
  Tags,
  BarChart3,
  ShieldBan,
  Link2,
  Search,
  FolderKanban,
  Store as StoreIcon,
  Package,
  BookOpen,
  ArrowUpRight,
  GraduationCap,
  Mail,
  Gift,
  BookOpenText,
  Clapperboard,
  FileSearch,
  Banknote,
  Wallet,
  Palette,
  History,
  Inbox,
  Coins,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useAppStore, type View } from '@/stores/app-store'
import { apiGet } from '@/lib/api-client'
import { useSocketEvent } from '@/hooks/use-realtime'
import { UserAvatar } from './components/user-avatar'
import { VerifiedBadge } from './components/verified-badge'
import { AdminSearch, useAdminSearchShortcut } from './components/admin-search'
import { StoreMobileNav } from './components/store/store-chrome'
import type { PublicSettings } from '@/lib/types'
import { cn } from '@/lib/utils'

import FeedView from './views/feed-view'
import PeopleView from './views/people-view'
import NotificationsView from './views/notifications-view'
import ChatView from './views/chat-view'
import DmView from './views/dm-view'
import ProfileView from './views/profile-view'
import UserProfileView from './views/user-profile-view'
import FollowingView from './views/following-view'
import CommunityView from './views/community-view'
import MyCommunityView from './views/my-community-view'
import SettingsView from './views/settings-view'
import AdminDashboard from './views/admin/admin-dashboard'
import AdminUsers from './views/admin/admin-users'
import AdminPosts from './views/admin/admin-posts'
import AdminApprovals from './views/admin/admin-approvals'
import AdminCommunities from './views/admin/admin-communities'
import AdminMessages from './views/admin/admin-messages'
import AdminSettings from './views/admin/admin-settings'
import AdminCategories from './views/admin/admin-categories'
import AdminProjects from './views/admin/admin-projects'
import AdminAnalytics from './views/admin/admin-analytics'
import AdminModeration from './views/admin/admin-moderation'
import AdminLinks from './views/admin/admin-links'
import AdminWorkGuideline from './views/admin/admin-work-guideline'
import ExploreView from './views/explore-view'
import CategoriesView from './views/categories-view'
import CategoryView from './views/category-view'
import ProjectsView from './views/projects-view'
import ProjectView from './views/project-view'
import StoreView from './views/store-view'
import ProductView from './views/product-view'
import CheckoutView from './views/checkout-view'
import MyOrdersView from './views/my-orders-view'
import AdminStore from './views/admin/admin-store'
import SavedView from './views/saved-view'

type NavItem = { label: string; icon: typeof Home; view: View; badge?: 'notifications' | 'messages' | 'dm' | 'approvals' }
type NavGroup = { label: string; items: NavItem[] }

const USER_NAV: NavItem[] = [
  { label: 'Home', icon: Home, view: { name: 'feed' } },
  { label: 'Explore', icon: Compass, view: { name: 'explore' } },
  { label: 'Store', icon: StoreIcon, view: { name: 'store' } },
  { label: 'People', icon: Users, view: { name: 'people' } },
  { label: 'Saved', icon: Bookmark, view: { name: 'saved' } },
  { label: 'Admin Chat', icon: MessageSquare, view: { name: 'chat' }, badge: 'messages' },
  { label: 'Direct Messages', icon: MessageCircle, view: { name: 'dm' }, badge: 'dm' },
  { label: 'Notifications', icon: Bell, view: { name: 'notifications' }, badge: 'notifications' },
]

const USER_NAV_SECONDARY: NavItem[] = [
  { label: 'My Community', icon: UsersRound, view: { name: 'my-community' } },
  { label: 'Profile', icon: UserIcon, view: { name: 'profile' } },
  { label: 'My Orders', icon: Package, view: { name: 'my-orders' } },
  { label: 'Settings', icon: SettingsIcon, view: { name: 'settings' } },
]

/** Member bottom-bar slots flanking the floating Store button (explicit, so
 *  sidebar re-ordering can never accidentally duplicate a slot). */
const MEMBER_MOBILE_NAV: NavItem[] = [
  { label: 'Home', icon: Home, view: { name: 'feed' } },
  { label: 'Explore', icon: Compass, view: { name: 'explore' } },
  { label: 'People', icon: Users, view: { name: 'people' } },
  { label: 'Saved', icon: Bookmark, view: { name: 'saved' } },
]

/**
 * Admin navigation, organized into logical sections. Work Hub management is
 * mounted natively in this same console and uses the shared Muxamil session.
 */
const ADMIN_NAV_GROUPS: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { label: 'Dashboard', icon: LayoutDashboard, view: { name: 'admin-dashboard' } },
      { label: 'Analytics', icon: BarChart3, view: { name: 'admin-analytics' } },
    ],
  },
  {
    label: 'Communication',
    items: [
      { label: 'Messages', icon: MessagesSquare, view: { name: 'admin-messages' }, badge: 'messages' },
    ],
  },
  {
    label: 'Content',
    items: [
      { label: 'Official Posts', icon: FileText, view: { name: 'admin-posts' } },
      { label: 'Categories', icon: Tags, view: { name: 'admin-categories' } },
      { label: 'Projects', icon: FolderKanban, view: { name: 'admin-projects' } },
      { label: 'CTA Buttons', icon: Link2, view: { name: 'admin-links' } },
    ],
  },
  {
    label: 'Store',
    items: [
      { label: 'Store', icon: StoreIcon, view: { name: 'admin-store' } },
    ],
  },
  {
    label: 'Members',
    items: [
      { label: 'Users', icon: UserCheck, view: { name: 'admin-users' } },
      { label: 'Communities', icon: UsersRound, view: { name: 'admin-communities' } },
    ],
  },
  {
    label: 'Review & Safety',
    items: [
      { label: 'Approvals', icon: CheckCircle2, view: { name: 'admin-approvals' }, badge: 'approvals' },
      { label: 'Moderation', icon: ShieldBan, view: { name: 'admin-moderation' } },
    ],
  },
  {
    label: 'Work Hub · Programs & Learning',
    items: [
      { label: 'Work Hub Overview', icon: LayoutDashboard, view: { name: 'admin-work-guideline', section: 'overview' } },
      { label: 'Microsoft Rewards', icon: GraduationCap, view: { name: 'admin-work-guideline', section: 'programs' } },
      { label: 'Gmail Rewards', icon: Mail, view: { name: 'admin-work-guideline', section: 'gmail-task' } },
      { label: 'Gift Card Rates', icon: Gift, view: { name: 'admin-work-guideline', section: 'card-rates' } },
      { label: 'Read Guides', icon: BookOpenText, view: { name: 'admin-work-guideline', section: 'guides' } },
      { label: 'Tutorial Videos', icon: Clapperboard, view: { name: 'admin-work-guideline', section: 'videos' } },
    ],
  },
  {
    label: 'Work Hub · Operations',
    items: [
      { label: 'Submissions', icon: FileSearch, view: { name: 'admin-work-guideline', section: 'submissions' } },
      { label: 'Payments & Payouts', icon: Banknote, view: { name: 'admin-work-guideline', section: 'payments' } },
      { label: 'Work Hub Members', icon: UserCheck, view: { name: 'admin-work-guideline', section: 'members' } },
      { label: 'Contact Messages', icon: Inbox, view: { name: 'admin-work-guideline', section: 'contact-messages' } },
    ],
  },
  {
    label: 'Work Hub · Configuration',
    items: [
      { label: 'Branding & Content', icon: Palette, view: { name: 'admin-work-guideline', section: 'branding' } },
      { label: 'Payout Methods', icon: Wallet, view: { name: 'admin-work-guideline', section: 'payment-methods' } },
      { label: 'Website Settings', icon: SettingsIcon, view: { name: 'admin-work-guideline', section: 'settings' } },
      { label: 'Currency Settings', icon: Coins, view: { name: 'admin-work-guideline', section: 'currency' } },
      { label: 'Work Hub Activity Log', icon: History, view: { name: 'admin-work-guideline', section: 'activity' } },
    ],
  },
  {
    label: 'Settings',
    items: [{ label: 'Platform Settings', icon: SettingsIcon, view: { name: 'admin-settings' } }],
  },
]

/** The four most useful mobile destinations for an admin (bottom bar). */
const ADMIN_MOBILE_NAV: NavItem[] = [
  { label: 'Dashboard', icon: LayoutDashboard, view: { name: 'admin-dashboard' } },
  { label: 'Messages', icon: MessagesSquare, view: { name: 'admin-messages' }, badge: 'messages' },
  { label: 'Approvals', icon: CheckCircle2, view: { name: 'admin-approvals' }, badge: 'approvals' },
  { label: 'Users', icon: UserCheck, view: { name: 'admin-users' } },
]

const VIEW_TITLES: Record<string, string> = {
  feed: 'Home',
  explore: 'Explore',
  categories: 'Categories',
  people: 'People',
  saved: 'Saved',
  notifications: 'Notifications',
  chat: 'Admin Chat',
  dm: 'Direct Messages',
  profile: 'My Profile',
  user: 'Profile',
  following: 'Following',
  community: 'Community',
  category: 'Category',
  projects: 'Projects',
  project: 'Project',
  store: 'Store',
  product: 'Product',
  checkout: 'Checkout',
  'my-orders': 'My Orders',
  'my-community': 'My Community',
  settings: 'Settings',
  'admin-dashboard': 'Dashboard',
  'admin-users': 'Users',
  'admin-posts': 'Official Posts',
  'admin-categories': 'Categories',
  'admin-projects': 'Projects',
  'admin-store': 'Store',
  'admin-analytics': 'Analytics',
  'admin-moderation': 'Moderation',
  'admin-links': 'CTA Buttons',
  'admin-approvals': 'Approvals',
  'admin-communities': 'Communities',
  'admin-messages': 'Messages',
  'admin-settings': 'Platform Settings',
  'admin-work-guideline': 'Work Hub Administration',
}

/** Brand mark: fetched logo when available, otherwise the chat-bubble monogram. */
function BrandMark({ logoUrl, platformName, size = 'md' }: { logoUrl: string | null; platformName: string; size?: 'md' | 'sm' }) {
  const box = size === 'md' ? 'h-10 w-10' : 'h-9 w-9'
  const icon = size === 'md' ? 'h-5 w-5' : 'h-[18px] w-[18px]'
  if (logoUrl) {
    return <img src={logoUrl} alt={`${platformName} logo`} className={cn(box, 'rounded-xl object-cover shadow-sm ring-1 ring-black/[0.04] dark:ring-white/10')} />
  }
  return (
    <div className={cn(box, 'flex items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm')} aria-hidden="true">
      <svg viewBox="0 0 24 24" className={icon} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
      </svg>
    </div>
  )
}

/** Tiny uppercase section label used between nav groups. */
function SectionLabel({ children }: { children: string }) {
  return (
    <p className="px-3 pb-1.5 pt-5 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/50">
      {children}
    </p>
  )
}

export default function AppShell({ onLogout }: { onLogout: () => void }) {
  const user = useAppStore((s) => s.user)!
  const view = useAppStore((s) => s.view)
  const navigate = useAppStore((s) => s.navigate)
  const back = useAppStore((s) => s.back)
  const unreadNotifications = useAppStore((s) => s.unreadNotifications)
  const unreadMessages = useAppStore((s) => s.unreadMessages)
  const unreadDm = useAppStore((s) => s.dmUnread)

  const isAdmin = user.role === 'admin'

  /** The storefront views render IMMERSIVELY: they bring their own chrome
   *  (dynamic header, footer and mobile bottom nav), so the app sidebar,
   *  header and footer step aside while a store view is active. Every other
   *  view keeps the standard layout untouched. */
  const storeImmersive = view.name === 'store' || view.name === 'product' || view.name === 'checkout'

  // Admin quick-search palette (Ctrl/Cmd+K) + mobile drawer state.
  const [searchOpen, setSearchOpen] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  useAdminSearchShortcut(searchOpen, setSearchOpen)

  // Pending-approvals badge for the nav (amber). Fetched once per session and
  // refreshed when new submissions arrive or when the queue is visited.
  const [pendingApprovals, setPendingApprovals] = useState(0)
  useEffect(() => {
    if (!isAdmin) return
    apiGet<{ pendingPosts: number }>('/api/admin/stats')
      .then((s) => setPendingApprovals(s.pendingPosts ?? 0))
      .catch(() => {
        /* decorative badge — stays hidden (0) when unavailable */
      })
  }, [isAdmin])
  useSocketEvent('community-post:new', () => {
    if (!isAdmin) return
    setPendingApprovals((n) => n + 1)
  })
  useEffect(() => {
    if (!isAdmin || view.name !== 'admin-approvals') return
    apiGet<{ pendingPosts: number }>('/api/admin/stats')
      .then((s) => setPendingApprovals(s.pendingPosts ?? 0))
      .catch(() => {
        /* keep the last known count */
      })
  }, [isAdmin, view.name])

  // Platform branding (site name) for the sidebar header — public endpoint.
  const [platformName, setPlatformName] = useState('Muxamil.co')
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [footerNote, setFooterNote] = useState('a safe, moderated community platform.')

  useEffect(() => {
    apiGet<{ settings: PublicSettings }>('/api/settings')
      .then((data) => {
        if (data.settings.platform_name?.trim()) setPlatformName(data.settings.platform_name.trim())
        setLogoUrl(data.settings.logo_url ?? null)
        if (data.settings.footer_text?.trim()) setFooterNote(data.settings.footer_text.trim())
      })
      .catch(() => {
        /* decorative — the fallback name is shown */
      })
  }, [])

  const title = useMemo(() => VIEW_TITLES[view.name] ?? 'Muxamil.co', [view.name])
  const canGoBack = useAppStore((s) => s.history.length > 0)

  const badgeFor = (item: NavItem) =>
    item.badge === 'notifications'
      ? unreadNotifications
      : item.badge === 'messages'
        ? unreadMessages
        : item.badge === 'dm'
          ? unreadDm
          : item.badge === 'approvals'
            ? pendingApprovals
            : 0

  const isActive = (item: NavItem) => {
    if (view.name !== item.view.name) return false
    if (view.name === 'admin-work-guideline' && item.view.name === 'admin-work-guideline') {
      return view.section === item.view.section
    }
    return true
  }

  /** One mobile bottom-nav item (shared by every slot of the bottom bar). */
  const mobileNavItem = (item: NavItem) => {
    const badge = badgeFor(item)
    const active = isActive(item)
    const badgeTone = item.badge === 'approvals' ? 'bg-amber-500' : 'bg-primary'
    return (
      <button
        key={item.label}
        type="button"
        onClick={() => navigate(item.view)}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'relative flex flex-col items-center justify-center gap-1 text-[10px] font-medium transition-all duration-150 active:scale-90',
          active ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
        )}
      >
        <span className="relative flex items-center">
          <item.icon className={cn('h-5 w-5 transition-transform duration-150', active && 'scale-110')} aria-hidden="true" />
          {/* Tiny emerald dot under the active icon */}
          <span
            className={cn(
              'absolute -bottom-1.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-primary transition-all duration-200',
              active ? 'scale-100 opacity-100' : 'scale-0 opacity-0',
            )}
            aria-hidden="true"
          />
        </span>
        <span className="truncate">{item.label.split(' ')[0]}</span>
        {badge > 0 && (
          <span className={cn('absolute right-3 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold tabular-nums text-white shadow-sm', badgeTone)}>
            {badge > 9 ? '9+' : badge}
          </span>
        )}
      </button>
    )
  }

  /** One nav button — shared by every nav surface (rail, sheet, bottom bar). */
  const navButton = (item: NavItem, badgeTone: 'primary' | 'amber' = 'primary') => {
    const badge = badgeFor(item)
    const active = isActive(item)
    return (
      <button
        key={item.label}
        type="button"
        onClick={() => navigate(item.view)}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'group flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          active
            ? 'bg-primary/10 font-semibold text-primary'
            : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground',
        )}
      >
        <item.icon
          className={cn(
            'h-[18px] w-[18px] shrink-0 transition-transform duration-150',
            !active && 'group-hover:scale-110',
          )}
          aria-hidden="true"
        />
        <span className="flex-1 truncate text-left">{item.label}</span>
        {badge > 0 && (
          <span
            className={cn(
              'flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums text-white shadow-sm',
              badgeTone === 'amber' ? 'bg-amber-500' : 'bg-primary',
            )}
          >
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </button>
    )
  }

  const navList = (items: NavItem[]) => (
    <nav className="space-y-1" aria-label="Main navigation">
      {items.map((item) => navButton(item))}
    </nav>
  )

  /** Sidebar body — admin sees grouped sections; members keep their lists. */
  const workGuidelineLink = (
    <a
      href="/work-guideline"
      aria-label="Open Muxamil Work Hub: programs, tutorials, tasks and payments"
      className="group relative mb-4 mt-2 block overflow-hidden rounded-2xl border border-emerald-500/25 bg-gradient-to-br from-emerald-50 via-teal-50 to-primary/5 p-3.5 shadow-[0_14px_30px_-20px_rgba(16,185,129,0.35)] transition-all duration-200 hover:-translate-y-0.5 hover:border-emerald-500/45 hover:shadow-[0_18px_34px_-18px_rgba(16,185,129,0.45)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span aria-hidden="true" className="pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full bg-emerald-400/15 blur-2xl" />
      <span className="relative flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-500 text-white shadow-lg shadow-emerald-900/20 ring-1 ring-white/20">
          <BookOpen className="h-5 w-5" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-emerald-800">Muxamil Work Hub</span>
            <span className="rounded-full border border-emerald-600/25 bg-emerald-100/80 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-800">Featured</span>
          </span>
          <span className="mt-1 block text-sm font-bold leading-snug text-sidebar-foreground">Find work. Learn. Earn.</span>
          <span className="mt-1 block text-[11px] leading-relaxed text-sidebar-foreground/70">Tutorials, tasks, submissions &amp; payouts — all inside Muxamil.</span>
          <span className="mt-2.5 inline-flex items-center gap-1 text-[11px] font-bold text-emerald-800">
            Explore Work Hub <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden="true" />
          </span>
        </span>
      </span>
    </a>
  )

  const sidebarBody = isAdmin ? (
    <>
    <nav className="space-y-0" aria-label="Main navigation">
      {ADMIN_NAV_GROUPS.map((group) => (
        <div key={group.label}>
          <SectionLabel>{group.label}</SectionLabel>
          <div className="space-y-1">
            {group.items.map((item) => navButton(item, item.badge === 'approvals' ? 'amber' : 'primary'))}
          </div>
        </div>
      ))}
    </nav>
    </>
  ) : (
    <>
      {workGuidelineLink}
      {navList(USER_NAV)}
      {user.isVerified && (
        <>
          <SectionLabel>Creator</SectionLabel>
          {navList([USER_NAV_SECONDARY[0]])}
        </>
      )}
      <SectionLabel>Account</SectionLabel>
      {navList(USER_NAV_SECONDARY.slice(1))}
    </>
  )

  /** Sidebar footer (user card + sign out) shared by the desktop rail and the mobile sheet. */
  const sidebarFooter = (
    <>
      <button
        type="button"
        onClick={() => navigate(isAdmin ? { name: 'admin-settings' } : { name: 'profile' })}
        className="flex w-full items-center gap-3 rounded-xl p-2 text-left transition-colors hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <UserAvatar name={user.fullName} url={user.avatarUrl} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1 truncate text-sm font-medium leading-tight">
            <span className="truncate" dir="auto">{user.fullName}</span>
            {user.isVerified && <VerifiedBadge size={14} />}
          </p>
          <p className="truncate text-xs text-sidebar-foreground/60">@{user.username}</p>
        </div>
      </button>
      {/* Quick hop back to the public website (admins only — members are
          already on the member side). */}
      {isAdmin && (
        <button
          type="button"
          onClick={() => navigate({ name: 'explore' })}
          className="mt-1 flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Compass className="h-[18px] w-[18px]" aria-hidden="true" /> View website
        </button>
      )}
      <button
        type="button"
        onClick={onLogout}
        className="mt-1 flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <LogOut className="h-[18px] w-[18px]" aria-hidden="true" /> Sign out
      </button>
    </>
  )

  return (
    <div className="flex min-h-screen bg-muted/30">
      {/* Desktop sidebar — light, premium (hidden while the immersive Store is active) */}
      {!storeImmersive && (
      <aside className="sticky top-0 hidden h-screen w-72 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex">
        <div className="flex items-center gap-3 px-5 pb-2 pt-6">
          <BrandMark logoUrl={logoUrl} platformName={platformName} />
          <div className="min-w-0">
            <p className="truncate text-base font-bold leading-tight tracking-tight" dir="auto">{platformName}</p>
            <p className="mt-0.5 text-[11px] font-medium text-sidebar-foreground/60">
              {isAdmin ? 'Admin Console' : 'Member'}
            </p>
          </div>
        </div>

        <div className="flex-1 space-y-1 overflow-y-auto px-3 pb-4 scrollbar-thin">
          {!isAdmin && <SectionLabel>Menu</SectionLabel>}
          {sidebarBody}
        </div>

        {/* Sidebar footer — user card */}
        <div className="border-t border-sidebar-border p-3 pt-3">{sidebarFooter}</div>
      </aside>
      )}

      {/* Main column */}
      <div className="flex min-h-screen w-full min-w-0 flex-1 flex-col">
        {/* Header (hidden while the immersive Store is active — the Store has
            its own dynamic top navigation) */}
        {!storeImmersive && (
        <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/70">
          <div className="mx-auto flex h-16 max-w-4xl items-center gap-1.5 px-3 sm:gap-2 sm:px-4">
            {/* Mobile menu (opens the sidebar sheet) */}
            <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0 lg:hidden" aria-label="Open menu">
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent
                side="left"
                className="flex w-80 max-w-[85vw] flex-col gap-0 border-sidebar-border bg-sidebar p-0 text-sidebar-foreground"
              >
                <SheetTitle className="px-5 pb-2 pt-6 text-left">
                  <span className="flex items-center gap-3">
                    <BrandMark logoUrl={logoUrl} platformName={platformName} size="sm" />
                    <span className="min-w-0">
                      <span className="block truncate text-base font-bold leading-tight tracking-tight" dir="auto">
                        {platformName}
                      </span>
                      <span className="mt-0.5 block text-[11px] font-medium text-sidebar-foreground/60">
                        {isAdmin ? 'Admin Console' : 'Member'}
                      </span>
                    </span>
                  </span>
                </SheetTitle>
                {isAdmin && (
                  <div className="px-3 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setMobileNavOpen(false)
                        setSearchOpen(true)
                      }}
                      className="flex w-full items-center gap-2.5 rounded-xl border border-sidebar-border bg-sidebar-accent/40 px-3 py-2.5 text-sm text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <span className="flex-1 text-left">Search admin panel…</span>
                      <kbd className="rounded border border-sidebar-border px-1.5 py-0.5 text-[10px] font-medium text-sidebar-foreground/50">⌘K</kbd>
                    </button>
                  </div>
                )}
                <div className="flex-1 space-y-1 overflow-y-auto px-3 pb-4 scrollbar-thin">
                  {!isAdmin && <SectionLabel>Menu</SectionLabel>}
                  {sidebarBody}
                </div>
                <div className="border-t border-sidebar-border p-3">{sidebarFooter}</div>
              </SheetContent>
            </Sheet>

            {/* Back button when there is history */}
            {canGoBack && view.name !== 'feed' && view.name !== 'admin-dashboard' && (
              <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={back} aria-label="Go back">
                <ChevronLeft className="h-5 w-5" />
              </Button>
            )}

            <h1 className="min-w-0 flex-1 truncate text-base font-semibold tracking-tight sm:text-lg">{title}</h1>

            {/* Admin quick-search (desktop header; drawer holds it on mobile) */}
            {isAdmin && (
              <Button
                variant="ghost"
                size="sm"
                className="hidden h-9 shrink-0 gap-2 px-3 text-muted-foreground sm:flex"
                onClick={() => setSearchOpen(true)}
                aria-label="Search admin panel"
              >
                <Search className="h-4 w-4" aria-hidden="true" />
                <span className="text-sm">Search</span>
                <kbd className="pointer-events-none ml-1 rounded border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">⌘K</kbd>
              </Button>
            )}

            {/* Support / messages shortcut — members: Admin Chat (the official
                support channel); admins: the member-inbox console. */}
            <Button
              variant="ghost"
              size="icon"
              className="relative h-9 w-9 shrink-0"
              onClick={() => navigate(isAdmin ? { name: 'admin-messages' } : { name: 'chat' })}
              aria-label={`${isAdmin ? 'Messages' : 'Admin Chat'}${unreadMessages ? `, ${unreadMessages} unread` : ''}`}
            >
              <MessageSquare className="h-5 w-5" />
              {unreadMessages > 0 && (
                <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold tabular-nums text-primary-foreground">
                  {unreadMessages > 9 ? '9+' : unreadMessages}
                </span>
              )}
            </Button>

            {/* Notifications */}
            <Button
              variant="ghost"
              size="icon"
              className="relative h-9 w-9 shrink-0"
              onClick={() => navigate({ name: 'notifications' })}
              aria-label={`Notifications${unreadNotifications ? `, ${unreadNotifications} unread` : ''}`}
            >
              {unreadNotifications > 0 ? <BellRing className="h-5 w-5 text-primary" /> : <Bell className="h-5 w-5" />}
              {unreadNotifications > 0 && (
                <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold tabular-nums text-primary-foreground">
                  {unreadNotifications > 9 ? '9+' : unreadNotifications}
                </span>
              )}
            </Button>

            {/* Avatar menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label="Account menu"
                >
                  <UserAvatar name={user.fullName} url={user.avatarUrl} size="sm" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <div className="flex items-center gap-2.5">
                    <UserAvatar name={user.fullName} url={user.avatarUrl} size="sm" />
                    <div className="min-w-0">
                      <p className="flex items-center gap-1 truncate text-sm font-medium">
                        {user.fullName}
                        {user.isVerified && <VerifiedBadge size={13} />}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">@{user.username}</p>
                    </div>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate(isAdmin ? { name: 'admin-settings' } : { name: 'profile' })}>
                  <UserIcon className="mr-2 h-4 w-4" /> {isAdmin ? 'Admin profile' : 'My profile'}
                </DropdownMenuItem>
                {!isAdmin && (
                  <DropdownMenuItem onClick={() => navigate({ name: 'my-orders' })}>
                    <Package className="mr-2 h-4 w-4" /> My Orders
                  </DropdownMenuItem>
                )}
                {isAdmin && (
                  <DropdownMenuItem onClick={() => navigate({ name: 'explore' })}>
                    <Compass className="mr-2 h-4 w-4" /> View website
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => navigate({ name: 'settings' })}>
                  <SettingsIcon className="mr-2 h-4 w-4" /> Settings
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onLogout} variant="destructive">
                  <LogOut className="mr-2 h-4 w-4" /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        )}

        {/* View content — the immersive Store manages its own full-width layout */}
        <main
          id="main-content"
          className={
            storeImmersive
              ? 'w-full flex-1'
              : view.name === 'admin-work-guideline'
                ? 'mx-auto w-full max-w-7xl flex-1 px-3 pb-28 pt-5 sm:px-5 lg:pb-10'
                : 'mx-auto w-full max-w-4xl flex-1 px-3 pb-28 pt-5 sm:px-4 lg:pb-10'
          }
        >
          <CurrentView />
        </main>

        {/* Admin quick-search palette (Ctrl/Cmd+K) */}
        {isAdmin && <AdminSearch open={searchOpen} onOpenChange={setSearchOpen} />}

        {/* Footer — sticks to the bottom, pushed down naturally on overflow
            (hidden while the immersive Store is active — it has its own) */}
        {!storeImmersive && (
        <footer className="mt-auto hidden border-t bg-background py-4 lg:block">
          <div className="mx-auto flex max-w-4xl items-center justify-between px-4 text-xs text-muted-foreground">
            <p>© {new Date().getFullYear()} {platformName} — {footerNote}</p>
            <p className="flex items-center gap-1.5">
              <Radio className="h-3 w-3 text-primary" aria-hidden="true" /> Realtime connected
            </p>
          </div>
        </footer>
        )}
      </div>

      {/* Mobile bottom navigation — the immersive Store swaps in its own */}
      {storeImmersive ? (
        <StoreMobileNav />
      ) : (
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur lg:hidden"
        aria-label="Primary"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className={cn('mx-auto grid h-16 max-w-md', isAdmin ? 'grid-cols-5' : 'grid-cols-6')}>
          {(isAdmin ? ADMIN_MOBILE_NAV : MEMBER_MOBILE_NAV.slice(0, 2)).map(mobileNavItem)}

          {/* Floating circular "M" — one-tap access to the Store (members
              only; raised above the bar with a soft brand-tinted shadow). */}
          {!isAdmin && (
            <button
              type="button"
              onClick={() => navigate({ name: 'store' })}
              aria-label="Open the Store"
              className="relative flex flex-col items-center justify-end gap-1 pb-1.5 text-[10px] font-medium text-muted-foreground transition-all duration-150 hover:text-foreground active:scale-90"
            >
              <span
                className="absolute -top-3 left-1/2 flex h-12 w-12 -translate-x-1/2 items-center justify-center rounded-full border border-primary/40 bg-gradient-to-br from-primary to-primary/80 text-lg font-black tracking-tight text-primary-foreground shadow-lg shadow-primary/50"
                aria-hidden="true"
              >
                {logoUrl ? (
                  <img src={logoUrl} alt="" className="h-7 w-7 rounded-full object-cover" />
                ) : (
                  'M'
                )}
              </span>
              <span className="text-muted-foreground">Store</span>
            </button>
          )}

          {(isAdmin ? [] : MEMBER_MOBILE_NAV.slice(2, 4)).map(mobileNavItem)}
          <button
            type="button"
            onClick={() => navigate(isAdmin ? { name: 'admin-settings' } : { name: 'profile' })}
            aria-current={view.name === (isAdmin ? 'admin-settings' : 'profile') ? 'page' : undefined}
            className={cn(
              'relative flex flex-col items-center justify-center gap-1 text-[10px] font-medium transition-all duration-150 active:scale-90',
              view.name === (isAdmin ? 'admin-settings' : 'profile') ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <span className="relative flex items-center">
              {isAdmin ? <ShieldCheck className="h-5 w-5" aria-hidden="true" /> : <UserIcon className="h-5 w-5" aria-hidden="true" />}
              {view.name === (isAdmin ? 'admin-settings' : 'profile') && (
                <span className="absolute -bottom-1.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-primary" aria-hidden="true" />
              )}
            </span>
            <span>{isAdmin ? 'Admin' : 'Profile'}</span>
          </button>
        </div>
      </nav>
      )}
    </div>
  )
}

function CurrentView() {
  const view = useAppStore((s) => s.view)
  const user = useAppStore((s) => s.user)

  // Admin route protection: normal users can never render admin views.
  if (view.name.startsWith('admin-') && user?.role !== 'admin') {
    return <AdminDenied />
  }

  switch (view.name) {
    case 'feed':
      return <FeedView />
    case 'explore':
      return <ExploreView initialCategory={view.categorySlug} initialQuery={view.q} />
    case 'categories':
      return <CategoriesView />
    case 'people':
      return <PeopleView />
    case 'saved':
      return <SavedView />
    case 'notifications':
      return <NotificationsView />
    case 'chat':
      return <ChatView orderContext={view.orderContext} />
    case 'dm':
      return <DmView initialConversationId={view.conversationId} />
    case 'profile':
      return <ProfileView />
    case 'user':
      return <UserProfileView userId={view.userId} />
    case 'following':
      return <FollowingView userId={view.userId} />
    case 'community':
      return <CommunityView communityId={view.communityId} />
    case 'category':
      return <CategoryView categorySlug={view.categorySlug} />
    case 'projects':
      return <ProjectsView />
    case 'project':
      return <ProjectView projectSlug={view.projectSlug} />
    case 'store':
      return <StoreView />
    case 'product':
      return <ProductView productSlug={view.productSlug} />
    case 'checkout':
      return <CheckoutView orderId={view.orderId} />
    case 'my-orders':
      return <MyOrdersView />
    case 'my-community':
      return <MyCommunityView />
    case 'settings':
      return <SettingsView />
    case 'admin-dashboard':
      return <AdminDashboard />
    case 'admin-users':
      return <AdminUsers initialFilter={view.filter} />
    case 'admin-posts':
      return <AdminPosts />
    case 'admin-categories':
      return <AdminCategories />
    case 'admin-projects':
      return <AdminProjects />
    case 'admin-store':
      return <AdminStore initialSection={view.section} />
    case 'admin-analytics':
      return <AdminAnalytics />
    case 'admin-moderation':
      return <AdminModeration />
    case 'admin-links':
      return <AdminLinks />
    case 'admin-approvals':
      return <AdminApprovals />
    case 'admin-communities':
      return <AdminCommunities />
    case 'admin-messages':
      return <AdminMessages initialConversationId={view.conversationId} initialUserId={view.userId} />
    case 'admin-settings':
      return <AdminSettings initialSection={view.section} />
    case 'admin-work-guideline':
      return <AdminWorkGuideline section={view.section} />
    default:
      return <FeedView />
  }
}

function AdminDenied() {
  const navigate = useAppStore((s) => s.navigate)
  return (
    <div className="flex min-h-[50vh] items-center justify-center py-10">
      <div className="flex w-full max-w-sm flex-col items-center rounded-2xl border bg-card p-8 text-center shadow-sm">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <ShieldAlert className="h-7 w-7" aria-hidden="true" />
        </div>
        <h2 className="mt-4 text-lg font-bold tracking-tight">Admins only</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          You do not have permission to view this area. If you believe this is a mistake, contact the platform admin.
        </p>
        <Button variant="outline" size="sm" className="mt-5" onClick={() => navigate({ name: 'feed' })}>
          Back to home
        </Button>
      </div>
    </div>
  )
}
