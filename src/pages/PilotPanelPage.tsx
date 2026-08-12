// Settings > Pilot Panel - configures the /pilot mobile view's own
// ticker and background, independently of the desktop dashboard's
// Dashboard Manager. Piece 3/6 of this round: route/nav/auth wiring
// only, real content (ticker section, background section, live phone
// preview) lands in the pieces that follow.
export default function PilotPanelPage(): JSX.Element {
  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="text-2xl font-bold text-primary">Pilot Panel</h1>
      <p className="mt-2 text-sm text-muted-400">
        Configure the /pilot mobile view's ticker and background, independently of the desktop dashboard.
      </p>
    </div>
  )
}
