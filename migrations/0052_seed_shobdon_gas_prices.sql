-- Shobdon's real gas prices, same tenant-specific seed-via-migration
-- precedent as 0005_seed_shobdon.sql - so the moment this merges and
-- runs on production, Shobdon already shows correct real prices
-- without Jeff needing to re-enter them manually after go-live.
-- Upsert (not a bare INSERT) since a row may already exist here from
-- preview-review testing (placeholder values entered directly into the
-- preview UI, e.g. £1.63/£1.87/£1.98) - this replaces whatever's there
-- with the real figures either way, on both a fresh production row and
-- an already-tested preview one. Currency stored as the literal symbol
-- '£' (GBP), matching gas_prices.currency's existing convention - see
-- migration 0049's own comment on why a symbol, not an ISO code.
INSERT INTO gas_prices (organizationId, avgasPrice, ul91Price, jetA1Price, currency, updatedAt)
VALUES ('org_shobdon', 2.24, 2.60, 1.55, '£', '2026-07-29T00:00:00.000Z')
ON CONFLICT(organizationId) DO UPDATE SET
  avgasPrice = excluded.avgasPrice,
  ul91Price = excluded.ul91Price,
  jetA1Price = excluded.jetA1Price,
  currency = excluded.currency,
  updatedAt = excluded.updatedAt;
