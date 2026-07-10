import { BrowserRouter, Route, Routes } from 'react-router-dom'
import ChecklistPage from './pages/ChecklistPage'
import ConfigPage from './pages/ConfigPage'
import DashboardPage from './pages/DashboardPage'
import DesignPage from './pages/DesignPage'
import LoginPage from './pages/LoginPage'
import MediaManagerPage from './pages/MediaManagerPage'
import MembersPage from './pages/MembersPage'
import RunwaysPage from './pages/RunwaysPage'
import RemoteRefreshWatcher from './components/RemoteRefreshWatcher'
import RequireAuth from './components/RequireAuth'

export default function App(): JSX.Element {
  return (
    <BrowserRouter>
      <RemoteRefreshWatcher />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        {/* Owner-only: admin/atc members are cleanly denied (not a
            blank/broken page) rather than redirected to /login - they
            ARE logged in, just not permitted here. */}
        <Route
          path="/config"
          element={
            <RequireAuth requireRole="owner">
              <ConfigPage />
            </RequireAuth>
          }
        />
        <Route path="/checklist" element={<ChecklistPage />} />
        <Route
          path="/design"
          element={
            <RequireAuth requireRole="owner">
              <DesignPage />
            </RequireAuth>
          }
        />
        <Route
          path="/runways"
          element={
            <RequireAuth requireRole="owner">
              <RunwaysPage />
            </RequireAuth>
          }
        />
        <Route
          path="/members"
          element={
            <RequireAuth requireRole="owner">
              <MembersPage />
            </RequireAuth>
          }
        />
        {/* Owner AND media role - the one page besides the public
            dashboard that isn't owner-exclusive. */}
        <Route
          path="/media-manager"
          element={
            <RequireAuth requireRole={['owner', 'media']}>
              <MediaManagerPage />
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
