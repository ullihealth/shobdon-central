import type { CSSProperties } from 'react'

interface PilotLockedScreenProps {
  airfieldName: string | null
  logoUrl: string | null
  themeOverride: CSSProperties
}

// Mobile access gating round (migration 0071) - shown by PilotViewPage.tsx
// in place of the full mobile dashboard when tenants.mobile_enabled is
// false. No new branding logic here: same logo/name fallback PilotHeader
// already uses (img if logoUrl resolved, else the airfield name as text),
// and the same club_theme CSS-variable override mechanism DashboardPage.tsx
// already applies to the TV templates (theme -> CSSProperties -> spread
// onto a root element's style) - PilotViewPage.tsx just wasn't reading
// `theme` off the public config response before this round, since nothing
// on that page needed it yet. bg-page-from/via/to are the same tokens the
// full Pilot View's own root already uses, so an unbranded tenant (no
// club_theme row) falls back to the exact same default gradient.
export default function PilotLockedScreen({ airfieldName, logoUrl, themeOverride }: PilotLockedScreenProps): JSX.Element {
  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center gap-6 bg-gradient-to-b from-page-from via-page-via to-page-to px-6 text-center text-slate-100"
      style={themeOverride}
    >
      {logoUrl ? (
        <img src={logoUrl} alt={airfieldName ?? 'Airfield logo'} className="h-16 max-w-[220px] object-contain" />
      ) : (
        <span className="text-xl font-bold uppercase tracking-wide text-primary">{airfieldName ?? 'Airfield Central'}</span>
      )}
      <div className="flex max-w-xs flex-col gap-2">
        <div className="text-sm font-semibold uppercase tracking-widest text-accent-sky-400">Mobile Pilot View</div>
        <p className="text-sm text-muted-400">
          This airfield hasn't unlocked the mobile Pilot View yet. Ask your club to enable it to see live weather,
          NOTAMs, and airfield info on your phone.
        </p>
      </div>
    </div>
  )
}
