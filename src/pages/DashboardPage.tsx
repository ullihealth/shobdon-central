import CentreDisplayPanel from '../components/CentreDisplayPanel'
import Header from '../components/Header'
import LeftInfoPanel from '../components/LeftInfoPanel'
import RightInfoPanel from '../components/RightInfoPanel'
import WeatherStatusIndicator from '../components/WeatherStatusIndicator'
import { WeatherProvider } from '../context/WeatherContext'

export default function DashboardPage(): JSX.Element {
  return (
    <WeatherProvider>
      <div className="h-screen w-screen overflow-hidden bg-gradient-to-b from-[#071229] via-[#081827] to-[#03101a] text-slate-100">
        <div
          className="mx-auto h-full max-w-[1920px] p-10"
          style={{ display: 'grid', gridTemplateRows: '7% 1fr', gap: '16px' }}
        >
          {/* HEADER (10%) */}
          <Header rightSlot={<WeatherStatusIndicator />} />

          {/* BODY (90%) - three columns left/center/right */}
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
        </div>
      </div>
    </WeatherProvider>
  )
}
