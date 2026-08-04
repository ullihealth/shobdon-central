// Pilot View header - AFISO open/closed + frequency. Manual, platform-
// admin-set data (tenants.afiso_open/afiso_frequency, migration 0070) -
// no live AFISO data source exists anywhere in this app. Reuses the
// same status-good/status-bad token classes RightInfoPanel.tsx's own
// "RUNWAYS CLOSED" styling already uses, for visual consistency.
export default function AfisoIndicator({ open, frequency }: { open: boolean; frequency: string }): JSX.Element {
  return (
    <div className="flex items-center gap-1.5 text-xs font-semibold">
      <span className={open ? 'text-status-good' : 'text-status-bad'}>{open ? 'AFISO OPEN' : 'AFISO CLOSED'}</span>
      {frequency && <span className="text-muted-400">{frequency}</span>}
    </div>
  )
}
