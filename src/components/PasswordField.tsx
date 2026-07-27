import { useState } from 'react'

interface PasswordFieldProps {
  id?: string
  label: string
  value: string
  onChange: (value: string) => void
  autoComplete?: string
  minLength?: number
  required?: boolean
  helperText?: string
}

// Show/hide toggle for a password input - confirmed no existing
// component or pattern for this anywhere in the app (LoginPage.tsx,
// AccountPage.tsx's three password fields are all plain, un-toggleable
// type="password" inputs) and no icon library is installed
// (package.json has no lucide-react/heroicons/react-icons), so the eye
// icons here are small hand-rolled inline SVGs rather than a new
// dependency for two icons. Built here rather than inlined directly in
// OnboardInvitePage.tsx since that page alone needs it twice
// (password + confirm password) - worth the extraction even before
// counting any future reuse on LoginPage.tsx/AccountPage.tsx, which
// this round doesn't touch.
export default function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  minLength,
  required,
  helperText,
}: PasswordFieldProps): JSX.Element {
  const [visible, setVisible] = useState(false)

  return (
    <label className="mb-4 flex flex-col gap-1.5" htmlFor={id}>
      <span className="text-sm font-semibold uppercase tracking-widest text-muted-400">{label}</span>
      <div className="relative">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          required={required}
          minLength={minLength}
          autoComplete={autoComplete}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="w-full rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 pr-10 text-base text-white focus:border-sky-500 focus:outline-none"
        />
        <button
          type="button"
          // tabIndex -1 so keyboard users tab from the field straight to
          // the next one, not through a toggle that's a convenience, not
          // a required stop.
          tabIndex={-1}
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-400 transition hover:text-white"
        >
          {visible ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
              <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 7 11 7a13.16 13.16 0 0 1-1.67 2.68" />
              <path d="M6.61 6.61A13.526 13.526 0 0 0 1 11.5s4 7 11 7a9.26 9.26 0 0 0 5.39-1.61" />
              <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
              <line x1="1" y1="1" x2="23" y2="23" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
              <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          )}
        </button>
      </div>
      {helperText && <span className="text-sm text-muted-500">{helperText}</span>}
    </label>
  )
}
