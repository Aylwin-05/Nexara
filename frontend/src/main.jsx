import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import App from "./App";
import "./index.css";
import "./styles/mobile.css";
import { AuthProvider } from "./context/AuthContext";
import ErrorBoundary from "./components/layout/ErrorBoundary";
import { applyTheme, getTheme } from "./utils/theme";
import { registerServiceWorker } from "./services/pushService";
import { initAndroidBack } from "./utils/androidBack";

applyTheme(getTheme());

// Flag the document when running inside the native Capacitor
// shell (the runtime injects window.Capacitor there, absent in
// normal browsers). CSS uses it to avoid dynamic-viewport
// quirks of older Android WebViews.
if (window.Capacitor?.isNativePlatform?.()) {
    document.documentElement.classList.add("native");
    initAndroidBack();
}

// Register the service worker for Web Push notifications.
// Idempotent; safe to run before auth (subscription itself is
// authenticated later).
void registerServiceWorker();

ReactDOM.createRoot(
    document.getElementById("root")
).render(
    <React.StrictMode>
        <ErrorBoundary>
            <BrowserRouter>
                <AuthProvider>
                    <App />
                    <Toaster position="top-right" reverseOrder={false} />
                </AuthProvider>
            </BrowserRouter>
        </ErrorBoundary>
    </React.StrictMode>
);