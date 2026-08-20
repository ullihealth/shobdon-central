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
    .prepare("SELECT organization_id AS organizationId, primary_camera_slot_number AS primarySlot, primary_camera_id AS primaryCameraId FROM tenants WHERE id = ?")
    .bind(tenantId)
    .first<{ organizationId: string | null; primarySlot: number | null; primaryCameraId: string | null }>();

  const [slotRows, cameraRows] = await Promise.all([
    tenant?.organizationId
      ? db
          .prepare("SELECT slotNumber, label FROM camera_slots WHERE organizationId = ? AND url != '' ORDER BY slotNumber")
          .bind(tenant.organizationId)
          .all<{ slotNumber: number; label: string }>()
      : Promise.resolve({ results: [] as { slotNumber: number; label: string }[] }),
    db.prepare("SELECT id, name AS label FROM cameras WHERE tenant_id = ? ORDER BY created_at").bind(tenantId).all<{ id: string; label: string }>(),
  ]);

  const candidates: Candidate[] = [
    ...slotRows.results.map((row) => ({ ref: `slot:${row.slotNumber}`, label: row.label })),
    ...cameraRows.results.map((row) => ({ ref: `cam:${row.id}`, label: row.label })),
  ];

  const selectedRef = tenant?.primarySlot != null ? `slot:${tenant.primarySlot}` : tenant?.primaryCameraId ? `cam:${tenant.primaryCameraId}` : null;

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

  const target = await env.DB.prepare("SELECT id, organization_id AS organizationId FROM tenants WHERE id = ?").bind(tenantId).first<{ id: number; organizationId: string | null }>();
  if (!target) return jsonResponse({ error: "Tenant not found" }, 404);

  const body = (await request.json().catch(() => null)) as { ref?: unknown } | null;
  if (!body || !("ref" in body)) {
    return jsonResponse({ error: "Provide ref (\"slot:<n>\" or \"cam:<id>\"), or null to clear the selection" }, 400);
  }

  if (body.ref === null) {
    await env.DB.prepare("UPDATE tenants SET primary_camera_slot_number = NULL, primary_camera_id = NULL WHERE id = ?").bind(tenantId).run();
    return jsonResponse(await loadCandidatesAndSelection(env.DB, tenantId));
  }

  if (typeof body.ref !== "string" || !body.ref.trim()) {
    return jsonResponse({ error: "ref must be a non-empty string, or null to clear the selection" }, 400);
  }

  if (body.ref.startsWith("slot:")) {
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
      .prepare("UPDATE tenants SET primary_camera_slot_number = ?, primary_camera_id = NULL WHERE id = ?")
      .bind(slotNumber, tenantId)
      .run();
  } else if (body.ref.startsWith("cam:")) {
    const cameraId = body.ref.slice("cam:".length);
    const camera = await env.DB.prepare("SELECT id FROM cameras WHERE id = ? AND tenant_id = ?").bind(cameraId, tenantId).first<{ id: string }>();
    if (!camera) return jsonResponse({ error: "No camera found with that id for this tenant" }, 404);
    await env.DB
      .prepare("UPDATE tenants SET primary_camera_id = ?, primary_camera_slot_number = NULL WHERE id = ?")
      .bind(cameraId, tenantId)
      .run();
  } else {
    return jsonResponse({ error: "ref must start with \"slot:\" or \"cam:\"" }, 400);
  }

  return jsonResponse(await loadCandidatesAndSelection(env.DB, tenantId));
};
