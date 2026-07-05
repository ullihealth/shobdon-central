import { Link, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'

export default function Header(): JSX.Element {
  const [now, setNow] = useState(new Date())
  const location = useLocation()
  const isConfigPage = location.pathname === '/config'

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(interval)
  }, [])

  const dateString = now.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  })
  const timeString = now.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })

  return (
    <div className="grid h-full grid-cols-[2fr_1fr_1fr] gap-4 rounded-3xl border border-slate-700 bg-slate-950/85 px-6 py-5 shadow-xl shadow-slate-950/20">
      <div className="flex flex-col justify-center gap-2">
        <div className="text-sm uppercase tracking-[0.3em] text-slate-500">Shobdon Central</div>
        <div className="text-4xl font-semibold text-white">Clubhouse Operations</div>
      </div>

      <div className="flex flex-col justify-center gap-3 border-x border-slate-700 px-4 text-right text-slate-300">
        <div className="text-xs uppercase tracking-[0.25em] text-slate-500">Date</div>
        <div className="text-2xl font-semibold text-white">{dateString}</div>
        <div className="text-xs uppercase tracking-[0.25em] text-slate-500">Time</div>
        <div className="text-3xl font-semibold text-white">{timeString}</div>
      </div>

      <div className="grid items-center gap-3 text-right">
        <div className="rounded-3xl bg-slate-900/90 p-4 text-left text-slate-200">
          <div className="text-xs uppercase tracking-[0.25em] text-slate-500">Current Runway</div>
          <div className="mt-2 text-3xl font-semibold text-white">05/23</div>
        </div>
        <div className="rounded-3xl bg-slate-900/90 p-4 text-left text-slate-200">
          <div className="text-xs uppercase tracking-[0.25em] text-slate-500">Weather Status</div>
          <div className="mt-2 text-3xl font-semibold text-white">VFR, light wind</div>
        </div>
        <Link
          to={isConfigPage ? '/' : '/config'}
          className="inline-flex justify-center rounded-full border border-slate-700 bg-sky-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-sky-500"
        >
          {isConfigPage ? 'Back to Dashboard' : 'Weather Config'}
        </Link>
      </div>
    </div>
  )
}
