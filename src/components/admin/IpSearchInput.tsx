import { useRef, useState } from 'react'
import type { ClipboardEvent, KeyboardEvent } from 'react'
import { buildIpPrefix, digitsOnly, EMPTY_IP_BOXES, parsePastedIp, type IpBoxes } from '../../utils/ipSearch'

interface Props {
  // Called on every change with the "starts with" prefix ('' = no filter).
  // The page debounces it; nothing is stored between visits.
  onPrefixChange: (prefix: string) => void
}

const FIELD_CLASS =
  'flex items-center rounded-lg border border-slate-700 bg-slate-900/80 px-2 py-1.5 text-sm text-white focus-within:border-sky-500'
const BOX_CLASS = 'w-8 bg-transparent text-center font-mono text-sm text-white focus:outline-none'

// Four digit boxes styled as ONE field: [   ].[   ].[   ].[   ]. Auto-advances
// after the 3rd digit; Tab / "." move on early; Backspace in an empty box moves
// back; pasting an address (or a leading part of one) fills the boxes. Pasting
// something containing ":" switches to a single text field (IPv6).
export function IpSearchInput({ onPrefixChange }: Props) {
  const [boxes, setBoxes] = useState<IpBoxes>(EMPTY_IP_BOXES)
  const [ipv6Text, setIpv6Text] = useState<string | null>(null)
  const refs = useRef<(HTMLInputElement | null)[]>([])

  function commit(next: IpBoxes) {
    setBoxes(next)
    onPrefixChange(buildIpPrefix(next))
  }

  function focusBox(index: number) {
    const el = refs.current[index]
    if (!el) return
    el.focus()
    const end = el.value.length
    el.setSelectionRange(end, end)
  }

  function handleChange(index: number, raw: string) {
    const value = digitsOnly(raw)
    const next = [...boxes] as IpBoxes
    next[index] = value
    commit(next)
    if (value.length === 3 && index < 3) focusBox(index + 1)
  }

  function handleKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === '.' || event.key === ',') {
      event.preventDefault()
      if (boxes[index] !== '' && index < 3) focusBox(index + 1)
    } else if (event.key === 'Backspace' && boxes[index] === '' && index > 0) {
      event.preventDefault()
      focusBox(index - 1)
    }
  }

  function handlePaste(index: number, event: ClipboardEvent<HTMLInputElement>) {
    event.preventDefault()
    const result = parsePastedIp(event.clipboardData.getData('text'), index)
    if ('ipv6' in result) {
      setIpv6Text(result.ipv6)
      setBoxes(EMPTY_IP_BOXES)
      onPrefixChange(result.ipv6)
      return
    }
    commit(result.boxes)
    // Wait for the re-render, then park the cursor on the next empty box.
    window.setTimeout(() => focusBox(result.focusIndex), 0)
  }

  function clearAll() {
    setIpv6Text(null)
    commit(EMPTY_IP_BOXES)
  }

  const hasValue = ipv6Text !== null || boxes.some((b) => b !== '')

  const clearButton = hasValue && (
    <button
      type="button"
      onClick={clearAll}
      aria-label="Clear IP search"
      className="ml-1 rounded px-1 text-xs text-muted-400 hover:text-white"
    >
      ×
    </button>
  )

  return (
    <div className="flex items-center gap-2 text-xs text-muted-400">
      <span id="ip-search-label">IP</span>
      {ipv6Text !== null ? (
        <div className={FIELD_CLASS}>
          <input
            type="text"
            aria-labelledby="ip-search-label"
            value={ipv6Text}
            onChange={(event) => {
              setIpv6Text(event.target.value)
              onPrefixChange(event.target.value)
            }}
            className="w-56 bg-transparent font-mono text-sm text-white focus:outline-none"
          />
          {clearButton}
        </div>
      ) : (
        <div className={FIELD_CLASS} role="group" aria-labelledby="ip-search-label">
          {boxes.map((value, index) => (
            <span key={index} className="flex items-center">
              {index > 0 && <span className="px-0.5 text-muted-500">.</span>}
              <input
                ref={(el) => {
                  refs.current[index] = el
                }}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                aria-label={`IP part ${index + 1}`}
                value={value}
                maxLength={3}
                onChange={(event) => handleChange(index, event.target.value)}
                onKeyDown={(event) => handleKeyDown(index, event)}
                onPaste={(event) => handlePaste(index, event)}
                className={BOX_CLASS}
              />
            </span>
          ))}
          {clearButton}
        </div>
      )}
    </div>
  )
}
