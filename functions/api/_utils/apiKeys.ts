// Per-tenant API key generation/hashing/lookup for the generic weather
// ingestion endpoint (migration 0029: tenant_api_keys). SHA-256 of the
// raw key, unsalted - unlike passwordHash.ts's PBKDF2 (built for
// low-entropy human passwords needing brute-force resistance), an API
// key is 24 random bytes generated server-side with plenty of entropy
// on its own; a fast, indexable hash is the right tradeoff here, the
// same approach GitHub/Stripe-style API tokens use.

import type { D1Database } from "./tenantAuth";

const KEY_PREFIX = "aic_live_";

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function generateApiKey(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return `${KEY_PREFIX}${toHex(bytes.buffer)}`;
}

export async function hashApiKey(rawKey: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawKey));
  return toHex(digest);
}

export interface ApiKeyLookup {
  id: string;
  tenantId: number;
}

// Resolves a raw Authorization-header key to its owning tenant, or null
// if the key doesn't exist or has been revoked. This is the entire
// security boundary the ingestion endpoint rests on: the tenant_id it
// writes to comes ONLY from this lookup, never from anything in the
// request body.
export async function resolveApiKey(db: D1Database, rawKey: string): Promise<ApiKeyLookup | null> {
  const keyHash = await hashApiKey(rawKey);
  const row = await db
    .prepare("SELECT id, tenant_id AS tenantId FROM tenant_api_keys WHERE key_hash = ? AND revoked_at IS NULL")
    .bind(keyHash)
    .first<ApiKeyLookup>();
  return row ?? null;
}
