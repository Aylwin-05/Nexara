import { animate } from "animejs";

// ==========================================================
// Central animation helpers for Nexara.
//
// Every function checks `prefers-reduced-motion` and returns
// immediately when the user has opted out of animation.
// ==========================================================

const REDUCED =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Animate a single element: fade-in + slide-up.
 * Used for new message bubbles appearing.
 */
export function animateBubbleIn(el) {
    if (REDUCED || !el) return;
    animate(el, {
        opacity: [0, 1],
        y: [12, 0],
        duration: 180,
        ease: "outQuad",
    });
}

/**
 * Pulse the send button after a message is sent.
 */
export function animateSendPulse(el) {
    if (REDUCED || !el) return;
    animate(el, {
        scale: [1, 1.25, 1],
        duration: 260,
        ease: "inOutQuad",
    });
}

/**
 * Pop + bounce animation for a reaction chip.
 */
export function animateReactionPop(el) {
    if (REDUCED || !el) return;
    animate(el, {
        scale: [0, 1.3, 1],
        duration: 300,
        ease: "outElastic(1, 0.5)",
    });
}
