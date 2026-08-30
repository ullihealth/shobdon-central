import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
import { registerServiceWorkerUpdates } from './services/serviceWorkerUpdate'

// Called here, not inside a component effect, so it runs exactly once
// regardless of StrictMode's dev-only double-invoke behaviour - see that
// module's own comment for the full "why" of this feature.
registerServiceWorkerUpdates()

const root = createRoot(document.getElementById('root')!)
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
