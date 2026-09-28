// ==========================================================
// localStorage that cannot throw
// ==========================================================
//
// Reading localStorage at module scope (api.js resolves the API base
// URL there, theme.js is called from main.jsx before createRoot) means
// a single throw kills the app before the first paint.
//
// It genuinely throws in a WebView with DOM storage disabled, in
// Safari private mode, and when the origin's quota is exhausted.
//
// appLock.js and screenSecurity.js already guarded their access; the
// three call sites that run EARLIEST and fail hardest did not. Route
// them all through here so the behaviour is uniform.
// ==========================================================

function backend() {

    try {

        return window.localStorage ?? null;

    }
    catch {

        // Accessing the property itself throws when storage is
        // blocked by policy.
        return null;

    }

}

export function storageGet(key) {

    try {

        return backend()?.getItem(key) ?? null;

    }
    catch {

        return null;

    }

}

export function storageSet(key, value) {

    try {

        backend()?.setItem(key, value);

        return true;

    }
    catch {

        return false;

    }

}

export function storageRemove(key) {

    try {

        backend()?.removeItem(key);

        return true;

    }
    catch {

        return false;

    }

}
