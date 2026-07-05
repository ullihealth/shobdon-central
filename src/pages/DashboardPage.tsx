import CentreDisplayPanel from '../components/CentreDisplayPanel'
import FooterStatusBar from '../components/FooterStatusBar'
import Header from '../components/Header'
import LeftInfoPanel from '../components/LeftInfoPanel'
import RightInfoPanel from '../components/RightInfoPanel'

export default function DashboardPage(): JSX.Element {
  return (
    <div className="h-screen overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.12),_transparent_22%),radial-gradient(circle_at_bottom_right,_rgba(59,130,246,0.12),_transparent_20%),linear-gradient(180deg,_#020617_0%,_#0b1220_55%,_#020617_100%)] text-slate-100">
      <div className="mx-auto grid h-full max-w-[1920px] gap-4 px-6 py-6" style={{ gridTemplateRows: '10% 82% 8%' }}>
        <Header />

        <div className="grid h-full gap-4" style={{ gridTemplateColumns: '25% 50% 25%' }}>
          <LeftInfoPanel />
          <CentreDisplayPanel />
          <RightInfoPanel />
        </div>

        <FooterStatusBar />
      </div>
    </div>
  )
}
