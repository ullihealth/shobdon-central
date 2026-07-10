import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { authClient } from '../lib/auth/authClient'

interface RequireAuthProps {
  children: ReactNode
}

// Gate for the management pages (/config, /design, /runways) - redirects
// to /login when there's no valid BetterAuth session. Uses the client's
// own useSession() hook, which calls the same /api/auth/get-session route
// already proven working at the phase-0 login checkpoint - not a
// separate, hand-rolled check. Deliberately NOT used on the public
// dashboard route ("/") - that must stay unauthenticated for everyone.
export default function RequireAuth({ children }: RequireAuthProps): JSX.Element | null {
  const { data: session, isPending } = authClient.useSession()

  if (isPending) return null
  if (!session) return <Navigate to="/login" replace />

  return <>{children}</>
}
