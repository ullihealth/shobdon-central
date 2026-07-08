import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'

interface StepProps {
  title: string
  children: ReactNode
}

function Step({ title, children }: StepProps): JSX.Element {
  return (
    <details open className="rounded-2xl border border-slate-700 bg-slate-950/85 p-5 open:pb-6">
      <summary className="cursor-pointer text-lg font-bold text-sky-400 marker:text-slate-500">{title}</summary>
      <ul className="mt-4 flex flex-col gap-2.5 text-[15px] leading-relaxed text-slate-200">{children}</ul>
    </details>
  )
}

function Item({ children }: { children: ReactNode }): JSX.Element {
  return <li className="pl-1">{children}</li>
}

function Code({ children }: { children: ReactNode }): JSX.Element {
  return <code className="rounded bg-slate-800 px-1.5 py-0.5 text-[0.9em] text-amber-300">{children}</code>
}

export default function ChecklistPage(): JSX.Element {
  return (
    <div className="min-h-screen bg-gradient-to-b from-page-from via-page-via to-page-to text-slate-100">
      <div className="mx-auto max-w-2xl px-5 pb-16 pt-8">
        <Link to="/config" className="text-sm font-semibold text-slate-400 hover:text-sky-400">
          ← Back to Config
        </Link>

        <h1 className="mb-8 mt-3 text-2xl font-black uppercase tracking-wide text-white">ATC Visit Checklist</h1>

        <div className="flex flex-col gap-5">
          <Step title="Step 1 — Get real data in from PC2">
            <Item>Open Shobdon Central on PC2's browser, go to Config.</Item>
            <Item>
              Click <Code>Download capture-weathercentral.ps1</Code> (save it anywhere, e.g. Desktop).
            </Item>
            <Item>
              Right-click the downloaded file and choose <Code>Run with PowerShell</Code>. This opens a black
              PowerShell window.
            </Item>
            <Item>
              You may see a message asking something like "Do you want to run this script?" because the file
              was downloaded from the internet — this is normal, expected Windows security behaviour, not an
              error. Type <Code>R</Code> and press Enter to run it once.
            </Item>
            <Item>
              Confirm the window shows <Code>Starting continuous capture every 60 seconds...</Code> followed by{' '}
              <Code>Capture sent successfully at ...</Code>, repeating on its own every minute.
            </Item>
            <Item>
              Leave this window open — minimizing it is fine, but closing it stops the data feed. The browser
              can be used completely normally at the same time; this script doesn't use or need it. No further
              action is needed — it keeps capturing automatically every 60 seconds.
            </Item>
            <Item>
              If PC2 restarts, or this window ever gets closed, the data feed stops — just repeat this step to
              start it again.
            </Item>
          </Step>

          <Step title="Step 2 — Check the result from your own Mac/phone">
            <Item>
              On your own device (not PC2), open Shobdon Central, go to Config, tap{' '}
              <Code>View Capture Logs</Code>.
            </Item>
            <Item>
              Confirm the capture appears with real data, or read the failure label if it didn't work (it will
              say plainly whether it's a mixed-content issue, a permission issue, or something else).
            </Item>
          </Step>

          <Step title="Step 3 — If something needs fixing">
            <Item>Diagnose using your own Mac with AI access, right there.</Item>
            <Item>Make the fix, push it live.</Item>
            <Item>
              Tap <Code>Refresh PC2 Now</Code> on your own device's Config page — this remotely tells PC2 to
              reload, no need to touch its keyboard.
            </Item>
            <Item>Allow up to ~60 seconds for this to take effect (propagation can vary).</Item>
            <Item>
              No need to re-run the capture script — if it's still running from Step 1, it's already sending
              fresh captures every 60 seconds on its own. Only re-run it if that window was closed or PC2 was
              restarted.
            </Item>
            <Item>Repeat from Step 2 as many times as time allows.</Item>
          </Step>

          <Step title="Step 4 — Optional: Investigate Station (only if time remains, lower priority than the above)">
            <Item>
              Click the <Code>Try HTTPS</Code> heading — this is the most useful of the three checks if time is
              short.
            </Item>
            <Item>Look at what appears in the new tab, then switch back and tap the ONE outcome button that matches what you saw.</Item>
            <Item>
              If time allows, repeat for <Code>Check Root</Code> and <Code>Check Folder Listing</Code> — these
              are less likely to show anything interesting, fine to skip.
            </Item>
          </Step>

          <Step title="Step 5 — Before leaving">
            <Item>
              Leave the PowerShell window running on PC2 (minimized is fine) so captures keep coming in after
              you leave. Only stop it (Ctrl+C in the window, or close it) if you're told to.
            </Item>
          </Step>
        </div>
      </div>
    </div>
  )
}
