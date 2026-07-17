// Shown by both DashboardPage.tsx ('/') and TenantDisplayPage.tsx
// ('/d/:displaySlug') when the tenant's public dashboard can't be
// resolved - most commonly because it's paused (tenants.active = 0,
// see functions/api/_utils/resolveTenantHost.ts), but also covers a
// genuinely misconfigured/unknown host the same way, since both cases
// warrant the identical response to an outside visitor: a clean,
// deliberate message instead of a blank or broken-looking dashboard.
// Deliberately doesn't say WHICH of those it is - that's an internal
// distinction, not something to expose to whoever's looking at the URL.
export default function TenantUnavailable(): JSX.Element {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-slate-950 text-center text-slate-300">
      <div>
        <p className="text-lg font-semibold text-slate-100">This dashboard isn&apos;t currently available.</p>
        <p className="mt-2 text-sm text-slate-500">Please check back later.</p>
      </div>
    </div>
  )
}
