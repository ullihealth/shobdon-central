import packageJson from '../../package.json'

// Single source of truth for the version stamp shown in /pilot's footer
// (PilotFooterTicker's own sibling in PilotViewPage.tsx) - bump
// package.json's own "version" field per release, nothing else needs
// touching. resolveJsonModule is already on in tsconfig.json, so this
// import is a genuine build-time read of the same package.json npm/CI
// already treats as canonical, not a second hand-maintained copy of the
// version number that could drift out of sync with it.
export const APP_VERSION = packageJson.version

// "AIRFIELD CENTRAL V0.1.0" - the exact literal format requested for
// the footer stamp. Not exported as a template elsewhere in the app
// (only PilotFooterTicker's own footer area uses this today), but
// centralised here rather than string-built inline at the call site so
// a second caller later reads the exact same label instead of a
// hand-copied near-duplicate.
export const APP_VERSION_LABEL = `AIRFIELD CENTRAL V${APP_VERSION}`
