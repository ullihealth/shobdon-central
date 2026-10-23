import type { ReactNode } from 'react'
import type { Badge, BadgeTone } from './tenantStatus'
import { tenantInitials } from './tenantStatus'

// Small shared pieces for the Platform Tenants pages. Badge colours follow
// the brief (red suspended, amber awaiting/none, blue plan, grey internal,
// green active); every text/background pair is at least 4.5:1 on the dark
// navy panels.
const TONE_CLASSES: Record<BadgeTone, string> = {
  red: 'border-red-400/50 bg-red-950/70 text-red-200',
  amber: 'border-amber-400/50 bg-amber-950/70 text-amber-200',
  blue: 'border-sky-400/50 bg-sky-950/70 text-sky-200',
  grey: 'border-slate-500/50 bg-slate-800/80 text-slate-200',
  green: 'border-emerald-400/50 bg-emerald-950/70 text-emerald-200',
}

export function StatusBadge({ badge }: { badge: Badge }): JSX.Element {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-bold ${TONE_CLASSES[badge.tone]}`}
    >
      {badge.label}
    </span>
  )
}

export function TenantAvatar({ name, logoUrl, size = 36 }: { name: string; logoUrl: string | null; size?: number }): JSX.Element {
  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt=""
        width={size}
        height={size}
        className="shrink-0 rounded-lg bg-slate-900 object-contain"
        style={{ width: size, height: size }}
      />
    )
  }
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center rounded-lg bg-slate-800 text-xs font-black text-slate-200"
      style={{ width: size, height: size }}
    >
      {tenantInitials(name)}
    </span>
  )
}

export function Card({ title, description, children }: { title: string; description?: string; children: ReactNode }): JSX.Element {
  return (
    <section className="rounded-2xl border border-border bg-panel p-5">
      <h3 className="mb-1 text-sm font-bold uppercase tracking-widest text-accent-sky-400">{title}</h3>
      {description && <p className="mb-3 text-xs text-muted-400">{description}</p>}
      {!description && <div className="mb-2" />}
      {children}
    </section>
  )
}

export function Fact({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/50 py-1.5 text-sm last:border-0">
      <dt className="text-muted-400">{label}</dt>
      <dd className="min-w-0 truncate text-right font-medium text-slate-100">{children}</dd>
    </div>
  )
}

// Contrast-safe dot + text for a Pi box's last-seen state.
export function PiStateText({ state }: { state: 'online' | 'offline' | 'unknown' }): JSX.Element {
  const map = {
    online: { dot: 'bg-emerald-400', text: 'text-emerald-200', label: 'Online' },
    offline: { dot: 'bg-red-400', text: 'text-red-200', label: 'Offline' },
    unknown: { dot: 'bg-slate-400', text: 'text-slate-300', label: 'No check-in yet' },
  }[state]
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${map.text}`}>
      <span className={`h-2 w-2 rounded-full ${map.dot}`} aria-hidden="true" />
      {map.label}
    </span>
  )
}
