import { useState } from 'react'
import { INVESTIGATION_LOG_URL } from '../../config/captureEndpoint'

interface CheckDefinition {
  name: string
  href: string
  presets: string[]
}

const CHECKS: CheckDefinition[] = [
  {
    name: 'Try HTTPS',
    href: 'https://192.168.2.1/disp/adisp.php',
    presets: [
      '✅ Loaded fine',
      '⚠️ Certificate warning — clicked through, same page loaded',
      "⚠️ Certificate warning — didn't click through",
      "❌ Couldn't connect",
      '❓ Something else',
    ],
  },
  {
    name: 'Check Root',
    href: 'http://192.168.2.1/',
    presets: [
      '📄 Same weather page',
      '🔑 Login/admin page shown',
      '📁 Directory listing shown',
      '❌ Blank / Not Found / Forbidden',
      '❓ Something else',
    ],
  },
  {
    name: 'Check Folder Listing',
    href: 'http://192.168.2.1/disp/',
    presets: ['📁 File list shown', '❌ Forbidden / Not Found', '❓ Something else'],
  },
]

type LoggedState = { label: string; ok: boolean } | null

export default function InvestigateStation(): JSX.Element {
  const [loggedByCheck, setLoggedByCheck] = useState<Record<string, LoggedState>>({})

  async function handleLog(check: string, label: string) {
    try {
      const response = await fetch(INVESTIGATION_LOG_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ check, label }),
      })
      setLoggedByCheck((prev) => ({ ...prev, [check]: { label, ok: response.ok } }))
    } catch {
      setLoggedByCheck((prev) => ({ ...prev, [check]: { label, ok: false } }))
    }
  }

  return (
    <div className="mt-8 border-t border-slate-800/80 pt-6">
      <div className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-500">Investigate Station</div>
      <div className="flex flex-col gap-5">
        {CHECKS.map((check) => {
          const logged = loggedByCheck[check.name]
          return (
            <div key={check.name}>
              <a
                href={check.href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-semibold text-slate-300 underline decoration-slate-600 underline-offset-2 hover:text-sky-400"
              >
                {check.name}
              </a>
              <div className="mt-2 flex flex-wrap gap-2">
                {check.presets.map((label) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => handleLog(check.name, label)}
                    className="rounded-md border border-slate-700 bg-slate-900/60 px-2.5 py-1 text-xs text-slate-300 transition hover:border-sky-500 hover:text-white"
                  >
                    {label}
                  </button>
                ))}
              </div>
              {logged && (
                <p className={`mt-1 text-xs ${logged.ok ? 'text-green-400' : 'text-red-400'}`}>
                  {logged.ok ? `✓ Logged: ${logged.label}` : `⚠️ Could not log "${logged.label}" — check connectivity.`}
                </p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
