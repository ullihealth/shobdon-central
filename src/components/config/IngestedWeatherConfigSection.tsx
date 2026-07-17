// No client-side settings for this provider - unlike ATC (station
// URL/timeout) or Internet (lat/lon/provider), what feeds this is
// entirely server-side: whichever API key(s) have been issued for this
// tenant (functions/api/tenant/api-keys/, owner-only, no settings-page
// UI yet) and are actively POSTing to /api/ingest/weather.
export default function IngestedWeatherConfigSection(): JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold uppercase tracking-widest text-slate-400">Third-Party Station</h3>
      <p className="text-lg text-slate-300">Use data from a third-party weather station or vendor API.</p>
      <p className="text-base text-slate-500">
        Requires an API key sending readings to this club&apos;s ingestion endpoint - contact support to set one up.
      </p>
    </div>
  )
}
