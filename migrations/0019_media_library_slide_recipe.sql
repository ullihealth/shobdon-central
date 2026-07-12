-- Optional "recipe" for composer-generated slides (background + text
-- boxes) - see src/types/slideRecipe.ts. NULL for every normal photo/
-- mp4/pdf upload; only set for a media_library row created by the
-- /media-manager slide composer, so its editor can be reopened later
-- and the layout reconstructed exactly. The flattened PNG itself is
-- stored as a completely ordinary row (r2Key, mediaType='image', etc)
-- - this column is purely additional metadata, never read by the
-- public dashboard rendering path.
ALTER TABLE media_library ADD COLUMN slideRecipeJson TEXT NULL;
