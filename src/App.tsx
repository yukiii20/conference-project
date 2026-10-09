import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './lib/authContext'
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
import { ConvenorPage } from './pages/ConvenorPage'
import { AuthorPage } from './pages/AuthorPage'
import { ReviewerPage } from './pages/ReviewerPage'
import { StaffPage } from './pages/StaffPage'
import { ManagerPage } from './pages/ManagerPage'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
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
            path="/convenor"
            element={
              <ProtectedRoute kind="convenor">
                <ConvenorPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/author"
            element={
              <ProtectedRoute kind="role" role="author">
                <AuthorPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/reviewer"
            element={
              <ProtectedRoute kind="role" role="reviewer">
                <ReviewerPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/staff"
            element={
              <ProtectedRoute kind="role" role="staff">
                <StaffPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/manager"
            element={
              <ProtectedRoute kind="role" role="manager">
                <ManagerPage />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
