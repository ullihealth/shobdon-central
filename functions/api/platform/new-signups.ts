// Platform-admin only: GET/POST /api/platform/new-signups - Stripe
// groundwork Part F. Simplest option first, per the go-ahead: a count +
// list on /platform/tenants, sourced from subscription_history (already
// written by functions/api/stripe/webhook.ts's own checkout.session.
// completed handler, see that file's "Stripe: checkout completed for
// ${product}." note), not a new table and not email (no provider is
// wired - see this round's own investigation).
//
// GET returns every tenant whose EARLIEST "checkout completed" history
// row is newer than max(7 days ago, the stored dismissal timestamp) -
// "since I last dismissed it" from the go-ahead overrides the fixed
// 7-day window once a dismissal exists, rather than the two competing
// independently (a dismissal from 3 days ago should hide everything
// before it, not just everything older than 7 days).
import { requirePlatformAdmin, jsonResponse, type D1Database } from "../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: { request: Request; env: Env }) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

const SETTING_KEY = "new_signups_dismissed_at";
const WINDOW_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

interface NewSignupRow {
  tenantId: number;
  name: string;
  slug: string;
  firstCheckoutAt: string;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requirePlatformAdmin(request, env);
  if ("error" in result) return result.error;

  const dismissedRow = await env.DB.prepare("SELECT value FROM platform_settings WHERE key = ?").bind(SETTING_KEY).first<{ value: string }>();
  const windowStart = new Date(Date.now() - WINDOW_DAYS * DAY_MS).toISOString();
  const cutoff = dismissedRow?.value && dismissedRow.value > windowStart ? dismissedRow.value : windowStart;

  const { results } = await env.DB
    .prepare(
      `SELECT t.id AS tenantId, t.name AS name, t.slug AS slug, MIN(sh.changed_at) AS firstCheckoutAt
       FROM subscription_history sh
       JOIN tenants t ON t.id = sh.tenant_id
       WHERE sh.note LIKE 'Stripe: checkout completed%'
       GROUP BY sh.tenant_id
       HAVING firstCheckoutAt > ?
       ORDER BY firstCheckoutAt DESC`
    )
    .bind(cutoff)
    .all<NewSignupRow>();

  return jsonResponse({ count: results.length, signups: results });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requirePlatformAdmin(request, env);
  if ("error" in result) return result.error;

  const now = new Date().toISOString();
  await env.DB
    .prepare(
      `INSERT INTO platform_settings (key, value, updatedAt) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt`
    )
    .bind(SETTING_KEY, now, now)
    .run();

  return jsonResponse({ ok: true });
};
