// Password hashing via Web Crypto PBKDF2 - reused verbatim from proven-ai's
// working implementation, not BetterAuth's bcrypt default. bcrypt relies on
// Node-native bindings unavailable in the Workers/Pages V8 isolate runtime;
// proven-ai's override is confirmed working there. Originally lived only in
// functions/api/auth/[[path]].ts (BetterAuth's own hash/verify config);
// extracted here so the member-management endpoints (which set/reset
// passwords directly, bypassing BetterAuth's own sign-up/reset-password
// routes entirely - see the phase-0.1 investigation for why) can produce
// hashes in the exact same format BetterAuth's client-configured verify
// function expects.

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

export async function hashPassword(password: string): Promise<string> {
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

export async function verifyPassword(data: { hash: string; password: string }): Promise<boolean> {
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

// Short, unambiguous temporary password for a newly-created or reset
// member account - avoids visually similar characters (0/O, 1/l/I) since
// this gets read aloud/typed by hand when an owner relays it to a new
// admin/atc member, not copy-pasted through a signup flow.
const TEMP_PASSWORD_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";

export function generateTemporaryPassword(length = 16): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let result = "";
  for (const byte of bytes) {
    result += TEMP_PASSWORD_ALPHABET[byte % TEMP_PASSWORD_ALPHABET.length];
  }
  return result;
}
