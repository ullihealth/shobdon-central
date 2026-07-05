const cards = [
  { title: 'Runway Status', value: '05/23 Open' },
  { title: 'Circuit Direction', value: 'Left-hand' },
  { title: 'Airfield Info', value: 'PPR only after 18:00' },
  { title: 'Safety Notices', value: 'Bird activity near apron' },
  { title: 'Upcoming Events', value: 'Fly-in Saturday 10:00' }
]

export default function RightInfoPanel(): JSX.Element {
  return (
    <div className="h-full rounded-3xl border border-slate-700 bg-slate-950/85 p-6 shadow-xl shadow-slate-950/20">
      <div className="mb-5 text-lg font-semibold uppercase tracking-[0.25em] text-slate-400">Ops Panel</div>
      <div className="grid gap-4">
        {cards.map((card) => (
          <div key={card.title} className="rounded-3xl border border-slate-700 bg-slate-900/90 p-5">
            <div className="text-xs uppercase tracking-[0.25em] text-slate-500">{card.title}</div>
            <div className="mt-3 text-3xl font-semibold text-white">{card.value}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
