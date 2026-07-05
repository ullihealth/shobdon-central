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
    <div className="flex flex-col gap-4 rounded-3xl border border-slate-700 bg-slate-950/80 px-6 py-5 shadow-xl shadow-slate-950/20 backdrop-blur-sm md:flex-row md:items-center md:justify-between">
      <div>
        <div className="text-sm uppercase tracking-[0.3em] text-slate-500">Shobdon Central</div>
        <div className="mt-2 text-3xl font-semibold text-white">Clubhouse Dashboard</div>
      </div>
      <div className="grid gap-2 text-right text-slate-300 md:text-left">
        <div className="text-sm text-slate-400">{dateString}</div>
        <div className="text-2xl font-medium text-white">{timeString}</div>
      </div>
      <div className="flex items-center justify-between gap-3 md:justify-end">
        <Link
          to={isConfigPage ? '/': '/config'}
          className="inline-flex rounded-full border border-slate-700 bg-slate-900/90 px-4 py-2 text-sm font-semibold text-slate-100 transition hover:border-slate-500 hover:text-white"
        >
          {isConfigPage ? 'Back to Dashboard' : 'Weather Config'}
        </Link>
      </div>
    </div>
  )
}
