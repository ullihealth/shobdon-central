import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { authClient } from '../../lib/auth/authClient'

interface SidebarUserMenuProps {
  activePath: string
}

// Deliberately separate from the grouped nav items above it (own smaller
// block, divider, bottom-anchored) - account actions aren't content
// navigation and shouldn't compete visually with it.
export default function SidebarUserMenu({ activePath }: SidebarUserMenuProps): JSX.Element {
  const navigate = useNavigate()
  const [loggingOut, setLoggingOut] = useState(false)

  async function handleLogout() {
    setLoggingOut(true)
    await authClient.signOut()
    navigate('/login')
  }

  return (
    <div className="border-t border-slate-800 px-3 py-4">
      <Link
        to="/account"
        className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-semibold transition ${
          activePath === '/account' ? 'bg-accent-sky-500/15 text-accent-sky-400' : 'text-muted-400 hover:bg-slate-900/80 hover:text-white'
        }`}
      >
        <span className="text-base">👤</span>
        <span>My Account</span>
      </Link>
      <button
        type="button"
        onClick={handleLogout}
        disabled={loggingOut}
        className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-semibold text-muted-400 transition hover:bg-slate-900/80 hover:text-status-bad disabled:opacity-50"
      >
        <span className="text-base">🚪</span>
        <span>{loggingOut ? 'Logging out…' : 'Log out'}</span>
      </button>
    </div>
  )
}
