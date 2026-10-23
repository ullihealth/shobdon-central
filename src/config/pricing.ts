// Single source of truth for the 3 paid plans' DISPLAY pricing/copy -
// Stripe groundwork (Part A). Every price shown anywhere in the app
// (LandingPage.tsx's Pricing section, PlatformTenantsPage.tsx's settings
// cards, the paid signup form's plan picker) reads from this one object
// instead of being typed out separately in each place - was 3 independent
// hardcoded strings before this round (confirmed via investigation), with
// the Pilot's App figure already stale (£19.99, pre-reprice) in one of
// them.
//
// Deliberately NOT imported by any functions/ file - this is DISPLAY
// copy only (what a human reads). The server-side plan id -> Stripe
// price env var mapping is a separate, small thing that already lives in
// functions/api/stripe/webhook.ts (productForPriceId) and this round's
// new functions/api/stripe/checkout.ts - duplicating that one small
// mapping there matches this codebase's own established functions/src
// boundary convention (see e.g. BrandDisplaySettings, CarouselSlotEditor
// vs the 4 server-side copies of its own shape) rather than reaching
// across it for a few lines.
//
// priceEnvKey is documentation only here (which env var ultimately
// decides the REAL price at Stripe) - this file never reads env itself,
// it's a plain src/ module with no access to Worker bindings.
export type PlanId = "pilotApp" | "pack" | "mediaScreen";

export interface PricingPlan {
  id: PlanId;
  name: string;
  priceGBP: number;
  priceEnvKey: string;
  description: string;
  // Only 'pack' is true - the one plan highlighted as the recommended,
  // best-value combo (go-ahead's own instruction).
  highlighted: boolean;
  // Media Screen's own "requires the Pack" rule (unchanged, per the
  // go-ahead's explicit instruction not to touch it) - true only there.
  // Used to keep it out of the new-tenant paid-signup plan picker (a
  // brand-new tenant can't already have the Pack) and to label it as an
  // add-on on the pricing page.
  requiresPack: boolean;
}

export const PRICING_PLANS: PricingPlan[] = [
  {
    id: "pack",
    name: "Airfield Pack",
    priceGBP: 44.0,
    priceEnvKey: "STRIPE_PRICE_PACK",
    description:
      "The Reception Dashboard for your clubhouse screen, plus the Pilot's App - a branded mobile app for members, students and visiting pilots, installable on their phone straight from the browser.",
    highlighted: true,
    requiresPack: false,
  },
  {
    id: "pilotApp",
    name: "Pilot's App",
    priceGBP: 29.99,
    priceEnvKey: "STRIPE_PRICE_PILOT_APP",
    description: "Just the branded mobile app for members and visiting pilots, without the clubhouse screen.",
    highlighted: false,
    requiresPack: false,
  },
  {
    id: "mediaScreen",
    name: "Media Screen",
    priceGBP: 29.99,
    priceEnvKey: "STRIPE_PRICE_MEDIA_SCREEN",
    description:
      "A full-screen advertising display for cafés and similar venues, with an advertising revenue split on slots sold. Add-on - requires the Airfield Pack.",
    highlighted: false,
    requiresPack: true,
  },
]

export function findPricingPlan(id: PlanId): PricingPlan | undefined {
  return PRICING_PLANS.find((plan) => plan.id === id)
}

export function formatGBP(amount: number): string {
  return `£${amount.toFixed(2).replace(/\.00$/, '')}`
}

// Go-ahead's own figure - Pack (£44) vs buying Pilot's App + Media
// Screen separately at £29.99 each (£59.98) - the anchor comparison
// Jeff asked for, not independently re-derived here.
export const PACK_SAVINGS_GBP = 15.98

// Legal/commercial terms line for the pricing section (go-ahead's own
// wording) - monthly billing, 3-month minimum then rolling, 30 days'
// notice to cancel, VAT-exclusive, no free trial on the paid plans
// (distinct from the separate, still-live trial_signups flow - see
// LandingPage.tsx's own comment on why both exist side by side).
export const PRICING_TERMS_LINE =
  "Billed monthly. 3-month minimum term, then rolling monthly with 30 days' notice to cancel. Prices exclude VAT. No free trial."
