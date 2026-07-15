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
// - airfieldcentral.com (bare root, no subdomain): TEMPORARY placeholder
//   for the not-yet-built cross-tenant landing page (Stage 5, deferred).
//   Preserves today's actual behaviour (the bare root already shows
//   Shobdon, since it's the only tenant) rather than changing anything -
//   revisit this the moment Stage 5 is actually scoped, don't mistake it
//   for a permanent design choice before then.
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
type D1Database = {
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
