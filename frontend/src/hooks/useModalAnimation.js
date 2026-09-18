import { useEffect, useRef } from "react";
import { animate } from "animejs";

/**
 * Animates a modal's content element on mount.
 * Pass the overlay element ref for the backdrop fade.
 *
 * Usage:
 *   const { contentRef } = useModalAnimation();
 *   <div ref={overlayRef} className="modal-overlay">
 *     <div ref={contentRef} className="modal-content">
 */
export function useModalAnimation() {
    const contentRef = useRef(null);

    useEffect(() => {
        const el = contentRef.current;
        if (!el) return;

        const prefersReduced =
            window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (prefersReduced) return;

        animate(el, {
            opacity: [0, 1],
            scale: [0.95, 1],
            duration: 220,
            ease: "outQuad",
        });
    }, []);

    return { contentRef };
}
