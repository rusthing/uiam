import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Shell } from './components/Shell'
import { ToastProvider } from './components/Toast'
import { GatewayListProvider } from './state/GatewayList'
import { HomePage } from './pages/HomePage'
import { GatewayPage } from './pages/GatewayPage'

export function App() {
  return (
    <ToastProvider>
      <GatewayListProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<Shell />}>
              <Route index element={<HomePage />} />
              <Route path="gateway/:gatewayId" element={<GatewayPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </GatewayListProvider>
    </ToastProvider>
  )
}
