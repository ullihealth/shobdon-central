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
    <div className="min-h-screen bg-gradient-to-b from-[#071229] via-[#081827] to-[#03101a] text-slate-100">
      <div className="mx-auto max-w-2xl px-5 pb-16 pt-8">
        <Link to="/config" className="text-sm font-semibold text-slate-400 hover:text-sky-400">
          ← Back to Config
        </Link>

        <h1 className="mb-8 mt-3 text-2xl font-black uppercase tracking-wide text-white">ATC Visit Checklist</h1>

        <div className="flex flex-col gap-5">
          <Step title="Step 1 — Get the relay running on PC2">
            <Item>Open Shobdon Central on PC2's browser, go to Config.</Item>
            <Item>
              Click <Code>Download relay.ps1</Code> and <Code>Download start-relay.bat</Code> (save both to the
              same folder, e.g. Desktop).
            </Item>
            <Item>
              Double-click <Code>start-relay.bat</Code>. Confirm the console window shows{' '}
              <Code>Relay listening on http://localhost:8791/adisp</Code>.
            </Item>
          </Step>

          <Step title="Step 2 — Run the capture">
            <Item>
              On the Config page, change Station URL to <Code>http://localhost:8791/adisp</Code>.
            </Item>
            <Item>
              Press <Code>Capture &amp; Copy Weather Snapshot</Code>.
            </Item>
            <Item>
              If Chrome shows a one-time prompt asking to connect to devices on your local network, click{' '}
              <Code>Allow</Code>.
            </Item>
          </Step>

          <Step title="Step 3 — Check the result from your own Mac/phone">
            <Item>
              On your own device (not PC2), open Shobdon Central, go to Config, tap{' '}
              <Code>View Capture Logs</Code>.
            </Item>
            <Item>
              Confirm the capture appears with real data, or read the failure label if it didn't work (it will
              say plainly whether it's a mixed-content issue, a permission issue, or something else).
            </Item>
          </Step>

          <Step title="Step 4 — If something needs fixing">
            <Item>Diagnose using your own Mac with AI access, right there.</Item>
            <Item>Make the fix, push it live.</Item>
            <Item>
              Tap <Code>Refresh PC2 Now</Code> on your own device's Config page — this remotely tells PC2 to
              reload, no need to touch its keyboard.
            </Item>
            <Item>Allow up to ~60 seconds for this to take effect (propagation can vary).</Item>
            <Item>Go back to PC2 and press Capture again.</Item>
            <Item>Repeat from Step 3 as many times as time allows.</Item>
          </Step>

          <Step title="Step 5 — Optional: Investigate Station (only if time remains, lower priority than the above)">
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

          <Step title="Step 6 — Before leaving">
            <Item>Close the relay console window on PC2.</Item>
            <Item>No need to leave anything running unless told otherwise.</Item>
          </Step>
        </div>
      </div>
    </div>
  )
}
