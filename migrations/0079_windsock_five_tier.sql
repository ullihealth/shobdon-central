-- 5-tier windsock system (5 images) replacing the old 2-threshold/3-image
-- one (migration 0073). Old windsock_full_kt/windsock_medium_kt dropped
-- outright rather than renamed - checked production first: every tenant
-- (Shobdon included) is still on the untouched seed defaults (15/6), so
-- there's nothing customized to carry forward, and a clean 4-column add
-- avoids any ambiguity about what a renamed-but-reinterpreted value would
-- mean going forward.
--
-- bandNKt = the crosswind speed (kt) at/above which windsock-N.png shows
-- instead of windsock-(N-1).png; windsock-1.png itself has no threshold
-- of its own (it's simply "below band2Kt"), same shape as the old
-- system's windsock-drooped-below-mediumKt default state. Defaults match
-- the specified bands: 0-3/3-7/7-11/11-15/15+.
ALTER TABLE tenants DROP COLUMN windsock_full_kt;
ALTER TABLE tenants DROP COLUMN windsock_medium_kt;

ALTER TABLE tenants ADD COLUMN windsock_band2_kt INTEGER NOT NULL DEFAULT 3;
ALTER TABLE tenants ADD COLUMN windsock_band3_kt INTEGER NOT NULL DEFAULT 7;
ALTER TABLE tenants ADD COLUMN windsock_band4_kt INTEGER NOT NULL DEFAULT 11;
ALTER TABLE tenants ADD COLUMN windsock_band5_kt INTEGER NOT NULL DEFAULT 15;
