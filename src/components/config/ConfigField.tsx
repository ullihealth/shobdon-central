import type { ReactNode } from 'react'

interface ConfigFieldProps {
  label: string
  children: ReactNode
}

export const configInputClassName =
  'w-full rounded-lg border border-slate-700 bg-slate-900/80 px-4 py-2 text-lg text-white focus:border-sky-500 focus:outline-none'

export default function ConfigField({ label, children }: ConfigFieldProps): JSX.Element {
  return (
    <div className="grid grid-cols-[160px_1fr] items-center gap-6">
      <label className="text-sm uppercase tracking-widest text-slate-400">{label}</label>
      {children}
    </div>
  )
}
