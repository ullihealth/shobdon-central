import { useEffect, useState } from 'react'

const PLATFORM_TENANTS_URL = '/api/platform/tenants'
const PREVIEW_ORG_URL = '/api/platform/preview-org'
const ME_URL = '/api/tenant/me'

interface PlatformTenant {
  slug: string
  name: string
  subdomain: string
  active: boolean
}

interface MeResponse {
  organizationSlug?: string
  organizationName?: string
}

const ADMIN_LINKS = [
  { to: '/config', label: 'Config' },
  { to: '/media-manager', label: 'Media Manager' },
  { to: '/runways', label: 'Runways' },
  { to: '/members', label: 'Members' },
  { to: '/design', label: 'Screens Design (live dashboard preview)' },
]

// Developer-only (RequireAuth requireDeveloper, same gate as
// /platform/tenants). Sets DEV_PREVIEW_ORG_COOKIE via preview-org.ts,
// which requireTenant's own tier 3 (tenantAuth.ts) then reads on every
// subsequent /config, /media-manager, /runways, /members, or Screens
// Design request - one picker here, no duplicate pages, since all of
// those already resolve tenant via requireTenant and pick this up
// automatically. Deliberately a different cookie from the regular
// account/org switcher (AdminSidebar's own OrgSwitcher) - see
// resolveDeveloperPreviewTenant's own comment in tenantAuth.ts for why
// mixing the two would be a real bug, not just an implementation detail.
export default function PlatformPreviewPage(): JSX.Element {
  const [tenants, setTenants] = useState<PlatformTenant[]>([])
  const [currentSlug, setCurrentSlug] = useState<string | null>(null)
  const [currentName, setCurrentName] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [switching, setSwitching] = useState(false)

  function loadState() {
    setLoading(true)
    return Promise.all([
      fetch(PLATFORM_TENANTS_URL).then((r) => {
        if (r.status === 401 || r.status === 403) {
          setForbidden(true)
          return null
        }
        return r.ok ? r.json() : null
      }),
      fetch(ME_URL).then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([tenantsData, meData]: [{ tenants?: PlatformTenant[] } | null, MeResponse | null]) => {
        if (tenantsData) setTenants(tenantsData.tenants ?? [])
        setCurrentSlug(meData?.organizationSlug ?? null)
        setCurrentName(meData?.organizationName ?? null)
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    loadState()
  }, [])

  async function handleSelect(orgSlug: string | null) {
    setSwitching(true)
    try {
      await fetch(PREVIEW_ORG_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgSlug }),
      })
      await loadState()
    } finally {
      setSwitching(false)
    }
  }

  if (forbidden) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-page-from via-page-via to-page-to px-4 text-slate-100">
        <div className="w-full max-w-sm rounded-2xl border border-border bg-panel p-8 text-center shadow-xl shadow-slate-950/20">
          <h1 className="mb-3 text-xl font-black uppercase tracking-wide text-status-bad">Not authorized</h1>
          <p className="text-sm text-muted-400">Platform admin access required.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-page-from via-page-via to-page-to px-6 pb-16 pt-10 text-slate-100">
      <div className="mx-auto max-w-[900px]">
        <h1 className="mb-2 text-2xl font-black uppercase tracking-wide text-primary">Platform · Tenant Preview</h1>
        <p className="mb-6 max-w-2xl text-sm text-muted-400">
          Pick any tenant to preview their admin pages and live dashboard as if you were logged into that tenant -
          no real membership required. This is separate from your own account's organization switcher; picking a
          tenant here never changes what you see on your own real tenant's pages.
        </p>

        {loading ? (
          <p className="text-sm text-muted-400">Loading…</p>
        ) : (
          <>
            <div className="mb-6 rounded-xl border border-border bg-panel p-4">
              <div className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-500">
                {currentSlug ? (
                  <span>
                    Currently previewing: <span className="text-accent-sky-400">{currentName}</span> ({currentSlug})
                  </span>
                ) : (
                  <span>Not previewing any tenant - admin pages show your own account's normal context.</span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <select
                  value={currentSlug ?? ''}
                  onChange={(e) => handleSelect(e.target.value || null)}
                  disabled={switching}
                  className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none disabled:opacity-50"
                >
                  <option value="">Select a tenant to preview…</option>
                  {tenants.map((t) => (
                    <option key={t.slug} value={t.slug}>
                      {t.name} ({t.slug}){!t.active ? ' - paused' : ''}
                    </option>
                  ))}
                </select>
                {currentSlug && (
                  <button
                    type="button"
                    onClick={() => handleSelect(null)}
                    disabled={switching}
                    className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-xs font-semibold uppercase tracking-widest text-muted-400 hover:border-slate-500 disabled:opacity-40"
                  >
                    Stop previewing
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {ADMIN_LINKS.map((link) => (
                <a
                  key={link.to}
                  href={link.to}
                  className="rounded-xl border border-border bg-panel p-4 text-sm font-semibold text-primary hover:border-accent-sky-500"
                >
                  {link.label} →
                </a>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
