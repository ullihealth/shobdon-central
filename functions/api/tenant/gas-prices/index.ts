// Owner/admin/media: GET/PUT /api/tenant/gas-prices - Dashboard Manager's
// dedicated Gas Prices container (task #42): exactly 3 fixed slots
// (Avgas/UL91/Jet A1), each an independent price, plus ONE shared
// currency symbol applying to all three. Deliberately its own table/
// route (migrations/0049_gas_prices.sql) rather than a 4th field bolted
// onto ops_panel_state - see that migration's own comment for why the
// fixed-3 shape doesn't fit ops_panel_state's JSON-array-of-rows
// convention. Same role gate as tenant/carousel/index.ts (the other
// Dashboard Manager endpoint this container sits alongside).
//
// fuelPricesEnabled (migration 0112, Tiger Helicopters round) lives on
// `tenants`, not `gas_prices` - it gates whether the panel shows AT ALL
// (own prices or an inherited weather-parent's), independent of whatever
// price data exists. Bundled into this same GET/PUT rather than a
// separate route since it's edited right alongside the prices it
// controls, in the same container.
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
  // Tiger Helicopters round (migration 0112) - a separate, tenants-table
  // flag, not part of the gas_prices row itself: lets a tenant hide the
  // Fuel Prices panel entirely regardless of what price data (its own or
  // inherited from a weather-parent, see that migration's own comment)
  // would otherwise be shown. Optional on input - omitted leaves the
  // existing value untouched, same posture ops-panel/index.ts's own
  // partial-PATCH-shaped fields take, so a client built before this
  // field existed can't accidentally reset it.
  fuelPricesEnabled?: boolean;
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

  const [row, tenantRow] = await Promise.all([
    env.DB
      .prepare("SELECT avgasPrice, ul91Price, jetA1Price, currency FROM gas_prices WHERE organizationId = ?")
      .bind(organizationId)
      .first<GasPricesRow>(),
    env.DB
      .prepare("SELECT fuel_prices_enabled AS fuelPricesEnabled FROM tenants WHERE organization_id = ?")
      .bind(organizationId)
      .first<{ fuelPricesEnabled: number }>(),
  ]);

  return jsonResponse({
    ...(row ?? { avgasPrice: null, ul91Price: null, jetA1Price: null, currency: "£" }),
    fuelPricesEnabled: tenantRow ? !!tenantRow.fuelPricesEnabled : true,
  });
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

  if (body.fuelPricesEnabled !== undefined && typeof body.fuelPricesEnabled !== "boolean") {
    return jsonResponse({ error: "fuelPricesEnabled must be a boolean" }, 400);
  }

  const now = new Date().toISOString();
  const writes: Promise<unknown>[] = [
    env.DB
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
      .run(),
  ];
  if (body.fuelPricesEnabled !== undefined) {
    writes.push(
      env.DB
        .prepare("UPDATE tenants SET fuel_prices_enabled = ? WHERE organization_id = ?")
        .bind(body.fuelPricesEnabled ? 1 : 0, organizationId)
        .run()
    );
  }
  await Promise.all(writes);

  return jsonResponse({ ok: true });
};
