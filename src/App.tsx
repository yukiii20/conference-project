import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AuthProvider } from './lib/authContext'
import { ToastProvider } from './components/ui/Toast'
import { ProtectedRoute } from './components/ProtectedRoute'
import { SuperAdminRoute } from './components/SuperAdminRoute'
import { HomePage } from './pages/HomePage'
import { PrivacyPage } from './pages/PrivacyPage'
import { TermsPage } from './pages/TermsPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { ConferencePage } from './pages/ConferencePage'
import { SignupPage } from './pages/SignupPage'
import { LoginPage } from './pages/LoginPage'
import { ForgotPasswordPage } from './pages/ForgotPasswordPage'
import { ResetPasswordPage } from './pages/ResetPasswordPage'
import { ChangePasswordPage } from './pages/ChangePasswordPage'
import { SetPasswordPage } from './pages/SetPasswordPage'
import { ProfilePage } from './pages/ProfilePage'
import { SuperAdminLoginPage } from './pages/SuperAdminLoginPage'
import { SuperAdminPage } from './pages/SuperAdminPage'
import { AdminViewAsPage } from './pages/AdminViewAsPage'
import { ConvenorPage } from './pages/ConvenorPage'
import { PortalPage } from './pages/PortalPage'
import { VerifyCertificatePage } from './pages/VerifyCertificatePage'
import { OLD_PORTAL_REDIRECTS } from './pages/portal/sidebarConfig'

/** Old single-role URLs (bookmarked, or baked into stored notification link_path values) — kept working, query string and all. */
function OldPortalRedirect({ to }: { to: string }) {
  const location = useLocation()
  return <Navigate to={`${to}${location.search}`} replace />
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/privacy" element={<PrivacyPage />} />
            <Route path="/terms" element={<TermsPage />} />
            <Route path="/c/:slug" element={<ConferencePage />} />
            <Route path="/signup" element={<SignupPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/change-password" element={<ChangePasswordPage />} />
            <Route path="/set-password" element={<SetPasswordPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/super-admin/login" element={<SuperAdminLoginPage />} />
            <Route
              path="/super-admin"
              element={
                <SuperAdminRoute>
                  <SuperAdminPage />
                </SuperAdminRoute>
              }
            />
            <Route
              path="/super-admin/view-as/:conferenceId/*"
              element={
                <SuperAdminRoute>
                  <AdminViewAsPage />
                </SuperAdminRoute>
              }
            />
            <Route
              path="/convenor/*"
              element={
                <ProtectedRoute kind="convenor">
                  <ConvenorPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/manager/*"
              element={
                <ProtectedRoute kind="role" role="manager">
                  <ConvenorPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/portal/*"
              element={
                <ProtectedRoute kind="authenticated">
                  <PortalPage />
                </ProtectedRoute>
              }
            />
            {/* Old single-role URLs from before the shared /portal shell existed. */}
            {Object.entries(OLD_PORTAL_REDIRECTS).map(([oldPath, newPath]) => (
              <Route key={oldPath} path={oldPath} element={<OldPortalRedirect to={newPath} />} />
            ))}
            <Route path="/verify/:token" element={<VerifyCertificatePage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
