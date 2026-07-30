-- Global, NOT tenant-scoped IP directory - deliberately separate from
-- tenant_known_devices (migration 0056), which is a narrower "counts
-- toward THIS tenant's uptime %" confirmation. This table is a plain
-- annotation layer over ANY IP Jeff recognizes (his own machine, a VPN,
-- a specific tenant's real display) so the Visit Log can be filtered
-- down to "stuff I haven't identified yet" regardless of which tenant
-- it appeared under - the same IP showing up across multiple tenants
-- (a real, observed case: 185.69.144.84 appears under both Shobdon and
-- GyroPlane Train) is exactly the kind of thing a per-tenant table
-- can't represent but this one can.
--
-- One IP -> one group_name (UNIQUE ip_address) - re-labeling an
-- already-labeled IP overwrites its group, it doesn't create a second
-- label. Many IPs CAN share the same group_name (e.g. Jeff's machine
-- getting a new IP over time still labels as "Jeff's Mac") - that's
-- just group_name repeating across rows, not a separate join table,
-- since there's no need to rename/manage groups as first-class objects
-- beyond "what string did I type last time" (surfaced via a plain
-- SELECT DISTINCT group_name for the label input's autocomplete).
CREATE TABLE ip_labels (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ip_address    TEXT NOT NULL UNIQUE,
  group_name    TEXT NOT NULL,
  note          TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

-- Backs both the Visit Log's per-row label lookup (by ip_address, via
-- the UNIQUE constraint's own index) and the IP Directory page's
-- grouped listing.
CREATE INDEX idx_ip_labels_group_name ON ip_labels(group_name);
