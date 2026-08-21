// Shown by DashboardPage.tsx while /api/public/config is in flight -
// deliberately has no branding/weather content of its own (unlike
// rendering a real template with unresolved/default props, which looks
// like an actual, wrong dashboard rather than a loading state). Same
// spinner style as LandingPage.tsx's own loading panel.
export default function DashboardLoading(): JSX.Element {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-slate-950">
      <div className="h-10 w-10 animate-spin rounded-full border-2 border-slate-700 border-t-sky-400" />
    </div>
  )
}
