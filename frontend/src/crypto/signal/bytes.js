// ==========================================================
// Nexara Byte Utilities
//
// Browser-compatible byte helpers: base64, hex, concat.
// The backend uses raw 32-byte keys; the API layer uses base64.
// ==========================================================

// ==========================================================
// Uint8Array <-> Base64
// ==========================================================

export function b64encode(bytes) {
    const binary = String.fromCharCode(...bytes);
    return btoa(binary);
}

export function b64decode(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

export function arrayBufferToBase64(buffer) {
    return b64encode(new Uint8Array(buffer));
}

export function base64ToArrayBuffer(base64) {
    return b64decode(base64).buffer;
}

// ==========================================================
// Uint8Array <-> Hex
// ==========================================================

export function hexEncode(bytes) {
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function hexDecode(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    return bytes;
}

// ==========================================================
// Concatenation
// ==========================================================

export function concatBytes(...arrays) {
    const total = arrays.reduce((acc, a) => acc + a.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const arr of arrays) {
        out.set(arr, offset);
        offset += arr.length;
    }
    return out;
}

// ==========================================================
// Strings
// ==========================================================

export function utf8Encode(text) {
    return new TextEncoder().encode(text);
}

export function utf8Decode(bytes) {
    return new TextDecoder().decode(bytes);
}

// ==========================================================
// Random
// ==========================================================

export function randomBytes(length) {
    return crypto.getRandomValues(new Uint8Array(length));
}