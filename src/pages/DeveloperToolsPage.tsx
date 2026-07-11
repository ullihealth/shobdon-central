import { Link } from 'react-router-dom'
import Header from '../components/Header'
import AtcDeveloperTools from '../components/config/AtcDeveloperTools'

export default function DeveloperToolsPage(): JSX.Element {
  return (
    <div className="min-h-screen bg-gradient-to-b from-page-from via-page-via to-page-to text-slate-100">
      <div className="mx-auto h-24 max-w-[1920px] px-10 pt-6">
        <Header />
      </div>

      <div className="mx-auto max-w-3xl px-6 pb-10">
        <div className="mt-6 rounded-3xl border border-slate-700 bg-slate-950/85 p-10 shadow-xl shadow-slate-950/20">
          <Link to="/config" className="text-sm font-semibold text-muted-400 hover:text-accent-sky-400">
            ← Back to Config
          </Link>
          <h1 className="mb-2 mt-3 text-2xl font-black uppercase tracking-wide text-primary">Developer Tools</h1>
          <p className="mb-2 max-w-2xl text-sm text-muted-400">
            Capture pipeline diagnostics - relocated here from /config, visible only to the developer account
            regardless of tenant role.
          </p>

          <AtcDeveloperTools />
        </div>
      </div>
    </div>
  )
}
