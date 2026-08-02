// Shared by every '/' or '/d/:slug' display template (Clubhouse1Template,
// Clubhouse2Template, ClassicTemplate, CafeTemplate) as their outer
// screen-edge inset, AND by the footer ticker's own overlay positioning
// (FooterTicker.tsx, CafeTemplate.tsx's inline ticker) to break back OUT
// past that exact inset to the true screen edge (negative offset equal
// to the padding). One shared constant so the four templates' padding
// and the ticker's break-out offset can never drift out of sync with
// each other - a template changing this value automatically keeps its
// ticker's edge-to-edge behaviour correct with zero extra changes.
export const TEMPLATE_EDGE_PADDING = 'clamp(12px, 3vmin, 48px)'
