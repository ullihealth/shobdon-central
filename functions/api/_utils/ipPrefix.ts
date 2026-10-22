// "Starts with" IP filter for the Visit Log (list + export routes): turns the
// page's ipPrefix query param into a parameterised LIKE clause. User text is
// escaped (backslash, %, _) and used with ESCAPE '\', so it can only ever
// match literally - never act as a wildcard.

const MAX_PREFIX_LENGTH = 45; // longest textual IPv6 address

export function ipPrefixCondition(raw: string | null, column = "v.ip_address"): { sql: string; binding: string } | null {
  const prefix = (raw ?? "").trim().slice(0, MAX_PREFIX_LENGTH);
  if (!prefix) return null;
  const escaped = prefix.replace(/[\\%_]/g, (ch) => `\\${ch}`);
  return { sql: `${column} LIKE ? ESCAPE '\\'`, binding: `${escaped}%` };
}
