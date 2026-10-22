import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './auth'
import { AppShell } from './layouts/AppShell'
import { CheckinsPage } from './pages/CheckinsPage'
import { DashboardPage } from './pages/DashboardPage'
import { DevicesPage } from './pages/DevicesPage'
import { EnrollmentPage } from './pages/EnrollmentPage'
import { KioskPage } from './pages/KioskPage'
import { LoginPage } from './pages/LoginPage'
import { MemberDetailPage } from './pages/MemberDetailPage'
import { MembersPage } from './pages/MembersPage'
import { MembershipPlansPage } from './pages/MembershipPlansPage'
import { ReportsPage } from './pages/ReportsPage'
import { SettingsPage } from './pages/SettingsPage'
import { StreamingCameraPage } from './pages/StreamingCameraPage'
import { SuperAdminPage } from './pages/SuperAdminPage'
import type { Role } from './types'

function ProtectedRoute({ roles }: { roles?: Role[] }) {
  const { user } = useAuth()
  if (!user) return <Navigate to="/login" replace />
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />
  return <AppShell />
}

export function App() {
  return <Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route path="/kiosk" element={<KioskPage />} />
    <Route element={<ProtectedRoute />}>
      <Route index element={<DashboardPage />} />
      <Route path="members" element={<MembersPage />} />
      <Route path="members/:id" element={<MemberDetailPage />} />
      <Route path="membership-plans" element={<MembershipPlansPage />} />
      <Route path="enrollment" element={<EnrollmentPage />} />
      <Route path="live-camera" element={<StreamingCameraPage />} />
      <Route path="checkins" element={<CheckinsPage />} />
    </Route>
    <Route element={<ProtectedRoute roles={['SUPER_ADMIN', 'GYM_ADMIN']} />}>
      <Route path="devices" element={<DevicesPage />} />
      <Route path="reports" element={<ReportsPage />} />
    </Route>
    <Route element={<ProtectedRoute roles={['SUPER_ADMIN']} />}>
      <Route path="settings" element={<SettingsPage />} />
      <Route path="super-admin" element={<SuperAdminPage />} />
    </Route>
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>
}
