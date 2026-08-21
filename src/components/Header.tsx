import { Link, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { AIRFIELD_TIMEZONE } from '../config/publicApi'
import { useHostReachable } from '../hooks/useHostReachable'
import { isPagesPlatformHost } from '../utils/isPagesPlatformHost'

interface HeaderProps {
  rightSlot?: ReactNode
  // Real tenant display name (tenants.name via the public config /
  // tenant config response's airfieldName field) - was a hardcoded
  // "SHOBDON AIRFIELD" literal until the pre-onboarding branding audit
  // caught it (every tenant's dashboard showed Shobdon's name
  // regardless of hostname). Undefined/null covers both the brief
  // window before a fetch resolves and a genuinely brand-new tenant
  // with nothing configured yet - the generic fallback below is
  // correct for both, never another tenant's real name.
  airfieldName?: string | null
  // Uploaded tenant logo (tenants.logo_r2_key, resolved to a public R2
  // URL). Null/undefined (no logo set) renders nothing extra - falls
  // back to the text-only layout unchanged.
  logoUrl?: string | null
  // DesignPage.tsx's Solid/Gradient toggle (DesignTemplate.gradientMode) -
  // 'solid' swaps the 3-stop from/via/to gradient for a flat fill using
  // just the `via` stop. Undefined/omitted (every existing caller) keeps
  // today's gradient unchanged - this is purely additive.
  gradientMode?: 'solid' | 'gradient'
  // Migration 0039 (Screens Design's Branding tab) - independent
  // logo/name visibility for THIS badge specifically (the 'main'
  // brandDisplay slice; VenueCornerBadge.tsx has its own 'cafe' slice).
  // Both default true - unchanged from today's unconditional "always
  // show both" behaviour for any caller not yet passing these.
  showLogo?: boolean
  showName?: boolean
  // Root cause this round: a real club logo (Shobdon's own) often
  // already has the club name baked into the artwork, making the
  // separate text label below redundant/visually cluttered next to it -
  // not a CSS overlap, a content-design one. showLogo/showName let an
  // admin pick just one; nameFontSize (separate from that) addresses
  // the "text reads too small" half of the same report. 'md' matches
  // today's hardcoded text-lg sm:text-3xl exactly - default is a no-op.
  nameFontSize?: 'sm' | 'md' | 'lg' | 'xl'
}

// Responsive pairs, not flat sizes - preserves this component's own
// documented narrow-viewport handling (the title needs to stay
// readable at both the /config admin chrome's typical widths and this
// same component's use in Screens Design's own preview rail). 'md' is
// exactly today's previous hardcoded text-lg sm:text-3xl - unchanged
// default for every caller not yet passing nameFontSize.
const NAME_FONT_SIZE_CLASSES: Record<'sm' | 'md' | 'lg' | 'xl', string> = {
  sm: 'text-sm sm:text-xl',
  md: 'text-lg sm:text-3xl',
  lg: 'text-xl sm:text-4xl',
  xl: 'text-2xl sm:text-5xl',
}

// Same nameFontSize value, same four-tier UI control (DesignPage.tsx's
// Branding tab) - reused rather than a second setting, because
// showLogo/showName are already mutually exclusive per display (see
// DesignPage.tsx's own radio-group comment), so this one value already
// unambiguously means "how big should whichever of these two is
// currently showing render." Logo was previously fixed at h-8 sm:h-12
// regardless of this value at all - the actual root cause of "logo
// renders too small," not just a missing option. 'md' is exactly that
// previous hardcoded h-8 max-w-[100px] sm:h-12 sm:max-w-[160px] -
// unchanged default. Ceiling deliberately conservative: confirmed via
// Playwright at 1920x1080/1600x900/1366x768 that this header's own box
// (the grid row it renders in) is only ~48-70px tall including padding -
// 'xl' stays inside that even on the smallest tested height rather than
// growing until it visually overflows into the row below.
const LOGO_SIZE_CLASSES: Record<'sm' | 'md' | 'lg' | 'xl', string> = {
  sm: 'h-6 max-w-[70px] sm:h-8 sm:max-w-[110px]',
  md: 'h-8 max-w-[100px] sm:h-12 sm:max-w-[160px]',
  lg: 'h-10 max-w-[130px] sm:h-14 sm:max-w-[190px]',
  xl: 'h-12 max-w-[160px] sm:h-16 sm:max-w-[220px]',
}

export default function Header({
  rightSlot,
  airfieldName,
  logoUrl,
  gradientMode = 'gradient',
  showLogo = true,
  showName = true,
  nameFontSize = 'md',
}: HeaderProps): JSX.Element {
  const [now, setNow] = useState(new Date())
  const location = useLocation()
  const isConfigPage = location.pathname === '/config'
  // '/d/:displaySlug' (tenant_displays, migration 0027) is a second public
  // dashboard route alongside '/' - same role-aware title-link behaviour
  // applies there too, otherwise a viewer on a named display's title link
  // would incorrectly fall through to the owner-only '/config' target.
  const isPublicDashboard = location.pathname === '/' || location.pathname.startsWith('/d/')

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(interval)
  }, [])

  // Role-aware header link, public dashboard only - /config and /design
  // (the other two pages this Header renders on) are already owner/admin-
  // gated, so a bare '/config' target there is always correct with no
  // lookup needed. On '/' the viewer could be anyone: not logged in,
  // owner/admin, atc, or media, so this reuses the exact same
  // /api/tenant/me check the post-login redirect already uses, rather
  // than duplicating that role->page mapping a third time (RequireAuth's
  // "Not authorized" safety-net link is the second).
  const [dashboardLandingPage, setDashboardLandingPage] = useState('/login')
  // Root cause of the freshly-onboarded-tenant "logo click dumps you on
  // the marketing page" bug: on /config, the logo link below used to be
  // a bare relative Link to '/' unconditionally. '/' (RootRoute.tsx)
  // renders the marketing LandingPage for the bare airfieldcentral.com
  // host and DashboardPage everywhere else, purely from
  // window.location.hostname - it has no session/cookie fallback at all
  // (same Host-only resolution as resolveTenantHost.ts server-side). A
  // tenant provisioned via the platform-admin invite flow never actually
  // lands on its own subdomain (onboard.ts's own comment: that flow
  // "runs path-based on the existing app domain, not the new tenant's
  // own subdomain" - no Cloudflare custom-domain automation exists yet),
  // so every one of its admins is on the bare marketing host by
  // definition - a relative '/' there is ALWAYS the marketing page for
  // them, logged in or not. Fetched alongside dashboardLandingPage
  // above (same /api/tenant/me response, now including `subdomain`) so
  // this can compare it against the current hostname before deciding.
  const [tenantSubdomain, setTenantSubdomain] = useState<string | null>(null)
  useEffect(() => {
    if (!isPublicDashboard && !isConfigPage) return
    let cancelled = false
    fetch('/api/tenant/me')
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled) return
        const role = data?.role
        setDashboardLandingPage(
          role === 'atc'
            ? '/atc-control'
            : role === 'media'
              ? '/media-manager'
              : role === 'cafe'
                ? '/cafe-media'
                : role
                  ? data?.tenantType === 'venue_cafe'
                    ? '/media-library'
                    : '/config'
                  : '/login'
        )
        setTenantSubdomain(data?.subdomain ?? null)
      })
      .catch(() => {
        if (!cancelled) setDashboardLandingPage('/login')
      })
    return () => {
      cancelled = true
    }
  }, [isPublicDashboard, isConfigPage])

  // Only trust a relative '/' when we've confirmed this IS the tenant's
  // own subdomain - otherwise '/' resolves to marketing content (or, on
  // Shobdon's own fallback hosts, to the WRONG tenant's dashboard) no
  // matter who's logged in. tenantSubdomain === null covers both "still
  // loading" and "not on /config at all" - '/' unchanged in both cases,
  // same as this link's behaviour before this fix (no flash of a
  // different target while the fetch above is in flight, matching
  // dashboardLandingPage's own pre-resolution default elsewhere in this
  // file). When it doesn't match, an absolute cross-host URL is the only
  // way to actually reach the right place - a relative Link can't cross
  // hosts. If that subdomain isn't DNS-provisioned yet (a separate,
  // still-manual step - see onboard.ts), this surfaces as an honest
  // browser navigation error instead of silently landing on marketing
  // copy or someone else's dashboard, which is strictly more correct
  // even though it isn't yet a fully working destination for every
  // tenant.
  // isPagesPlatformHost: same addition as AdminSidebar.tsx's own
  // isOnOwnSubdomain - a Cloudflare Pages preview deployment's hash
  // subdomain resolves this tenant's real content directly (see
  // resolveTenantHost.ts's own fallback), so it counts as "own" too,
  // not just the bare production pages.dev alias.
  const isOnOwnSubdomain = !tenantSubdomain || tenantSubdomain === window.location.hostname || isPagesPlatformHost(window.location.hostname)
  const configBackHref = isOnOwnSubdomain ? '/' : `https://${tenantSubdomain}/`

  // Option B from the DNS-not-provisioned round: rather than always
  // linking to configBackHref and letting an unprovisioned subdomain
  // fail as a raw browser navigation error, probe it first (only when
  // we'd actually render the cross-host link - never for Shobdon or any
  // tenant already on its own working subdomain, where isOnOwnSubdomain
  // is true and this stays null/unused). null (still checking, or not
  // applicable) intentionally falls through to the SAME link-rendering
  // branch as `true` below - this is the exact pre-this-round behaviour
  // for the brief window before the probe settles, not a new failure
  // mode.
  const crossHostSubdomain = isConfigPage && !isOnOwnSubdomain ? tenantSubdomain : null
  const subdomainReachable = useHostReachable(crossHostSubdomain)
  const subdomainConfirmedDown = isConfigPage && !isOnOwnSubdomain && subdomainReachable === false

  // timeZone: AIRFIELD_TIMEZONE, not the viewing device's own local zone -
  // this clock represents the airfield's actual local time (what a pilot
  // or ATC reading it on-site needs), not whatever timezone the browser/
  // TV's own system clock happens to be set to. A device with a
  // misconfigured clock, or a browser session behind a VPN in another
  // region, would otherwise show a plausible-looking but wrong time.
  const timeString = now.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: AIRFIELD_TIMEZONE,
  })

  const lastUpdatedString = now.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: AIRFIELD_TIMEZONE,
  })

  return (
    <div
      className={`relative h-full w-full rounded-xl p-3 shadow-lg flex items-center justify-between gap-2 px-3 sm:px-5 ${
        gradientMode === 'solid' ? 'bg-header-via' : 'bg-gradient-to-r from-header-from via-header-via to-header-to'
      }`}
    >
      {/* Left - title only (doubles as the Configuration nav control). "Last updated" used to
          stack directly beneath this as a second line - moved under the clock below instead
          (see that block's own comment) so a larger logo/name has the full row height to grow
          into rather than sharing it with a caption. min-w-0 + truncate: a flex child otherwise
          refuses to shrink below its text's own natural width, which is what was pushing the
          clock (below) into overlapping it at narrow widths. */}
      {(() => {
        const headerLinkContent = (
          <div className="flex min-w-0 items-center gap-2">
            {showLogo && logoUrl && (
              // shrink-0 + capped max-width/height (LOGO_SIZE_CLASSES, driven by the
              // same nameFontSize value the name text uses - see that map's own
              // comment): a logo of any aspect ratio must never be allowed to grow
              // past its tier's cap and push the centred clock (below) out of
              // position - the exact narrow-width collision this file's own
              // comments already document for the title text. h-full + object-
              // contain (never object-cover/fixed w+h) guarantees no distortion
              // and no cropping regardless of the uploaded image's native
              // dimensions.
              <div className={`shrink-0 ${LOGO_SIZE_CLASSES[nameFontSize]}`}>
                <img src={logoUrl} alt="" className="h-full w-full object-contain object-left" />
              </div>
            )}
            {showName && (
              <div
                className={`truncate font-black uppercase tracking-wide text-primary transition-colors group-hover:text-accent-sky-400 ${NAME_FONT_SIZE_CLASSES[nameFontSize]}`}
              >
                {airfieldName || 'AIRFIELD CENTRAL'}
              </div>
            )}
          </div>
        )
        // No longer flex-col - headerLinkContent is a single row now that
        // "Last updated" moved out from underneath it (see above).
        const headerLinkClassName = 'group flex min-w-0 cursor-pointer'
        const headerLinkTitle = isConfigPage ? 'Back to Dashboard' : 'Weather Config'

        // Confirmed unreachable (not just "still checking" - see
        // subdomainConfirmedDown's own comment) - a raw <a href> here
        // would just be a dead link to a host that doesn't resolve at
        // all. Same content, not wrapped in any link element at all
        // (no cursor-pointer, no hover state) - nothing to click to,
        // so nothing should look clickable.
        if (subdomainConfirmedDown) {
          return (
            <div className="flex min-w-0" title="Your dashboard URL isn't live yet — contact support">
              {headerLinkContent}
            </div>
          )
        }

        // A relative <Link> can't cross hosts - when configBackHref is
        // the absolute cross-subdomain URL (see the comment on
        // isOnOwnSubdomain above), this must be a plain <a>, not
        // react-router's <Link>, which would otherwise just push a
        // same-origin history entry for an https:// `to` value instead
        // of actually navigating there.
        if (isConfigPage && !isOnOwnSubdomain) {
          return (
            <a href={configBackHref} className={headerLinkClassName} title={headerLinkTitle}>
              {headerLinkContent}
            </a>
          )
        }
        return (
          <Link
            to={isConfigPage ? configBackHref : isPublicDashboard ? dashboardLandingPage : '/config'}
            className={headerLinkClassName}
            title={headerLinkTitle}
          >
            {headerLinkContent}
          </Link>
        )
      })()}

      {/* Centre - large clock, absolutely centred against the full header
          width from sm up. Below sm, absolute positioning is exactly what
          caused the overlap (it ignored the title's actual width entirely) -
          a normal flex item instead, sized down, takes its place in the row
          between the title and rightSlot with no collision. "Last updated"
          used to stack beneath the title/logo on the left instead - moved
          here (same small-caption-under-a-big-value pattern, just under the
          clock rather than the name) so the title row is free to grow a
          larger logo into the space that line used to reserve. Hidden below
          sm for the same reason it always was: no room for a second line
          alongside the title and status slot without forcing things to
          shrink further than they already have to at that width. */}
      <div className="flex-shrink-0 flex flex-col items-center sm:absolute sm:left-1/2 sm:-translate-x-1/2">
        <div className="text-lg font-extrabold text-primary sm:text-5xl">{timeString}</div>
        <div className="hidden text-sm font-medium text-muted-300 leading-tight sm:block">
          {subdomainConfirmedDown ? "Your dashboard URL isn't live yet — contact support" : `Last updated ${lastUpdatedString}`}
        </div>
      </div>

      {/* Right - optional slot (e.g. weather status indicator on the dashboard) */}
      {rightSlot}
    </div>
  )
}
