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
    <div className="h-full w-full rounded-xl bg-gradient-to-r from-slate-800/60 via-slate-900/50 to-slate-800/50 p-4 shadow-lg" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', alignItems: 'center', gap: '12px' }}>
      {/* Left - title */}
      <div className="pl-4">
        <div className="text-xs uppercase tracking-widest text-slate-300">SHOBDON CENTRAL</div>
        <div className="mt-1 text-4xl font-extrabold text-white">Clubhouse</div>
      </div>

      {/* Centre - date + large clock */}
      <div className="text-center">
        <div className="text-sm uppercase tracking-wider text-slate-300">{dateString}</div>
        <div className="mt-1 text-5xl font-extrabold text-white">{timeString}</div>
      </div>

      {/* Right - source and runway */}
      <div className="flex items-center justify-end gap-6 pr-4">
        <div className="text-right">
          <div className="text-xs uppercase tracking-wider text-slate-300">Weather Source</div>
          <div className="text-2xl font-bold text-white">Local Network</div>
        </div>
        <div className="text-right">
          <div className="text-xs uppercase tracking-wider text-slate-300">Runway</div>
          <div className="text-3xl font-extrabold text-white">05/23</div>
        </div>
      </div>
    </div>
  )
}
