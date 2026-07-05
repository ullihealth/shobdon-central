export default function CentreDisplayPanel(): JSX.Element {
  return (
    <div className="h-full rounded-[2rem] border border-slate-700 bg-slate-950/90 p-6 shadow-2xl shadow-slate-950/30">
      <div className="flex h-full flex-col rounded-[1.75rem] border-2 border-dashed border-slate-700 bg-slate-900/80">
        <div className="flex items-center justify-between border-b border-slate-700 px-6 py-5">
          <div>
            <div className="text-xs uppercase tracking-[0.3em] text-slate-500">Media Panel</div>
            <div className="mt-2 text-3xl font-semibold text-white">Primary Display</div>
          </div>
          <div className="rounded-full bg-slate-800 px-4 py-2 text-xs uppercase tracking-[0.25em] text-slate-300">Placeholder</div>
        </div>
        <div className="flex h-full items-center justify-center p-10 text-center">
          <div className="space-y-4">
            <div className="text-5xl font-semibold text-white">Media Panel</div>
            <div className="max-w-2xl text-base text-slate-400">Images, notices, advertisements, videos, and live webcam streams will be displayed here.</div>
          </div>
        </div>
      </div>
    </div>
  )
}
