-- Per-slot "auto-expand when active" flag - when true, this slot
-- renders as a full-viewport overlay for the duration it's active in
-- the carousel rotation, then reverts to the normal in-flow box the
-- moment rotation moves to the next slot, repeating every cycle.
-- Admin-configured (Media Manager's CarouselSlotEditor), not a live-
-- viewer click on the unattended kiosk display itself - this dashboard
-- has no one present to click anything (see this project's own
-- established "nothing dismissible or attention-grabbing" posture for
-- unattended venue displays). A persisted per-slot flag also survives
-- the display's own periodic reload (RemoteRefreshWatcher.tsx), unlike
-- session-only click state, which is what "remembered every cycle"
-- actually requires.
ALTER TABLE carousel_slots ADD COLUMN autoFullscreen INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cafe_carousel_slots ADD COLUMN autoFullscreen INTEGER NOT NULL DEFAULT 0;
