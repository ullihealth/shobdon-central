const cards = [
  { title: 'Runway Status', value: '08/26 Open' },
  { title: 'Circuit Direction', value: 'Left-hand' },
  { title: 'Airfield Info', value: 'PPR only after 17:00' },
  { title: 'Safety Notices', value: '' }
]

export default function RightInfoPanel(): JSX.Element {
  return (
    <div className="h-full rounded-3xl border border-border bg-panel p-6 shadow-xl shadow-slate-950/20">
      <div className="mb-5 text-lg font-semibold uppercase tracking-[0.25em] text-muted-400">Ops Panel</div>
      <div className="grid gap-4">
        {cards.map((card) => (
          <div key={card.title} className="rounded-3xl border border-border bg-card p-5">
            <div className="text-xs uppercase tracking-[0.25em] text-muted-500">{card.title}</div>
            <div className="mt-3 text-3xl font-semibold text-primary">{card.value}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
