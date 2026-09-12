/**
 * Development-only logger utility
 * Logs are stripped in production builds
 */

// Check if running in development mode
// Vite sets import.meta.env.MODE and import.meta.env.DEV
const isDevelopment =
    (typeof import.meta !== 'undefined' &&
     (import.meta.env?.MODE === 'development' || import.meta.env?.DEV === true)) ||
    (typeof process !== 'undefined' && process.env?.NODE_ENV === 'development');

export const logger = {
    log: (...args) => {
        if (isDevelopment) {
            console.log(...args);
        }
    },
    warn: (...args) => {
        if (isDevelopment) {
            console.warn(...args);
        }
    },
    error: (...args) => {
        // Always log errors, but strip sensitive data in production
        if (isDevelopment) {
            console.error(...args);
        } else {
            // In production, only log the error message, not full objects
            const sanitized = args.map(arg =>
                typeof arg === 'object' && arg !== null ? '[Object]' : arg
            );
            console.error(...sanitized);
        }
    },
    debug: (...args) => {
        if (isDevelopment) {
            console.debug(...args);
        }
    },
};
