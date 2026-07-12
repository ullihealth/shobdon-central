-- Non-destructive per-slot appearance metadata for carousel slots:
-- crop (as a percentage sub-rect of the source), rotation, brightness,
-- and an optional footer banner. All applied via CSS at render time in
-- MediaSlotRenderer.tsx (shared by MediaManagerPage.tsx's live preview
-- and MediaPanel.tsx's live dashboard) - the original uploaded file in
-- R2 is never touched or re-encoded.
--
-- Crop defaults to the full image (0,0,100,100) rather than nullable,
-- so "no crop" and "explicit full-image crop" are the same value -
-- consistent with fitMode's NOT NULL DEFAULT pattern (migration 0017).
-- Same reasoning for rotationDegrees=0 and brightnessPercent=100 - both
-- are literal identity values, not sentinels needing NULL handling.
-- bannerText defaults to '' (not NULL) since "no banner" is exactly
-- "nothing to render", checked via a simple truthiness/length check.
ALTER TABLE carousel_slots ADD COLUMN cropX REAL NOT NULL DEFAULT 0;
ALTER TABLE carousel_slots ADD COLUMN cropY REAL NOT NULL DEFAULT 0;
ALTER TABLE carousel_slots ADD COLUMN cropWidth REAL NOT NULL DEFAULT 100;
ALTER TABLE carousel_slots ADD COLUMN cropHeight REAL NOT NULL DEFAULT 100;
ALTER TABLE carousel_slots ADD COLUMN rotationDegrees REAL NOT NULL DEFAULT 0;
ALTER TABLE carousel_slots ADD COLUMN brightnessPercent REAL NOT NULL DEFAULT 100;
ALTER TABLE carousel_slots ADD COLUMN bannerText TEXT NOT NULL DEFAULT '';
ALTER TABLE carousel_slots ADD COLUMN bannerOpacity REAL NOT NULL DEFAULT 70;
ALTER TABLE carousel_slots ADD COLUMN bannerFontSize TEXT NOT NULL DEFAULT 'md';
