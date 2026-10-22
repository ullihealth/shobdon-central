// Platform-admin only: GET /api/platform/visits/daily-devices
//   ?tenantId=&date=YYYY-MM-DD&hideGroups=a,b
// Backs the unique-device counter panel in the header of
// /platform/visits (src/pages/PlatformVisitsPage.tsx). Read-only.
//
// "Device" = DISTINCT ip_address - the same identity the Visit Log itself
// uses (one IP = one row-group); see the page's own footnote. TOTAL is
// distinct IPs across ALL displays, NOT main + pilot, so an IP seen on
// both counts once there. Any display slug other than main/pilot is
// counted in total only.
//
// `date` is a UK local day (Europe/London) converted to a UTC window
// here (_utils/londonDay.ts) - the list route's own From/To stay UTC.
// Counted in SQL (COUNT DISTINCT), so unlike the list route there is no
// MAX_ROWS cap in play.
//
// Visitors (visitorsMain/Pilot/Total): same windows and filters, but one
// visitor per ip_labels GROUP (a person on several IPs - wifi, mobile data,
// VPN - labelled under one group counts once); an unlabelled IP counts once
// on its own. Keys are prefixed ('g:' / 'ip:') so a group name can never
// collide with an IP string. Devices (above) are unchanged.
//
// Robots and automated test runs (_utils/visitorKind.ts, classified from the
// user agent) are EXCLUDED from every device/visitor number above; they are
// counted separately as `robots` / `tests` (distinct IPs for the day) so the
// panel can show what was left out. Display/counting only - they are still
// logged. hideGroups joins ip_labels exactly as the list
// route does, so hidden labels drop out of the counts the same way they
// drop out of the list. tenantId omitted = all tenants.
//
// requirePlatformAdmin, same as visits/index.ts.
import { requirePlatformAdmin, jsonResponse, type D1Database } from "../../_utils/tenantAuth";
import { londonDayWindow } from "../../_utils/londonDay";
import { visitorKindSql } from "../../_utils/visitorKind";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

const KIND = visitorKindSql("v.user_agent");
const VISITOR_KEY = "CASE WHEN l.group_name IS NOT NULL THEN 'g:' || l.group_name ELSE 'ip:' || v.ip_address END";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requirePlatformAdmin(request, env);
  if ("error" in result) return result.error;

  const url = new URL(request.url);
  const date = url.searchParams.get("date") ?? "";
  const dayWindow = londonDayWindow(date);
  if (!dayWindow) return jsonResponse({ error: "date must be a valid YYYY-MM-DD" }, 400);

  const conditions = ["v.visited_at >= ?", "v.visited_at < ?"];
  const bindings: (string | number)[] = [dayWindow.startIso, dayWindow.endIso];

  const tenantIdParam = url.searchParams.get("tenantId");
  if (tenantIdParam) {
    const tenantId = Number(tenantIdParam);
    if (!Number.isFinite(tenantId)) return jsonResponse({ error: "tenantId must be a number" }, 400);
    conditions.push("v.tenant_id = ?");
    bindings.push(tenantId);
  }

  const hideGroupsParam = url.searchParams.get("hideGroups");
  const hideGroups = hideGroupsParam ? hideGroupsParam.split(",").map((g) => g.trim()).filter(Boolean) : [];
  if (hideGroups.length > 0) {
    conditions.push(`(l.group_name IS NULL OR l.group_name NOT IN (${hideGroups.map(() => "?").join(",")}))`);
    bindings.push(...hideGroups);
  }

  const row = await env.DB
    .prepare(
      `SELECT COUNT(DISTINCT CASE WHEN ${KIND} = 'human' AND v.display_slug = 'main' THEN v.ip_address END) AS main,
              COUNT(DISTINCT CASE WHEN ${KIND} = 'human' AND v.display_slug = 'pilot' THEN v.ip_address END) AS pilot,
              COUNT(DISTINCT CASE WHEN ${KIND} = 'human' THEN v.ip_address END) AS total,
              COUNT(DISTINCT CASE WHEN ${KIND} = 'human' AND v.display_slug = 'main' THEN ${VISITOR_KEY} END) AS visitorsMain,
              COUNT(DISTINCT CASE WHEN ${KIND} = 'human' AND v.display_slug = 'pilot' THEN ${VISITOR_KEY} END) AS visitorsPilot,
              COUNT(DISTINCT CASE WHEN ${KIND} = 'human' THEN ${VISITOR_KEY} END) AS visitorsTotal,
              COUNT(DISTINCT CASE WHEN ${KIND} = 'robot' THEN v.ip_address END) AS robots,
              COUNT(DISTINCT CASE WHEN ${KIND} = 'test' THEN v.ip_address END) AS tests
       FROM display_visits v
       LEFT JOIN ip_labels l ON l.ip_address = v.ip_address
       WHERE ${conditions.join(" AND ")}`
    )
    .bind(...bindings)
    .first<{
      main: number;
      pilot: number;
      total: number;
      visitorsMain: number;
      visitorsPilot: number;
      visitorsTotal: number;
      robots: number;
      tests: number;
    }>();

  return jsonResponse({
    date,
    main: row?.main ?? 0,
    pilot: row?.pilot ?? 0,
    total: row?.total ?? 0,
    visitorsMain: row?.visitorsMain ?? 0,
    visitorsPilot: row?.visitorsPilot ?? 0,
    visitorsTotal: row?.visitorsTotal ?? 0,
    robots: row?.robots ?? 0,
    tests: row?.tests ?? 0,
  });
};
