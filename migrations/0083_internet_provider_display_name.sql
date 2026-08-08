-- Per-tenant override for how the Open-Meteo internet-weather source is
-- named in the UI (WeatherStatusIndicator.tsx's fallback badge AND its
-- manual-Internet-Weather-selected badge, InternetWeatherConfigSection.tsx's
-- provider dropdown option text - all three read this same one value).
-- NULL means "no override, show the generic 'Open-Meteo' name" - every
-- tenant except the two below.
--
-- Not branding: Open-Meteo's own UK data is itself Met Office-sourced,
-- so for a tenant whose weather setup is tied to Shobdon's own ATC/PC2
-- station - Shobdon itself, and GyroPlane Train, which shares that same
-- infrastructure - "Met-Office" is the factually accurate name for
-- where this data actually comes from, not a marketing choice. Any
-- future tenant linked the same way should get the same override.
--
-- Developer-set only via direct D1 update on request, same posture as
-- arrow_tailwind_kt/arrow_crosswind_kt/arrow_headwind_kt (migration
-- 0081) - no self-service admin UI, since a tenant being able to claim
-- "Met-Office" regardless of whether that's actually true for their own
-- data would misrepresent the real source.
ALTER TABLE tenants ADD COLUMN internet_provider_display_name TEXT;

UPDATE tenants SET internet_provider_display_name = 'Met-Office' WHERE slug IN ('shobdon', 'gyroplane');
