// Resolves an incoming request's Host header to the organizationId that
// owns it - the subdomain-based replacement for the :tenant URL path
// param that functions/api/public/[tenant]/*.ts still use (kept working
// unchanged, see those files' own comments). tenants.subdomain already
// stores the full hostname ('shobdon.airfieldcentral.com'), so this is a
// direct equality match, not label/prefix parsing.
//
// Three fallback hosts resolve to Shobdon rather than 404:
// - shobdon-central.pages.dev: Shobdon's own Pages project's own default
//   hostname - permanently Shobdon, same category as the worker/D1/KV
//   internal resource names that don't get renamed for the rebrand.
// - airfieldcentral.com (bare root, no subdomain): the landing page
//   (src/pages/LandingPage.tsx, rendered via src/components/RootRoute.tsx)
//   now lives at this host and never calls this endpoint or any other
//   tenant-scoped public API - so this fallback no longer drives any
//   real rendering decision. Left in place (comment-only update, not a
//   behaviour change) purely so a direct call to this endpoint under
//   this host still returns something valid rather than 404, since
//   Shobdon remains the only real tenant. Revisit if that ever stops
//   being a reasonable default.
// - localhost (any port): local dev only, so `wrangler pages dev`
//   continues working exactly as it does today with no extra setup.
//
// Any other host returns null (-> the caller 404s) rather than silently
// falling back to Shobdon - an unrecognised host must never accidentally
// serve Shobdon's data under someone else's expectations.

// Deliberately its own minimal structural type, not imported from
// tenantAuth.ts or publicConfig.ts - this only ever calls .prepare().bind()
// .first(), and every D1 binding across this codebase already satisfies
// that shape, so there's nothing to gain by coupling to either of those
// files' own (slightly larger) D1Database types.
export type D1Database = {
  prepare: (query: string) => {
    bind: (...values: unknown[]) => {
      first: <T = Record<string, unknown>>() => Promise<T | null>;
    };
  };
};

const FALLBACK_TO_SHOBDON_HOSTS = new Set(["airfieldcentral.com", "shobdon-central.pages.dev"]);

export async function resolveOrganizationIdFromHost(host: string, db: D1Database): Promise<string | null> {
  const bareHost = host.split(":")[0];

  const bySubdomain = await db
    .prepare("SELECT organization_id AS organizationId FROM tenants WHERE subdomain = ?")
    .bind(bareHost)
    .first<{ organizationId: string | null }>();
  if (bySubdomain?.organizationId) return bySubdomain.organizationId;

  if (FALLBACK_TO_SHOBDON_HOSTS.has(bareHost) || bareHost === "localhost") {
    const shobdon = await db
      .prepare("SELECT organization_id AS organizationId FROM tenants WHERE slug = 'shobdon'")
      .first<{ organizationId: string | null }>();
    return shobdon?.organizationId ?? null;
  }

  return null;
}

export interface ResolvedTenant {
  id: number;
  organizationId: string | null;
}

// Same Host resolution + fallback rules as resolveOrganizationIdFromHost
// above, but returns tenants.id too - needed by tenant_displays (0027),
// which is keyed off tenants.id rather than organizationId. Added
// alongside rather than changing the existing function's return shape,
// so every current caller of resolveOrganizationIdFromHost is
// completely unaffected.
export async function resolveTenantFromHost(host: string, db: D1Database): Promise<ResolvedTenant | null> {
  const bareHost = host.split(":")[0];

  const bySubdomain = await db
    .prepare("SELECT id, organization_id AS organizationId FROM tenants WHERE subdomain = ?")
    .bind(bareHost)
    .first<ResolvedTenant>();
  if (bySubdomain) return bySubdomain;

  if (FALLBACK_TO_SHOBDON_HOSTS.has(bareHost) || bareHost === "localhost") {
    const shobdon = await db
      .prepare("SELECT id, organization_id AS organizationId FROM tenants WHERE slug = 'shobdon'")
      .first<ResolvedTenant>();
    return shobdon ?? null;
  }

  return null;
}
