import CentreDisplayPanel from '../components/CentreDisplayPanel'
import FooterStatusBar from '../components/FooterStatusBar'
import Header from '../components/Header'
import LeftInfoPanel from '../components/LeftInfoPanel'
import MainDashboardLayout from '../components/MainDashboardLayout'
import RightInfoPanel from '../components/RightInfoPanel'
import WeatherSummaryBar from '../components/WeatherSummaryBar'

export default function DashboardPage(): JSX.Element {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.12),_transparent_22%),radial-gradient(circle_at_bottom_right,_rgba(59,130,246,0.12),_transparent_20%),linear-gradient(180deg,_#020617_0%,_#0b1220_55%,_#020617_100%)] text-slate-100">
      <div className="mx-auto flex min-h-screen max-w-[1920px] flex-col gap-6 px-6 py-6">
        <Header />
        <WeatherSummaryBar />
        <MainDashboardLayout left={<LeftInfoPanel />} center={<CentreDisplayPanel />} right={<RightInfoPanel />} />
        <FooterStatusBar />
      </div>
    </div>
  )
}
