import { useWeather } from '../context/WeatherContext'

export default function RightInfoPanel(): JSX.Element {
  const { weather, liveDataUnavailable } = useWeather()

  // Same liveDataUnavailable treatment as LeftInfoPanel's Notices row -
  // an empty notams array during an unintended mock fallback would
  // otherwise read as a false "No active notices" all-clear.
  const safetyNoticesValue =
    !weather || liveDataUnavailable
      ? 'N/A'
      : weather.notams.length > 0
        ? weather.notams.join(' • ')
        : 'No active notices'

  // Runway Status, Circuit Direction, and Airfield Info stay static here
  // deliberately - Runway Status is driven separately by /runways config,
  // Circuit Direction is pending a future manual ATC-control page, and
  // Airfield Info's PPR notice is a fixed club fact, not live data.
  const cards = [
    { title: 'Runway Status', value: '08/26 Open' },
    { title: 'Circuit Direction', value: 'Left-hand' },
    { title: 'Airfield Info', value: 'PPR only after 17:00' },
    { title: 'Safety Notices', value: safetyNoticesValue },
  ]

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
