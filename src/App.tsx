import { BrowserRouter, Route, Routes } from 'react-router-dom'
import AccountPage from './pages/AccountPage'
import AtcControlPage from './pages/AtcControlPage'
import ChecklistPage from './pages/ChecklistPage'
import PilotViewPage from './pages/PilotViewPage'
import RunwayWidgetTestPage from './pages/RunwayWidgetTestPage'
import ConfigPage from './pages/ConfigPage'
import CafeMediaPage from './pages/CafeMediaPage'
import DesignPage from './pages/DesignPage'
import DeveloperToolsPage from './pages/DeveloperToolsPage'
import FeatureRequestsPage from './pages/FeatureRequestsPage'
import GlobalDashboardPage from './pages/GlobalDashboardPage'
import VersionsPage from './pages/VersionsPage'
import HelpPage from './pages/HelpPage'
import LoginPage from './pages/LoginPage'
import MediaLibraryPage from './pages/MediaLibraryPage'
import MediaManagerPage from './pages/MediaManagerPage'
import MembersPage from './pages/MembersPage'
import OnboardInvitePage from './pages/OnboardInvitePage'
import OnboardingTermsPage from './pages/OnboardingTermsPage'
import PlatformCamerasPage from './pages/PlatformCamerasPage'
import PlatformCarouselOwnerSlotsPage from './pages/PlatformCarouselOwnerSlotsPage'
import PlatformOnboardingContentPage from './pages/PlatformOnboardingContentPage'
import PlatformTenantsPage from './pages/PlatformTenantsPage'
import PlatformPreviewPage from './pages/PlatformPreviewPage'
import PlatformDevFeaturesPage from './pages/PlatformDevFeaturesPage'
import PlatformUpdatesPage from './pages/PlatformUpdatesPage'
import PlatformVisitsPage from './pages/PlatformVisitsPage'
import KnownDevicesPage from './pages/KnownDevicesPage'
import UptimeReportPage from './pages/UptimeReportPage'
import IpDirectoryPage from './pages/IpDirectoryPage'
import RunwaysPage from './pages/RunwaysPage'
import TenantDisplayPage from './pages/TenantDisplayPage'
import UpgradeCafeDisplayPage from './pages/UpgradeCafeDisplayPage'
import PreviewBanner from './components/PreviewBanner'
import RemoteRefreshWatcher from './components/RemoteRefreshWatcher'
import RequireAuth from './components/RequireAuth'
import RootRoute from './components/RootRoute'
import AdminLayout from './components/admin/AdminLayout'
import DeveloperLayout from './components/admin/DeveloperLayout'
import UploadIndicator from './components/UploadIndicator'
import { UploadProvider } from './context/UploadContext'

export default function App(): JSX.Element {
  return (
    <BrowserRouter>
      {/* Wraps everything below (not just a plain sibling like
          PreviewBanner/RemoteRefreshWatcher) - a Context provider has to
          be an ANCESTOR of whatever consumes it (MediaLibraryPage, deep
          inside <Routes>), unlike those two, which need no such
          relationship. Same "mounted once above the router, survives
          every route change" placement intent either way - see
          UploadContext.tsx's own comment. */}
      <UploadProvider>
        <PreviewBanner />
        <RemoteRefreshWatcher />
        <UploadIndicator />
        <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/checklist" element={<ChecklistPage />} />
        {/* Mobile-first, single-column, read-only per-tenant pilot info
            screen - same standalone-no-Host-special-handling treatment as
            /checklist above. Tenant identity resolves the same way it
            already does for PUBLIC_CONFIG_URL, via whatever subdomain the
            request actually arrived on - no path-based resolution needed. */}
        <Route path="/pilot" element={<PilotViewPage />} />
        {/* Standalone, unlinked prototype for RunwayWindWidget.tsx - not in
            any nav, not wired into /pilot or the dashboard yet. Same bare
            "no RequireAuth" posture as /checklist above. */}
        <Route path="/runway-widget-test" element={<RunwayWidgetTestPage />} />
        {/* Placeholder CTA destination for CafeMediaPage's FeatureUpsellPanel
            (cafe-tv entitled=0 case) - no real checkout/marketing content
            yet, see UpgradeCafeDisplayPage.tsx's own comment. Bare route,
            same "no RequireAuth" posture as /checklist above. */}
        <Route path="/upgrade/cafe-display" element={<UpgradeCafeDisplayPage />} />
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
        {/* Public, unauthenticated released-version history (dev-features/
            Updates consolidation round) - linked from /features's own
            "Versions" button. */}
        <Route path="/versions" element={<VersionsPage />} />
        {/* Named per-tenant displays (tenant_displays, migration 0027) -
            e.g. /d/main, /d/cafe-tv. Same Host-based tenant resolution
            as '/' (server-side, via functions/api/public/display.ts);
            the :displaySlug param only selects which named display
            within that tenant to render. '/' itself (RootRoute ->
            DashboardPage) is untouched and keeps working exactly as
            before - this is a new, additional route, not a replacement. */}
        <Route path="/d/:displaySlug" element={<TenantDisplayPage />} />
        {/* All 11 previously-scattered platform-admin pages (formerly the
            main sidebar's own "Platform Admin" group, each individually
            wrapped in RequireAuth requireDeveloper below its own route)
            collapsed under one shared DeveloperLayout shell - see that
            component's own comment for why it's a sibling of AdminLayout,
            not nested inside it. requireDeveloper applied ONCE here,
            around the whole block, rather than per child route - every
            child already shared this exact gate (confirmed before
            consolidating), so this removes 11x duplicated wrapping with
            no change in effective access. Server-side requirePlatformAdmin
            on every functions/api/platform/* route is unchanged and
            remains the real boundary - this is still only a UX nicety. */}
        <Route
          element={
            <RequireAuth requireDeveloper>
              <DeveloperLayout />
            </RequireAuth>
          }
        >
          <Route path="/platform/tenants" element={<PlatformTenantsPage />} />
          {/* Reserved Owner Slots & Time Budget round - assigns owner ad
              content to one specific tenant's slots 5/8/12, linked from
              PlatformTenantsPage.tsx's own tenant detail pane. */}
          <Route path="/platform/tenants/:id/carousel-owner-slots" element={<PlatformCarouselOwnerSlotsPage />} />
          {/* Dev-tenant-preview feature: a single tenant picker that
              drives /config, /media-manager, /runways, /members, and
              Screens Design's own live dashboard preview together, via
              requireTenant's own tier-3 resolution (tenantAuth.ts) rather
              than duplicate pages. */}
          <Route path="/platform/preview" element={<PlatformPreviewPage />} />
          <Route path="/platform/cameras" element={<PlatformCamerasPage />} />
          <Route path="/platform/onboarding-content" element={<PlatformOnboardingContentPage />} />
          {/* Reverse-chronological log viewer over display_visits
              (migration 0041). */}
          <Route path="/platform/visits" element={<PlatformVisitsPage />} />
          {/* Phase B of the visit-log uptime work (migration 0056):
              confirm/dismiss which IPs are a tenant's real display. */}
          <Route path="/platform/known-devices" element={<KnownDevicesPage />} />
          {/* Phase C of the visit-log uptime work: the audit report
              itself, computed only from Known Devices' confirmed IPs. */}
          <Route path="/platform/uptime-report" element={<UptimeReportPage />} />
          {/* The global IP directory (migration 0057). */}
          <Route path="/platform/ip-directory" element={<IpDirectoryPage />} />
          {/* Internal, app-wide running changelog (migration 0050). */}
          <Route path="/platform/updates" element={<PlatformUpdatesPage />} />
          {/* Private developer workspace (migration 0067) - mirrors
              /features read-through plus developer-private entries. */}
          <Route path="/platform/dev-features" element={<PlatformDevFeaturesPage />} />
          {/* Moved in from AdminLayout's own block below - isDeveloper-
              gated, NOT role-gated, exactly as before; now sharing this
              layout with the rest of Platform Admin instead of the main
              app's AdminSidebar, which never actually listed it under
              any org-relevant context anyway. */}
          <Route path="/developertools" element={<DeveloperToolsPage />} />
        </Route>
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
          {/* Platform-wide shared feature request board - owner/admin can
              view + submit, but status editing is developer-only (enforced
              server-side too, see functions/api/tenant/feature-requests/
              [id].ts). Same requireRole shape as /members, not requireDeveloper
              - this page itself is reachable by any tenant admin. */}
          <Route
            path="/features"
            element={
              <RequireAuth requireRole={['owner', 'admin']}>
                <FeatureRequestsPage />
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
          {/* Same role gate as /media-manager (owner/admin/media), plus
              'cafe' - this is where that page's embedded library UI moved
              to (folders, upload, move-to-folder, Edit Slide, delete,
              plus the new usableOn/orientation tagging), shared by both
              Dashboard Manager and Cafe Media's Source dropdowns. cafe
              role is scoped to exactly this + /cafe-media, nothing else -
              not even Dashboard Manager itself. */}
          <Route
            path="/media-library"
            element={
              <RequireAuth requireRole={['owner', 'admin', 'media', 'cafe']}>
                <MediaLibraryPage />
              </RequireAuth>
            }
          />
          {/* Owner+admin, same gate as /design - Café Template's
              layout/ad-label/ticker settings, plus the future ad-slot
              management surface (not yet built) - plus 'cafe', the new
              role scoped to exactly this + /media-library. */}
          <Route
            path="/cafe-media"
            element={
              <RequireAuth requireRole={['owner', 'admin', 'cafe']}>
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
      </UploadProvider>
    </BrowserRouter>
  )
}
