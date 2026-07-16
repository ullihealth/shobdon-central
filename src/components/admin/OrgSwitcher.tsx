import { useState } from 'react'

export interface MembershipSummary {
  slug: string
  name: string
  role: string
}

interface OrgSwitcherProps {
  memberships: MembershipSummary[]
  activeOrgSlug: string
}

// Only renders a real dropdown once the account has 2+ memberships -
// every single-org account (every real club today) sees nothing here,
// so their experience is unchanged from before this feature existed.
export default function OrgSwitcher({ memberships, activeOrgSlug }: OrgSwitcherProps): JSX.Element | null {
  const [switching, setSwitching] = useState(false)

  if (memberships.length <= 1) return null

  async function handleChange(event: React.ChangeEvent<HTMLSelectElement>): Promise<void> {
    const orgSlug = event.target.value
    if (orgSlug === activeOrgSlug) return
    setSwitching(true)
    try {
      const response = await fetch('/api/tenant/switch-org', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgSlug }),
      })
      if (response.ok) {
        // Full reload rather than client-side state update - every admin
        // page independently fetches its own tenant-scoped data on
        // mount with no shared org-context store, so a reload is what
        // makes every already-mounted component's data refetch under
        // the newly selected org.
        window.location.reload()
      } else {
        setSwitching(false)
      }
    } catch {
      setSwitching(false)
    }
  }

  return (
    <div className="px-5 pb-4">
      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Organization</label>
      <select
        value={activeOrgSlug}
        onChange={handleChange}
        disabled={switching}
        className="w-full rounded-lg border border-slate-700 bg-slate-900/80 px-2 py-1.5 text-sm text-slate-100 transition focus:border-accent-sky-500 focus:outline-none disabled:opacity-60"
      >
        {memberships.map((membership) => (
          <option key={membership.slug} value={membership.slug}>
            {membership.name}
          </option>
        ))}
      </select>
    </div>
  )
}
