// BetterAuth server handler, mounted as a Cloudflare Pages Function catch-all
// under /api/auth/* - confirmed as the right place for this (not the
// separate standalone Worker in worker/) by inspecting a proven, already-
// working BetterAuth + D1 Pages Function in another project on this
// machine (proven-ai's functions/api/auth/[[path]].ts). This file mirrors
// that structure and reuses its exact password-hashing approach; it
// deliberately drops proven-ai's product-specific extras (referral
// tracking, SaasDesk webhook, login-attempt rate limiting, signup gate) -
// out of scope for this phase, not overlooked.

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

// Password hashing via Web Crypto PBKDF2 - reused verbatim from proven-ai's
// working implementation, not BetterAuth's bcrypt default. bcrypt relies on
// Node-native bindings unavailable in the Workers/Pages V8 isolate runtime;
// proven-ai's override is confirmed working there, so this project starts
// from the same known-good implementation rather than rediscovering the
// problem.
const textEncoder = new TextEncoder();
const PBKDF2_ITERATIONS = 10000;

function toBase64(data: Uint8Array): string {
  let binary = "";
  for (const byte of data) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i += 1) {
    result |= a[i] ^ b[i];
  }
  return result === 0;
}

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", iterations: PBKDF2_ITERATIONS, salt: salt as unknown as BufferSource },
    key,
    256
  );
  const hash = new Uint8Array(bits);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
}

async function verifyPassword(data: { hash: string; password: string }): Promise<boolean> {
  const [scheme, iterationsRaw, saltRaw, hashRaw] = data.hash.split("$");
  if (scheme !== "pbkdf2" || !iterationsRaw || !saltRaw || !hashRaw) return false;

  const iterations = Number(iterationsRaw);
  if (!Number.isFinite(iterations) || iterations <= 0) return false;

  const salt = fromBase64(saltRaw);
  const expectedHash = fromBase64(hashRaw);
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(data.password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", iterations, salt: salt as unknown as BufferSource },
    key,
    expectedHash.length * 8
  );
  const actualHash = new Uint8Array(bits);
  return timingSafeEqual(actualHash, expectedHash);
}

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
