import { createAuthClient } from 'better-auth/react'
import { organizationClient } from 'better-auth/client/plugins'

// BetterAuth's client requires a full absolute URL (protocol + host) for
// baseURL, not a bare path - it calls `new URL(baseURL)` with no base
// argument internally (confirmed in node_modules/better-auth/dist/utils/
// url.mjs: assertHasProtocol/checkHasPath), so a relative "/api/auth"
// throws "Invalid base URL" before any request is even made. Building it
// from window.location.origin at runtime still means this works
// unchanged in local dev, preview deployments, and production without
// hardcoding a domain - same intent as before, just a valid URL instead
// of a path.
export const authClient = createAuthClient({
  baseURL: `${window.location.origin}/api/auth`,
  plugins: [organizationClient()],
})
