import CompassPanel from './CompassPanel'

export default function CentreDisplayPanel(): JSX.Element {
  return (
    <div className="h-full flex flex-col gap-4 overflow-hidden">
      {/* Upper Media Panel (40% height) */}
      <div className="h-2/5 rounded-xl border border-slate-700 bg-slate-950/90 p-4 shadow-lg shadow-slate-950/30">
        <div className="flex h-full flex-col rounded-lg border border-dashed border-slate-700 bg-slate-900/60">
          <div className="flex items-center justify-between border-b border-slate-700 px-4 py-3">
            <div>
              <div className="text-xs uppercase tracking-widest text-slate-500">Media</div>
              <div className="mt-1 text-xl font-bold text-white">Primary Display</div>
            </div>
            <div className="rounded-full bg-slate-800 px-3 py-1 text-xs uppercase tracking-widest text-slate-400">
              Placeholder
            </div>
          </div>
          <div className="flex flex-1 items-center justify-center p-6 text-center">
            <div className="space-y-2">
              <div className="text-2xl font-semibold text-white">Media Panel</div>
              <div className="text-sm text-slate-400">
                Images, webcam, alerts, or slideshow content
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Lower Compass Panel (60% height) */}
      <div className="h-3/5 overflow-hidden rounded-xl">
        <CompassPanel />
      </div>
    </div>
  )
}
