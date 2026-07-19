import { useEffect, useState } from 'react'
import { REFRESH_TRIGGER_URL } from '../config/captureEndpoint'
import { TENANT_CONFIG_URL } from '../config/publicApi'
import type { RunwayGroup } from '../types/clubProfile'
import RunwayStripPreview from '../components/RunwayStripPreview'

const MAX_GROUPS = 3

// Matches Shobdon's seeded strip width/length - used both for brand-new
// groups (so they render a visible, sensible-looking strip immediately)
// and as the fallback if an admin clears the corresponding field entirely.
const DEFAULT_STRIP_WIDTH_PX = 22
const DEFAULT_STRIP_LENGTH_PX = 216
const DEFAULT_IDENTIFIER_FONT_SIZE_PX = 14

type ApplyStatus = 'idle' | 'working' | 'success' | 'error'

// The end opposite endAIdentifier's heading - shown in that field's own
// label so it's self-evidently "the other end", grounded in a number the
// admin can check against the real runway, not an implicit position
// convention (which is exactly what made the old single "label" text
// field ambiguous: nothing in the UI said which half of "08/26" applied
// to which physical end).
function reciprocalHeading(headingDegrees: number): number {
  return ((headingDegrees % 360) + 360 + 180) % 360
}

function createBlankGroup(): RunwayGroup {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    endAIdentifier: '',
    endBIdentifier: '',
    headingDegrees: 0,
    twin: false,
    strips: [{ colour: '#a8b4c4', widthPx: DEFAULT_STRIP_WIDTH_PX, hasThresholdMarkings: false, showIdentifierLabel: true, showCenterline: true }],
    stripLengthPx: DEFAULT_STRIP_LENGTH_PX,
    identifierFontSizePx: DEFAULT_IDENTIFIER_FONT_SIZE_PX,
  }
}

export default function RunwaysPage(): JSX.Element {
  const [loading, setLoading] = useState(true)
  const [groups, setGroups] = useState<RunwayGroup[]>([])
  const [applyStatus, setApplyStatus] = useState<ApplyStatus>('idle')
  // Which runway's form/preview is currently shown - the dropdown
  // selector replaces the old "stack every runway's full form vertically"
  // layout, so only one group is ever rendered for editing at a time.
  const [selectedIndex, setSelectedIndex] = useState(0)

  // Real D1-backed read (functions/api/tenant/config.ts, the same route
  // /design already uses) - was a synchronous loadClubProfile()
  // (localStorage) read, which is why runway edits never reached the live
  // dashboard: CompassPanel.tsx has always read from the public config
  // endpoint (D1), a completely separate store nothing here ever wrote to.
  useEffect(() => {
    let cancelled = false
    fetch(TENANT_CONFIG_URL)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled) return
        setGroups(Array.isArray(data?.runwayGroups) ? data.runwayGroups : [])
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Staged local state only, matching DesignPage.tsx/AtcControlPage.tsx's
  // pattern - nothing reaches the shared backend until "Update Dashboard"
  // is clicked. Was saveClubProfile() on every keystroke (immediate, but
  // to localStorage only, which nothing else ever read).
  function updateSelectedGroup(updates: Partial<RunwayGroup>) {
    setGroups((prev) => prev.map((group, i) => (i === selectedIndex ? { ...group, ...updates } : group)))
  }

  function handleEndAIdentifierChange(endAIdentifier: string) {
    updateSelectedGroup({ endAIdentifier })
  }

  function handleEndBIdentifierChange(endBIdentifier: string) {
    updateSelectedGroup({ endBIdentifier })
  }

  function handleHeadingChange(headingDegrees: number) {
    updateSelectedGroup({ headingDegrees })
  }

  // Each strip's own width, independent of any other strip in the same
  // group (e.g. a narrower grass strip beside a wider tarmac one). Same
  // fallback pattern as before: cleared or non-positive/non-numeric falls
  // back to Shobdon's seeded default (22px) rather than a zero-width,
  // invisible strip.
  function handleStripWidthChange(stripIndex: number, rawValue: string) {
    const parsed = Number(rawValue)
    const widthPx = rawValue.trim() === '' || !Number.isFinite(parsed) || parsed <= 0 ? DEFAULT_STRIP_WIDTH_PX : parsed
    const strips = selectedGroup.strips.map((strip, i) => (i === stripIndex ? { ...strip, widthPx } : strip))
    updateSelectedGroup({ strips })
  }

  // Same fallback pattern as width: cleared or non-positive/non-numeric
  // falls back to Shobdon's seeded default (216px) rather than a
  // zero/negative-length, degenerate strip. CompassPanel.tsx (and this
  // page's own preview) additionally clamps whatever is actually stored
  // to a safe render-time range, so an extreme value here still can't
  // reach the cardinal letters.
  function handleStripLengthChange(rawValue: string) {
    const parsed = Number(rawValue)
    const stripLengthPx = rawValue.trim() === '' || !Number.isFinite(parsed) || parsed <= 0 ? DEFAULT_STRIP_LENGTH_PX : parsed
    updateSelectedGroup({ stripLengthPx })
  }

  // Same fallback pattern as strip length/width: cleared or non-positive/
  // non-numeric falls back to Shobdon's seeded default (14px) rather than a
  // zero/invisible or negative-size label.
  function handleFontSizeChange(rawValue: string) {
    const parsed = Number(rawValue)
    const identifierFontSizePx =
      rawValue.trim() === '' || !Number.isFinite(parsed) || parsed <= 0 ? DEFAULT_IDENTIFIER_FONT_SIZE_PX : parsed
    updateSelectedGroup({ identifierFontSizePx })
  }

  function handleTwinChange(twin: boolean) {
    const group = selectedGroup
    const strips = twin
      ? [
          group.strips[0] ?? { colour: '#4caf50', widthPx: DEFAULT_STRIP_WIDTH_PX, hasThresholdMarkings: false, showIdentifierLabel: true, showCenterline: true },
          group.strips[1] ?? { colour: '#a8b4c4', widthPx: DEFAULT_STRIP_WIDTH_PX, hasThresholdMarkings: false, showIdentifierLabel: true, showCenterline: true },
        ]
      : [group.strips[0] ?? { colour: '#a8b4c4', widthPx: DEFAULT_STRIP_WIDTH_PX, hasThresholdMarkings: false, showIdentifierLabel: true, showCenterline: true }]
    updateSelectedGroup({ twin, strips })
  }

  function handleStripColourChange(stripIndex: number, colour: string) {
    const strips = selectedGroup.strips.map((strip, i) => (i === stripIndex ? { ...strip, colour } : strip))
    updateSelectedGroup({ strips })
  }

  // Threshold markings (checkerboard) and direction labels are both
  // independent per physical strip - e.g. tarmac markings on, grass off.
  function handleStripMarkingsChange(stripIndex: number, hasThresholdMarkings: boolean) {
    const strips = selectedGroup.strips.map((strip, i) => (i === stripIndex ? { ...strip, hasThresholdMarkings } : strip))
    updateSelectedGroup({ strips })
  }

  function handleStripLabelChange(stripIndex: number, showIdentifierLabel: boolean) {
    const strips = selectedGroup.strips.map((strip, i) => (i === stripIndex ? { ...strip, showIdentifierLabel } : strip))
    updateSelectedGroup({ strips })
  }

  // Dashed centreline, independent per strip - e.g. only the paved
  // surface has one painted, matching real-world practice - same pattern
  // as threshold markings/direction labels above.
  function handleStripCenterlineChange(stripIndex: number, showCenterline: boolean) {
    const strips = selectedGroup.strips.map((strip, i) => (i === stripIndex ? { ...strip, showCenterline } : strip))
    updateSelectedGroup({ strips })
  }

  // Selects the new runway immediately so it's what the form/preview show
  // next, rather than leaving the admin on whichever runway they were
  // already looking at.
  function handleAddGroup() {
    if (groups.length >= MAX_GROUPS) return
    setGroups((prev) => [...prev, createBlankGroup()])
    setSelectedIndex(groups.length)
  }

  function handleRemoveGroup() {
    if (groups.length <= 1) return
    setGroups((prev) => prev.filter((_, i) => i !== selectedIndex))
    setSelectedIndex((prev) => Math.max(0, Math.min(prev, groups.length - 2)))
  }

  // Same PUT-then-refresh-trigger flow as /design's
  // handleApplyToLiveScreen - runwayGroups is a full-replace body area
  // (functions/api/tenant/config.ts DELETEs and re-inserts everything for
  // this org on each call), so the complete staged list is always sent,
  // not a diff. Gated behind confirm() since it affects the shared,
  // physically-visible display, not just this browser.
  async function handleUpdateDashboard() {
    if (
      !window.confirm(
        'Push these runway changes to the live dashboard? This affects every device that loads it (PC2, clubhouse display, etc.) within about 15 seconds.'
      )
    ) {
      return
    }

    setApplyStatus('working')
    try {
      const response = await fetch(TENANT_CONFIG_URL, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runwayGroups: groups }),
      })
      if (!response.ok) {
        setApplyStatus('error')
        return
      }
      await fetch(REFRESH_TRIGGER_URL)
      setApplyStatus('success')
    } catch {
      setApplyStatus('error')
    }
  }

  const selectedGroup = groups[selectedIndex] ?? groups[0]

  return (
    <div className="mx-auto max-w-6xl px-5 pb-16 pt-10">
      {/* ── Heading + sticky Update Dashboard, side by side - same
          principle as the ATC Control redesign: the publish action stays
          reachable near the top, not buried below a long scrolling form. */}
      <div className="mb-6 grid grid-cols-2 items-start gap-6">
        <div>
          <h1 className="mb-2 text-2xl font-black uppercase tracking-wide text-primary">Runways</h1>
          <p className="max-w-2xl text-sm text-muted-400">
            The physical facts about this airfield's runway(s) — identifiers, precise magnetic heading, and
            surface colours. These drive both the compass graphic and the headwind/crosswind maths, so accuracy
            matters here more than anywhere else. Edits are staged below until you click "Update Dashboard".
          </p>
        </div>

        {!loading && (
          <div className="sticky top-4 z-20 ml-auto w-80 rounded-xl border border-accent-sky-500/40 bg-slate-950/95 px-5 py-3 shadow-lg shadow-slate-950/40 backdrop-blur">
            <div className="text-sm font-bold uppercase tracking-widest text-accent-sky-400">Update Dashboard</div>
            <p className="mb-2 text-xs text-muted-500">
              Publishes the staged runway configuration below to the live dashboard - every device that loads it
              picks it up within about 15 seconds.
            </p>
            {applyStatus === 'success' && (
              <p className="mb-2 text-xs font-semibold text-status-good">Published - live dashboard will update shortly.</p>
            )}
            {applyStatus === 'error' && (
              <p className="mb-2 text-xs font-semibold text-status-bad">Failed to publish - check your connection and try again.</p>
            )}
            <button
              type="button"
              onClick={handleUpdateDashboard}
              disabled={applyStatus === 'working'}
              className="rounded-lg bg-accent-sky-500 px-6 py-2.5 text-sm font-bold uppercase tracking-widest text-white transition hover:bg-accent-sky-400 disabled:opacity-50"
            >
              {applyStatus === 'working' ? 'Updating…' : 'Update Dashboard'}
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-muted-400">Loading…</p>
      ) : (
        <>
          {/* ── Runway selector + Add another runway ────────────────── */}
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-widest text-muted-400">Editing</span>
              <select
                value={selectedIndex}
                onChange={(event) => setSelectedIndex(Number(event.target.value))}
                className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
              >
                {groups.map((group, index) => (
                  <option key={group.id} value={index}>
                    Runway {index + 1} ({group.endAIdentifier || '?'}/{group.endBIdentifier || '?'})
                  </option>
                ))}
              </select>
            </label>
            {groups.length > 1 && (
              <button type="button" onClick={handleRemoveGroup} className="text-xs font-semibold text-status-bad">
                Remove this runway
              </button>
            )}
            {groups.length < MAX_GROUPS && (
              <button
                type="button"
                onClick={handleAddGroup}
                className="rounded-lg border border-border bg-slate-900/80 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-accent-sky-500 hover:text-white"
              >
                + Add another runway
              </button>
            )}
          </div>

          {/* ── Form (left) + live preview (right) ──────────────────── */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
            <section className="rounded-2xl border border-border bg-panel p-6">
              {/* Label-left/input-right for the four short, fixed-width
                  fields - was stacked-label-above-full-width-input, which
                  wasted a lot of horizontal space for values that are
                  never more than a few characters. */}
              <div className="grid grid-cols-[minmax(0,auto)_1fr] items-center gap-x-4 gap-y-3 sm:grid-cols-[220px_auto]">
                <span className="text-xs font-semibold uppercase tracking-widest text-muted-400">Precise heading (degrees)</span>
                <input
                  type="number"
                  value={selectedGroup.headingDegrees}
                  onChange={(event) => handleHeadingChange(Number(event.target.value))}
                  className="w-28 rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
                />

                <span className="text-xs font-semibold uppercase tracking-widest text-muted-400">
                  Identifier for the {selectedGroup.headingDegrees}° end
                </span>
                <input
                  type="text"
                  value={selectedGroup.endAIdentifier}
                  onChange={(event) => handleEndAIdentifierChange(event.target.value)}
                  placeholder="e.g. 08"
                  maxLength={2}
                  className="w-20 rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
                />

                <span className="text-xs font-semibold uppercase tracking-widest text-muted-400">
                  Identifier for the {reciprocalHeading(selectedGroup.headingDegrees)}° (opposite) end
                </span>
                <input
                  type="text"
                  value={selectedGroup.endBIdentifier}
                  onChange={(event) => handleEndBIdentifierChange(event.target.value)}
                  placeholder="e.g. 26"
                  maxLength={2}
                  className="w-20 rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
                />

                <span className="text-xs font-semibold uppercase tracking-widest text-muted-400">Strip length (px)</span>
                <input
                  type="number"
                  min={1}
                  value={selectedGroup.stripLengthPx}
                  onChange={(event) => handleStripLengthChange(event.target.value)}
                  className="w-28 rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
                />
              </div>
              <p className="mt-3 text-xs text-muted-500">
                No upper limit on strip width (set per strip below) or length - a large value can visually
                overlap the compass ring or letters, which is an intentional choice you're free to make, not
                something this page prevents.
              </p>

              <label className="mt-4 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={selectedGroup.twin}
                  onChange={(event) => handleTwinChange(event.target.checked)}
                  className="h-4 w-4"
                />
                <span className="text-sm text-muted-300">Twin runway (two parallel strips, e.g. grass + tarmac)</span>
              </label>

              <label className="mt-3 flex max-w-xs flex-col gap-1.5">
                <span className="text-xs font-semibold uppercase tracking-widest text-muted-400">
                  Direction label font size (px)
                </span>
                <input
                  type="number"
                  min={1}
                  value={selectedGroup.identifierFontSizePx}
                  onChange={(event) => handleFontSizeChange(event.target.value)}
                  className="w-24 rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
                />
              </label>
              <p className="mt-1 text-xs text-muted-500">
                Shared font size for whichever strips below have their direction labels switched on. Threshold
                markings and direction labels are each set independently per strip - e.g. tarmac markings on,
                grass off.
              </p>

              <div className="mt-4 flex flex-wrap gap-6">
                {selectedGroup.strips.map((strip, stripIndex) => (
                  <div key={stripIndex} className="flex flex-col gap-3">
                    <div className="flex items-end gap-3">
                      <label className="flex items-center gap-3">
                        <input
                          type="color"
                          value={strip.colour}
                          onChange={(event) => handleStripColourChange(stripIndex, event.target.value)}
                          className="h-9 w-9 cursor-pointer rounded border border-border bg-transparent"
                        />
                        <span className="text-xs text-muted-400">
                          {selectedGroup.twin ? `Strip ${stripIndex + 1} colour` : 'Strip colour'}
                        </span>
                      </label>
                      <label className="flex flex-col gap-1.5">
                        <span className="text-xs font-semibold uppercase tracking-widest text-muted-400">
                          {selectedGroup.twin ? `Strip ${stripIndex + 1} width (px)` : 'Strip width (px)'}
                        </span>
                        <input
                          type="number"
                          min={1}
                          value={strip.widthPx}
                          onChange={(event) => handleStripWidthChange(stripIndex, event.target.value)}
                          className="w-24 rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
                        />
                      </label>
                    </div>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={strip.hasThresholdMarkings}
                        onChange={(event) => handleStripMarkingsChange(stripIndex, event.target.checked)}
                        className="h-4 w-4"
                      />
                      <span className="text-sm text-muted-300">Threshold markings (checkerboard)</span>
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={strip.showIdentifierLabel}
                        onChange={(event) => handleStripLabelChange(stripIndex, event.target.checked)}
                        className="h-4 w-4"
                      />
                      <span className="text-sm text-muted-300">Direction labels (both ends)</span>
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={strip.showCenterline}
                        onChange={(event) => handleStripCenterlineChange(stripIndex, event.target.checked)}
                        className="h-4 w-4"
                      />
                      <span className="text-sm text-muted-300">Dashed centreline</span>
                    </label>
                  </div>
                ))}
              </div>
            </section>

            {/* Live preview - updates on every keystroke/toggle above,
                entirely from the staged (unsaved) selectedGroup value.
                RunwayStripPreview shares no code with CompassPanel.tsx -
                see that component's own header comment for why. */}
            <div className="rounded-2xl border border-border bg-panel p-6">
              <div className="mb-3 text-xs font-bold uppercase tracking-widest text-muted-400">Live Preview</div>
              <div className="aspect-square w-full">
                <RunwayStripPreview group={selectedGroup} />
              </div>
              <p className="mt-3 text-xs text-muted-500">
                Reflects the staged values on the left as you edit - nothing here has been published yet.
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
