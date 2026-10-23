import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTenants } from './TenantsContext'
import { StatusBadge, TenantAvatar } from './TenantUi'
import { matchesSearch, piUnitsForTenant, readRecentTenants, rememberRecentTenant, statusBadges } from './tenantStatus'

// Cmd/Ctrl+K tenant switcher: search box, matching tenants with their status
// badge, recent tenants (localStorage, best effort), arrow keys + Enter + Esc.
// Switching keeps the tab you are on, so Billing -> Billing for the next tenant.
export default function QuickSwitcher({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element | null {
  const { tenants, piUnits } = useTenants()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setQuery('')
      setActive(0)
      window.setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open])

  const results = useMemo(() => {
    const live = tenants.filter((t) => !t.deletedAt)
    if (query.trim()) return live.filter((t) => matchesSearch(t, query, piUnitsForTenant(piUnits, t.id))).slice(0, 12)
    const recents = readRecentTenants()
      .map((slug) => live.find((t) => t.slug === slug))
      .filter((t): t is NonNullable<typeof t> => !!t)
    const rest = [...live].sort((a, b) => a.name.localeCompare(b.name)).filter((t) => !recents.includes(t))
    return [...recents, ...rest].slice(0, 12)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenants, piUnits, query, open])

  useEffect(() => {
    if (active >= results.length) setActive(Math.max(0, results.length - 1))
  }, [results, active])

  if (!open) return null

  const recentCount = query.trim() ? 0 : readRecentTenants().filter((slug) => tenants.some((t) => t.slug === slug && !t.deletedAt)).length

  function choose(index: number) {
    const tenant = results[index]
    if (!tenant) return
    rememberRecentTenant(tenant.slug)
    const tab = params.get('tab')
    navigate(`/platform/tenants/${tenant.slug}${tab ? `?tab=${encodeURIComponent(tab)}` : ''}`)
    onClose()
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((i) => Math.min(results.length - 1, i + 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((i) => Math.max(0, i - 1))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      choose(active)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-slate-950/70 px-4 pt-[10vh]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Switch tenant"
        onKeyDown={onKeyDown}
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-slate-950 shadow-2xl"
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setActive(0)
          }}
          placeholder="Search tenants by name, slug, email or Pi box"
          aria-label="Search tenants"
          role="combobox"
          aria-expanded="true"
          aria-controls="tenant-switcher-list"
          className="min-h-[56px] w-full border-b border-border bg-transparent px-5 text-[17px] text-white placeholder:text-muted-400 focus:outline-none"
        />
        <ul id="tenant-switcher-list" role="listbox" className="max-h-[60vh] overflow-y-auto p-2">
          {results.length === 0 && <li className="px-3 py-4 text-[16px] text-muted-400">No tenants match.</li>}
          {results.map((tenant, index) => (
            <li key={tenant.id} role="presentation">
              {recentCount > 0 && index === 0 && <div className="px-3 pb-1 pt-1 text-[14px] font-semibold text-muted-300">Recent</div>}
              {recentCount > 0 && index === recentCount && <div className="px-3 pb-1 pt-3 text-[14px] font-semibold text-muted-300">All tenants</div>}
              <button
                type="button"
                role="option"
                aria-selected={index === active}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(index)}
                className={`flex min-h-[56px] w-full items-center gap-3 rounded-lg px-3 py-2 text-left ${
                  index === active ? 'bg-accent-sky-500/15' : 'hover:bg-slate-800/60'
                }`}
              >
                <TenantAvatar name={tenant.name} logoUrl={tenant.logoUrl} size={32} />
                <span className="min-w-0 flex-1">
                  <span className="block break-words text-[16px] font-semibold text-white">{tenant.name}</span>
                  <span className="block break-all text-[15px] text-muted-400">{tenant.slug}</span>
                </span>
                <span className="flex shrink-0 flex-wrap justify-end gap-1">
                  {statusBadges(tenant).slice(0, 2).map((badge) => (
                    <StatusBadge key={badge.label} badge={badge} />
                  ))}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-between border-t border-border px-5 py-3 text-[15px] text-muted-400">
          <span>Up/Down to move, Enter to open</span>
          <span>Esc to close</span>
        </div>
      </div>
    </div>
  )
}
