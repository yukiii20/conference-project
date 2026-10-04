import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { ProtectedRoute } from './components/ProtectedRoute'
import { SignupPage } from './pages/SignupPage'
import { LoginPage } from './pages/LoginPage'
import { ForgotPasswordPage } from './pages/ForgotPasswordPage'
import { ResetPasswordPage } from './pages/ResetPasswordPage'
import { ConvenorPage } from './pages/ConvenorPage'
import { AuthorPage } from './pages/AuthorPage'
import { ReviewerPage } from './pages/ReviewerPage'
import { ChairPage } from './pages/ChairPage'
import { StaffPage } from './pages/StaffPage'
import { ManagerPage } from './pages/ManagerPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
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
          path="/chair"
          element={
            <ProtectedRoute kind="role" role="session_chair">
              <ChairPage />
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
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
