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
  AUTH_TRUSTED_ORIGIN?: string;
  BETTER_AUTH_URL?: string;
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
        baseURL: env.BETTER_AUTH_URL || "https://shobdon-central.pages.dev",
        trustedOrigins: env.AUTH_TRUSTED_ORIGIN ? [env.AUTH_TRUSTED_ORIGIN] : [],
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
