-- Range labels for the Visit Log: label an IP PREFIX once (e.g. "187.40.50."
-- or "2a00:d203:85fc:0:") and every matching address - including future ones -
-- picks up that label. Separate from ip_labels (migration 0057), which stays
-- exactly as it is: one exact IP -> one group, and an exact label always wins
-- over a range label.
--
-- prefix is stored NORMALISED with a trailing separator ("187.40.50." /
-- "2a00:d203:85fc:0:") so "187.40.5." can never match 187.40.50.x. IPv4 has 2
-- or 3 octets, IPv6 1 to 4 groups (validated by the API, not here). Where
-- ranges overlap the longest prefix wins. Matching is a plain
-- `ip_address LIKE prefix || '%'` - safe because a normalised prefix contains
-- only digits, hex letters, '.' and ':' (never a LIKE wildcard).
--
-- group_name is a free-text label group, same vocabulary as
-- ip_labels.group_name (a range joins an existing group by using its name).
-- Additive table only; no data is created or changed.
--
-- DEPLOY ORDER: apply this migration BEFORE deploying the code - the Visit Log
-- routes join this table.
CREATE TABLE ip_range_labels (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  prefix      TEXT NOT NULL UNIQUE,
  group_name  TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
