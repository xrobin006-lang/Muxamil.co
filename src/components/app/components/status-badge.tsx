'use client'

import { Clock3, CheckCircle2, XCircle, ShieldAlert, FileEdit } from 'lucide-react'
import { cn } from '@/lib/utils'

type Status = 'pending' | 'approved' | 'rejected' | 'published' | 'draft' | 'resolved' | 'dismissed' | 'blocked' | 'active' | 'inactive'

const CONFIG: Record<Status, { label: string; className: string; icon: typeof Clock3 }> = {
  pending: { label: 'Pending review', className: 'bg-amber-500/12 text-amber-700 dark:text-amber-400 border-amber-500/25', icon: Clock3 },
  approved: { label: 'Approved', className: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400 border-emerald-500/25', icon: CheckCircle2 },
  published: { label: 'Published', className: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400 border-emerald-500/25', icon: CheckCircle2 },
  draft: { label: 'Draft', className: 'bg-muted text-muted-foreground border-border', icon: FileEdit },
  resolved: { label: 'Resolved', className: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400 border-emerald-500/25', icon: CheckCircle2 },
  active: { label: 'Active', className: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400 border-emerald-500/25', icon: CheckCircle2 },
  rejected: { label: 'Rejected', className: 'bg-destructive/10 text-destructive border-destructive/25', icon: XCircle },
  dismissed: { label: 'Dismissed', className: 'bg-muted text-muted-foreground border-border', icon: XCircle },
  blocked: { label: 'Blocked', className: 'bg-destructive/10 text-destructive border-destructive/25', icon: ShieldAlert },
  inactive: { label: 'Unavailable', className: 'bg-muted text-muted-foreground border-border', icon: ShieldAlert },
}

export function StatusBadge({ status, className }: { status: Status; className?: string }) {
  const cfg = CONFIG[status] ?? CONFIG.pending
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium',
        cfg.className,
        className,
      )}
    >
      <cfg.icon className="h-3 w-3" aria-hidden="true" />
      {cfg.label}
    </span>
  )
}
