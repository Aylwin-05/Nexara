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
import { isNative } from "./utils/platform";

applyTheme(getTheme());

// Flag the document when running inside the native Capacitor
// shell (the runtime injects window.Capacitor there, absent in
// normal browsers). CSS uses it to avoid dynamic-viewport
// quirks of older Android WebViews.
if (isNative()) {
    document.documentElement.classList.add("native");
    initAndroidBack();
} else {
    // Web Push only. In the native shell this registered
    // https://localhost/sw.js inside the WebView, where a service
    // worker is at best dead weight and at worst able to pin a
    // stale bundle. The native shell has no web-push origin.
    void registerServiceWorker();
}

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
