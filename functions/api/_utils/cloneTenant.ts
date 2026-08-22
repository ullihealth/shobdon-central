// Clones a template tenant's org-scoped rows onto a newly created
// organization. Reads whatever the source org's rows actually contain
// right now (SELECT *) rather than hardcoding a second copy of each
// table's column list - this project's schema has grown several of
// these tables via incremental ALTER TABLE migrations (club_theme,
// runway_groups, camera_slots, ops_panel_state, carousel_slots), so a
// hardcoded column list would silently drift out of date the next time
// one of those gets a new column. Used by both onboarding paths that
// provision a real tenant from org_newcustomer -
// functions/api/platform/tenants/onboard.ts (platform-admin invite
// link) and functions/api/public/trial-signup.ts (public self-serve
// signup).
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
  // Café Reserved Owner Slots round - the template's own slots 5/8/12
  // (ownerSlotUnlocked=0, empty) carry over the same way carousel_slots'
  // reserved rows already do above, so every future tenant's café screen
  // starts with the same 3 reserved-but-empty positions with zero
  // onboarding code changes beyond this one line.
  await cloneTable(db, "cafe_carousel_slots", sourceOrgId, targetOrgId, newSlug, null);
  // Café ticker round - previously NOT cloned at all, meaning every new
  // venue_cafe tenant started with zero rows in this table rather than
  // org_newcustomer's own generic defaults (tickerEnabled=0, its own
  // style/slot config). publicConfig.ts's cafeSettings resolution
  // already treats a missing row as "tickerEnabled: false" as a safe
  // fallback, so this gap never broke anything visibly - but it also
  // meant a tenant had no row for cafe-settings/index.ts's own
  // ON CONFLICT(organizationId) upsert to ever land on until the first
  // time someone actually saved that page, and any admin-side read of
  // "what is this tenant's current ticker config" saw nothing at all
  // instead of the template's real generic defaults. Confirmed a real
  // production tenant (Meg's café) hit exactly this gap. Cloning here
  // doesn't change default behaviour (still starts disabled, same as
  // org_newcustomer's own row) - it just ensures the row exists.
  await cloneTable(db, "cafe_template_settings", sourceOrgId, targetOrgId, newSlug, null);
}
