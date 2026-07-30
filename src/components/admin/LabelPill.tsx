import { resolveLabelColor } from '../../utils/labelColors'

interface LabelPillProps {
  groupName: string
  color?: string | null
  className?: string
}

// Shared across every place a label renders as a pill (Visit Log's
// Label column, the "Hide" filter pills, IP Directory, Known Devices'
// cross-check warnings) - one place resolving the colour (explicit or
// hash-derived, see labelColors.ts) means all four stay visually
// consistent for the same group name with no duplicated logic.
export function LabelPill({ groupName, color, className }: LabelPillProps): JSX.Element {
  const entry = resolveLabelColor(color, groupName)
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs ${entry.pillClass} ${className ?? ''}`}>{groupName}</span>
  )
}
