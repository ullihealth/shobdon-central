-- Item 3 (this round): a short, factual note about display-visit access
-- logs (migration 0041's display_visits table + heartbeat.ts), appended
-- to the existing global Privacy Policy text (onboarding_content,
-- migration 0032). Not a schema change - a content addition, appended to
-- whatever privacy_text currently holds rather than overwriting it, so
-- this doesn't clobber any editing Jeff has already done via
-- /platform/onboarding-content. Kept deliberately brief - Jeff can edit
-- or reword it like any other part of this text via that same page.
UPDATE onboarding_content
SET privacy_text = privacy_text || '

Access Logs & Monitoring
When a dashboard display is viewed, we log the timestamp, IP address, and browser/device identifier (user-agent) for service-monitoring purposes. These records are kept for up to 30 days and then automatically deleted.',
    updated_at = datetime('now')
WHERE id = 1;
