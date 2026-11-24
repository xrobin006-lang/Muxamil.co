'use client'

/**
 * STORE CHROME — the cyberpunk/glassmorphism shell shared by the Store home
 * and the Product detail page (headless-CMS redesign).
 * ---------------------------------------------------------------------------
 * Everything here is 100% data-driven from the Admin Panel:
 *   • StoreHeader  — dynamic logo + name, menu links, cart (wishlist), bell,
 *                    profile dropdown
 *   • StoreFooter  — dynamic footer text, social links, categories, pages
 *   • StoreMobileNav — Home / Store / Categories / Profile bottom bar
 *   • StorePageDialog — About Us / Contact Us / Privacy Policy (Page Builder)
 *   • useStoreWishlist — localStorage wishlist powering the hearts + cart
 *
 * Visual language: deep dark blue/black (#05070f) base, electric purple /
 * neon pink / vibrant cyan gradients, frosted-glass surfaces, neon glows on
 * interactive elements. Scoped entirely to the Store — the rest of the site
 * keeps its own design system untouched.
 */

import { useCallback, useState, useSyncExternalStore } from 'react'
import {
  Bell,
  BellRing,
  ChevronLeft,
  Facebook,
  Github,
  Globe,
  Heart,
  Home,
  Instagram,
  LayoutGrid,
  Linkedin,
  LogOut,
  Mail,
  MessageCircle,
  Send,
  Settings as SettingsIcon,
  ShieldCheck,
  Sparkles,
  Store as StoreIcon,
  Trash2,
  User as UserIcon,
  Youtube,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { apiJson } from '@/lib/api-client'
import { formatPrice } from '@/lib/store-format'
import { useAppStore } from '@/stores/app-store'
import type {
  StoreCategoryDTO,
  StorePageDTO,
  StorePagesDTO,
  StoreSettingsDTO,
  StoreSocialLinkDTO,
} from '@/lib/types'
import { UserAvatar } from '../user-avatar'
import { VerifiedBadge } from '../verified-badge'

// ---------------------------------------------------------------------------
// Wishlist (localStorage + cross-component sync)
// ---------------------------------------------------------------------------

export type WishlistItem = {
  slug: string
  name: string
  price: number | null
  currency: string
  imageUrl: string | null
}

const WISHLIST_KEY = 'mux_store_wishlist'
const WISHLIST_CAP = 60

let wishlistCache: WishlistItem[] | null = null
const wishlistListeners = new Set<() => void>()

function readWishlistRaw(): WishlistItem[] {
  if (wishlistCache === null) {
    try {
      const raw = JSON.parse(localStorage.getItem(WISHLIST_KEY) ?? '[]')
      wishlistCache = Array.isArray(raw)
        ? raw
            .filter(
              (x): x is WishlistItem =>
                !!x &&
                typeof x === 'object' &&
                typeof (x as WishlistItem).slug === 'string' &&
                typeof (x as WishlistItem).name === 'string',
            )
            .slice(0, WISHLIST_CAP)
        : []
    } catch {
      wishlistCache = []
    }
  }
  return wishlistCache
}

function writeWishlistRaw(next: WishlistItem[]) {
  wishlistCache = next.slice(0, WISHLIST_CAP)
  try {
    localStorage.setItem(WISHLIST_KEY, JSON.stringify(wishlistCache))
  } catch {
    /* storage full / private mode — keep the in-memory copy */
  }
  for (const listener of wishlistListeners) listener()
}

function subscribeWishlist(listener: () => void) {
  wishlistListeners.add(listener)
  return () => {
    wishlistListeners.delete(listener)
  }
}

/** The store wishlist — hearts on cards + the cart popover in the header. */
export function useStoreWishlist() {
  const items = useSyncExternalStore(
    subscribeWishlist,
    readWishlistRaw,
    () => [] as WishlistItem[],
  )
  const toggle = useCallback((item: WishlistItem) => {
    const cur = readWishlistRaw()
    writeWishlistRaw(
      cur.some((x) => x.slug === item.slug) ? cur.filter((x) => x.slug !== item.slug) : [...cur, item],
    )
  }, [])
  const clear = useCallback(() => writeWishlistRaw([]), [])
  const has = useCallback((slug: string) => readWishlistRaw().some((x) => x.slug === slug), [])
  return { items, toggle, clear, has }
}

// ---------------------------------------------------------------------------
// Small shared pieces
// ---------------------------------------------------------------------------

/** The deep-space backdrop every store page sits on (mesh gradients + Inter). */
export function CyberBackdrop({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen flex-col overflow-x-clip bg-[#05070f] font-[family-name:var(--font-inter),var(--font-geist-sans),ui-sans-serif,system-ui] text-slate-100">
      {/* Aurora mesh — fixed so it never scrolls away */}
      <div aria-hidden className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute -top-40 left-1/2 h-[440px] w-[min(56rem,120vw)] -translate-x-1/2 rounded-full bg-violet-600/20 blur-[130px]" />
        <div className="absolute -left-24 top-1/3 h-[320px] w-[420px] rounded-full bg-fuchsia-600/10 blur-[120px]" />
        <div className="absolute -right-24 bottom-0 h-[360px] w-[480px] rounded-full bg-cyan-500/10 blur-[120px]" />
        {/* Subtle grid overlay */}
        <div
          className="absolute inset-0 opacity-[0.35]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(148,163,184,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.05) 1px, transparent 1px)',
            backgroundSize: '44px 44px',
            maskImage: 'radial-gradient(ellipse 90% 60% at 50% 0%, black 30%, transparent 75%)',
            WebkitMaskImage: 'radial-gradient(ellipse 90% 60% at 50% 0%, black 30%, transparent 75%)',
          }}
        />
      </div>
      <div className="relative z-10 flex min-h-screen flex-col">{children}</div>
    </div>
  )
}

/** Neon-gradient primary button style (purple → fuchsia) with glow. */
export const neonCTA =
  'bg-gradient-to-r from-violet-600 via-fuchsia-600 to-violet-600 bg-[length:200%_100%] text-white shadow-[0_0_22px_rgba(139,92,246,0.35)] transition-all duration-300 hover:bg-right hover:shadow-[0_0_30px_rgba(139,92,246,0.5)] focus-visible:ring-fuchsia-400'

/**
 * Shared store-brand visual tokens — the SINGLE SOURCE of the Store's
 * purple/violet identity. Used by the store header/footer here AND by the
 * Explore store banner card, so every Store entry point stays visually
 * consistent (sizes/radius stay at the call site).
 */
/** Dark-glass logo tile: violet border, violet→cyan inner wash, soft glow. */
export const storeLogoTile =
  'border-violet-400/30 bg-gradient-to-br from-violet-600/30 to-cyan-500/20 shadow-[0_0_18px_rgba(139,92,246,0.25)]'
/** Signature store name gradient: violet → fuchsia → cyan. */
export const storeNameGradient =
  'bg-gradient-to-r from-violet-300 via-fuchsia-300 to-cyan-300 bg-clip-text text-transparent'

/** Frosted-glass surface. */
export const glass =
  'border border-white/10 bg-white/[0.04] backdrop-blur-xl supports-[backdrop-filter]:bg-white/[0.05]'

// ---------------------------------------------------------------------------
// Store header (top navigation)
// ---------------------------------------------------------------------------

const SOCIAL_ICON_BY_PLATFORM: Record<string, typeof Globe> = {
  facebook: Facebook,
  instagram: Instagram,
  youtube: Youtube,
  github: Github,
  linkedin: Linkedin,
  telegram: Send,
  whatsapp: MessageCircle,
  twitter: MessageCircle,
  x: MessageCircle,
  website: Globe,
  email: Mail,
  link: Globe,
}

export function socialIcon(platform: string): typeof Globe {
  return SOCIAL_ICON_BY_PLATFORM[platform.trim().toLowerCase()] ?? Globe
}

type HeaderProps = {
  store: StoreSettingsDTO
  pages: StorePagesDTO
  onOpenProduct: (slug: string) => void
  /** Show the back chevron (product page / store entered from elsewhere). */
  showBack?: boolean
  /** Which menu entry is highlighted. */
  active?: 'store' | 'product'
}

/**
 * Dynamic top navigation — logo, menu links (Home / Categories / Projects /
 * Store / Contact), wishlist cart, notification bell and the user profile
 * dropdown. Every label and image comes from the Admin Panel.
 */
export function StoreHeader({ store, pages, onOpenProduct, showBack = false, active = 'store' }: HeaderProps) {
  const navigate = useAppStore((s) => s.navigate)
  const back = useAppStore((s) => s.back)
  const user = useAppStore((s) => s.user)
  const unreadNotifications = useAppStore((s) => s.unreadNotifications)
  const wishlist = useStoreWishlist()
  const [contactOpen, setContactOpen] = useState(false)

  const menu = [
    { key: 'home', label: 'Home', onClick: () => navigate({ name: 'feed' }) },
    { key: 'categories', label: 'Categories', onClick: () => navigate({ name: 'categories' }) },
    { key: 'projects', label: 'Projects', onClick: () => navigate({ name: 'projects' }) },
    { key: 'store', label: 'Store', onClick: () => navigate({ name: 'store' }) },
    { key: 'contact', label: 'Contact', onClick: () => setContactOpen(true) },
  ] as const

  const signOut = async () => {
    try {
      await apiJson('/api/auth/logout', 'POST')
    } catch {
      /* best effort */
    }
    useAppStore.getState().reset()
  }

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[#05070f]/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center gap-2 px-4 sm:gap-3 sm:px-6">
          {showBack && (
            <button
              type="button"
              onClick={() => {
                if (useAppStore.getState().history.length > 0) back()
                else navigate({ name: 'store' })
              }}
              aria-label="Back to previous page"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-300 transition hover:border-violet-400/40 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400/60"
            >
              <ChevronLeft className="h-5 w-5" aria-hidden="true" />
            </button>
          )}

          {/* Dynamic logo + store name */}
          <button
            type="button"
            onClick={() => navigate({ name: 'store' })}
            className="flex min-w-0 shrink-0 items-center gap-2.5 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400/60 sm:gap-3"
            aria-label={`${store.name} — Store home`}
          >
            <span className={cn('relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl', storeLogoTile)}>
              {store.logoUrl ? (
                <img src={store.logoUrl} alt="" className="h-full w-full object-contain p-1" />
              ) : (
                <StoreIcon className="h-5 w-5 text-violet-300" aria-hidden="true" />
              )}
            </span>
            <span className="hidden min-w-0 flex-col items-start sm:flex">
              <span className={cn('max-w-[12rem] truncate text-sm font-bold tracking-wide', storeNameGradient)} dir="auto">
                {store.name}
              </span>
              <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-slate-500">
                Premium Digital Store
              </span>
            </span>
          </button>

          {/* Menu links (desktop) */}
          <nav aria-label="Store menu" className="ml-4 hidden min-w-0 flex-1 items-center gap-1 md:flex">
            {menu.map((item) => {
              const isActive =
                (item.key === 'store' && (active === 'store' || active === 'product')) ||
                (item.key === 'contact' && contactOpen)
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={item.onClick}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400/60',
                    isActive
                      ? 'text-white [text-shadow:0_0_12px_rgba(139,92,246,0.8)]'
                      : 'text-slate-400 hover:bg-white/5 hover:text-white',
                  )}
                >
                  {item.label}
                </button>
              )
            })}
          </nav>
          <div className="flex-1 md:hidden" aria-hidden="true" />

          {/* Cart / wishlist */}
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={`Wishlist${wishlist.items.length ? `, ${wishlist.items.length} saved` : ''}`}
                className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-300 transition hover:border-fuchsia-400/40 hover:text-white hover:shadow-[0_0_14px_rgba(236,72,153,0.35)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400/60"
              >
                <Heart className="h-[18px] w-[18px]" aria-hidden="true" />
                {wishlist.items.length > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-gradient-to-r from-fuchsia-500 to-rose-500 px-1 text-[9px] font-bold tabular-nums text-white shadow-sm">
                    {wishlist.items.length > 9 ? '9+' : wishlist.items.length}
                  </span>
                )}
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="w-80 border-white/10 bg-[#0b0f1d]/95 p-0 text-slate-100 backdrop-blur-xl"
            >
              <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                <p className="text-sm font-semibold">
                  Wishlist <span className="ml-1 text-xs font-normal text-slate-400">({wishlist.items.length})</span>
                </p>
                {wishlist.items.length > 0 && (
                  <button
                    type="button"
                    onClick={() => wishlist.clear()}
                    className="inline-flex items-center gap-1 text-xs font-medium text-slate-400 transition hover:text-rose-300"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    Clear
                  </button>
                )}
              </div>
              <div className="max-h-72 overflow-y-auto scrollbar-thin">
                {wishlist.items.length === 0 ? (
                  <div className="px-4 py-8 text-center">
                    <span className="text-3xl" aria-hidden="true">
                      💜
                    </span>
                    <p className="mt-2 text-sm font-medium text-slate-300">Nothing saved yet</p>
                    <p className="mt-1 text-xs text-slate-500">
                      Tap the heart on any product to keep it here.
                    </p>
                  </div>
                ) : (
                  wishlist.items.map((item) => (
                    <button
                      key={item.slug}
                      type="button"
                      onClick={() => onOpenProduct(item.slug)}
                      className="flex w-full items-center gap-3 border-b border-white/5 px-4 py-2.5 text-left transition hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fuchsia-400/60"
                    >
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-white/5">
                        {item.imageUrl ? (
                          <img src={item.imageUrl} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <span aria-hidden="true">📦</span>
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium" dir="auto">
                          {item.name}
                        </span>
                        <span className="block text-xs text-slate-400">
                          {item.price === null || item.price === 0
                            ? 'FREE'
                            : formatPrice(item.price, item.currency)}
                        </span>
                      </span>
                    </button>
                  ))
                )}
              </div>
              <div className="p-3">
                <Button
                  size="sm"
                  className={cn('w-full', neonCTA)}
                  onClick={() => navigate({ name: 'my-orders' })}
                >
                  My Orders
                </Button>
              </div>
            </PopoverContent>
          </Popover>

          {/* Notification bell */}
          <button
            type="button"
            onClick={() => navigate({ name: 'notifications' })}
            aria-label={`Notifications${unreadNotifications ? `, ${unreadNotifications} unread` : ''}`}
            className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-300 transition hover:border-cyan-400/40 hover:text-white hover:shadow-[0_0_14px_rgba(34,211,238,0.35)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
          >
            {unreadNotifications > 0 ? (
              <BellRing className="h-[18px] w-[18px] text-cyan-300" aria-hidden="true" />
            ) : (
              <Bell className="h-[18px] w-[18px]" aria-hidden="true" />
            )}
            {unreadNotifications > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-cyan-400 px-1 text-[9px] font-bold tabular-nums text-[#05070f] shadow-sm">
                {unreadNotifications > 9 ? '9+' : unreadNotifications}
              </span>
            )}
          </button>

          {/* Profile dropdown */}
          {user && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400/60"
                  aria-label="Account menu"
                >
                  <UserAvatar name={user.fullName} url={user.avatarUrl} size="sm" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 border-white/10 bg-[#0b0f1d]/95 text-slate-100 backdrop-blur-xl">
                <DropdownMenuLabel>
                  <div className="flex items-center gap-2.5">
                    <UserAvatar name={user.fullName} url={user.avatarUrl} size="sm" />
                    <div className="min-w-0">
                      <p className="flex items-center gap-1 truncate text-sm font-medium">
                        <span className="truncate" dir="auto">
                          {user.fullName}
                        </span>
                        {user.isVerified && <VerifiedBadge size={13} />}
                      </p>
                      <p className="truncate text-xs text-slate-400">@{user.username}</p>
                    </div>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator className="bg-white/10" />
                {user.role === 'admin' && (
                  <DropdownMenuItem
                    className="gap-2 focus:bg-white/10 focus:text-white"
                    onClick={() => navigate({ name: 'admin-dashboard' })}
                  >
                    <ShieldCheck className="h-4 w-4 text-violet-300" aria-hidden="true" /> Admin Console
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  className="gap-2 focus:bg-white/10 focus:text-white"
                  onClick={() => navigate({ name: 'profile' })}
                >
                  <UserIcon className="h-4 w-4" aria-hidden="true" /> My profile
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="gap-2 focus:bg-white/10 focus:text-white"
                  onClick={() => navigate({ name: 'settings' })}
                >
                  <SettingsIcon className="h-4 w-4" aria-hidden="true" /> Settings
                </DropdownMenuItem>
                <DropdownMenuSeparator className="bg-white/10" />
                <DropdownMenuItem
                  className="gap-2 focus:bg-rose-500/20 focus:text-rose-200"
                  onClick={() => void signOut()}
                >
                  <LogOut className="h-4 w-4" aria-hidden="true" /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </header>

      {/* Contact page (Page Builder content) */}
      <StorePageDialog open={contactOpen} onOpenChange={setContactOpen} page={pages.contact} />
    </>
  )
}

// ---------------------------------------------------------------------------
// Store footer
// ---------------------------------------------------------------------------

type FooterProps = {
  store: StoreSettingsDTO
  categories: StoreCategoryDTO[]
  pages: StorePagesDTO
  /** Category click (only the Store home passes this — it filters + scrolls). */
  onCategory?: (id: string) => void
}

/** Dynamic footer — copyright, social links, categories and CMS pages. */
export function StoreFooter({ store, categories, pages, onCategory }: FooterProps) {
  const navigate = useAppStore((s) => s.navigate)
  const [page, setPage] = useState<'about' | 'contact' | 'privacy' | null>(null)
  const whatsappUrl = store.whatsapp
    ? `https://wa.me/${store.whatsapp.replace(/[^0-9]/g, '')}`
    : null
  const socials: StoreSocialLinkDTO[] = whatsappUrl
    ? [
        ...store.socialLinks,
        { platform: 'whatsapp', label: 'WhatsApp', url: whatsappUrl },
      ]
    : store.socialLinks

  const pageLinks = [
    { key: 'about' as const, label: pages.about.title || 'About Us' },
    { key: 'contact' as const, label: pages.contact.title || 'Contact Us' },
    { key: 'privacy' as const, label: pages.privacy.title || 'Privacy Policy' },
  ]

  return (
    <>
      <footer className="relative z-10 mt-16 border-t border-white/10 bg-[#04060d]/90 backdrop-blur">
        <div className="mx-auto grid w-full max-w-7xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-2 lg:grid-cols-4">
          {/* Brand */}
          <div>
            <div className="flex items-center gap-2.5">
              <span className={cn('flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl', storeLogoTile)}>
                {store.logoUrl ? (
                  <img src={store.logoUrl} alt="" className="h-full w-full object-contain p-1" />
                ) : (
                  <StoreIcon className="h-5 w-5 text-violet-300" aria-hidden="true" />
                )}
              </span>
              <span className={cn('text-base font-bold tracking-wide', storeNameGradient)} dir="auto">
                {store.name}
              </span>
            </div>
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-slate-400" dir="auto">
              {store.description?.trim() || 'Premium digital products, curated for the community.'}
            </p>
          </div>

          {/* Quick links (CMS pages) */}
          <nav aria-label="Quick links">
            <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Quick Links</h3>
            <ul className="mt-4 space-y-2.5">
              {pageLinks.map((link) => (
                <li key={link.key}>
                  <button
                    type="button"
                    onClick={() => setPage(link.key)}
                    className="text-sm text-slate-400 transition hover:text-white"
                  >
                    {link.label}
                  </button>
                </li>
              ))}
              <li>
                <button
                  type="button"
                  onClick={() => navigate({ name: 'my-orders' })}
                  className="text-sm text-slate-400 transition hover:text-white"
                >
                  My Orders
                </button>
              </li>
            </ul>
          </nav>

          {/* Categories */}
          <nav aria-label="Store categories">
            <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Categories</h3>
            <ul className="mt-4 space-y-2.5">
              {categories
                .filter((c) => c.active)
                .slice(0, 6)
                .map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => (onCategory ? onCategory(c.id) : navigate({ name: 'store' }))}
                      className="text-sm text-slate-400 transition hover:text-white"
                    >
                      <span aria-hidden="true" className="mr-1.5">
                        {c.emoji}
                      </span>
                      {c.name}
                    </button>
                  </li>
                ))}
            </ul>
          </nav>

          {/* Connect */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Connect</h3>
            <ul className="mt-4 space-y-2.5">
              {socials.length === 0 && store.contactEmail === null && (
                <li className="text-sm text-slate-500">Coming soon</li>
              )}
              {socials.map((s) => {
                const Icon = socialIcon(s.platform)
                return (
                  <li key={`${s.platform}-${s.url}`}>
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-center gap-2 text-sm text-slate-400 transition hover:text-white"
                    >
                      <Icon className="h-4 w-4 text-violet-300" aria-hidden="true" />
                      {s.label}
                    </a>
                  </li>
                )
              })}
              {store.contactEmail && (
                <li>
                  <a
                    href={`mailto:${store.contactEmail}`}
                    className="inline-flex items-center gap-2 text-sm text-slate-400 transition hover:text-white"
                  >
                    <Mail className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                    {store.contactEmail}
                  </a>
                </li>
              )}
            </ul>
          </div>
        </div>

        {/* Bottom bar — fully dynamic copyright */}
        <div className="border-t border-white/5">
          <div className="mx-auto flex w-full max-w-7xl flex-col items-center justify-between gap-2 px-4 py-5 text-xs text-slate-500 sm:flex-row sm:px-6">
            <p dir="auto">
              {store.footerText?.trim() ||
                `© ${new Date().getFullYear()} ${store.name}. All rights reserved.`}
            </p>
            <p className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" aria-hidden="true" />
              Powered by Muxamil.co
            </p>
          </div>
        </div>
      </footer>

      {/* CMS page dialogs */}
      {page === 'about' && <StorePageDialog open onOpenChange={() => setPage(null)} page={pages.about} />}
      {page === 'contact' && <StorePageDialog open onOpenChange={() => setPage(null)} page={pages.contact} />}
      {page === 'privacy' && <StorePageDialog open onOpenChange={() => setPage(null)} page={pages.privacy} />}
    </>
  )
}

// ---------------------------------------------------------------------------
// Mobile bottom navigation (Home / Store / Categories / Profile)
// ---------------------------------------------------------------------------

export function StoreMobileNav() {
  const navigate = useAppStore((s) => s.navigate)
  const view = useAppStore((s) => s.view)
  const user = useAppStore((s) => s.user)

  const items = [
    { key: 'home', label: 'Home', icon: Home, view: { name: 'feed' } as const },
    { key: 'store', label: 'Store', icon: StoreIcon, view: { name: 'store' } as const },
    { key: 'categories', label: 'Categories', icon: LayoutGrid, view: { name: 'categories' } as const },
  ]
  const profileView = user?.role === 'admin' ? ({ name: 'admin-dashboard' } as const) : ({ name: 'profile' } as const)
  const storeish = view.name === 'store' || view.name === 'product'

  return (
    <nav
      aria-label="Store navigation"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#05070f]/90 backdrop-blur-xl lg:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="mx-auto grid h-16 max-w-md grid-cols-4">
        {items.map((item) => {
          const active =
            (item.key === 'store' && storeish) ||
            (item.key === 'home' && view.name === 'feed') ||
            (item.key === 'categories' && (view.name === 'categories' || view.name === 'category'))
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => navigate(item.view)}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'relative flex flex-col items-center justify-center gap-1 text-[10px] font-medium transition-all duration-150 active:scale-90',
                active ? 'text-fuchsia-300 [text-shadow:0_0_10px_rgba(236,72,153,0.6)]' : 'text-slate-400 hover:text-white',
              )}
            >
              <span className="relative flex items-center">
                <item.icon className={cn('h-5 w-5 transition-transform duration-150', active && 'scale-110')} aria-hidden="true" />
                <span
                  className={cn(
                    'absolute -bottom-1.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-fuchsia-400 shadow-[0_0_8px_rgba(236,72,153,0.9)] transition-all duration-200',
                    active ? 'scale-100 opacity-100' : 'scale-0 opacity-0',
                  )}
                  aria-hidden="true"
                />
              </span>
              <span className="truncate">{item.label}</span>
            </button>
          )
        })}
        <button
          type="button"
          onClick={() => navigate(profileView)}
          aria-current={view.name === 'profile' || view.name === 'admin-dashboard' ? 'page' : undefined}
          className={cn(
            'relative flex flex-col items-center justify-center gap-1 text-[10px] font-medium transition-all duration-150 active:scale-90',
            view.name === 'profile' || view.name === 'admin-dashboard'
              ? 'text-fuchsia-300 [text-shadow:0_0_10px_rgba(236,72,153,0.6)]'
              : 'text-slate-400 hover:text-white',
          )}
        >
          <span className="relative flex items-center">
            {user?.role === 'admin' ? (
              <ShieldCheck className="h-5 w-5" aria-hidden="true" />
            ) : (
              <UserIcon className="h-5 w-5" aria-hidden="true" />
            )}
          </span>
          <span className="truncate">{user?.role === 'admin' ? 'Admin' : 'Profile'}</span>
        </button>
      </div>
    </nav>
  )
}

// ---------------------------------------------------------------------------
// CMS page dialog (About Us / Contact Us / Privacy Policy)
// ---------------------------------------------------------------------------

export function StorePageDialog({
  open,
  onOpenChange,
  page,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  page: StorePageDTO
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto border-white/10 bg-[#0b0f1d]/95 text-slate-100 backdrop-blur-xl sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className={cn('flex items-center gap-2 text-left text-lg font-bold', storeNameGradient)}>
            {page.title}
          </DialogTitle>
          <DialogDescription className="sr-only">{page.title} — {page.body.slice(0, 80)}</DialogDescription>
        </DialogHeader>
        <div className="px-1">
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-300" dir="auto">
            {page.body}
          </p>
          {page.updatedAt && (
            <p className="mt-6 flex items-center gap-1.5 text-[11px] text-slate-500">
              <Sparkles className="h-3 w-3" aria-hidden="true" />
              Dynamic page — last updated{' '}
              {new Date(page.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
