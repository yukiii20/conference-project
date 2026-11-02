import { lazy, Suspense } from "react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { AuthProvider } from "./lib/authContext";
import { ToastProvider } from "./components/ui/Toast";
import { SlowRequestBanner } from "./components/SlowRequestBanner";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { SuperAdminRoute } from "./components/SuperAdminRoute";
import { PageLoading } from "./components/PageLoading";
import { HomePage } from "./pages/HomePage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { OLD_PORTAL_REDIRECTS } from "./pages/portal/sidebarConfig";

// Route-based code splitting for the big, role-gated portals - a visitor who
// never signs in (or signs in as an attendee) never downloads any of this.
// ConvenorPage is also used by AdminViewAsPage, which lazy-imports it the
// same way - Vite/Rollup dedupe both dynamic imports into one shared chunk.
// Every other page is split out too, so the home page - most visitors' first
// load - only downloads what it renders.
const PrivacyPage = lazy(() =>
  import("./pages/PrivacyPage").then((m) => ({ default: m.PrivacyPage })),
);
const TermsPage = lazy(() =>
  import("./pages/TermsPage").then((m) => ({ default: m.TermsPage })),
);
const TeamPage = lazy(() =>
  import("./pages/TeamPage").then((m) => ({ default: m.TeamPage })),
);
const ConferencePage = lazy(() =>
  import("./pages/ConferencePage").then((m) => ({ default: m.ConferencePage })),
);
const SignupPage = lazy(() =>
  import("./pages/SignupPage").then((m) => ({ default: m.SignupPage })),
);
const LoginPage = lazy(() =>
  import("./pages/LoginPage").then((m) => ({ default: m.LoginPage })),
);
const ForgotPasswordPage = lazy(() =>
  import("./pages/ForgotPasswordPage").then((m) => ({
    default: m.ForgotPasswordPage,
  })),
);
const ResetPasswordPage = lazy(() =>
  import("./pages/ResetPasswordPage").then((m) => ({
    default: m.ResetPasswordPage,
  })),
);
const ChangePasswordPage = lazy(() =>
  import("./pages/ChangePasswordPage").then((m) => ({
    default: m.ChangePasswordPage,
  })),
);
const SetPasswordPage = lazy(() =>
  import("./pages/SetPasswordPage").then((m) => ({
    default: m.SetPasswordPage,
  })),
);
const ProfilePage = lazy(() =>
  import("./pages/ProfilePage").then((m) => ({ default: m.ProfilePage })),
);
const SuperAdminLoginPage = lazy(() =>
  import("./pages/SuperAdminLoginPage").then((m) => ({
    default: m.SuperAdminLoginPage,
  })),
);
const VerifyCertificatePage = lazy(() =>
  import("./pages/VerifyCertificatePage").then((m) => ({
    default: m.VerifyCertificatePage,
  })),
);
const ConferenceLoginPage = lazy(() =>
  import("./pages/conferenceAuth/ConferenceLoginPage").then((m) => ({
    default: m.ConferenceLoginPage,
  })),
);
const ConferenceSignupPage = lazy(() =>
  import("./pages/conferenceAuth/ConferenceSignupPage").then((m) => ({
    default: m.ConferenceSignupPage,
  })),
);
const ConferenceForgotPasswordPage = lazy(() =>
  import("./pages/conferenceAuth/ConferenceForgotPasswordPage").then((m) => ({
    default: m.ConferenceForgotPasswordPage,
  })),
);
const SuperAdminPage = lazy(() =>
  import("./pages/SuperAdminPage").then((m) => ({ default: m.SuperAdminPage })),
);
const AdminViewAsPage = lazy(() =>
  import("./pages/AdminViewAsPage").then((m) => ({
    default: m.AdminViewAsPage,
  })),
);
const ConvenorPage = lazy(() =>
  import("./pages/ConvenorPage").then((m) => ({ default: m.ConvenorPage })),
);
const PortalPage = lazy(() =>
  import("./pages/PortalPage").then((m) => ({ default: m.PortalPage })),
);
const SessionTimerPage = lazy(() =>
  import("./pages/SessionTimerPage").then((m) => ({
    default: m.SessionTimerPage,
  })),
);

/** Old single-role URLs (bookmarked, or baked into stored notification link_path values) — kept working, query string and all. */
function OldPortalRedirect({ to }: { to: string }) {
  const location = useLocation();
  return <Navigate to={`${to}${location.search}`} replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <SlowRequestBanner />
          <Suspense fallback={<PageLoading />}>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/privacy" element={<PrivacyPage />} />
              <Route path="/terms" element={<TermsPage />} />
              <Route path="/SYPN" element={<TeamPage />} />
              <Route path="/c/:slug" element={<ConferencePage />} />
              {/* Each conference's own account pages; a role only works at its own conference. */}
              <Route path="/c/:slug/login" element={<ConferenceLoginPage />} />
              <Route
                path="/c/:slug/signup"
                element={<ConferenceSignupPage />}
              />
              <Route
                path="/c/:slug/forgot-password"
                element={<ConferenceForgotPasswordPage />}
              />
              <Route
                path="/c/:slug/reset-password"
                element={<ResetPasswordPage />}
              />
              {/* Generic /signup and /login: "Choose your conference". */}
              <Route path="/signup" element={<SignupPage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/forgot-password" element={<ForgotPasswordPage />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />
              <Route path="/change-password" element={<ChangePasswordPage />} />
              <Route path="/set-password" element={<SetPasswordPage />} />
              <Route path="/profile" element={<ProfilePage />} />
              <Route
                path="/super-admin/login"
                element={<SuperAdminLoginPage />}
              />
              <Route
                path="/super-admin"
                element={
                  <SuperAdminRoute>
                    <Suspense fallback={<PageLoading />}>
                      <SuperAdminPage />
                    </Suspense>
                  </SuperAdminRoute>
                }
              />
              <Route
                path="/super-admin/view-as/:conferenceId/*"
                element={
                  <SuperAdminRoute>
                    <Suspense fallback={<PageLoading />}>
                      <AdminViewAsPage />
                    </Suspense>
                  </SuperAdminRoute>
                }
              />
              <Route
                path="/convenor/*"
                element={
                  <ProtectedRoute kind="convenor">
                    <Suspense fallback={<PageLoading />}>
                      <ConvenorPage />
                    </Suspense>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/manager/*"
                element={
                  <ProtectedRoute kind="role" role="manager">
                    <Suspense fallback={<PageLoading />}>
                      <ConvenorPage />
                    </Suspense>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/portal/*"
                element={
                  <ProtectedRoute kind="authenticated">
                    <Suspense fallback={<PageLoading />}>
                      <PortalPage />
                    </Suspense>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/timer/:conferenceId/:sessionId"
                element={
                  <ProtectedRoute kind="authenticated">
                    <Suspense fallback={<PageLoading />}>
                      <SessionTimerPage />
                    </Suspense>
                  </ProtectedRoute>
                }
              />
              {/* Old single-role URLs from before the shared /portal shell existed. */}
              {Object.entries(OLD_PORTAL_REDIRECTS).map(
                ([oldPath, newPath]) => (
                  <Route
                    key={oldPath}
                    path={oldPath}
                    element={<OldPortalRedirect to={newPath} />}
                  />
                ),
              )}
              <Route
                path="/verify/:token"
                element={<VerifyCertificatePage />}
              />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </Suspense>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
