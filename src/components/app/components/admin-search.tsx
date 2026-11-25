'use client'

import { useEffect } from 'react'
import {
  LayoutDashboard,
  BarChart3,
  MessagesSquare,
  FileText,
  Tags,
  Link2,
  UserCheck,
  UsersRound,
  CheckCircle2,
  ShieldBan,
  Settings as SettingsIcon,
  Plus,
  Search,
  ShieldCheck,
  KeyRound,
  History,
  Building2,
  UserPlus,
  MessageSquare,
  FolderKanban,
  Store as StoreIcon,
  ArrowUpDown,
  CreditCard,
  Palette,
  GraduationCap,
  Mail,
  Gift,
  BookOpenText,
  Clapperboard,
  FileSearch,
  Banknote,
  Wallet,
  Inbox,
  Coins,
} from 'lucide-react'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useAppStore, type View } from '@/stores/app-store'

/**
 * Admin quick-search (Ctrl/Cmd+K): one lightweight palette over the existing
 * navigation and settings — helps the admin answer "where do I go to do this?"
 * without memorizing the sidebar. Purely navigational: it never mutates
 * anything, it only routes to existing screens (all permissions stay
 * server-enforced).
 */

type Entry = {
  label: string
  icon: typeof Search
  keywords: string
  view: View
}

/** The admin screens, labeled with their sidebar groups. */
const NAV_ENTRIES: Entry[] = [
  { label: 'Dashboard', icon: LayoutDashboard, keywords: 'overview stats home', view: { name: 'admin-dashboard' } },
  { label: 'Analytics', icon: BarChart3, keywords: 'views signups charts trends top posts', view: { name: 'admin-analytics' } },
  { label: 'Messages', icon: MessagesSquare, keywords: 'admin chat inbox conversations members support', view: { name: 'admin-messages' } },
  { label: 'Official Posts', icon: FileText, keywords: 'announcements create publish draft schedule pin', view: { name: 'admin-posts' } },
  { label: 'Categories', icon: Tags, keywords: 'topics explore organize post groups', view: { name: 'admin-categories' } },
  { label: 'Projects', icon: FolderKanban, keywords: 'project showcase logo banner website video featured publish order explore', view: { name: 'admin-projects' } },
  { label: 'CTA Buttons', icon: Link2, keywords: 'links buttons destinations clicks cta', view: { name: 'admin-links' } },
  { label: 'Store', icon: StoreIcon, keywords: 'products orders payments methods analytics settings shop ecommerce digital', view: { name: 'admin-store' } },
  { label: 'Users', icon: UserCheck, keywords: 'members manage blue tick block restrict verify search', view: { name: 'admin-users' } },
  { label: 'Communities', icon: UsersRound, keywords: 'member communities owners personal', view: { name: 'admin-communities' } },
  { label: 'Approvals', icon: CheckCircle2, keywords: 'queue review community posts pending', view: { name: 'admin-approvals' } },
  { label: 'Moderation', icon: ShieldBan, keywords: 'replies hide delete reports abuse flags', view: { name: 'admin-moderation' } },
  { label: 'Platform Settings', icon: SettingsIcon, keywords: 'configuration switches toggles site', view: { name: 'admin-settings' } },
  { label: 'Work Hub Overview', icon: LayoutDashboard, keywords: 'work guideline rewards operations dashboard tasks earnings', view: { name: 'admin-work-guideline', section: 'overview' } },
  { label: 'Microsoft Rewards Programs', icon: GraduationCap, keywords: 'work hub microsoft rewards offers program tutorials steps banners', view: { name: 'admin-work-guideline', section: 'programs' } },
  { label: 'Gmail Rewards Task', icon: Mail, keywords: 'gmail task checker url daily limit notice rate quantity deadline', view: { name: 'admin-work-guideline', section: 'gmail-task' } },
  { label: 'Gift Card Rates', icon: Gift, keywords: 'gift cards offers card rate price active display order', view: { name: 'admin-work-guideline', section: 'card-rates' } },
  { label: 'Read Guides', icon: BookOpenText, keywords: 'guides articles tutorials learning content steps', view: { name: 'admin-work-guideline', section: 'guides' } },
  { label: 'Tutorial Videos', icon: Clapperboard, keywords: 'video tutorials steps reorder publish', view: { name: 'admin-work-guideline', section: 'videos' } },
  { label: 'Work Hub Submissions', icon: FileSearch, keywords: 'review approve reject correction overdue reference', view: { name: 'admin-work-guideline', section: 'submissions' } },
  { label: 'Work Hub Payments', icon: Banknote, keywords: 'payout transactions record paid processing completion', view: { name: 'admin-work-guideline', section: 'payments' } },
  { label: 'Work Hub Members', icon: UserCheck, keywords: 'member accounts roles restrictions balances submission history', view: { name: 'admin-work-guideline', section: 'members' } },
  { label: 'Work Hub Branding', icon: Palette, keywords: 'logo banner images branding content', view: { name: 'admin-work-guideline', section: 'branding' } },
  { label: 'Payout Methods', icon: Wallet, keywords: 'payment methods bank paypal easypaisa jazzcash instructions logos', view: { name: 'admin-work-guideline', section: 'payment-methods' } },
  { label: 'Work Hub Website Settings', icon: SettingsIcon, keywords: 'hero title subtitle announcement support email disclaimer rules', view: { name: 'admin-work-guideline', section: 'settings' } },
  { label: 'Work Hub Currency Settings', icon: Coins, keywords: 'currency rates default enabled symbols exchange', view: { name: 'admin-work-guideline', section: 'currency' } },
  { label: 'Work Hub Contact Messages', icon: Inbox, keywords: 'support contact enquiries mark handled reopen', view: { name: 'admin-work-guideline', section: 'contact-messages' } },
  { label: 'Work Hub Activity Log', icon: History, keywords: 'audit log admin action history who changed record', view: { name: 'admin-work-guideline', section: 'activity' } },
]

/** Settings shortcuts — jump straight to the matching settings section. */
const SETTINGS_ENTRIES: Entry[] = [
  { label: 'Platform identity', icon: Building2, keywords: 'site name description support email branding', view: { name: 'admin-settings', section: 'identity' } },
  { label: 'Member chat settings', icon: MessageSquare, keywords: 'communication dm flags master switch chat dms messages', view: { name: 'admin-settings', section: 'communication' } },
  { label: 'Maintenance mode', icon: ShieldCheck, keywords: 'access availability offline downtime site down', view: { name: 'admin-settings', section: 'access' } },
  { label: 'Registration', icon: UserPlus, keywords: 'sign up join new accounts open', view: { name: 'admin-settings', section: 'access' } },
  { label: 'Change password', icon: KeyRound, keywords: 'security admin account password sign in', view: { name: 'admin-settings', section: 'security' } },
  { label: 'Audit log', icon: History, keywords: 'history actions who did what recent sensitive', view: { name: 'admin-settings', section: 'audit' } },
  { label: 'Blue tick & verification', icon: UserCheck, keywords: 'verified badge community features approvals', view: { name: 'admin-settings', section: 'moderation' } },
  { label: 'Store payment methods', icon: CreditCard, keywords: 'easypaisa jazzcash bank transfer paypal wise qr logo instructions checkout', view: { name: 'admin-store', section: 'payments' } },
  { label: 'Store branding & banners', icon: Palette, keywords: 'logo desktop mobile banner favicon hero storefront content pages', view: { name: 'admin-store', section: 'settings' } },
  { label: 'Explore section order', icon: ArrowUpDown, keywords: 'explore page store categories projects sequence position layout', view: { name: 'admin-categories' } },
]

/** High-frequency actions — one hop fewer than navigating manually. */
const ACTION_ENTRIES: Entry[] = [
  { label: 'Create official post', icon: Plus, keywords: 'new announcement write compose publish', view: { name: 'admin-posts' } },
  { label: 'Create project', icon: Plus, keywords: 'new project add showcase portfolio', view: { name: 'admin-projects' } },
  { label: 'Search users', icon: Search, keywords: 'find member look up account', view: { name: 'admin-users' } },
]

/**
 * Tight AND-match filter: every search term must appear as a substring of the
 * entry's label + keywords (cmdk's default fuzzy is too loose for a settings
 * finder — "chat" would match "Analytics" via "charts").
 */
function entryFilter(value: string, search: string): number {
  const v = value.toLowerCase()
  const terms = search.toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return 1
  const matched = terms.filter((t) => v.includes(t)).length
  return matched === terms.length ? matched : 0
}

export function AdminSearch({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useAppStore((s) => s.navigate)

  const go = (view: View) => {
    onOpenChange(false)
    navigate(view)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader className="sr-only">
        <DialogTitle>Admin quick-search</DialogTitle>
        <DialogDescription>Jump to a screen, setting or action.</DialogDescription>
      </DialogHeader>
      <DialogContent className="overflow-hidden p-0">
        <Command
          filter={entryFilter}
          className="[&_[cmdk-group-heading]]:text-muted-foreground **:data-[slot=command-input-wrapper]:h-12 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group]]:px-2 [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-3 [&_[cmdk-item]_svg]:h-5 [&_[cmdk-item]_svg]:w-5"
        >
          <CommandInput placeholder="Search admin panel — screens, settings, actions…" />
          <CommandList>
            <CommandEmpty>No matches found.</CommandEmpty>
            <CommandGroup heading="Actions">
              {ACTION_ENTRIES.map((e) => (
                <CommandItem key={`a-${e.label}`} value={`${e.label} ${e.keywords}`} onSelect={() => go(e.view)}>
                  <e.icon className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="truncate">{e.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandGroup heading="Screens">
              {NAV_ENTRIES.map((e) => (
                <CommandItem key={`n-${e.label}`} value={`${e.label} ${e.keywords}`} onSelect={() => go(e.view)}>
                  <e.icon className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="truncate">{e.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandGroup heading="Settings">
              {SETTINGS_ENTRIES.map((e) => (
                <CommandItem key={`s-${e.label}`} value={`${e.label} ${e.keywords}`} onSelect={() => go(e.view)}>
                  <e.icon className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="truncate">{e.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  )
}

/** Global Ctrl/Cmd+K listener — mounts once, only for admins. */
export function useAdminSearchShortcut(open: boolean, setOpen: (v: boolean) => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(!open)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setOpen])
}
