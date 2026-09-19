import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import LandingPage from './components/LandingPage'
import AppDashboard from './components/AppDashboard'
import { WalletContextProvider } from './components/WalletContextProvider'

export default function App() {
  return (
    <WalletContextProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/app" element={<AppDashboard />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </WalletContextProvider>
  )
}
