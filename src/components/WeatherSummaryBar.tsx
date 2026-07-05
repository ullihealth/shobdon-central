const summaryItems = [
  { label: 'Wind', value: 'NNE 12 kt', detail: 'Light breeze' },
  { label: 'Visibility', value: '10 km', detail: 'Clear' },
  { label: 'Traffic', value: 'Moderate', detail: 'Club movements' },
  { label: 'Notices', value: '4 active', detail: 'Runway alerts' }
]

export default function WeatherSummaryBar(): JSX.Element {
  return (
    <div className="grid gap-4 md:grid-cols-4">
      {summaryItems.map((item) => (
        <div key={item.label} className="rounded-3xl border border-slate-700 bg-slate-950/80 p-5 shadow-lg shadow-slate-950/10">
          <div className="text-sm uppercase tracking-[0.25em] text-slate-500">{item.label}</div>
          <div className="mt-3 text-3xl font-semibold text-white">{item.value}</div>
          <div className="mt-2 text-sm text-slate-400">{item.detail}</div>
        </div>
      ))}
    </div>
  )
}
