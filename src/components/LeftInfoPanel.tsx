const cards = [
  { title: 'Club Update', content: 'New briefing notes available in the clubhouse.' },
  { title: 'Local Weather', content: 'Pressure 1016 hPa, stable with light cloud.' },
  { title: 'Flight Plan', content: 'Submit by 09:00 for afternoon arrivals.' }
]

export default function LeftInfoPanel(): JSX.Element {
  return (
    <div className="rounded-3xl border border-slate-700 bg-slate-950/80 p-5 shadow-xl shadow-slate-950/20">
      <div className="mb-6 text-lg font-semibold text-white">Left Panel</div>
      <div className="space-y-4">
        {cards.map((card) => (
          <div key={card.title} className="rounded-3xl border border-slate-700 bg-slate-900/90 p-4">
            <div className="text-sm uppercase tracking-[0.25em] text-slate-500">{card.title}</div>
            <div className="mt-3 text-base leading-6 text-slate-200">{card.content}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
