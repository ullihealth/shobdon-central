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
        baseURL: {
          allowedHosts: ["shobdon-central.pages.dev", "airfieldcentral.com", "*.airfieldcentral.com"],
          fallback: "https://shobdon-central.pages.dev",
          protocol: "https",
        },
        // Same fix, same reasoning, for the CSRF/origin allowlist - was a
        // single hardcoded string (env.AUTH_TRUSTED_ORIGIN). Wildcard syntax
        // ("https://*.domain.com") is BetterAuth's own documented pattern
        // for exactly this (confirmed against their published docs, not
        // just the source) - matches any subdomain over HTTPS specifically;
        // a non-HTTPS request to a matching host is correctly rejected.
        trustedOrigins: [
          "https://shobdon-central.pages.dev",
          "https://airfieldcentral.com",
          "https://*.airfieldcentral.com",
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
