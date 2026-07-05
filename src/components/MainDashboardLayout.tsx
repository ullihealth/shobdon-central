import type { ReactNode } from 'react'

type MainDashboardLayoutProps = {
  left: ReactNode
  center: ReactNode
  right: ReactNode
}

export default function MainDashboardLayout({ left, center, right }: MainDashboardLayoutProps): JSX.Element {
  return (
    <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)_320px] 2xl:grid-cols-[360px_minmax(0,1fr)_360px]">
      <div className="space-y-4">{left}</div>
      <div>{center}</div>
      <div className="space-y-4">{right}</div>
    </div>
  )
}
