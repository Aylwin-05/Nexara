import { defineConfig } from "vite";

const BACKEND =
    process.env.VITE_BACKEND_URL || "http://127.0.0.1:8000";

export default defineConfig({
    server: {
        host: process.env.VITE_HOST === "true",
        proxy: {
            "/api": {
                target: BACKEND,
                changeOrigin: true,
            },
            "/push": {
                target: BACKEND,
                changeOrigin: true,
            },
            "/uploads": {
                target: BACKEND,
                changeOrigin: true,
            },
            "/ws": {
                target: BACKEND,
                changeOrigin: true,
                ws: true,
            },
        },
    },
    build: {
        rollupOptions: {
            output: {
                manualChunks(id) {
                    if (id.includes("node_modules/react-dom")) return "react-vendor";
                    if (id.includes("node_modules/react/") || id.includes("node_modules/react/index")) return "react-vendor";
                    if (id.includes("node_modules/react-router")) return "router";
                    if (id.includes("node_modules/@noble/")) return "noble-crypto";
                },
            },
        },
    },
    test: {
        globals: true,
        environment: "jsdom",
        setupFiles: ["./src/test-setup.js"],
        include: ["src/**/*.test.{js,jsx}"],
        coverage: {
            provider: "v8",
            include: ["src/**/*.{js,jsx}"],
        },
    },
});
