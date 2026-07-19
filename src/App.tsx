import { BrowserRouter, Route, Routes } from 'react-router-dom'
import AccountPage from './pages/AccountPage'
import AtcControlPage from './pages/AtcControlPage'
import ChecklistPage from './pages/ChecklistPage'
import ConfigPage from './pages/ConfigPage'
import CafeMediaPage from './pages/CafeMediaPage'
import DesignPage from './pages/DesignPage'
import DeveloperToolsPage from './pages/DeveloperToolsPage'
import GlobalDashboardPage from './pages/GlobalDashboardPage'
import HelpPage from './pages/HelpPage'
import LoginPage from './pages/LoginPage'
import MediaManagerPage from './pages/MediaManagerPage'
import MembersPage from './pages/MembersPage'
import OnboardInvitePage from './pages/OnboardInvitePage'
import OnboardingTermsPage from './pages/OnboardingTermsPage'
import PlatformOnboardingContentPage from './pages/PlatformOnboardingContentPage'
import PlatformTenantsPage from './pages/PlatformTenantsPage'
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
        {/* Public, unauthenticated invite-link account setup - the entry
            point of the onboarding pipeline. Path-based, not tied to the
            new tenant's own (not-yet-DNS-provisioned) subdomain - runs
            entirely on whatever host served this link. */}
        <Route path="/onboard/:token" element={<OnboardInvitePage />} />
        {/* Mandatory terms/privacy gate - reached via RequireAuth.tsx's
            redirect, never linked to directly. Its own RequireAuth carries
            skipTermsGate (must not redirect to itself) but still requires
            a real session - this isn't a public route. */}
        <Route
          path="/onboarding/terms"
          element={
            <RequireAuth skipTermsGate>
              <OnboardingTermsPage />
            </RequireAuth>
          }
        />
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
        {/* Platform-admin, cross-tenant tenant list/control - deliberately
            OUTSIDE AdminLayout (no org-switcher/tenant-admin sidebar chrome;
            a tenant owner should never see a link to this, and it has
            nothing to do with "which org am I currently switched to" -
            it operates on every tenant regardless). requireDeveloper is
            the same user.developer gate /developertools uses, enforced
            again server-side by every functions/api/platform/* route -
            this client-side check is a UX nicety, not the real boundary. */}
        <Route
          path="/platform/tenants"
          element={
            <RequireAuth requireDeveloper>
              <PlatformTenantsPage />
            </RequireAuth>
          }
        />
        <Route
          path="/platform/onboarding-content"
          element={
            <RequireAuth requireDeveloper>
              <PlatformOnboardingContentPage />
            </RequireAuth>
          }
        />
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
          {/* skipTermsGate: the invite flow's branding step, reached
              directly from account creation, must stay usable BEFORE
              the mandatory terms/privacy gate - see RequireAuth.tsx's
              own comment on why this is the one route carrying it. */}
          <Route
            path="/design"
            element={
              <RequireAuth requireRole={['owner', 'admin']} skipTermsGate>
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
          {/* Owner+admin only, same gate as /design - Café Template's
              layout/ad-label/ticker settings, plus the future ad-slot
              management surface (not yet built). */}
          <Route
            path="/cafe-media"
            element={
              <RequireAuth requireRole={['owner', 'admin']}>
                <CafeMediaPage />
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
          {/* Any logged-in role - persistent access to the same video/
              Terms/Privacy content shown during onboarding, so it isn't
              only reachable that one time. */}
          <Route
            path="/help"
            element={
              <RequireAuth>
                <HelpPage />
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
