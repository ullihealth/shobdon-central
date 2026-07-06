import { Link, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

interface HeaderProps {
  rightSlot?: ReactNode
}

export default function Header({ rightSlot }: HeaderProps): JSX.Element {
  const [now, setNow] = useState(new Date())
  const location = useLocation()
  const isConfigPage = location.pathname === '/config'

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(interval)
  }, [])

  const timeString = now.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })

  const lastUpdatedString = now.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit'
  })

  return (
    <div className="relative h-full w-full rounded-xl bg-gradient-to-r from-slate-800/60 via-slate-900/50 to-slate-800/50 p-3 shadow-lg flex items-center justify-between px-5">
      {/* Left - title (doubles as the Configuration nav control) with Last Updated, read as one info block */}
      <Link
        to={isConfigPage ? '/' : '/config'}
        className="group flex flex-col cursor-pointer"
        title={isConfigPage ? 'Back to Dashboard' : 'Weather Config'}
      >
        <div className="text-3xl font-black uppercase tracking-wide text-white transition-colors group-hover:text-sky-400">
          SHOBDON AIRFIELD
        </div>
        <div className="text-sm font-medium text-slate-300 leading-tight">Last updated {lastUpdatedString}</div>
      </Link>

      {/* Centre - large clock, absolutely centred against the full header width */}
      <div className="absolute left-1/2 -translate-x-1/2">
        <div className="text-5xl font-extrabold text-white">{timeString}</div>
      </div>

      {/* Right - optional slot (e.g. weather status indicator on the dashboard) */}
      {rightSlot}
    </div>
  )
}
