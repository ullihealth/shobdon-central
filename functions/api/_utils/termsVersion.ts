// Mirrors TERMS_VERSION in src/content/legalTerms.ts - duplicated,
// deliberately, rather than imported across the functions//src boundary.
// This codebase has zero existing precedent either direction (checked
// before adding this file) - functions/ and src/ are built by two
// completely separate bundlers (wrangler's esbuild vs Vite/rolldown),
// and introducing the first-ever cross-boundary import for something as
// consequential as legal-acceptance version tracking isn't worth being
// the one untested case. Bump BOTH this value and src/content/
// legalTerms.ts's TERMS_VERSION together, in the same commit, whenever
// the legal text changes - functions/api/tenant/terms/accept.ts (what a
// user accepts) and functions/api/tenant/me.ts (what RequireAuth.tsx
// compares against to decide whether to re-prompt) both read this one.
export const TERMS_VERSION = "1.0";
