import { BrowserRouter, Route, Routes } from 'react-router-dom'
import AccountPage from './pages/AccountPage'
import AtcControlPage from './pages/AtcControlPage'
import ChecklistPage from './pages/ChecklistPage'
import ConfigPage from './pages/ConfigPage'
import DesignPage from './pages/DesignPage'
import DeveloperToolsPage from './pages/DeveloperToolsPage'
import GlobalDashboardPage from './pages/GlobalDashboardPage'
import LoginPage from './pages/LoginPage'
import MediaManagerPage from './pages/MediaManagerPage'
import MembersPage from './pages/MembersPage'
import RunwaysPage from './pages/RunwaysPage'
import TenantDisplayPage from './pages/TenantDisplayPage'
import RemoteRefreshWatcher from './components/RemoteRefreshWatcher'
import RequireAuth from './components/RequireAuth'
import RootRoute from './components/RootRoute'
import AdminLayout from './components/admin/AdminLayout'

export default function App(): JSX.Element {
  return (
    <BrowserRouter>
      <RemoteRefreshWatcher />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/checklist" element={<ChecklistPage />} />
        {/* Public, unauthenticated cross-tenant directory - Stage 4's
            public/private toggle plumbing's own consumer. Not linked from
            anywhere in the existing dashboard/nav yet (direct URL only) -
            wiring it into the root landing page is separately parked. */}
        <Route path="/global" element={<GlobalDashboardPage />} />
        {/* Named per-tenant displays (tenant_displays, migration 0027) -
            e.g. /d/main, /d/cafe-tv. Same Host-based tenant resolution
            as '/' (server-side, via functions/api/public/display.ts);
            the :displaySlug param only selects which named display
            within that tenant to render. '/' itself (RootRoute ->
            DashboardPage) is untouched and keeps working exactly as
            before - this is a new, additional route, not a replacement. */}
        <Route path="/d/:displaySlug" element={<TenantDisplayPage />} />
        {/* Shared sidebar shell (AdminLayout.tsx) for every authenticated
            admin page - a React Router layout route rendering <Outlet/>.
            Per-route access gating below is completely unchanged: each
            child route still wraps its page in RequireAuth with its own
            requireRole/requireDeveloper, exactly as before this layout
            route was introduced. */}
        <Route element={<AdminLayout />}>
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
          {/* isDeveloper-gated, NOT role-gated - the real developer account
              also happens to hold 'owner' role at Shobdon, but every other
              owner/admin must be denied here regardless of role. */}
          <Route
            path="/developertools"
            element={
              <RequireAuth requireDeveloper>
                <DeveloperToolsPage />
              </RequireAuth>
            }
          />
        </Route>
        {/* Public live dashboard - no auth, must work for PC2, the
            clubhouse display, and anyone with the link - OR the public
            marketing landing page, depending on hostname (RootRoute.tsx).
            Both routes point here (not just "/") so a mistyped URL on
            the marketing domain lands on the marketing homepage rather
            than falling through to a tenant's operational dashboard. */}
        <Route path="/" element={<RootRoute />} />
        <Route path="*" element={<RootRoute />} />
      </Routes>
    </BrowserRouter>
  )
}
