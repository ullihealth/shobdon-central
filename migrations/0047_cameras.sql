-- Outdoor tenant cameras (RTSP -> local relay -> optional YouTube push),
-- additive only. Deliberately separate from the existing camera_slots
-- table (migration 0004: 3 fixed webcam-URL slots, already wired into
-- the carousel/DesignPage) rather than folding into it - camera_slots
-- keeps its existing generic "any embeddable URL" role unchanged; this
-- is a new, independent system for the richer RTSP/relay/push case,
-- with its own dedicated dashboard panel. See MD FILES/Shobdon-Central-
-- Decisions.md for the fuller reasoning if this ever needs revisiting.

-- One row per physical relay device (go2rtc/MediaMTX, admin-run, one per
-- site/building). local_base_url is the relay's OWN address on the
-- tenant's local network (e.g. http://192.168.1.50:1984) - this is what
-- a viewer's browser embeds directly for local-mode playback; it is
-- never reachable from the public internet, matching the relay's own
-- behind-NAT posture. id is a short admin-chosen slug (e.g.
-- "shobdon-main"), not a UUID - it doubles as the poll URL's path
-- segment (GET /api/relay/:site_relay_id/state), so a readable value
-- makes that URL sane to type into a relay's own config by hand.
CREATE TABLE site_relays (
    id              TEXT PRIMARY KEY,
    tenant_id       INTEGER NOT NULL REFERENCES tenants(id),
    label           TEXT NOT NULL,
    local_base_url  TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_site_relays_tenant ON site_relays(tenant_id);

-- rtsp_address is the camera's own local-network address (e.g.
-- rtsp://user:pass@192.168.1.60:554/stream1) - read only by the relay
-- poll endpoint (functions/api/relay/[siteRelayId]/state.ts), which is
-- authenticated via the existing tenant_api_keys system (migration
-- 0029), NEVER by any browser-facing route. The YouTube RTMP ingest
-- URL + stream key are deliberately NOT columns here at all - per the
-- original spec, that lives purely in the relay's own local config,
-- matched by this row's id, and never touches D1/Cloudflare.
-- youtube_video_id is the public *viewing* id (https://youtube.com/embed/<id>),
-- a completely different, non-secret value from the RTMP ingest key
-- used to publish to it - safe to serve from the public dashboard.
--
-- push_enabled is the single piece of desired state the relay polls
-- for: true means "the relay should currently be pushing this camera's
-- feed to YouTube", false means "should not be". The relay is
-- responsible for reconciling its own actual push state against this
-- flag on each poll (start/stop/no-op) - this table only ever records
-- desired state, never actual state, matching the existing PC2
-- capture pattern's "device polls out, nothing reaches in" shape.
CREATE TABLE cameras (
    id                TEXT PRIMARY KEY,
    tenant_id         INTEGER NOT NULL REFERENCES tenants(id),
    site_relay_id     TEXT NOT NULL REFERENCES site_relays(id),
    name              TEXT NOT NULL,
    mode              TEXT NOT NULL CHECK (mode IN ('local', 'stream', 'both')),
    rtsp_address      TEXT,
    youtube_video_id  TEXT,
    push_enabled      INTEGER NOT NULL DEFAULT 0,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_cameras_tenant ON cameras(tenant_id);
CREATE INDEX idx_cameras_site_relay ON cameras(site_relay_id);
