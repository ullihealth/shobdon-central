import { Link, useLocation } from 'react-router-dom'

export default function FooterStatusBar(): JSX.Element {
  const location = useLocation()
  const isConfigPage = location.pathname === '/config'

  return (
    <div className="grid h-full grid-cols-[1fr_1fr] gap-4 rounded-3xl border border-slate-700 bg-slate-950/85 px-6 py-4 text-slate-300">
      <div className="flex items-center gap-4 border-r border-slate-700 pr-4 text-sm">
        <span className="rounded-full bg-slate-900/90 px-3 py-2">Dashboard v1.0</span>
        <span className="rounded-full bg-slate-900/90 px-3 py-2">Last updated: now</span>
        <span className="rounded-full bg-slate-900/90 px-3 py-2">Weather source: Local network</span>
      </div>
      <div className="flex items-center justify-end">
        <Link
          to={isConfigPage ? '/' : '/config'}
          className="rounded-full border border-slate-700 bg-sky-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-sky-500"
        >
          {isConfigPage ? 'Back to Dashboard' : 'Weather Config'}
        </Link>
      </div>
    </div>
  )
}
