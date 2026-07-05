import { BrowserRouter, Route, Routes } from 'react-router-dom'
import ConfigPage from './pages/ConfigPage'
import DashboardPage from './pages/DashboardPage'

export default function App(): JSX.Element {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/config" element={<ConfigPage />} />
        <Route path="/" element={<DashboardPage />} />
        <Route path="*" element={<DashboardPage />} />
      </Routes>
    </BrowserRouter>
  )
}
