import { BrowserRouter, Route, Routes } from 'react-router-dom'
import ChecklistPage from './pages/ChecklistPage'
import ConfigPage from './pages/ConfigPage'
import DashboardPage from './pages/DashboardPage'
import DesignPage from './pages/DesignPage'
import LoginPage from './pages/LoginPage'
import RunwaysPage from './pages/RunwaysPage'
import RemoteRefreshWatcher from './components/RemoteRefreshWatcher'
import RequireAuth from './components/RequireAuth'

export default function App(): JSX.Element {
  return (
    <BrowserRouter>
      <RemoteRefreshWatcher />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/config"
          element={
            <RequireAuth>
              <ConfigPage />
            </RequireAuth>
          }
        />
        <Route path="/checklist" element={<ChecklistPage />} />
        <Route
          path="/design"
          element={
            <RequireAuth>
              <DesignPage />
            </RequireAuth>
          }
        />
        <Route
          path="/runways"
          element={
            <RequireAuth>
              <RunwaysPage />
            </RequireAuth>
          }
        />
        {/* Public live dashboard - no auth, must work for PC2, the
            clubhouse display, and anyone with the link, unchanged. */}
        <Route path="/" element={<DashboardPage />} />
        <Route path="*" element={<DashboardPage />} />
      </Routes>
    </BrowserRouter>
  )
}
