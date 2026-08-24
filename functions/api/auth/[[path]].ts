// BetterAuth server handler, mounted as a Cloudflare Pages Function catch-all
// under /api/auth/* - confirmed as the right place for this (not the
// separate standalone Worker in worker/) by inspecting a proven, already-
// working BetterAuth + D1 Pages Function in another project on this
// machine (proven-ai's functions/api/auth/[[path]].ts). This file mirrors
// that structure and reuses its exact password-hashing approach; it
// deliberately drops proven-ai's product-specific extras (referral
// tracking, SaasDesk webhook, login-attempt rate limiting, signup gate) -
// out of scope for this phase, not overlooked.

import { hashPassword, verifyPassword } from "../_utils/passwordHash";

type D1Database = {
  prepare: (query: string) => {
    bind: (...values: unknown[]) => {
      run: () => Promise<{ success: boolean }>;
      first: <T = Record<string, unknown>>() => Promise<T | null>;
      all: <T = unknown>() => Promise<{ results: T[] }>;
    };
    first: <T = Record<string, unknown>>() => Promise<T | null>;
    all: <T = unknown>() => Promise<{ results: T[] }>;
  };
};

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
  waitUntil: (promise: Promise<unknown>) => void;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
  AUTH_SECRET: string;
  // .dev.vars-only, gitignored, never deployed - see local-login.ts's
  // own comment for the full reasoning. Used below to conditionally
  // trust a spoofed tenant subdomain host (e.g. test-cafe-media.
  // airfieldcentral.com via /etc/hosts) over plain HTTP for local
  // testing only - never present in a real deployed Function, so this
  // can never widen what a real production request is allowed to do.
  WRANGLER_PAGES_DEV_LOCAL_ONLY?: string;
}

let cachedAuth: { handler: (request: Request) => Promise<Response> } | null = null;

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (!cachedAuth) {
      const [{ betterAuth }, { D1Dialect }, { organization }] = await Promise.all([
        import("better-auth"),
        import("kysely-d1"),
        import("better-auth/plugins/organization"),
      ]);

      // Computed once, memoized alongside cachedAuth for the isolate's
      // whole lifetime (same caching this file already does) - safe,
      // since a real deployed Function's env never has this var and
      // never will mid-isolate-lifetime either.
      const isLocalDev = !!env.WRANGLER_PAGES_DEV_LOCAL_ONLY;

      cachedAuth = betterAuth({
        secret: env.AUTH_SECRET,
        // Was a single hardcoded string (env.BETTER_AUTH_URL, defaulting to
        // the .pages.dev URL) - broke the moment a second host needed to
        // work, which is exactly what happens today (shobdon.airfieldcentral.com
        // going live) and will keep happening with every future tenant
        // subdomain. BetterAuth's dynamic baseURL config (confirmed against
        // the installed 1.6.23 source in node_modules/better-auth/dist/
        // utils/url.mjs, not assumed from docs alone - resolveDynamicBaseURL/
        // getHostFromSource) derives the base URL per-request from the
        // incoming Host header, validated against allowedHosts - so it's an
        // explicit allowlist, never "trust whatever Host the client sent."
        // The wildcard entry is the whole point: any *.airfieldcentral.com
        // subdomain (any future tenant) resolves correctly with zero further
        // code changes, matching the same pattern trustedOrigins below uses.
        // fallback keeps the original .pages.dev URL working if a request
        // ever arrives with a Host header that isn't on the allowlist.
        // airfield-central.jeffthompson.workers.dev added alongside the
        // .pages.dev entry - the new Worker's own workers.dev URL from the
        // Pages -> Workers migration (Cloudflare's documented conversion
        // path). Additive only: the .pages.dev entries stay exactly as
        // they are, since the Pages project keeps serving real traffic
        // until custom domains are deliberately moved over.
        baseURL: {
          allowedHosts: [
            "shobdon-central.pages.dev",
            // Cloudflare Pages preview deployments (branch pushes, not
            // production) get a per-deployment hash subdomain of their
            // own - <hash>.shobdon-central.pages.dev - which the bare
            // entry above never matched, so sign-in silently failed
            // ("Invalid email or password", not a clearer error) on
            // every preview URL. Same wildcard pattern as
            // *.airfieldcentral.com below, just for Pages' own preview
            // subdomains.
            "*.shobdon-central.pages.dev",
            "airfield-central.jeffthompson.workers.dev",
            "airfieldcentral.com",
            "*.airfieldcentral.com",
            // Local dev round - `wrangler pages dev` (this session's own
            // established local-testing command) serves on localhost, a
            // Host this allowlist never covered, so resolveDynamicBaseURL
            // (node_modules/better-auth/dist/utils/url.mjs) silently fell
            // back to the production .pages.dev URL for every local
            // request. Wildcard on the port, not a single hardcoded
            // "localhost:8788" - matchesHostPattern (same file) does a
            // plain string/wildcard compare with no port-stripping, so a
            // future dev port change wouldn't silently break this again.
            // Confirmed via direct source inspection (matchesHostPattern +
            // wildcardMatch) that "*" here can't accidentally widen to
            // match any REAL production host - it's anchored to the
            // literal "localhost:" prefix, and no external request can
            // ever legitimately arrive with that Host value.
            "localhost:*",
            // Local dev round 2 - spoofed-subdomain local testing (an
            // /etc/hosts entry pointing a real tenant's own subdomain,
            // e.g. test-cafe-media.airfieldcentral.com, at 127.0.0.1 -
            // the only way to reach a non-Shobdon tenant's real public
            // display locally, since resolveTenantHost.ts's own
            // Host-based resolution has no other local override).
            // "*.airfieldcentral.com" above is HTTPS-only in practice
            // for a real request (see trustedOrigins below, which is
            // scheme-specific) - allowedHosts itself isn't scheme-aware,
            // so this entry is redundant for a real production request
            // but was still missing the *:port* form local dev needs
            // (wrangler pages dev's own port, not 443). Only added when
            // isLocalDev - never present for a real deployed Function.
            ...(isLocalDev ? ["*.airfieldcentral.com:*"] : []),
          ],
          fallback: "https://shobdon-central.pages.dev",
          // Local dev round - was hardcoded "https", which overrides
          // better-auth's own built-in dev-ergonomics inference
          // (getProtocolFromSource/isLoopbackForDevScheme, same url.mjs)
          // that would otherwise correctly resolve "http" for a loopback
          // host and "https" for everything else. Removed entirely rather
          // than set conditionally - on Cloudflare, request.url already
          // reflects the real scheme the edge received (confirmed via the
          // same source read: getProtocolFromSource checks the request's
          // own URL protocol before ever falling back to the loopback
          // check), so omitting this is correct for production too, not
          // just a local-dev carve-out.
        },
        // Same fix, same reasoning, for the CSRF/origin allowlist - was a
        // single hardcoded string (env.AUTH_TRUSTED_ORIGIN). Wildcard syntax
        // ("https://*.domain.com") is BetterAuth's own documented pattern
        // for exactly this (confirmed against their published docs, not
        // just the source) - matches any subdomain over HTTPS specifically;
        // a non-HTTPS request to a matching host is correctly rejected.
        trustedOrigins: [
          "https://shobdon-central.pages.dev",
          "https://*.shobdon-central.pages.dev",
          "https://airfield-central.jeffthompson.workers.dev",
          "https://airfieldcentral.com",
          "https://*.airfieldcentral.com",
          // Local dev round - the actual root cause of local sign-in
          // failing outright (not a bad-credentials issue): better-auth's
          // own CSRF/origin-check middleware (origin-check.mjs,
          // validateOrigin) rejects any sign-in whose Origin header isn't
          // an exact/wildcard match in this list, with a 403 thrown
          // BEFORE credentials are ever checked - confirmed via direct
          // source read, not assumed from symptoms alone. Scheme-specific
          // ("http://", not "https://") since matchesOriginPattern's
          // wildcard branch matches the full origin string including
          // scheme - a plain HTTP origin was never going to match any of
          // the https-only patterns above regardless of host.
          "http://localhost:*",
          // Local dev round 2 - same spoofed-subdomain local testing
          // case as allowedHosts above, but this one is the check that
          // actually matters: better-auth's CSRF/origin-check rejects
          // any sign-in whose Origin isn't a match here, and the
          // existing "https://*.airfieldcentral.com" entry is scheme-
          // specific (matchesOriginPattern matches the full origin
          // string including scheme) - a plain http:// request via a
          // spoofed subdomain host never matched it, 403ing exactly
          // where local-login.ts's own self-fetch needs it to succeed.
          // Only added when isLocalDev - a real production request
          // over plain HTTP to a real tenant subdomain was never going
          // to be a legitimate sign-in attempt anyway (real tenants are
          // HTTPS-only), so this can't widen production's real CSRF
          // protection even in principle, but it's still scoped to
          // isLocalDev rather than added unconditionally on that
          // reasoning alone - never present for a real deployed
          // Function.
          ...(isLocalDev ? ["http://*.airfieldcentral.com:*"] : []),
        ],
        basePath: "/api/auth",
        emailAndPassword: {
          enabled: true,
          password: {
            hash: hashPassword,
            verify: verifyPassword,
          },
        },
        // Cross-tenant superadmin flag for the future developer/tenant-
        // management dashboard - deliberately NOT an organization role
        // (see migrations/0003_user_developer_field.sql for why).
        user: {
          additionalFields: {
            developer: {
              type: "boolean",
              required: false,
              defaultValue: false,
              input: false,
            },
          },
        },
        // Official organization plugin = this project's tenant model.
        // Default roles (owner/admin/member) are exactly what phase 0
        // needs; nothing custom configured here yet.
        plugins: [organization()],
        database: {
          dialect: new D1Dialect({ database: env.DB }),
          type: "sqlite",
        },
      });
    }

    return await cachedAuth.handler(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
