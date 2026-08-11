import { useEffect, useRef, useState } from 'react'
import EmojiPicker, { Theme, type EmojiClickData } from 'emoji-picker-react'

interface TickerEmojiTextInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}

// Shared by both ticker slot editors (TickerSettingsCards.tsx's desktop
// café ticker, PilotTickerSlotsEditor.tsx's mobile/pilot ticker) - same
// "type your own message" free-text input each already had, now with an
// emoji-insert button attached. Not duplicated between the two editors:
// the cursor-position tracking/restoration below is genuinely non-
// trivial, and both editors live in the same src/ Vite bundle (unlike
// the functions/ vs src/ build-boundary cases elsewhere in this
// codebase that DO deliberately keep small per-file copies) - there's
// no boundary reason to duplicate this one.
export default function TickerEmojiTextInput({ value, onChange, placeholder, className }: TickerEmojiTextInputProps): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [pickerOpen, setPickerOpen] = useState(false)

  // Click-outside-to-close - emoji-picker-react has no built-in
  // dismiss-on-outside-click behaviour of its own, and leaving the
  // picker open after a slot's text is otherwise done being edited
  // would be the only floating overlay left open with no explicit close
  // control on it.
  useEffect(() => {
    if (!pickerOpen) return
    function handlePointerDown(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) setPickerOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [pickerOpen])

  function insertEmoji(emoji: string) {
    const input = inputRef.current
    const start = input?.selectionStart ?? value.length
    const end = input?.selectionEnd ?? value.length
    onChange(value.slice(0, start) + emoji + value.slice(end))
    setPickerOpen(false)
    // Cursor restoration has to wait one frame - at the moment this
    // runs, `input` still holds its OLD value (onChange above only
    // queues the state update that becomes the new `value` prop on the
    // next render); setSelectionRange against indices computed from the
    // new text would be operating on a DOM node that hasn't caught up
    // yet. requestAnimationFrame runs after React has committed that
    // re-render, so the input's own value is already the new text by
    // the time this fires.
    requestAnimationFrame(() => {
      if (!input) return
      input.focus()
      const cursor = start + emoji.length
      input.setSelectionRange(cursor, cursor)
    })
  }

  return (
    <div ref={wrapperRef} className="relative flex items-center gap-1.5">
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={className}
      />
      <button
        type="button"
        onClick={() => setPickerOpen((prev) => !prev)}
        className="shrink-0 rounded-lg border border-slate-700 bg-slate-900/80 px-2.5 py-2 text-sm transition hover:border-sky-500"
        title="Insert emoji"
        aria-label="Insert emoji"
      >
        🙂
      </button>
      {pickerOpen && (
        <div className="absolute right-0 top-full z-50 mt-1">
          <EmojiPicker theme={Theme.DARK} onEmojiClick={(data: EmojiClickData) => insertEmoji(data.emoji)} width={300} height={360} />
        </div>
      )}
    </div>
  )
}
