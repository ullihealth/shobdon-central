import { Link } from 'react-router-dom'
import type { SidebarGroupConfig } from './sidebarConfig'

interface SidebarGroupProps {
  group: SidebarGroupConfig
  activePath: string
  collapsed: boolean
  onToggle: () => void
}

export default function SidebarGroup({ group, activePath, collapsed, onToggle }: SidebarGroupProps): JSX.Element {
  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-sm font-bold uppercase tracking-widest text-muted-400 transition hover:text-muted-300"
      >
        <span>{group.label}</span>
        <span className={`inline-block text-[10px] transition-transform ${collapsed ? '-rotate-90' : ''}`}>▾</span>
      </button>
      {!collapsed && (
        <div className="flex flex-col gap-0.5">
          {group.items.map((item) => {
            const active = item.to === activePath
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`block rounded-lg px-3 py-2 text-base font-semibold transition ${
                  active ? 'bg-accent-sky-500/15 text-accent-sky-400' : 'text-slate-300 hover:bg-slate-900/80 hover:text-white'
                }`}
              >
                {item.label}
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
