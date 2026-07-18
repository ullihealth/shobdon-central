// Clones a template tenant's org-scoped rows onto a newly created
// organization. Reads whatever the source org's rows actually contain
// right now (SELECT *) rather than hardcoding a second copy of each
// table's column list - this project's schema has grown several of
// these tables via incremental ALTER TABLE migrations (club_theme,
// runway_groups, camera_slots, ops_panel_state, carousel_slots), so a
// hardcoded column list would silently drift out of date the next time
// one of those gets a new column. Only used by
// functions/api/platform/tenants/onboard.ts, cloning from org_newcustomer.
import type { D1Database } from "./tenantAuth";

async function cloneTable(
  db: D1Database,
  table: string,
  sourceOrgId: string,
  targetOrgId: string,
  newIdPrefix: string,
  idColumn: string | null
): Promise<void> {
  const { results } = await db
    .prepare(`SELECT * FROM ${table} WHERE organizationId = ?`)
    .bind(sourceOrgId)
    .all<Record<string, unknown>>();

  for (const row of results) {
    const next: Record<string, unknown> = { ...row, organizationId: targetOrgId };
    if (idColumn) {
      next[idColumn] = `${newIdPrefix}-${crypto.randomUUID().slice(0, 8)}`;
    }
    const columns = Object.keys(next);
    const placeholders = columns.map(() => "?").join(", ");
    await db
      .prepare(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`)
      .bind(...columns.map((column) => next[column]))
      .run();
  }
}

// Deliberately does NOT clone weather_observations/latest_conditions/
// operational_events - those are newcustomer's own dummy screenshot
// sample data, not something a real new customer's tenant should start
// with. A real tenant starts with genuinely no weather data until its
// own source produces real observations.
export async function cloneTenantTemplate(db: D1Database, sourceOrgId: string, targetOrgId: string, newSlug: string): Promise<void> {
  await cloneTable(db, "club_theme", sourceOrgId, targetOrgId, newSlug, null);
  await cloneTable(db, "runway_groups", sourceOrgId, targetOrgId, newSlug, "id");
  await cloneTable(db, "camera_slots", sourceOrgId, targetOrgId, newSlug, null);
  await cloneTable(db, "ops_panel_state", sourceOrgId, targetOrgId, newSlug, null);
  await cloneTable(db, "carousel_slots", sourceOrgId, targetOrgId, newSlug, null);
}
