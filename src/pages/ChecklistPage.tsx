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
              Right-click the downloaded file and choose <Code>Run with PowerShell</Code>. It fetches the
              station directly and sends the result to Shobdon Central on its own - no browser step needed.
              Confirm the console shows <Code>Capture sent successfully at ...</Code>.
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
            <Item>Run <Code>capture-weathercentral.ps1</Code> again on PC2.</Item>
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
            <Item>Nothing to close or leave running - the script exits on its own once the capture is sent.</Item>
          </Step>
        </div>
      </div>
    </div>
  )
}
