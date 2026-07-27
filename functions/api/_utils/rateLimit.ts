// Minimal fixed-window rate limiter for public, unauthenticated
// endpoints. No rate-limiting mechanism exists anywhere else in this
// codebase to reuse (confirmed by inspection - trial-signup.ts's own
// "no rate-limiting yet" comment was the only hit) - this reuses the
// WEATHER_CACHE KV namespace's existing TTL-based ephemeral-storage
// shape rather than provisioning a new KV namespace for one counter,
// since it's already bound in both wrangler.toml and
// wrangler.worker.toml. Keys are prefixed distinctly from that
// namespace's own weather-forecast cache keys to guarantee no
// collision.

export type KVNamespace = {
  get: (key: string) => Promise<string | null>;
  put: (key: string, value: string, options?: { expirationTtl?: number }) => Promise<void>;
};

// Bucketing by a truncated window index (not "renew TTL on every hit")
// so a steady trickle of requests below the limit can't keep a client
// permanently rate-limited by continuously pushing the expiry out - each
// window is its own key, expires on its own, unaffected by activity in
// the next window. expirationTtl is 2x the window as a safety margin
// against KV's own eventual-consistency/expiry timing, not because the
// count needs to survive into the next window - the window-index in the
// key already guarantees a fresh count once the window rolls over.
export async function isRateLimited(kv: KVNamespace, key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const window = Math.floor(Date.now() / (windowSeconds * 1000));
  const fullKey = `ratelimit:${key}:${window}`;

  const current = await kv.get(fullKey).catch(() => null);
  const count = current ? Number(current) : 0;
  if (count >= limit) return true;

  await kv.put(fullKey, String(count + 1), { expirationTtl: windowSeconds * 2 }).catch(() => {});
  return false;
}
