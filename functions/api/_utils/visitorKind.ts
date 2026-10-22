// Classifies a display_visits user agent as 'robot' (crawler / link-preview
// fetcher), 'test' (automated browser run) or 'human'. Display and counting
// only - the heartbeat still logs every visit unchanged; this is applied
// when the Visit Log lists rows, exports them, and counts devices.
//
// ONE pattern list per kind drives BOTH the TypeScript classifier and the
// SQL expression (visitorKindSql), so the two can never disagree - add a
// new crawler by adding one string to ROBOT_PATTERNS. Matching is a
// case-insensitive "contains". Patterns must be plain lowercase text with no
// SQL LIKE wildcards (% _) or quotes.

// Checked first: an automated test run is never reported as a robot.
export const TEST_PATTERNS = ["headlesschrome"];

export const ROBOT_PATTERNS = [
  "bot", // Googlebot, bingbot, Applebot, ExaSearchBot, Reflectionbot, ...
  "crawler",
  "spider",
  "slurp",
  "read-aloud", // Google-Read-Aloud
  "webindexer", // meta-webindexer
  "facebookexternalhit",
  "applebot",
  "googlebot",
  "bingbot",
  "exasearch",
  "reflectionbot",
  "preview",
];

export type VisitorKind = "robot" | "test" | "human";

export function visitorKind(userAgent: string | null | undefined): VisitorKind {
  if (!userAgent) return "human";
  const ua = userAgent.toLowerCase();
  if (TEST_PATTERNS.some((p) => ua.includes(p))) return "test";
  if (ROBOT_PATTERNS.some((p) => ua.includes(p))) return "robot";
  return "human";
}

function likeAny(column: string, patterns: string[]): string {
  return patterns.map((p) => `lower(${column}) LIKE '%${p}%'`).join(" OR ");
}

// SQL equivalent of visitorKind() for a user-agent column, e.g.
// visitorKindSql("v.user_agent"). A NULL user agent falls through to 'human',
// same as the TypeScript version.
export function visitorKindSql(column: string): string {
  return `CASE WHEN ${likeAny(column, TEST_PATTERNS)} THEN 'test' WHEN ${likeAny(column, ROBOT_PATTERNS)} THEN 'robot' ELSE 'human' END`;
}
