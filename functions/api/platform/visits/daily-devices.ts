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
// MAX_ROWS cap in play. hideGroups joins ip_labels exactly as the list
// route does, so hidden labels drop out of the counts the same way they
// drop out of the list. tenantId omitted = all tenants.
//
// requirePlatformAdmin, same as visits/index.ts.
import { requirePlatformAdmin, jsonResponse, type D1Database } from "../../_utils/tenantAuth";
import { londonDayWindow } from "../../_utils/londonDay";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

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
      `SELECT COUNT(DISTINCT CASE WHEN v.display_slug = 'main' THEN v.ip_address END) AS main,
              COUNT(DISTINCT CASE WHEN v.display_slug = 'pilot' THEN v.ip_address END) AS pilot,
              COUNT(DISTINCT v.ip_address) AS total
       FROM display_visits v
       LEFT JOIN ip_labels l ON l.ip_address = v.ip_address
       WHERE ${conditions.join(" AND ")}`
    )
    .bind(...bindings)
    .first<{ main: number; pilot: number; total: number }>();

  return jsonResponse({ date, main: row?.main ?? 0, pilot: row?.pilot ?? 0, total: row?.total ?? 0 });
};
