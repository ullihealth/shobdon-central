export default function CentreDisplayPanel(): JSX.Element {
  return (
    <div className="rounded-[2rem] border border-slate-700 bg-slate-950/85 p-6 shadow-2xl shadow-slate-950/30">
      <div className="flex items-center justify-between border-b border-slate-700 pb-4">
        <div>
          <div className="text-sm uppercase tracking-[0.3em] text-slate-500">Media Panel</div>
          <div className="mt-2 text-2xl font-semibold text-white">Placeholder content</div>
        </div>
      </div>
      <div className="mt-8 flex h-[520px] items-center justify-center rounded-3xl border-2 border-dashed border-slate-700 bg-slate-900/70 text-center text-slate-400">
        <div>
          <div className="text-3xl font-semibold text-white">Media Panel</div>
          <div className="mt-3 text-sm text-slate-400">Images, notices, advertisements, videos, and live webcam will appear here.</div>
        </div>
      </div>
    </div>
  )
}
