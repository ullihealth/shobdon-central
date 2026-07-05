const data = [
  { label: 'Wind', value: 'NNE 12 kt' },
  { label: 'QNH', value: '1016 hPa' },
  { label: 'Temperature', value: '16°C' },
  { label: 'Visibility', value: '10 km' },
  { label: 'Notices', value: '4 active' }
]

export default function LeftInfoPanel(): JSX.Element {
  return (
    <div className="h-full rounded-3xl border border-slate-700 bg-slate-950/85 p-6 shadow-xl shadow-slate-950/20">
      <div className="mb-5 text-lg font-semibold uppercase tracking-[0.25em] text-slate-400">Weather Summary</div>
      <div className="grid gap-4">
        {data.map((item) => (
          <div key={item.label} className="rounded-3xl border border-slate-700 bg-slate-900/90 p-5">
            <div className="text-xs uppercase tracking-[0.25em] text-slate-500">{item.label}</div>
            <div className="mt-3 text-3xl font-semibold text-white">{item.value}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
