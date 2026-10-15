// Public, UNAUTHENTICATED listing of eligible Parent Airfields - GET
// /api/public/parent-airfields. Landing-page signup round: replaces the
// old free-text "Parent airfield slug" field (which accepted ANY slug,
// including demo/newcustomer) with a dropdown built from this list.
// Deliberately returns ONLY id + name - no lat/lon, no slug, no other
// tenant data - this is a public, unauthenticated endpoint, and a
// prospective customer's browser has no business seeing more than "which
// airfields exist to link to and what are they called." Eligibility
// itself (and the validation signup.ts runs against the exact same list)
// lives in the shared _utils/eligibleParents.ts helper - see that file's
// own comment for why the set is data-driven, not a hardcoded blocklist.
import { getEligibleParentTenants } from "../_utils/eligibleParents";
import { jsonResponse, type D1Database } from "../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: { request: Request; env: Env }) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const eligible = await getEligibleParentTenants(env.DB);
  return jsonResponse({
    parents: eligible.map((tenant) => ({ id: tenant.id, name: tenant.name })),
  });
};
