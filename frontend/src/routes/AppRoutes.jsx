import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import ProtectedRoute from "./ProtectedRoute";
import PublicOnlyRoute from "./PublicOnlyRoute";
import SidebarShell from "../components/layout/SidebarShell";

const Dashboard = lazy(() => import("../pages/Dashboard/Dashboard"));
const Login = lazy(() => import("../pages/Login/Login"));
const OTP = lazy(() => import("../pages/OTP/OTP"));
const RecoverPage = lazy(() => import("../pages/Recover/RecoverPage"));
const Splash = lazy(() => import("../pages/Splash/Splash"));
const LegalPage = lazy(() => import("../pages/Legal/Legal"));
const CallLog = lazy(() => import("../components/call/CallLog"));
const SettingsPage = lazy(() => import("../pages/Settings/SettingsPage"));

function PageLoader() {
    return (
        <div className="app-loading">
            <div className="spinner" />
            Loading…
        </div>
    );
}

function NotFound() {
    return (
        <div className="nf-wrap">
            <div className="nf-card">
                <h2 className="nf-code">404</h2>
                <p className="nf-title">This page went off the grid.</p>
                <p className="nf-sub">
                    The link may be mistyped, or the page was removed.
                    Message your way back home.
                </p>
                <a className="nf-home" href="/">
                    ← Back to start
                </a>
            </div>
        </div>
    );
}

export default function AppRoutes() {
    return (
        <Suspense fallback={<PageLoader />}>
            <Routes>

                <Route
                    path="/"
                    element={<Splash />}
                />

                <Route
                    path="/login"
                    element={
                        <PublicOnlyRoute>
                            <Login />
                        </PublicOnlyRoute>
                    }
                />

                <Route
                    path="/otp"
                    element={
                        <PublicOnlyRoute>
                            <OTP />
                        </PublicOnlyRoute>
                    }
                />

                <Route
                    path="/recover"
                    element={<RecoverPage />}
                />

                <Route
                    path="/privacy"
                    element={<LegalPage doc="privacy" />}
                />

                <Route
                    path="/terms"
                    element={<LegalPage doc="terms" />}
                />

                <Route
                    path="/dashboard"
                    element={
                        <ProtectedRoute>
                            <Dashboard />
                        </ProtectedRoute>
                    }
                />

                <Route
                    path="/calls"
                    element={
                        <ProtectedRoute>
                            <SidebarShell currentPage="calls">
                                <CallLog />
                            </SidebarShell>
                        </ProtectedRoute>
                    }
                />

                <Route
                    path="/settings"
                    element={
                        <ProtectedRoute>
                            <SidebarShell currentPage="settings">
                                <SettingsPage />
                            </SidebarShell>
                        </ProtectedRoute>
                    }
                />

                <Route path="*" element={<NotFound />} />

            </Routes>
        </Suspense>
    );
}
