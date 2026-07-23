-- Per-display visit log - answers "was this screen actually showing
-- the dashboard at 9am" and "what IPs have hit this URL recently",
-- neither of which a single overwritten last-seen timestamp could
-- answer. One row per LOGGED visit, not per heartbeat ping - the
-- heartbeat endpoint (functions/api/public/heartbeat.ts) only inserts
-- when the IP/user-agent changed or ~20 minutes have passed since the
-- last row for that tenant+slug, so a continuously-running kiosk on
-- one IP costs roughly one row every ~20 minutes, not one per 2-5
-- minute ping - see that file's own comment for the exact dedup logic.
--
-- No FK on display_slug (unlike tenant_id) - tenant_displays rows can
-- be created/renamed independently of this log, and a visit for a
-- since-renamed/deleted display slug should still show up in history
-- rather than being blocked by a constraint or silently orphaned.
--
-- Personal data note (ip_address, user_agent): logging these is
-- personal data under UK GDPR even for this internal ops purpose - see
-- migration 0042's own privacy-notice text addition, and the
-- prune-on-write pruning in heartbeat.ts (30-day default retention)
-- this table relies on to keep that data bounded, not indefinite.
CREATE TABLE display_visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  display_slug TEXT NOT NULL,
  visited_at TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

-- Backs both the heartbeat's own "find the last row for this tenant+
-- slug" dedup check and the /platform/visits viewer's per-tenant/
-- per-display, most-recent-first listing - the same three columns
-- both queries filter/sort by.
CREATE INDEX idx_display_visits_tenant_slug_time ON display_visits(tenant_id, display_slug, visited_at);
