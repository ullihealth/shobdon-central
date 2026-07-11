import { BrowserRouter, Route, Routes } from 'react-router-dom'
import AccountPage from './pages/AccountPage'
import AtcControlPage from './pages/AtcControlPage'
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
        {/* Owner+admin only: admin is a full alias of owner (original
            design intent - e5aa79a incorrectly scoped it down to
            media-manager-only, corrected here). atc/media members are
            cleanly denied (not a blank/broken page) rather than
            redirected to /login - they ARE logged in, just not
            permitted here. */}
        <Route
          path="/config"
          element={
            <RequireAuth requireRole={['owner', 'admin']}>
              <ConfigPage />
            </RequireAuth>
          }
        />
        <Route path="/checklist" element={<ChecklistPage />} />
        <Route
          path="/design"
          element={
            <RequireAuth requireRole={['owner', 'admin']}>
              <DesignPage />
            </RequireAuth>
          }
        />
        <Route
          path="/runways"
          element={
            <RequireAuth requireRole={['owner', 'admin']}>
              <RunwaysPage />
            </RequireAuth>
          }
        />
        <Route
          path="/members"
          element={
            <RequireAuth requireRole={['owner', 'admin']}>
              <MembersPage />
            </RequireAuth>
          }
        />
        {/* Owner, admin, AND media role. admin was always documented
            (src/types/member.ts) as having media-manager access, but was
            missed here when this route was first built - a real admin-
            role account hit a "Not authorized" dead end after login as
            a result. */}
        <Route
          path="/media-manager"
          element={
            <RequireAuth requireRole={['owner', 'admin', 'media']}>
              <MediaManagerPage />
            </RequireAuth>
          }
        />
        {/* Owner, admin, AND atc role - admin included for the same
            full-owner-alias reason as /config above. NOT media -
            developer already has access via existing owner-level
            auto-membership. */}
        <Route
          path="/atc-control"
          element={
            <RequireAuth requireRole={['owner', 'admin', 'atc']}>
              <AtcControlPage />
            </RequireAuth>
          }
        />
        {/* Any logged-in role - no requireRole, so owner/admin/atc/media
            all reach this the same way. Self-service password change and
            logout aren't privileged actions, just a valid session. */}
        <Route
          path="/account"
          element={
            <RequireAuth>
              <AccountPage />
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
