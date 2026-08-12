import type { ReactNode } from 'react'

// Pure presentational phone-frame chrome for Pilot Panel's live preview -
// no data logic of its own, just a styled wrapper. Rounded rect + notch,
// a common phone aspect ratio (9:19.5) so the ticker/background preview
// inside reads as "this is roughly what /pilot looks like on a phone",
// not a literal device mockup.
export default function PilotPreviewFrame({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="mx-auto w-full max-w-[260px]">
      <div className="relative aspect-[9/19.5] w-full overflow-hidden rounded-[2.5rem] border-[10px] border-slate-800 bg-black shadow-2xl shadow-slate-950/50">
        <div
          className="absolute left-1/2 top-0 z-10 h-5 w-24 -translate-x-1/2 rounded-b-2xl bg-slate-800"
          aria-hidden="true"
        />
        <div className="h-full w-full overflow-hidden rounded-[1.8rem]">{children}</div>
      </div>
    </div>
  )
}
