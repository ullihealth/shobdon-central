import { useEffect, useState } from 'react'
import { PUBLIC_CONFIG_URL } from '../../config/publicApi'
import { useWeather } from '../../context/WeatherContext'

type NoticeSize = 'sm' | 'md' | 'lg' | 'xl'

interface SafetyNotice {
  text: string
  size: NoticeSize
  enabled: boolean
}

const SIZE_CLASSES: Record<NoticeSize, string> = {
  sm: 'text-base',
  md: 'text-lg',
  lg: 'text-xl',
  xl: 'text-2xl',
}

// Pilot View (Section 8 - Notices). Same manual safetyNotices data
// RightInfoPanel.tsx's own NotamsPanel renders (opsPanel.safetyNotices),
// but a fresh component rather than a reuse of that one: NotamsPanel
// measures scrollHeight against a fixed clientHeight and drops entries
// to fit a non-scrolling TV card - the same truncation-by-height problem
// AutoNotamsScrollPanel.tsx's own comment already worked around for
// NOTAMs, just missed for this section in the original plan (found and
// fixed during implementation, not shipped as-is). Renders every notice
// in full, natural flow, no cap.
export default function PilotNoticesPanel({ refreshSignal }: { refreshSignal?: number }): JSX.Element {
  const { weather, liveDataUnavailable } = useWeather()
  const [notices, setNotices] = useState<SafetyNotice[]>([])

  useEffect(() => {
    let cancelled = false
    fetch(PUBLIC_CONFIG_URL)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled) setNotices(Array.isArray(data?.opsPanel?.safetyNotices) ? data.opsPanel.safetyNotices : [])
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [refreshSignal])

  const manualNotices = notices.filter((n) => n.enabled !== false)
  const noticesForDisplay: SafetyNotice[] =
    !weather || liveDataUnavailable
      ? [{ text: 'N/A', size: 'md', enabled: true }]
      : manualNotices.length > 0
        ? manualNotices
        : [{ text: 'No active notices', size: 'md', enabled: true }]

  // No outer section/title of its own any more - PilotViewPage.tsx now
  // wraps this in PilotCollapsibleSection (passed its own distinct
  // accent-sky sectionClassName/titleClassName there, so the "visually
  // distinct from NOTAMs" requirement from the original spec still
  // holds even collapsed). Bare content only.
  return (
    <div className="flex flex-col gap-3">
      {noticesForDisplay.map((notice, index) => (
        <div key={index} className={`font-semibold text-primary ${SIZE_CLASSES[notice.size]}`}>
          {notice.text}
        </div>
      ))}
    </div>
  )
}
