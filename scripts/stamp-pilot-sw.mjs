#!/usr/bin/env node
// Runs as the LAST step of `npm run build` (see package.json), after
// `vite build`. Appends the latest RELEASED version label to the BUILT
// dist/pilot-sw.js, e.g.
//
//     // pilot-release: AIRFIELD CENTRAL V1.0.20
//
// Why: the Pilot's App update box ("A new version of the app is available", or the
// automatic release update) is triggered when the browser finds that pilot-sw.js
// has different bytes (usePilotServiceWorker.ts
// asks it to re-check on open, every 6 hours and on pull-to-refresh). That file is
// otherwise a plain static file, so ordinary deploys never changed it and no
// banner could ever appear. With this stamp its bytes change ONLY when a new
// version is released in Developer Features - ordinary deploys leave it
// byte-identical (the stamp contains nothing but the label: no timestamp, no
// build id) and so never trigger an update.
//
// The label comes from src/generated/pilotVersion.ts, which
// scripts/generate-pilot-version.mjs wrote moments earlier from the same
// platform_updates query the footer version stamp uses - one source, not a second
// D1 read. public/pilot-sw.js (the source), PilotUpdateBanner, the version stamp
// and the release system are not touched; only the built copy gets the line.
//
// NEVER breaks a deploy: whatever goes wrong (no label, the placeholder label
// generate-pilot-version.mjs writes when it could not reach D1, no built file, a
// write error) this logs a clear warning, leaves pilot-sw.js as it is (unstamped)
// and still exits 0. Stamping the "V0.0.0" placeholder would be worse than not
// stamping: it would make bytes flip whenever a build could not read D1.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

// What generate-pilot-version.mjs writes when it cannot read D1 on a fresh clone.
export const PLACEHOLDER_LABEL = 'AIRFIELD CENTRAL V0.0.0'
const STAMP_PREFIX = '// pilot-release: '
// Matches a previous stamp (always the last line) so re-running replaces it
// instead of stacking a second one.
const EXISTING_STAMP = /\n\/\/ pilot-release: [^\n]*\n?$/

const log = (message) => console.log(`[stamp-pilot-sw] ${message}`)
const warn = (message) => console.warn(`[stamp-pilot-sw] WARNING: ${message}`)

// Pulls the label out of the generated file's `export const PILOT_VERSION_LABEL = "..."`.
export function parseVersionLabel(generatedSource) {
  const match = /PILOT_VERSION_LABEL\s*=\s*("(?:[^"\\]|\\.)*")/.exec(generatedSource ?? '')
  if (!match) return null
  try {
    const label = JSON.parse(match[1])
    return typeof label === 'string' && label.trim() !== '' ? label.trim() : null
  } catch {
    return null
  }
}

// Whether a label is a real released version worth stamping.
export function isStampableLabel(label) {
  return typeof label === 'string' && label.trim() !== '' && label.trim() !== PLACEHOLDER_LABEL && !/[\r\n]/.test(label)
}

// Returns the service worker source with exactly one stamp line for `label`
// (replacing any earlier one). Pure and deterministic: the same source and label
// always give the same bytes.
export function stampServiceWorkerSource(source, label) {
  const unstamped = source.replace(EXISTING_STAMP, '\n')
  const base = unstamped.endsWith('\n') ? unstamped : `${unstamped}\n`
  return `${base}${STAMP_PREFIX}${label}\n`
}

export function run({ distDir, versionFile }) {
  const swPath = resolve(distDir, 'pilot-sw.js')
  try {
    if (!existsSync(swPath)) {
      warn(`${swPath} not found - nothing to stamp. Leaving the build as it is.`)
      return 'skipped-no-file'
    }
    if (!existsSync(versionFile)) {
      warn(`${versionFile} not found - cannot tell which version is released. Leaving pilot-sw.js UNSTAMPED.`)
      return 'skipped-no-label'
    }
    const label = parseVersionLabel(readFileSync(versionFile, 'utf8'))
    if (!label) {
      warn(`could not read PILOT_VERSION_LABEL from ${versionFile}. Leaving pilot-sw.js UNSTAMPED.`)
      return 'skipped-no-label'
    }
    if (!isStampableLabel(label)) {
      warn(`the released version could not be read at build time (label is "${label}", the placeholder written when D1 was unreachable). Leaving pilot-sw.js UNSTAMPED - no update banner will be triggered by this build.`)
      return 'skipped-placeholder'
    }
    const current = readFileSync(swPath, 'utf8')
    const stamped = stampServiceWorkerSource(current, label)
    if (stamped !== current) writeFileSync(swPath, stamped)
    log(`Stamped ${swPath} with "${label}".`)
    return 'stamped'
  } catch (err) {
    warn(`could not stamp pilot-sw.js (${err?.message ?? err}). Leaving it as it is - the build continues.`)
    return 'skipped-error'
  }
}

// Only when run as a script (tests import the functions above without side effects).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const distDir = process.env.PILOT_SW_DIST_DIR ?? fileURLToPath(new URL('../dist', import.meta.url))
  const versionFile = process.env.PILOT_VERSION_FILE ?? fileURLToPath(new URL('../src/generated/pilotVersion.ts', import.meta.url))
  run({ distDir, versionFile })
  process.exit(0)
}
