export default function FooterStatusBar(): JSX.Element {
  return (
    <div className="flex flex-col gap-3 rounded-3xl border border-slate-700 bg-slate-950/80 px-6 py-5 text-slate-300 shadow-xl shadow-slate-950/20 sm:flex-row sm:items-center sm:justify-between">
      <div className="text-sm text-slate-400">Dashboard status: Placeholder data only</div>
      <div className="flex flex-wrap gap-4 text-sm text-slate-300">
        <span className="rounded-full bg-slate-900/90 px-3 py-1">Update cadence: TBC</span>
        <span className="rounded-full bg-slate-900/90 px-3 py-1">Connectivity test: /config</span>
      </div>
    </div>
  )
}
