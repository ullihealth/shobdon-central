import CentreDisplayPanel from '../components/CentreDisplayPanel'
import FooterStatusBar from '../components/FooterStatusBar'
import Header from '../components/Header'
import LeftInfoPanel from '../components/LeftInfoPanel'
import RightInfoPanel from '../components/RightInfoPanel'

export default function DashboardPage(): JSX.Element {
  return (
    <div className="h-screen w-screen overflow-hidden bg-gradient-to-b from-[#071229] via-[#081827] to-[#03101a] text-slate-100">
      <div
        className="mx-auto h-full max-w-[1920px] px-6 py-6"
        style={{ display: 'grid', gridTemplateRows: '10% 82% 8%', gap: '16px' }}
      >
        {/* HEADER (10%) */}
        <Header />

        {/* BODY (82%) - three columns left/center/right */}
        <div style={{ display: 'grid', gridTemplateColumns: '23% 54% 23%', gap: '16px', height: '100%' }}>
          <div className="h-full">
            <LeftInfoPanel />
          </div>

          <div className="h-full">
            <CentreDisplayPanel />
          </div>

          <div className="h-full">
            <RightInfoPanel />
          </div>
        </div>

        {/* FOOTER (8%) */}
        <FooterStatusBar />
      </div>
    </div>
  )
}
