import { BrowserRouter, Route, Routes } from 'react-router-dom'
import ChecklistPage from './pages/ChecklistPage'
import ConfigPage from './pages/ConfigPage'
import DashboardPage from './pages/DashboardPage'
import RemoteRefreshWatcher from './components/RemoteRefreshWatcher'

export default function App(): JSX.Element {
  return (
    <BrowserRouter>
      <RemoteRefreshWatcher />
      <Routes>
        <Route path="/config" element={<ConfigPage />} />
        <Route path="/checklist" element={<ChecklistPage />} />
        <Route path="/" element={<DashboardPage />} />
        <Route path="*" element={<DashboardPage />} />
      </Routes>
    </BrowserRouter>
  )
}
