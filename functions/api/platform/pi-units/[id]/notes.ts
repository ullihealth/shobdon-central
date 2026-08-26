// Platform-admin only: POST /api/platform/pi-units/:id/notes - append one
// timestamped entry to a Pi unit's notes log (migration 0098,
// pi_unit_notes). Append-only by design, same as subscription_history -
// there is deliberately no PATCH/DELETE here or anywhere else for this
// table, in this file or the UI. A correction is a new note, never an
// edit to a prior one - see the migration's own comment.
import { requirePlatformAdmin, jsonResponse, type D1Database } from "../../../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
  params: Record<string, string>;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

interface CreateNoteBody {
  noteText?: string;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const result = await requirePlatformAdmin(request, env);
  if ("error" in result) return result.error;

  const unitId = Number(params.id);
  if (!Number.isFinite(unitId)) return jsonResponse({ error: "Invalid unit id" }, 400);

  const body = await request.json<CreateNoteBody>().catch(() => null);
  const noteText = body?.noteText?.trim();
  if (!noteText) return jsonResponse({ error: "noteText is required" }, 400);

  const unit = await env.DB.prepare("SELECT id FROM pi_units WHERE id = ?").bind(unitId).first<{ id: number }>();
  if (!unit) return jsonResponse({ error: "Pi unit not found" }, 404);

  const now = new Date().toISOString();
  await env.DB
    .prepare("INSERT INTO pi_unit_notes (pi_unit_id, note_text, created_at) VALUES (?, ?, ?)")
    .bind(unitId, noteText, now)
    .run();

  // updated_at bump so the unit surfaces near the top of the list's own
  // "most recently touched" ordering (index.ts's GET sorts by
  // updated_at DESC) when a note is added, even if no other field
  // changed - a new note IS an update to the unit's own record, in the
  // sense that matters for "what have I touched recently".
  await env.DB.prepare("UPDATE pi_units SET updated_at = ? WHERE id = ?").bind(now, unitId).run();

  const { results: notes } = await env.DB
    .prepare(
      `SELECT id, note_text AS noteText, created_at AS createdAt
       FROM pi_unit_notes WHERE pi_unit_id = ? ORDER BY created_at DESC`
    )
    .bind(unitId)
    .all<{ id: number; noteText: string; createdAt: string }>();

  return jsonResponse({ notes }, 201);
};
