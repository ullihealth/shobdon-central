// Which dashboard templates exist and whether each is selectable yet -
// a frontend-only constant (this is a code-level fact, not tenant data;
// the tenant's own CURRENT SELECTION lives in tenant_displays.template_id,
// already-existing infrastructure, not duplicated here). 'classic' (not
// a new 'clubhouse-1' string) stays the stored id for Template 1 -
// avoids any data migration/rename risk against Shobdon/Demo's existing
// tenant_displays rows. Café slots render disabled regardless of
// CafeTvTemplate.tsx already existing in code - entitlement/trial-access
// gating for Café is a separate, later piece of work.
export interface TemplateSlot {
  id: string
  label: string
  category: 'clubhouse' | 'cafe'
  status: 'available' | 'coming-soon'
}

export const TEMPLATE_SLOTS: TemplateSlot[] = [
  { id: 'classic', label: 'Clubhouse Template 1', category: 'clubhouse', status: 'available' },
  { id: 'clubhouse-2', label: 'Clubhouse Template 2', category: 'clubhouse', status: 'available' },
  { id: 'clubhouse-3', label: 'Clubhouse Template 3', category: 'clubhouse', status: 'coming-soon' },
  // 'cafe-1' is the flexible split/full + ticker template
  // (CafeTemplate.tsx). The older, simpler CafeTvTemplate.tsx was
  // retired in migration 0034 - Shobdon's existing named /d/cafe-tv
  // display now also renders this same 'cafe-1' template
  // (TenantDisplayPage.tsx), gated by that display's own entitlement,
  // independent of whether a tenant has picked 'cafe-1' here for their
  // main '/' dashboard too. Opt-in the same way clubhouse-2 was:
  // selectable via this tile, off by default for every tenant.
  { id: 'cafe-1', label: 'Café Template 1', category: 'cafe', status: 'available' },
  { id: 'cafe-2', label: 'Café Template 2', category: 'cafe', status: 'coming-soon' },
]
