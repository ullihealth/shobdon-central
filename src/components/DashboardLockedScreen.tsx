import type { CSSProperties } from 'react'

interface DashboardLockedScreenProps {
  airfieldName: string | null
  logoUrl: string | null
  themeOverride: CSSProperties
}

// Reception Dashboard entitlement gating (Airfield Pack round, migration
// 0106) - shown by DashboardPage.tsx ('/') and TenantDisplayPage.tsx
// ('/d/:slug', non-café templates only) in place of the real TV/
// clubhouse display when tenants.dashboard_enabled is false. Direct
// mirror of PilotLockedScreen.tsx's own shape (same logo/name fallback,
// same club_theme CSS-variable override) - deliberately the same soft,
// branded "not unlocked yet" message rather than TenantUnavailable's
// generic unavailable state, matching mobileEnabled's own established
// tone for this exact scenario (a real customer who hasn't paid yet,
// not a broken/unknown tenant).
export default function DashboardLockedScreen({ airfieldName, logoUrl, themeOverride }: DashboardLockedScreenProps): JSX.Element {
  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center gap-6 bg-gradient-to-b from-page-from via-page-via to-page-to px-6 text-center text-slate-100"
      style={themeOverride}
    >
      {logoUrl ? (
        <img src={logoUrl} alt={airfieldName ?? 'Airfield logo'} className="h-20 max-w-[280px] object-contain" />
      ) : (
        <span className="text-2xl font-bold uppercase tracking-wide text-primary">{airfieldName ?? 'Airfield Central'}</span>
      )}
      <div className="flex max-w-sm flex-col gap-2">
        <div className="text-sm font-semibold uppercase tracking-widest text-accent-sky-400">Reception Dashboard</div>
        <p className="text-sm text-muted-400">
          This airfield hasn't unlocked the Reception Dashboard yet. Contact AirfieldCentral to activate it.
        </p>
      </div>
    </div>
  )
}
