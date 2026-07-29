// Owner/admin/media: GET/PUT /api/tenant/gas-prices - Dashboard Manager's
// dedicated Gas Prices container (task #42): exactly 3 fixed slots
// (Avgas/UL91/Jet A1), each an independent price, plus ONE shared
// currency symbol applying to all three. Deliberately its own table/
// route (migrations/0049_gas_prices.sql) rather than a 4th field bolted
// onto ops_panel_state - see that migration's own comment for why the
// fixed-3 shape doesn't fit ops_panel_state's JSON-array-of-rows
// convention. Same role gate as tenant/carousel/index.ts (the other
// Dashboard Manager endpoint this container sits alongside).
import { requireRoles, jsonResponse, type D1Database } from "../../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

interface GasPricesRow {
  avgasPrice: number | null;
  ul91Price: number | null;
  jetA1Price: number | null;
  currency: string;
}

interface GasPricesInput {
  avgasPrice: number | null;
  ul91Price: number | null;
  jetA1Price: number | null;
  currency: string;
}

const VALID_CURRENCIES = ["£", "$", "€"];
const MAX_PRICE = 100;

function isValidPrice(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MAX_PRICE);
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requireRoles(request, env, ["owner", "admin", "media"]);
  if ("error" in result) return result.error;
  const { organizationId } = result.membership;

  const row = await env.DB
    .prepare("SELECT avgasPrice, ul91Price, jetA1Price, currency FROM gas_prices WHERE organizationId = ?")
    .bind(organizationId)
    .first<GasPricesRow>();

  return jsonResponse(
    row ?? { avgasPrice: null, ul91Price: null, jetA1Price: null, currency: "£" }
  );
};

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requireRoles(request, env, ["owner", "admin", "media"]);
  if ("error" in result) return result.error;
  const { organizationId } = result.membership;

  const body = (await request.json().catch(() => null)) as GasPricesInput | null;
  if (!body) return jsonResponse({ error: "Invalid JSON body" }, 400);

  if (!isValidPrice(body.avgasPrice) || !isValidPrice(body.ul91Price) || !isValidPrice(body.jetA1Price)) {
    return jsonResponse({ error: `each price must be a number between 0 and ${MAX_PRICE}, or null` }, 400);
  }
  if (!VALID_CURRENCIES.includes(body.currency)) {
    return jsonResponse({ error: `currency must be one of: ${VALID_CURRENCIES.join(", ")}` }, 400);
  }

  const now = new Date().toISOString();
  await env.DB
    .prepare(
      `INSERT INTO gas_prices (organizationId, avgasPrice, ul91Price, jetA1Price, currency, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(organizationId) DO UPDATE SET
         avgasPrice = excluded.avgasPrice,
         ul91Price = excluded.ul91Price,
         jetA1Price = excluded.jetA1Price,
         currency = excluded.currency,
         updatedAt = excluded.updatedAt`
    )
    .bind(organizationId, body.avgasPrice, body.ul91Price, body.jetA1Price, body.currency, now)
    .run();

  return jsonResponse({ ok: true });
};
