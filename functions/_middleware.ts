// Runs before every request to this Pages project AND the standalone
// "airfield-central" Worker deployed from this same Functions build
// (deploy-worker.yml runs `wrangler pages functions build --outdir dist/
// _worker.js`, bundling this file into that Worker's own entrypoint too,
// covering every *.airfieldcentral.com subdomain the Worker's own Route
// pattern claims).
//
// Root cause of the "Invalid origin" login failures (megs-cafe-media,
// confirmed also affecting shobdon and every other subdomain, not tenant-
// specific): *.airfieldcentral.com traffic through that Worker's Route
// was never upgraded to HTTPS at all - confirmed directly, curl -I
// http://<any-subdomain>.airfieldcentral.com/ returned a plain 200, while
// the bare apex (served via Pages directly, no Worker Route involved)
// correctly 301s to https. A Worker attached via its own Route pattern
// bypasses the zone's "Always Use HTTPS" edge feature for the traffic it
// claims - well-documented Cloudflare behaviour, not a dashboard toggle
// that was left off. A plain-HTTP page load then sent a plain-HTTP Origin
// on its own follow-up sign-in POST, which better-auth's trustedOrigins
// correctly rejected (HTTPS-only wildcard, by design) - the origin-check
// logic itself was never wrong; this was the missing layer in front of it.
//
// Excluded by PORT rather than hostname: local dev (`wrangler pages dev`)
// always serves over plain HTTP with no TLS at all, and this project's
// established local-testing pattern maps real production-shaped hostnames
// (e.g. shobdon.airfieldcentral.com) to 127.0.0.1 via
// --host-resolver-rules to exercise Host-based resolution - so hostname
// alone can't distinguish real production traffic from a local test using
// a production-shaped Host header. No real production request ever
// arrives with an explicit port in its Host header (always bare 80/443),
// so port presence is the reliable signal instead.
//
// 308 (Permanent Redirect), not 301: preserves the request method across
// the redirect - relevant here since a POST arriving over plain HTTP
// (the sign-in call itself, not just the page load) must still POST after
// upgrading, not silently become a GET the way legacy 301 handling can.
//
// Built as a plain Response with an explicit Location header rather than
// Response.redirect(url, 308) - confirmed directly (local dev) that
// Response.redirect's own URL handling in this runtime doesn't reliably
// carry the mutated https: protocol through to its Location header even
// though the computed URL string itself is correct; constructing the
// response manually sidesteps that entirely.
export const onRequest: PagesFunction = async ({ request, next }) => {
  const url = new URL(request.url);
  if (url.protocol === "http:" && !url.port) {
    url.protocol = "https:";
    return new Response(null, { status: 308, headers: { Location: url.toString() } });
  }
  return next();
};
