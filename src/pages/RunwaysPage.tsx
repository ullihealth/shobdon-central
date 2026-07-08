import { useState } from 'react'
import { Link } from 'react-router-dom'
import { loadClubProfile, saveClubProfile } from '../services/clubProfileStore'
import type { RunwayGroup } from '../types/clubProfile'

const MAX_GROUPS = 3

// Matches Shobdon's seeded strip width/length - used both for brand-new
// groups (so they render a visible, sensible-looking strip immediately)
// and as the fallback if an admin clears the corresponding field entirely.
const DEFAULT_STRIP_WIDTH_PX = 22
const DEFAULT_STRIP_LENGTH_PX = 216
const DEFAULT_IDENTIFIER_FONT_SIZE_PX = 14

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
    strips: [{ colour: '#a8b4c4', widthPx: DEFAULT_STRIP_WIDTH_PX }],
    stripLengthPx: DEFAULT_STRIP_LENGTH_PX,
    hasThresholdMarkings: false,
    showIdentifierLabels: true,
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
  const [editableGroups, setEditableGroups] = useState<EditableGroup[]>(() =>
    loadClubProfile().runwayGroups.map((group) => ({ group, headingTouched: true }))
  )

  function persist(next: EditableGroup[]) {
    setEditableGroups(next)
    saveClubProfile({ runwayGroups: next.map((entry) => entry.group) })
  }

  function updateGroup(index: number, updates: Partial<RunwayGroup>) {
    persist(
      editableGroups.map((entry, i) => (i === index ? { ...entry, group: { ...entry.group, ...updates } } : entry))
    )
  }

  function handleLabelChange(index: number, label: string) {
    const entry = editableGroups[index]
    const updates: Partial<RunwayGroup> = { label }
    if (!entry.headingTouched) {
      const suggested = suggestHeadingFromLabel(label)
      if (suggested !== null) updates.headingDegrees = suggested
    }
    persist(
      editableGroups.map((e, i) => (i === index ? { group: { ...e.group, ...updates }, headingTouched: e.headingTouched } : e))
    )
  }

  function handleHeadingChange(index: number, headingDegrees: number) {
    persist(
      editableGroups.map((e, i) => (i === index ? { group: { ...e.group, headingDegrees }, headingTouched: true } : e))
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
          entry.group.strips[0] ?? { colour: '#4caf50', widthPx: DEFAULT_STRIP_WIDTH_PX },
          entry.group.strips[1] ?? { colour: '#a8b4c4', widthPx: DEFAULT_STRIP_WIDTH_PX },
        ]
      : [entry.group.strips[0] ?? { colour: '#a8b4c4', widthPx: DEFAULT_STRIP_WIDTH_PX }]
    updateGroup(index, { twin, strips })
  }

  function handleStripColourChange(groupIndex: number, stripIndex: number, colour: string) {
    const entry = editableGroups[groupIndex]
    const strips = entry.group.strips.map((strip, i) => (i === stripIndex ? { colour } : strip))
    updateGroup(groupIndex, { strips })
  }

  function handleAddGroup() {
    if (editableGroups.length >= MAX_GROUPS) return
    persist([...editableGroups, { group: createBlankGroup(), headingTouched: false }])
  }

  function handleRemoveGroup(index: number) {
    if (editableGroups.length <= 1) return
    persist(editableGroups.filter((_, i) => i !== index))
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
          matters here more than anywhere else. Changes save immediately.
        </p>

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

              <label className="mt-3 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={entry.group.hasThresholdMarkings}
                  onChange={(event) => updateGroup(index, { hasThresholdMarkings: event.target.checked })}
                  className="h-4 w-4"
                />
                <span className="text-sm text-muted-300">Threshold markings (checkerboard block at each end)</span>
              </label>

              <label className="mt-3 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={entry.group.showIdentifierLabels}
                  onChange={(event) => updateGroup(index, { showIdentifierLabels: event.target.checked })}
                  className="h-4 w-4"
                />
                <span className="text-sm text-muted-300">
                  Direction labels (identifier numbers at both ends, e.g. "08"/"26")
                </span>
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

              <div className="mt-4 flex flex-wrap gap-6">
                {entry.group.strips.map((strip, stripIndex) => (
                  <div key={stripIndex} className="flex items-end gap-3">
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
                ))}
              </div>
            </section>
          ))}
        </div>

        {editableGroups.length < MAX_GROUPS && (
          <button
            type="button"
            onClick={handleAddGroup}
            className="mt-6 rounded-lg border border-border bg-slate-900/80 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-accent-sky-500 hover:text-white"
          >
            + Add another runway
          </button>
        )}
      </div>
    </div>
  )
}
