# Nexara Mobile (Capacitor)

Native Android/iOS shell that wraps the existing Nexara web
frontend (`frontend/`) in a WebView. There is **no duplicated UI
code** here: this folder only contains the native shell and build
wiring; every screen comes from the single React SPA.

```
Mobile/
├── package.json            Capacitor deps + helper scripts
├── capacitor.config.json   appId / appName / webDir → ../frontend/dist
└── android/                Generated native Android project
```

## How it works

1. The web frontend is built normally (`npm run build` in `frontend/`).
2. `npx cap sync` copies `frontend/dist` into the native asset folder.
3. The native app opens that bundle in a secure WebView (`https://localhost`).

## One-time setup

```bash
cd Mobile
npm install
npx cap add android     # already done in this repo
```

Building an APK additionally requires **Android Studio** (or the
Android SDK + JDK 17). Install it, then:

```bash
cd Mobile
npm run sync            # rebuilds frontend + copies it into android/
npm run open:android    # opens the project in Android Studio
# then Build ▸ Build APK(s)
```

iOS requires macOS: `npx cap add ios && npx cap open ios`.

## Pointing the app at your server

Inside a native WebView there is no reverse proxy, so relative
`/api/v1` calls would hit the WebView's own origin. The frontend
therefore reads two env vars at **build time**:

| Env var        | Used for                        | Example                       |
|----------------|---------------------------------|-------------------------------|
| `VITE_API_URL` | REST base + attachment downloads| `https://chat.example.com`    |
| `VITE_WS_URL`  | WebSocket endpoint              | `https://chat.example.com`    |

Build the mobile bundle with them set (production):

```powershell
cd Mobile
powershell -ExecutionPolicy Bypass -File .\prod-build.ps1 -Domain chat.example.com
# then Android Studio -> Build -> Build App Bundle(s) / APK(s)
```

`prod-build.ps1` normalises the domain to `https://chat.example.com`
and `wss://chat.example.com`, rebuilds `frontend/` with both vars
baked in, and runs `npx cap sync android`. It refuses to ship
plain `http://` silently and prints a reminder of the backend env
vars that must be set.

Equivalently, set the vars yourself:

```bash
cd frontend
VITE_API_URL=https://chat.example.com \
VITE_WS_URL=https://chat.example.com npm run build
cd ../Mobile && npx cap sync android
```

(When both vars are unset the bundle behaves exactly like today's
browser build.)

### Backend requirements for the native app

Because the WebView origin (`https://localhost`) differs from your
server origin, configure these **existing** backend env vars at
deploy time (defaults are dev-friendly; see `backend/app/core/config.py`):

```env
CORS_ORIGINS=https://chat.example.com   # add your server origin (already required for web)
COOKIE_SECURE=true                      # Secure cookie (mandatory cross-site)
COOKIE_SAMESITE=None                    # allow refresh cookie from the WebView
```

- The app sends `withCredentials` on every request (set in `frontend/src/api/api.js`).
- HTTPS is mandatory on device (secure cookies + WebSockets).

## Local LAN testing (no HTTPS server)

`dev-build.ps1` rebuilds the bundle pointing at your PC over Wi-Fi
(auto-detects the LAN IP) and syncs it into the Android project:

```powershell
cd Mobile
powershell -ExecutionPolicy Bypass -File .\dev-build.ps1          # port 8000
powershell -ExecutionPolicy Bypass -File .\dev-build.ps1 -IpAddress 192.168.1.50  # manual IP
```

What it sets up for you:
- `capacitor.config.json`: `server.cleartext` + `android.allowMixedContent`
- `android/app/src/main/AndroidManifest.xml`: `usesCleartextTraffic="true"` (already applied)
- Frontend built with `VITE_API_URL=http://<lan-ip>:8000`, `VITE_WS_URL=ws://<lan-ip>:8000`

Then run the backend reachable from the phone and build the APK:

```bash
cd backend
uvicorn app.main:app --host 0.0.0.0 --port 8000   # must bind 0.0.0.0, not 127.0.0.1
```

`backend/.env` needs (one-time, already applied in this repo):

```env
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,https://localhost
```

**Dev-mode limitation:** over plain HTTP the refresh-token cookie is not
accepted cross-site, so when the short-lived access token expires you are
logged out and simply sign in again. Persistent sessions require the HTTPS
deployment described above. Windows Firewall may prompt to allow inbound
port 8000 on first run — allow it for private networks.

## Files changed outside Mobile/

- `frontend/src/api/api.js` — axios instance now prefixes
  `VITE_API_URL` (empty by default → unchanged browser behaviour)
  and sends credentials so refresh cookies work cross-origin.
