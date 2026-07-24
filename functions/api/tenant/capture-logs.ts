// Authenticated proxy for the capture worker's human-facing log page.
// GET /api/tenant/capture-logs[?org=slug]
//
// Previously "View Capture Logs" linked straight to
// https://shobdon-central-capture.<subdomain>.workers.dev/?key=<CAPTURE_KEY>,
// putting the raw key in a copy-pasteable/screenshottable URL. This route
// requires an owner/admin session (requireOwner, same gate as /config
// itself) and fetches the worker server-side with the key attached only
// here - never sent to or visible in the browser. A redirect would NOT
// fix this (the browser's address bar would still end up showing the
// worker's own ?key=... URL after following it) - the response body is
// proxied through directly instead, so the address bar stays on this
// route's own URL throughout.

import { requireOwner, jsonResponse, type D1Database } from "../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
  // Optional Pages secret - falls back to the same shared value already
  // used client-side for the worker's other still-public endpoints
  // (theme/latest/investigate/refresh-check, which must keep working
  // unauthenticated on the live dashboard and so aren't part of this
  // fix). Setting this env var later rotates the key for just these two
  // authenticated routes without touching those.
  CAPTURE_KEY?: string;
}

const CAPTURE_WORKER_BASE = "https://shobdon-central-capture.jeffthompson.workers.dev";
const FALLBACK_CAPTURE_KEY = "49f761797d8e1fe76898e079b997980f";

// This whole capture pipeline is Shobdon's own physical PC2/WeatherLink
// hardware, hardcoded above - there is no generic/multi-tenant version
// of it (see functions/api/ingest/weather.ts for the one that is). Bug
// found during the ingest-pipeline investigation: requireOwner only
// confirms the CALLER has an owner/admin role on WHATEVER tenant their
// own session is scoped to - it says nothing about which tenant that
// is. Without this check, any owner/admin on ANY tenant (demo,
// newcustomer, or a real future customer) could view Shobdon's live
// capture logs or trigger "Refresh PC2 Now" against Shobdon's actual
// physical machine from their own unrelated tenant's /config page.
const REQUIRED_TENANT_SLUG = "shobdon";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requireOwner(request, env);
  if ("error" in auth) return auth.error;
  if (auth.membership.slug !== REQUIRED_TENANT_SLUG) {
    return jsonResponse({ error: "This capture pipeline belongs to a different tenant" }, 403);
  }

  const key = env.CAPTURE_KEY || FALLBACK_CAPTURE_KEY;
  const upstream = await fetch(`${CAPTURE_WORKER_BASE}/?key=${key}`).catch(() => null);
  if (!upstream) {
    return new Response("Could not reach the capture log service.", { status: 502 });
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("Content-Type") || "text/html",
      "Cache-Control": "no-store",
    },
  });
};
