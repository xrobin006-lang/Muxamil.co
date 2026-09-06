'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Bell,
  BellRing,
  MessageSquare,
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
  Link2,
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
import { useServiceWorker } from '@/hooks/use-service-worker'
import { UserAvatar } from './components/user-avatar'
import { VerifiedBadge } from './components/verified-badge'
import type { PublicSettings } from '@/lib/types'
import { cn } from '@/lib/utils'

import FeedView from './views/feed-view'
import PeopleView from './views/people-view'
import NotificationsView from './views/notifications-view'
import ChatView from './views/chat-view'
import ProfileView from './views/profile-view'
import UserProfileView from './views/user-profile-view'
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
import AdminAnalytics from './views/admin/admin-analytics'
import AdminLinks from './views/admin/admin-links'
import ExploreView from './views/explore-view'
import SavedView from './views/saved-view'

type NavItem = { label: string; icon: typeof Home; view: View; badge?: 'notifications' | 'messages' }

const USER_NAV: NavItem[] = [
  { label: 'Home', icon: Home, view: { name: 'feed' } },
  { label: 'Explore', icon: Compass, view: { name: 'explore' } },
  { label: 'People', icon: Users, view: { name: 'people' } },
  { label: 'Saved', icon: Bookmark, view: { name: 'saved' } },
  { label: 'Admin Chat', icon: MessageSquare, view: { name: 'chat' }, badge: 'messages' },
  { label: 'Notifications', icon: Bell, view: { name: 'notifications' }, badge: 'notifications' },
]

const USER_NAV_SECONDARY: NavItem[] = [
  { label: 'My Community', icon: UsersRound, view: { name: 'my-community' } },
  { label: 'Profile', icon: UserIcon, view: { name: 'profile' } },
  { label: 'Settings', icon: SettingsIcon, view: { name: 'settings' } },
]

const ADMIN_NAV: NavItem[] = [
  { label: 'Dashboard', icon: LayoutDashboard, view: { name: 'admin-dashboard' } },
  { label: 'Messages', icon: MessagesSquare, view: { name: 'admin-messages' }, badge: 'messages' },
  { label: 'Approvals', icon: CheckCircle2, view: { name: 'admin-approvals' } },
  { label: 'Posts', icon: FileText, view: { name: 'admin-posts' } },
  { label: 'Categories', icon: Tags, view: { name: 'admin-categories' } },
  { label: 'Users', icon: UserCheck, view: { name: 'admin-users' } },
]

const ADMIN_NAV_SECONDARY: NavItem[] = [
  { label: 'Analytics', icon: BarChart3, view: { name: 'admin-analytics' } },
  { label: 'CTA Links', icon: Link2, view: { name: 'admin-links' } },
  { label: 'Communities', icon: UsersRound, view: { name: 'admin-communities' } },
  { label: 'Settings', icon: SettingsIcon, view: { name: 'admin-settings' } },
]

const VIEW_TITLES: Record<string, string> = {
  feed: 'Home',
  explore: 'Explore',
  people: 'People',
  saved: 'Saved Posts',
  notifications: 'Notifications',
  chat: 'Admin Chat',
  profile: 'My Profile',
  user: 'Profile',
  community: 'Community',
  'my-community': 'My Community',
  settings: 'Settings',
  'admin-dashboard': 'Dashboard',
  'admin-users': 'Users',
  'admin-posts': 'Official Posts',
  'admin-categories': 'Categories',
  'admin-analytics': 'Analytics',
  'admin-links': 'CTA Links',
  'admin-approvals': 'Pending Approvals',
  'admin-communities': 'Communities',
  'admin-messages': 'Messages',
  'admin-settings': 'Platform Settings',
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

  // Web Push service worker (no-op where unsupported).
  useServiceWorker()

  // Platform branding (site name) for the sidebar header — public endpoint.
  const [platformName, setPlatformName] = useState('Muxamil.co')
  const [logoUrl, setLogoUrl] = useState<string | null>(null)

  useEffect(() => {
    apiGet<{ settings: PublicSettings }>('/api/settings')
      .then((data) => {
        if (data.settings.platform_name?.trim()) setPlatformName(data.settings.platform_name.trim())
        setLogoUrl(data.settings.logo_url ?? null)
      })
      .catch(() => {
        /* decorative — the fallback name is shown */
      })
  }, [])

  const isAdmin = user.role === 'admin'
  const primaryNav = isAdmin ? ADMIN_NAV : USER_NAV

  const title = useMemo(() => VIEW_TITLES[view.name] ?? 'Muxamil.co', [view.name])
  const canGoBack = useAppStore((s) => s.history.length > 0)

  const badgeFor = (item: NavItem) =>
    item.badge === 'notifications' ? unreadNotifications : item.badge === 'messages' ? unreadMessages : 0

  const isActive = (item: NavItem) => view.name === item.view.name

  const navList = (items: NavItem[]) => (
    <nav className="space-y-1" aria-label="Main navigation">
      {items.map((item) => {
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
              <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold tabular-nums text-primary-foreground shadow-sm">
                {badge > 99 ? '99+' : badge}
              </span>
            )}
          </button>
        )
      })}
    </nav>
  )

  /** Sidebar body (brand → nav sections) shared by the desktop rail and the mobile sheet. */
  const sidebarBody = (
    <>
      {navList(primaryNav)}
      {!isAdmin && user.isVerified && (
        <>
          <SectionLabel>Creator</SectionLabel>
          {navList([USER_NAV_SECONDARY[0]])}
        </>
      )}
      <SectionLabel>{isAdmin ? 'Admin' : 'Account'}</SectionLabel>
      {navList(isAdmin ? ADMIN_NAV_SECONDARY : USER_NAV_SECONDARY.slice(1))}
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
      {/* Desktop sidebar — light, premium */}
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
          <SectionLabel>Menu</SectionLabel>
          {sidebarBody}
        </div>

        {/* Sidebar footer — user card */}
        <div className="border-t border-sidebar-border p-3 pt-3">{sidebarFooter}</div>
      </aside>

      {/* Main column */}
      <div className="flex min-h-screen w-full min-w-0 flex-1 flex-col">
        {/* Header */}
        <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/70">
          <div className="mx-auto flex h-16 max-w-4xl items-center gap-1.5 px-3 sm:gap-2 sm:px-4">
            {/* Mobile menu (opens the sidebar sheet) */}
            <Sheet>
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
                <div className="flex-1 space-y-1 overflow-y-auto px-3 pb-4 scrollbar-thin">
                  <SectionLabel>Menu</SectionLabel>
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

            {/* Messages shortcut */}
            <Button
              variant="ghost"
              size="icon"
              className="relative h-9 w-9 shrink-0"
              onClick={() => navigate(isAdmin ? { name: 'admin-messages' } : { name: 'chat' })}
              aria-label={`Messages${unreadMessages ? `, ${unreadMessages} unread` : ''}`}
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

        {/* View content */}
        <main className="mx-auto w-full max-w-4xl flex-1 px-3 pb-28 pt-5 sm:px-4 lg:pb-10" id="main-content">
          <CurrentView />
        </main>

        {/* Footer — sticks to the bottom, pushed down naturally on overflow */}
        <footer className="mt-auto hidden border-t bg-background py-4 lg:block">
          <div className="mx-auto flex max-w-4xl items-center justify-between px-4 text-xs text-muted-foreground">
            <p>© {new Date().getFullYear()} {platformName} — a safe, moderated community platform.</p>
            <p className="flex items-center gap-1.5">
              <Radio className="h-3 w-3 text-primary" aria-hidden="true" /> Realtime connected
            </p>
          </div>
        </footer>
      </div>

      {/* Mobile bottom navigation */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur lg:hidden"
        aria-label="Primary"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="mx-auto grid h-16 max-w-md grid-cols-5">
          {primaryNav.slice(0, 4).map((item) => {
            const badge = badgeFor(item)
            const active = isActive(item)
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
                  <span className="absolute right-3 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold tabular-nums text-primary-foreground shadow-sm">
                    {badge > 9 ? '9+' : badge}
                  </span>
                )}
              </button>
            )
          })}
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
    case 'people':
      return <PeopleView />
    case 'saved':
      return <SavedView />
    case 'notifications':
      return <NotificationsView />
    case 'chat':
      return <ChatView />
    case 'profile':
      return <ProfileView />
    case 'user':
      return <UserProfileView userId={view.userId} />
    case 'community':
      return <CommunityView communityId={view.communityId} />
    case 'my-community':
      return <MyCommunityView />
    case 'settings':
      return <SettingsView />
    case 'admin-dashboard':
      return <AdminDashboard />
    case 'admin-users':
      return <AdminUsers />
    case 'admin-posts':
      return <AdminPosts />
    case 'admin-categories':
      return <AdminCategories />
    case 'admin-analytics':
      return <AdminAnalytics />
    case 'admin-links':
      return <AdminLinks />
    case 'admin-approvals':
      return <AdminApprovals />
    case 'admin-communities':
      return <AdminCommunities />
    case 'admin-messages':
      return <AdminMessages initialConversationId={view.conversationId} />
    case 'admin-settings':
      return <AdminSettings />
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
