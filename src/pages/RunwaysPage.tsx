import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { REFRESH_TRIGGER_URL } from '../config/captureEndpoint'
import { TENANT_CONFIG_URL } from '../config/publicApi'
import type { RunwayGroup } from '../types/clubProfile'

const MAX_GROUPS = 3

// Matches Shobdon's seeded strip width/length - used both for brand-new
// groups (so they render a visible, sensible-looking strip immediately)
// and as the fallback if an admin clears the corresponding field entirely.
const DEFAULT_STRIP_WIDTH_PX = 22
const DEFAULT_STRIP_LENGTH_PX = 216
const DEFAULT_IDENTIFIER_FONT_SIZE_PX = 14

type ApplyStatus = 'idle' | 'working' | 'success' | 'error'

function suggestHeadingFromLabel(label: string): number | null {
  const firstPart = label.split('/')[0]?.trim()
  if (!firstPart) return null
  const numeric = Number(firstPart)
  if (Number.isNaN(numeric)) return null
  return numeric * 10
}

function createBlankGroup(): RunwayGroup {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    label: '',
    headingDegrees: 0,
    twin: false,
    strips: [{ colour: '#a8b4c4', widthPx: DEFAULT_STRIP_WIDTH_PX, hasThresholdMarkings: false, showIdentifierLabel: true, showCenterline: true }],
    stripLengthPx: DEFAULT_STRIP_LENGTH_PX,
    identifierFontSizePx: DEFAULT_IDENTIFIER_FONT_SIZE_PX,
  }
}

interface EditableGroup {
  group: RunwayGroup
  // Tracks whether the admin has manually set headingDegrees for this group.
  // Until then, editing the label auto-suggests a heading; afterward, the
  // label and heading are fully independent, per spec.
  headingTouched: boolean
}

export default function RunwaysPage(): JSX.Element {
  const [loading, setLoading] = useState(true)
  const [editableGroups, setEditableGroups] = useState<EditableGroup[]>([])
  const [applyStatus, setApplyStatus] = useState<ApplyStatus>('idle')

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
        const runwayGroups: RunwayGroup[] = Array.isArray(data?.runwayGroups) ? data.runwayGroups : []
        setEditableGroups(runwayGroups.map((group) => ({ group, headingTouched: true })))
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
  function updateGroup(index: number, updates: Partial<RunwayGroup>) {
    setEditableGroups((prev) =>
      prev.map((entry, i) => (i === index ? { ...entry, group: { ...entry.group, ...updates } } : entry))
    )
  }

  function handleLabelChange(index: number, label: string) {
    setEditableGroups((prev) =>
      prev.map((entry, i) => {
        if (i !== index) return entry
        const updates: Partial<RunwayGroup> = { label }
        if (!entry.headingTouched) {
          const suggested = suggestHeadingFromLabel(label)
          if (suggested !== null) updates.headingDegrees = suggested
        }
        return { group: { ...entry.group, ...updates }, headingTouched: entry.headingTouched }
      })
    )
  }

  function handleHeadingChange(index: number, headingDegrees: number) {
    setEditableGroups((prev) =>
      prev.map((entry, i) => (i === index ? { group: { ...entry.group, headingDegrees }, headingTouched: true } : entry))
    )
  }

  // Each strip's own width, independent of any other strip in the same
  // group (e.g. a narrower grass strip beside a wider tarmac one). Same
  // fallback pattern as before: cleared or non-positive/non-numeric falls
  // back to Shobdon's seeded default (22px) rather than a zero-width,
  // invisible strip.
  function handleStripWidthChange(groupIndex: number, stripIndex: number, rawValue: string) {
    const parsed = Number(rawValue)
    const widthPx = rawValue.trim() === '' || !Number.isFinite(parsed) || parsed <= 0 ? DEFAULT_STRIP_WIDTH_PX : parsed
    const entry = editableGroups[groupIndex]
    const strips = entry.group.strips.map((strip, i) => (i === stripIndex ? { ...strip, widthPx } : strip))
    updateGroup(groupIndex, { strips })
  }

  // Same fallback pattern as width: cleared or non-positive/non-numeric
  // falls back to Shobdon's seeded default (216px) rather than a
  // zero/negative-length, degenerate strip. CompassPanel.tsx additionally
  // clamps whatever is actually stored to a safe render-time range, so an
  // extreme value here still can't reach the cardinal letters.
  function handleStripLengthChange(index: number, rawValue: string) {
    const parsed = Number(rawValue)
    const stripLengthPx = rawValue.trim() === '' || !Number.isFinite(parsed) || parsed <= 0 ? DEFAULT_STRIP_LENGTH_PX : parsed
    updateGroup(index, { stripLengthPx })
  }

  // Same fallback pattern as strip length/width: cleared or non-positive/
  // non-numeric falls back to Shobdon's seeded default (14px) rather than a
  // zero/invisible or negative-size label.
  function handleFontSizeChange(index: number, rawValue: string) {
    const parsed = Number(rawValue)
    const identifierFontSizePx =
      rawValue.trim() === '' || !Number.isFinite(parsed) || parsed <= 0 ? DEFAULT_IDENTIFIER_FONT_SIZE_PX : parsed
    updateGroup(index, { identifierFontSizePx })
  }

  function handleTwinChange(index: number, twin: boolean) {
    const entry = editableGroups[index]
    const strips = twin
      ? [
          entry.group.strips[0] ?? { colour: '#4caf50', widthPx: DEFAULT_STRIP_WIDTH_PX, hasThresholdMarkings: false, showIdentifierLabel: true, showCenterline: true },
          entry.group.strips[1] ?? { colour: '#a8b4c4', widthPx: DEFAULT_STRIP_WIDTH_PX, hasThresholdMarkings: false, showIdentifierLabel: true, showCenterline: true },
        ]
      : [entry.group.strips[0] ?? { colour: '#a8b4c4', widthPx: DEFAULT_STRIP_WIDTH_PX, hasThresholdMarkings: false, showIdentifierLabel: true, showCenterline: true }]
    updateGroup(index, { twin, strips })
  }

  function handleStripColourChange(groupIndex: number, stripIndex: number, colour: string) {
    const entry = editableGroups[groupIndex]
    const strips = entry.group.strips.map((strip, i) => (i === stripIndex ? { ...strip, colour } : strip))
    updateGroup(groupIndex, { strips })
  }

  // Threshold markings (checkerboard) and direction labels are both
  // independent per physical strip - e.g. tarmac markings on, grass off.
  function handleStripMarkingsChange(groupIndex: number, stripIndex: number, hasThresholdMarkings: boolean) {
    const entry = editableGroups[groupIndex]
    const strips = entry.group.strips.map((strip, i) => (i === stripIndex ? { ...strip, hasThresholdMarkings } : strip))
    updateGroup(groupIndex, { strips })
  }

  function handleStripLabelChange(groupIndex: number, stripIndex: number, showIdentifierLabel: boolean) {
    const entry = editableGroups[groupIndex]
    const strips = entry.group.strips.map((strip, i) => (i === stripIndex ? { ...strip, showIdentifierLabel } : strip))
    updateGroup(groupIndex, { strips })
  }

  // Dashed centreline, independent per strip - e.g. only the paved
  // surface has one painted, matching real-world practice - same pattern
  // as threshold markings/direction labels above.
  function handleStripCenterlineChange(groupIndex: number, stripIndex: number, showCenterline: boolean) {
    const entry = editableGroups[groupIndex]
    const strips = entry.group.strips.map((strip, i) => (i === stripIndex ? { ...strip, showCenterline } : strip))
    updateGroup(groupIndex, { strips })
  }

  function handleAddGroup() {
    if (editableGroups.length >= MAX_GROUPS) return
    setEditableGroups((prev) => [...prev, { group: createBlankGroup(), headingTouched: false }])
  }

  function handleRemoveGroup(index: number) {
    if (editableGroups.length <= 1) return
    setEditableGroups((prev) => prev.filter((_, i) => i !== index))
  }

  // Same PUT-then-refresh-trigger flow as /design's
  // handleApplyToLiveDashboard - runwayGroups is a full-replace body area
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
        body: JSON.stringify({ runwayGroups: editableGroups.map((entry) => entry.group) }),
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

  return (
    <div className="min-h-screen bg-gradient-to-b from-page-from via-page-via to-page-to text-slate-100">
      <div className="mx-auto max-w-2xl px-5 pb-16 pt-8">
        <Link to="/config" className="text-sm font-semibold text-muted-400 hover:text-accent-sky-400">
          ← Back to Config
        </Link>
        <h1 className="mb-2 mt-3 text-2xl font-black uppercase tracking-wide text-primary">Runways</h1>
        <p className="mb-8 max-w-2xl text-sm text-muted-400">
          The physical facts about this airfield's runway(s) — identifiers, precise magnetic heading, and
          surface colours. These drive both the compass graphic and the headwind/crosswind maths, so accuracy
          matters here more than anywhere else. Edits are staged below until you click "Update Dashboard".
        </p>

        {loading ? (
          <p className="text-sm text-muted-400">Loading…</p>
        ) : (
          <div className="flex flex-col gap-6">
            {editableGroups.map((entry, index) => (
              <section key={entry.group.id} className="rounded-2xl border border-border bg-panel p-6">
                <div className="mb-4 flex items-center justify-between">
                  <div className="text-sm font-bold uppercase tracking-widest text-accent-sky-400">
                    Runway {index + 1}
                  </div>
                  {editableGroups.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveGroup(index)}
                      className="text-xs font-semibold text-status-bad"
                    >
                      Remove
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-semibold uppercase tracking-widest text-muted-400">Label</span>
                    <input
                      type="text"
                      value={entry.group.label}
                      onChange={(event) => handleLabelChange(index, event.target.value)}
                      placeholder="e.g. 08/26"
                      className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
                    />
                  </label>

                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-semibold uppercase tracking-widest text-muted-400">
                      Precise heading (degrees)
                    </span>
                    <input
                      type="number"
                      value={entry.group.headingDegrees}
                      onChange={(event) => handleHeadingChange(index, Number(event.target.value))}
                      className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
                    />
                  </label>

                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-semibold uppercase tracking-widest text-muted-400">
                      Strip length (px)
                    </span>
                    <input
                      type="number"
                      min={1}
                      value={entry.group.stripLengthPx}
                      onChange={(event) => handleStripLengthChange(index, event.target.value)}
                      className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
                    />
                  </label>
                </div>
                <p className="mt-2 text-xs text-muted-500">
                  No upper limit on strip width (set per strip below) or length - a large value can visually
                  overlap the compass ring or letters, which is an intentional choice you're free to make, not
                  something this page prevents.
                </p>

                <label className="mt-4 flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={entry.group.twin}
                    onChange={(event) => handleTwinChange(index, event.target.checked)}
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
                    value={entry.group.identifierFontSizePx}
                    onChange={(event) => handleFontSizeChange(index, event.target.value)}
                    className="w-24 rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
                  />
                </label>
                <p className="mt-1 text-xs text-muted-500">
                  Shared font size for whichever strips below have their direction labels switched on. Threshold
                  markings and direction labels are each set independently per strip - e.g. tarmac markings on,
                  grass off.
                </p>

                <div className="mt-4 flex flex-wrap gap-6">
                  {entry.group.strips.map((strip, stripIndex) => (
                    <div key={stripIndex} className="flex flex-col gap-3">
                      <div className="flex items-end gap-3">
                        <label className="flex items-center gap-3">
                          <input
                            type="color"
                            value={strip.colour}
                            onChange={(event) => handleStripColourChange(index, stripIndex, event.target.value)}
                            className="h-9 w-9 cursor-pointer rounded border border-border bg-transparent"
                          />
                          <span className="text-xs text-muted-400">
                            {entry.group.twin ? `Strip ${stripIndex + 1} colour` : 'Strip colour'}
                          </span>
                        </label>
                        <label className="flex flex-col gap-1.5">
                          <span className="text-xs font-semibold uppercase tracking-widest text-muted-400">
                            {entry.group.twin ? `Strip ${stripIndex + 1} width (px)` : 'Strip width (px)'}
                          </span>
                          <input
                            type="number"
                            min={1}
                            value={strip.widthPx}
                            onChange={(event) => handleStripWidthChange(index, stripIndex, event.target.value)}
                            className="w-24 rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
                          />
                        </label>
                      </div>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={strip.hasThresholdMarkings}
                          onChange={(event) => handleStripMarkingsChange(index, stripIndex, event.target.checked)}
                          className="h-4 w-4"
                        />
                        <span className="text-sm text-muted-300">Threshold markings (checkerboard)</span>
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={strip.showIdentifierLabel}
                          onChange={(event) => handleStripLabelChange(index, stripIndex, event.target.checked)}
                          className="h-4 w-4"
                        />
                        <span className="text-sm text-muted-300">Direction labels (both ends)</span>
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={strip.showCenterline}
                          onChange={(event) => handleStripCenterlineChange(index, stripIndex, event.target.checked)}
                          className="h-4 w-4"
                        />
                        <span className="text-sm text-muted-300">Dashed centreline</span>
                      </label>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}

        {!loading && editableGroups.length < MAX_GROUPS && (
          <button
            type="button"
            onClick={handleAddGroup}
            className="mt-6 rounded-lg border border-border bg-slate-900/80 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-accent-sky-500 hover:text-white"
          >
            + Add another runway
          </button>
        )}

        {!loading && (
          <section className="mt-8 rounded-2xl border border-accent-sky-500/40 bg-panel p-6">
            <div className="mb-2 text-sm font-bold uppercase tracking-widest text-accent-sky-400">
              Update Dashboard
            </div>
            <p className="mb-4 text-sm text-muted-400">
              Pushes the runway configuration above to every device that loads the real dashboard - PC2, the
              clubhouse display, home browsers - within about 15 seconds.
            </p>
            <button
              type="button"
              onClick={handleUpdateDashboard}
              disabled={applyStatus === 'working'}
              className="rounded-lg border border-accent-sky-500 bg-slate-900/80 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-accent-sky-500/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {applyStatus === 'working' ? 'Updating…' : 'Update Dashboard'}
            </button>
            {applyStatus === 'success' && (
              <p className="mt-3 text-sm font-semibold text-status-good">✅ Applied - devices will pick it up within ~15 seconds.</p>
            )}
            {applyStatus === 'error' && (
              <p className="mt-3 text-sm font-semibold text-status-bad">❌ Could not apply the changes - check connectivity and try again.</p>
            )}
          </section>
        )}
      </div>
    </div>
  )
}
