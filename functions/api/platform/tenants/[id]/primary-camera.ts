// Platform-admin only: GET/PUT /api/platform/tenants/:id/primary-camera -
// manages tenants.primary_camera_slot_number/primary_camera_id
// (migration 0091). Structural clone of this same directory's own
// parent-tenant.ts (GET returns current selection, PUT sets it), same
// requirePlatformAdmin gate, same explicit :id.
//
// A "candidate" is any real camera across BOTH mechanisms - a
// camera_slots row with a non-empty url, or any cameras row - combined
// into one list via a single string ref ("slot:<n>" / "cam:<id>"), the
// same "one combined key for a single <select>" convention
// CarouselSlotEditor.tsx's own cameraOptionValue() already uses for
// this identical two-mechanism problem, chosen here for the same
// reason: the frontend picker shouldn't need to know which table
// either option actually came from.
//
// Sub-tenant parent-camera round (migration 0109) - when this tenant
// has a parent, its PARENT's own candidates are appended with a
// distinct ref ("parent-slot:<n>" / "parent-cam:<id>") and a label that
// names the parent, so the exact same flat <select>
// (PrimaryCameraEditor.tsx) can offer them with no frontend change -
// it already renders whatever {ref, label} pairs this endpoint returns.
// Picking one sets tenants.primary_camera_from_parent = 1 alongside the
// existing two columns; picking an own-tenant "slot:"/"cam:" ref (or
// clearing) always resets it back to 0. This is opt-in only - no
// existing tenant's selection or stored flag changes just because it
// now has/had a parent.
import { requirePlatformAdmin, jsonResponse, type D1Database } from "../../../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
  params: Record<string, string>;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

interface Candidate {
  ref: string;
  label: string;
}

interface PrimaryCameraResponse {
  candidates: Candidate[];
  selectedRef: string | null;
}

async function loadCandidatesAndSelection(db: D1Database, tenantId: number): Promise<PrimaryCameraResponse> {
  const tenant = await db
    .prepare(
      "SELECT organization_id AS organizationId, primary_camera_slot_number AS primarySlot, primary_camera_id AS primaryCameraId, primary_camera_from_parent AS fromParent, parent_tenant_id AS parentTenantId FROM tenants WHERE id = ?"
    )
    .bind(tenantId)
    .first<{
      organizationId: string | null;
      primarySlot: number | null;
      primaryCameraId: string | null;
      fromParent: number;
      parentTenantId: number | null;
    }>();

  const parent = tenant?.parentTenantId
    ? await db
        .prepare("SELECT id, organization_id AS organizationId, name FROM tenants WHERE id = ?")
        .bind(tenant.parentTenantId)
        .first<{ id: number; organizationId: string; name: string }>()
    : null;

  const [slotRows, cameraRows, parentSlotRows, parentCameraRows] = await Promise.all([
    tenant?.organizationId
      ? db
          .prepare("SELECT slotNumber, label FROM camera_slots WHERE organizationId = ? AND url != '' ORDER BY slotNumber")
          .bind(tenant.organizationId)
          .all<{ slotNumber: number; label: string }>()
      : Promise.resolve({ results: [] as { slotNumber: number; label: string }[] }),
    db.prepare("SELECT id, name AS label FROM cameras WHERE tenant_id = ? ORDER BY created_at").bind(tenantId).all<{ id: string; label: string }>(),
    parent
      ? db
          .prepare("SELECT slotNumber, label FROM camera_slots WHERE organizationId = ? AND url != '' ORDER BY slotNumber")
          .bind(parent.organizationId)
          .all<{ slotNumber: number; label: string }>()
      : Promise.resolve({ results: [] as { slotNumber: number; label: string }[] }),
    parent
      ? db.prepare("SELECT id, name AS label FROM cameras WHERE tenant_id = ? ORDER BY created_at").bind(parent.id).all<{ id: string; label: string }>()
      : Promise.resolve({ results: [] as { id: string; label: string }[] }),
  ]);

  const candidates: Candidate[] = [
    ...slotRows.results.map((row) => ({ ref: `slot:${row.slotNumber}`, label: row.label })),
    ...cameraRows.results.map((row) => ({ ref: `cam:${row.id}`, label: row.label })),
    ...(parent
      ? [
          ...parentSlotRows.results.map((row) => ({ ref: `parent-slot:${row.slotNumber}`, label: `${parent.name} - ${row.label} (parent)` })),
          ...parentCameraRows.results.map((row) => ({ ref: `parent-cam:${row.id}`, label: `${parent.name} - ${row.label} (parent)` })),
        ]
      : []),
  ];

  const selectedRef =
    tenant?.primarySlot != null
      ? `${tenant.fromParent ? "parent-slot" : "slot"}:${tenant.primarySlot}`
      : tenant?.primaryCameraId
        ? `${tenant.fromParent ? "parent-cam" : "cam"}:${tenant.primaryCameraId}`
        : null;

  return { candidates, selectedRef };
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const result = await requirePlatformAdmin(request, env);
  if ("error" in result) return result.error;

  const tenantId = Number(params.id);
  if (!Number.isInteger(tenantId)) return jsonResponse({ error: "Invalid tenant id" }, 400);

  return jsonResponse(await loadCandidatesAndSelection(env.DB, tenantId));
};

export const onRequestPut: PagesFunction<Env> = async ({ request, env, params }) => {
  const result = await requirePlatformAdmin(request, env);
  if ("error" in result) return result.error;

  const tenantId = Number(params.id);
  if (!Number.isInteger(tenantId)) return jsonResponse({ error: "Invalid tenant id" }, 400);

  const target = await env.DB
    .prepare("SELECT id, organization_id AS organizationId, parent_tenant_id AS parentTenantId FROM tenants WHERE id = ?")
    .bind(tenantId)
    .first<{ id: number; organizationId: string | null; parentTenantId: number | null }>();
  if (!target) return jsonResponse({ error: "Tenant not found" }, 404);

  const body = (await request.json().catch(() => null)) as { ref?: unknown } | null;
  if (!body || !("ref" in body)) {
    return jsonResponse({ error: "Provide ref (\"slot:<n>\", \"cam:<id>\", \"parent-slot:<n>\" or \"parent-cam:<id>\"), or null to clear the selection" }, 400);
  }

  if (body.ref === null) {
    await env.DB
      .prepare("UPDATE tenants SET primary_camera_slot_number = NULL, primary_camera_id = NULL, primary_camera_from_parent = 0 WHERE id = ?")
      .bind(tenantId)
      .run();
    return jsonResponse(await loadCandidatesAndSelection(env.DB, tenantId));
  }

  if (typeof body.ref !== "string" || !body.ref.trim()) {
    return jsonResponse({ error: "ref must be a non-empty string, or null to clear the selection" }, 400);
  }

  if (body.ref.startsWith("parent-slot:") || body.ref.startsWith("parent-cam:")) {
    // Validated against the TARGET's actual current parent, not any ref
    // the caller supplies - a ref naming a slot/camera that happens to
    // belong to some other tenant's parent (or a tenant with no parent
    // at all) is rejected here, never trusted from the request body.
    if (!target.parentTenantId) return jsonResponse({ error: "This tenant has no parent airfield" }, 400);
    const parent = await env.DB
      .prepare("SELECT id, organization_id AS organizationId FROM tenants WHERE id = ?")
      .bind(target.parentTenantId)
      .first<{ id: number; organizationId: string }>();
    if (!parent) return jsonResponse({ error: "Parent tenant not found" }, 404);

    if (body.ref.startsWith("parent-slot:")) {
      const slotNumber = Number(body.ref.slice("parent-slot:".length));
      if (!Number.isInteger(slotNumber)) return jsonResponse({ error: "Invalid slot ref" }, 400);
      const slot = await env.DB
        .prepare("SELECT slotNumber FROM camera_slots WHERE organizationId = ? AND slotNumber = ? AND url != ''")
        .bind(parent.organizationId, slotNumber)
        .first<{ slotNumber: number }>();
      if (!slot) return jsonResponse({ error: "No configured camera found at that slot on the parent airfield" }, 404);
      await env.DB
        .prepare("UPDATE tenants SET primary_camera_slot_number = ?, primary_camera_id = NULL, primary_camera_from_parent = 1 WHERE id = ?")
        .bind(slotNumber, tenantId)
        .run();
    } else {
      const cameraId = body.ref.slice("parent-cam:".length);
      const camera = await env.DB.prepare("SELECT id FROM cameras WHERE id = ? AND tenant_id = ?").bind(cameraId, parent.id).first<{ id: string }>();
      if (!camera) return jsonResponse({ error: "No camera found with that id for the parent airfield" }, 404);
      await env.DB
        .prepare("UPDATE tenants SET primary_camera_id = ?, primary_camera_slot_number = NULL, primary_camera_from_parent = 1 WHERE id = ?")
        .bind(cameraId, tenantId)
        .run();
    }
  } else if (body.ref.startsWith("slot:")) {
    const slotNumber = Number(body.ref.slice("slot:".length));
    if (!Number.isInteger(slotNumber)) return jsonResponse({ error: "Invalid slot ref" }, 400);
    const slot = target.organizationId
      ? await env.DB
          .prepare("SELECT slotNumber FROM camera_slots WHERE organizationId = ? AND slotNumber = ? AND url != ''")
          .bind(target.organizationId, slotNumber)
          .first<{ slotNumber: number }>()
      : null;
    if (!slot) return jsonResponse({ error: "No configured camera found at that slot" }, 404);
    await env.DB
      .prepare("UPDATE tenants SET primary_camera_slot_number = ?, primary_camera_id = NULL, primary_camera_from_parent = 0 WHERE id = ?")
      .bind(slotNumber, tenantId)
      .run();
  } else if (body.ref.startsWith("cam:")) {
    const cameraId = body.ref.slice("cam:".length);
    const camera = await env.DB.prepare("SELECT id FROM cameras WHERE id = ? AND tenant_id = ?").bind(cameraId, tenantId).first<{ id: string }>();
    if (!camera) return jsonResponse({ error: "No camera found with that id for this tenant" }, 404);
    await env.DB
      .prepare("UPDATE tenants SET primary_camera_id = ?, primary_camera_slot_number = NULL, primary_camera_from_parent = 0 WHERE id = ?")
      .bind(cameraId, tenantId)
      .run();
  } else {
    return jsonResponse({ error: "ref must start with \"slot:\", \"cam:\", \"parent-slot:\" or \"parent-cam:\"" }, 400);
  }

  return jsonResponse(await loadCandidatesAndSelection(env.DB, tenantId));
};
