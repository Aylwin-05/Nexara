import { useId } from "react";

// ==========================================================
// Animated in-chat presence pets.
//
// Each pet is inline SVG built to read as a soft 3D character:
// - 4-stop radial body gradients (top-left light source)
// - ambient occlusion shading under chin/belly
// - a soft grounding shadow at the feet (sells the "standing
//   on the topbar line" look)
// - rim light along the top of the head and glossy specular
//   highlights on eyes/nose
// driven by pure CSS keyframes (see Chat.css): blinking eyes,
// breathing body, tongue, ear wiggle. No animation libraries.
// `style === "default"` (or unknown) renders nothing - the
// caller falls back to the regular username avatar.
//
// NOTE: the animation CSS targets class names, not shapes, so
// every animated part keeps the class it had before (pp-eye,
// pp-cat-ears, pp-rabbit-ear, pp-owl-bob, pp-tongue, pp-nose).
// ==========================================================

const RIM = 1.4;

function Cat({ uid }) {
    const g = (name) => `url(#${uid}-${name})`;
    const id = (name) => `${uid}-${name}`;
    return (
        <svg
            className="pp-pet pp-cat"
            viewBox="0 0 48 48"
            aria-hidden="true"
        >
            <defs>
                <radialGradient id={id("catBody")} cx="0.4" cy="0.24" r="1.05">
                    <stop offset="0%" stopColor="#fff1d2" />
                    <stop offset="35%" stopColor="#ffdca8" />
                    <stop offset="72%" stopColor="#f7a854" />
                    <stop offset="100%" stopColor="#c97a2e" />
                </radialGradient>
                <radialGradient id={id("catEar")} cx="0.4" cy="0.32" r="0.95">
                    <stop offset="0%" stopColor="#ffdfb0" />
                    <stop offset="100%" stopColor="#cf7b2e" />
                </radialGradient>
                <radialGradient id={id("catAo")} cx="0.5" cy="0.3" r="0.8">
                    <stop offset="0%" stopColor="#8a4c16" stopOpacity="0.5" />
                    <stop offset="100%" stopColor="#8a4c16" stopOpacity="0" />
                </radialGradient>
                <radialGradient id={id("catSheen")} cx="0.45" cy="0.35" r="0.8">
                    <stop offset="0%" stopColor="#ffffff" stopOpacity="0.55" />
                    <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
                </radialGradient>
                <radialGradient id={id("catGround")} cx="0.5" cy="0.5" r="0.5">
                    <stop offset="0%" stopColor="#000000" stopOpacity="0.22" />
                    <stop offset="100%" stopColor="#000000" stopOpacity="0" />
                </radialGradient>
            </defs>

            <g className="pp-cat-ears">
                <path d="M15 14 L6 3 Q11 3.5 20 8 Z" fill={g("catEar")} />
                <path
                    d="M13.6 11.8 L9.2 5.4 Q13 6.6 17.6 8.4 Z"
                    fill="#ffb8c6"
                    opacity="0.9"
                />
                <path d="M33 14 L42 3 Q37 3.5 28 8 Z" fill={g("catEar")} />
                <path
                    d="M34.4 11.8 L38.8 5.4 Q35 6.6 30.4 8.4 Z"
                    fill="#ffb8c6"
                    opacity="0.9"
                />
            </g>

            <circle className="pp-body" cx="24" cy="26" r="15" fill={g("catBody")} />

            <ellipse
                className="pp-body"
                cx="24"
                cy="37.5"
                rx="10.5"
                ry="8"
                fill={g("catBody")}
            />

            <ellipse
                className="pp-body"
                cx="24"
                cy="32.5"
                rx="8.5"
                ry="6.5"
                fill="#fff6e8"
                opacity="0.85"
            />

            <ellipse
                cx="24"
                cy="37"
                rx="10"
                ry="4.6"
                fill={g("catAo")}
                transform="rotate(-7 24 37)"
            />

            <g fill="#c2691f">
                <ellipse cx="16" cy="45.2" rx="4.3" ry="3.5" />
                <ellipse cx="32" cy="45.2" rx="4.3" ry="3.5" />
            </g>
            <g fill="#7e4a10" opacity="0.85">
                <ellipse cx="13.7" cy="45.6" rx="0.9" ry="1.2" />
                <ellipse cx="16.3" cy="46" rx="0.9" ry="1.2" />
                <ellipse cx="18.9" cy="45.6" rx="0.9" ry="1.2" />
                <ellipse cx="29.5" cy="45.6" rx="0.9" ry="1.2" />
                <ellipse cx="32.1" cy="46" rx="0.9" ry="1.2" />
                <ellipse cx="34.7" cy="45.6" rx="0.9" ry="1.2" />
            </g>

            <g className="pp-eye">
                <circle cx="19" cy="24" r="3.4" fill="#ffffff" />
                <circle className="pp-pupil" cx="19" cy="24" r="1.9" />
                <circle cx="19.9" cy="23.1" r="0.8" fill="#ffffff" />
            </g>
            <g className="pp-eye pp-delay-1">
                <circle cx="29" cy="24" r="3.4" fill="#ffffff" />
                <circle className="pp-pupil" cx="29" cy="24" r="1.9" />
                <circle cx="29.9" cy="23.1" r="0.8" fill="#ffffff" />
                <circle cx="29.5" cy="25" r="0.4" fill="#ffffff" />
            </g>

            <path d="M22.8 30.4 L25.2 30.4 L24 32.3 Z" fill="#ff8fa3" />
            <circle cx="23.6" cy="30.7" r="0.7" fill="#ffffff" opacity="0.85" />

            <path
                className="pp-detail"
                strokeWidth={1.4}
                d="M24 32.3 q-2.6 -2.6 -5.2 0 M24 32.3 q2.6 -2.6 5.2 0"
            />

            <g
                stroke="#3a2d23"
                strokeWidth={1.1}
                opacity="0.32"
                strokeLinecap="round"
            >
                <path d="M13.5 24 L6 22.6" />
                <path d="M13.5 27.4 L6 28.4" />
                <path d="M34.5 24 L42 22.6" />
                <path d="M34.5 27.4 L42 28.4" />
            </g>

            <circle className="pp-blush" cx="15.5" cy="30" r="2.2" />
            <circle className="pp-blush" cx="32.5" cy="30" r="2.2" />

            <ellipse
                cx="24"
                cy="45.2"
                rx="10.5"
                ry="2.1"
                fill={g("catGround")}
            />

            <ellipse cx="16" cy="17" rx="8" ry="5.5" fill={g("catSheen")} transform="rotate(-25 16 17)" />
            <path
                d="M14 17 Q24 9.5 34 17"
                stroke="#ffffff"
                strokeWidth={RIM}
                fill="none"
                strokeLinecap="round"
                opacity="0.55"
            />
        </svg>
    );
}

function Dog({ uid }) {
    const g = (name) => `url(#${uid}-${name})`;
    const id = (name) => `${uid}-${name}`;
    return (
        <svg
            className="pp-pet pp-dog"
            viewBox="0 0 48 48"
            aria-hidden="true"
        >
            <defs>
                <radialGradient id={id("dogBody")} cx="0.4" cy="0.24" r="1.05">
                    <stop offset="0%" stopColor="#fff4e0" />
                    <stop offset="35%" stopColor="#f4d2a4" />
                    <stop offset="72%" stopColor="#dca76f" />
                    <stop offset="100%" stopColor="#b0773f" />
                </radialGradient>
                <radialGradient id={id("dogEar")} cx="0.5" cy="0.2" r="1">
                    <stop offset="0%" stopColor="#c1875c" />
                    <stop offset="100%" stopColor="#6f4a24" />
                </radialGradient>
                <radialGradient id={id("dogAo")} cx="0.5" cy="0.3" r="0.8">
                    <stop offset="0%" stopColor="#6b4216" stopOpacity="0.5" />
                    <stop offset="100%" stopColor="#6b4216" stopOpacity="0" />
                </radialGradient>
                <radialGradient id={id("dogSheen")} cx="0.45" cy="0.35" r="0.8">
                    <stop offset="0%" stopColor="#ffffff" stopOpacity="0.5" />
                    <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
                </radialGradient>
                <radialGradient id={id("dogGround")} cx="0.5" cy="0.5" r="0.5">
                    <stop offset="0%" stopColor="#000000" stopOpacity="0.22" />
                    <stop offset="100%" stopColor="#000000" stopOpacity="0" />
                </radialGradient>
            </defs>

            <g fill={g("dogEar")}>
                <ellipse
                    cx="9.5"
                    cy="26"
                    rx="4.6"
                    ry="11"
                    transform="rotate(-14 9.5 26)"
                />
                <ellipse
                    cx="38.5"
                    cy="26"
                    rx="4.6"
                    ry="11"
                    transform="rotate(14 38.5 26)"
                />
            </g>

            <circle className="pp-body" cx="24" cy="27" r="15" fill={g("dogBody")} />

            <ellipse
                className="pp-body"
                cx="24"
                cy="39.5"
                rx="10.5"
                ry="7"
                fill={g("dogBody")}
            />

            <ellipse
                className="pp-body"
                cx="24"
                cy="32.5"
                rx="8.6"
                ry="6.6"
                fill="#fff6ea"
                opacity="0.92"
            />

            <ellipse
                cx="24"
                cy="37.5"
                rx="10"
                ry="4.8"
                fill={g("dogAo")}
                transform="rotate(-7 24 37.5)"
            />

            <g fill="#a96e3b">
                <ellipse cx="16" cy="45.4" rx="4.4" ry="3.6" />
                <ellipse cx="32" cy="45.4" rx="4.4" ry="3.6" />
            </g>
            <g fill="#6d4118" opacity="0.85">
                <ellipse cx="13.6" cy="45.8" rx="1" ry="1.3" />
                <ellipse cx="16.2" cy="46.2" rx="1" ry="1.3" />
                <ellipse cx="18.8" cy="45.8" rx="1" ry="1.3" />
                <ellipse cx="29.4" cy="45.8" rx="1" ry="1.3" />
                <ellipse cx="32" cy="46.2" rx="1" ry="1.3" />
                <ellipse cx="34.6" cy="45.8" rx="1" ry="1.3" />
            </g>

            <g className="pp-eye">
                <circle cx="19" cy="25" r="3.4" fill="#ffffff" />
                <circle className="pp-pupil" cx="19" cy="25" r="1.9" />
                <circle cx="19.9" cy="24.1" r="0.8" fill="#ffffff" />
            </g>
            <g className="pp-eye pp-delay-1">
                <circle cx="29" cy="25" r="3.4" fill="#ffffff" />
                <circle className="pp-pupil" cx="29" cy="25" r="1.9" />
                <circle cx="29.9" cy="24.1" r="0.8" fill="#ffffff" />
                <circle cx="29.5" cy="26" r="0.4" fill="#ffffff" />
            </g>

            <ellipse className="pp-nose" cx="24" cy="30.6" rx="2.9" ry="2.2" />
            <circle cx="23.4" cy="29.9" r="0.7" fill="#ffffff" opacity="0.85" />

            <rect className="pp-tongue" x="22.2" y="36" width="3.6" height="5.6" rx="1.8" />

            <circle className="pp-blush" cx="15" cy="30" r="2.4" />
            <circle className="pp-blush" cx="33" cy="30" r="2.4" />

            <ellipse
                cx="24"
                cy="45.8"
                rx="11"
                ry="2.2"
                fill={g("dogGround")}
            />

            <ellipse cx="16.5" cy="19" rx="8.5" ry="6" fill={g("dogSheen")} transform="rotate(-25 16.5 19)" />
            <path
                d="M13.5 17.5 Q24 9.5 34.5 17.5"
                stroke="#ffffff"
                strokeWidth={RIM}
                fill="none"
                strokeLinecap="round"
                opacity="0.5"
            />
        </svg>
    );
}

function Owl({ uid }) {
    const g = (name) => `url(#${uid}-${name})`;
    const id = (name) => `${uid}-${name}`;
    return (
        <svg
            className="pp-pet pp-owl"
            viewBox="0 0 48 48"
            aria-hidden="true"
        >
            <defs>
                <radialGradient id={id("owlBody")} cx="0.4" cy="0.24" r="1.05">
                    <stop offset="0%" stopColor="#efe5ff" />
                    <stop offset="35%" stopColor="#c4b4f7" />
                    <stop offset="72%" stopColor="#9b8be8" />
                    <stop offset="100%" stopColor="#6a57c2" />
                </radialGradient>
                <radialGradient id={id("owlBelly")} cx="0.5" cy="0.3" r="0.9">
                    <stop offset="0%" stopColor="#fffffa" />
                    <stop offset="45%" stopColor="#fdf1e2" />
                    <stop offset="100%" stopColor="#e0c6a8" />
                </radialGradient>
                <radialGradient id={id("owlAo")} cx="0.5" cy="0.3" r="0.8">
                    <stop offset="0%" stopColor="#3d2d82" stopOpacity="0.45" />
                    <stop offset="100%" stopColor="#3d2d82" stopOpacity="0" />
                </radialGradient>
                <radialGradient id={id("owlSheen")} cx="0.45" cy="0.35" r="0.8">
                    <stop offset="0%" stopColor="#ffffff" stopOpacity="0.5" />
                    <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
                </radialGradient>
                <radialGradient id={id("owlGround")} cx="0.5" cy="0.5" r="0.5">
                    <stop offset="0%" stopColor="#000000" stopOpacity="0.22" />
                    <stop offset="100%" stopColor="#000000" stopOpacity="0" />
                </radialGradient>
            </defs>

            <g className="pp-owl-bob">
                <path d="M13 12.5 L9.5 3.5 L18 9.5 Z" fill="#8a79d4" />
                <path d="M35 12.5 L38.5 3.5 L30 9.5 Z" fill="#8a79d4" />

                <g fill="#8a79d4">
                    <ellipse
                        cx="6.5"
                        cy="30"
                        rx="3.4"
                        ry="9"
                        transform="rotate(-12 6.5 30)"
                    />
                    <ellipse
                        cx="41.5"
                        cy="30"
                        rx="3.4"
                        ry="9"
                        transform="rotate(12 41.5 30)"
                    />
                </g>

                <circle className="pp-body" cx="24" cy="29" r="16" fill={g("owlBody")} />

                <ellipse
                    className="pp-body"
                    cx="24"
                    cy="33.5"
                    rx="10.5"
                    ry="8.5"
                    fill={g("owlBelly")}
                />

                <ellipse
                    cx="24"
                    cy="37"
                    rx="10.5"
                    ry="5"
                    fill={g("owlAo")}
                    transform="rotate(-6 24 37)"
                />

                <g stroke="#d9c9ee" strokeWidth={1.1} fill="none" strokeLinecap="round" opacity="0.9">
                    <path d="M19.5 34.5 q2.4 2.4 4.8 0" />
                    <path d="M22 37.2 q2.4 2.4 4.8 0" />
                </g>

                <g className="pp-eye">
                    <circle cx="18" cy="24" r="6.4" fill="#ffd374" />
                    <circle className="pp-pupil" cx="18" cy="24" r="3.4" />
                    <circle cx="19.2" cy="22.8" r="1.2" fill="#ffffff" />
                </g>
                <g className="pp-eye pp-delay-1">
                    <circle cx="30" cy="24" r="6.4" fill="#ffd374" />
                    <circle className="pp-pupil" cx="30" cy="24" r="3.4" />
                    <circle cx="31.2" cy="22.8" r="1.2" fill="#ffffff" />
                    <circle cx="30.5" cy="25.4" r="0.6" fill="#ffffff" />
                </g>

                <path d="M24 30.2 l-2.6 -1 q2.6 2.8 5.2 0 Z" fill="#f7a45c" />
                <circle cx="24.2" cy="29.6" r="0.7" fill="#ffffff" opacity="0.8" />

                <g fill="#6f5cc4">
                    <ellipse cx="15.2" cy="45.4" rx="4.6" ry="2.4" />
                    <ellipse cx="31" cy="45.4" rx="4.6" ry="2.4" />
                </g>
                <g fill="#524099" opacity="0.9">
                    <ellipse cx="12" cy="45.6" rx="0.8" ry="1.1" />
                    <ellipse cx="14.9" cy="46" rx="0.8" ry="1.1" />
                    <ellipse cx="17.8" cy="45.6" rx="0.8" ry="1.1" />
                    <ellipse cx="27.8" cy="45.6" rx="0.8" ry="1.1" />
                    <ellipse cx="30.7" cy="46" rx="0.8" ry="1.1" />
                    <ellipse cx="33.6" cy="45.6" rx="0.8" ry="1.1" />
                </g>

                <ellipse
                    cx="24"
                    cy="46"
                    rx="12"
                    ry="2.3"
                    fill={g("owlGround")}
                />

                <ellipse cx="15" cy="18" rx="9" ry="6" fill={g("owlSheen")} transform="rotate(-28 15 18)" />
                <path
                    d="M12.5 20 Q24 10.5 35.5 20"
                    stroke="#ffffff"
                    strokeWidth={RIM}
                    fill="none"
                    strokeLinecap="round"
                    opacity="0.5"
                />
            </g>
        </svg>
    );
}

function Rabbit({ uid }) {
    const g = (name) => `url(#${uid}-${name})`;
    const id = (name) => `${uid}-${name}`;
    return (
        <svg
            className="pp-pet pp-rabbit"
            viewBox="0 0 48 48"
            aria-hidden="true"
        >
            <defs>
                <radialGradient id={id("rabbitBody")} cx="0.4" cy="0.24" r="1.05">
                    <stop offset="0%" stopColor="#fff6f9" />
                    <stop offset="35%" stopColor="#fbdbe3" />
                    <stop offset="72%" stopColor="#efb9c6" />
                    <stop offset="100%" stopColor="#d68a9c" />
                </radialGradient>
                <radialGradient id={id("rabbitEar")} cx="0.5" cy="0.15" r="1">
                    <stop offset="0%" stopColor="#fff2f6" />
                    <stop offset="100%" stopColor="#df93a6" />
                </radialGradient>
                <radialGradient id={id("rabbitAo")} cx="0.5" cy="0.3" r="0.8">
                    <stop offset="0%" stopColor="#bb5f76" stopOpacity="0.45" />
                    <stop offset="100%" stopColor="#bb5f76" stopOpacity="0" />
                </radialGradient>
                <radialGradient id={id("rabbitSheen")} cx="0.45" cy="0.35" r="0.8">
                    <stop offset="0%" stopColor="#ffffff" stopOpacity="0.55" />
                    <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
                </radialGradient>
                <radialGradient id={id("rabbitGround")} cx="0.5" cy="0.5" r="0.5">
                    <stop offset="0%" stopColor="#000000" stopOpacity="0.2" />
                    <stop offset="100%" stopColor="#000000" stopOpacity="0" />
                </radialGradient>
            </defs>

            <g className="pp-body pp-rabbit-ear">
                <ellipse
                    cx="20"
                    cy="9"
                    rx="3.9"
                    ry="10.5"
                    fill={g("rabbitEar")}
                    transform="rotate(-7 20 9)"
                />
                <ellipse
                    cx="19.2"
                    cy="9"
                    rx="1.7"
                    ry="7.8"
                    fill="#ffd1dc"
                    transform="rotate(-7 19.2 9)"
                />
            </g>
            <g className="pp-body pp-rabbit-ear pp-delay-1">
                <ellipse
                    cx="28"
                    cy="9"
                    rx="3.9"
                    ry="10.5"
                    fill={g("rabbitEar")}
                    transform="rotate(7 28 9)"
                />
                <ellipse
                    cx="28.8"
                    cy="9"
                    rx="1.7"
                    ry="7.8"
                    fill="#ffd1dc"
                    transform="rotate(7 28.8 9)"
                />
            </g>

            <circle className="pp-body" cx="35" cy="33" r="3.8" fill="#ffffff" opacity="0.9" />

            <ellipse
                className="pp-body"
                cx="24"
                cy="31"
                rx="13.5"
                ry="12.5"
                fill={g("rabbitBody")}
            />

            <ellipse
                className="pp-body"
                cx="24"
                cy="33.5"
                rx="6.8"
                ry="5.2"
                fill="#fff8f8"
                opacity="0.85"
            />

            <ellipse
                cx="24"
                cy="36"
                rx="9.5"
                ry="4.8"
                fill={g("rabbitAo")}
                transform="rotate(-6 24 36)"
            />

            <g fill="#c47387">
                <ellipse cx="16" cy="44.8" rx="4.3" ry="3.4" />
                <ellipse cx="32" cy="44.8" rx="4.3" ry="3.4" />
            </g>
            <g fill="#8d4a5c" opacity="0.85">
                <ellipse cx="13.7" cy="45.2" rx="0.9" ry="1.2" />
                <ellipse cx="16.3" cy="45.6" rx="0.9" ry="1.2" />
                <ellipse cx="18.9" cy="45.2" rx="0.9" ry="1.2" />
                <ellipse cx="29.5" cy="45.2" rx="0.9" ry="1.2" />
                <ellipse cx="32.1" cy="45.6" rx="0.9" ry="1.2" />
                <ellipse cx="34.7" cy="45.2" rx="0.9" ry="1.2" />
            </g>

            <g className="pp-eye">
                <circle cx="19" cy="28" r="3.2" fill="#ffffff" />
                <circle className="pp-pupil" cx="19" cy="28" r="1.8" />
                <circle cx="19.8" cy="27.2" r="0.8" fill="#ffffff" />
            </g>
            <g className="pp-eye pp-delay-1">
                <circle cx="29" cy="28" r="3.2" fill="#ffffff" />
                <circle className="pp-pupil" cx="29" cy="28" r="1.8" />
                <circle cx="29.8" cy="27.2" r="0.8" fill="#ffffff" />
                <circle cx="29.4" cy="29" r="0.4" fill="#ffffff" />
            </g>

            <path d="M22.6 33 L25.4 33 L24 35.2 Z" fill="#ff9fb2" />
            <circle cx="23.6" cy="33.8" r="0.7" fill="#ffffff" opacity="0.85" />

            <path
                className="pp-detail"
                strokeWidth={1.3}
                d="M24 35.2 q-1.7 -2 -3.5 0 M24 35.2 q1.7 -2 3.5 0"
            />

            <g
                stroke="#3a2d23"
                strokeWidth={1.1}
                opacity="0.25"
                strokeLinecap="round"
            >
                <path d="M15 32.8 L8 31.5" />
                <path d="M15 35.6 L8 36.8" />
                <path d="M33 32.8 L40 31.5" />
                <path d="M33 35.6 L40 36.8" />
            </g>

            <circle className="pp-blush" cx="15.5" cy="32" r="2.1" />
            <circle className="pp-blush" cx="32.5" cy="32" r="2.1" />

            <ellipse
                cx="24"
                cy="45.2"
                rx="10.5"
                ry="2"
                fill={g("rabbitGround")}
            />

            <ellipse cx="14.5" cy="20" rx="7.5" ry="5.5" fill={g("rabbitSheen")} transform="rotate(-25 14.5 20)" />
            <path
                d="M14 21 Q24 12.5 34 21"
                stroke="#ffffff"
                strokeWidth={RIM}
                fill="none"
                strokeLinecap="round"
                opacity="0.5"
            />
        </svg>
    );
}

const PRESENCE_PETS = {
    cat: Cat,
    dog: Dog,
    owl: Owl,
    rabbit: Rabbit,
};

export default function PresencePet({ style, className = "" }) {
    const Pet = PRESENCE_PETS[style];

    // Unique gradient namespace: stamp each pet with a per-instance
    // id so `url(#…)` fills resolve to ITS OWN <defs>. Without this,
    // two same-species pets (header + composer, composer + profile)
    // collide on identical gradient ids and the first occurrence in
    // DOM order wins — if that one sits inside a display:none copy,
    // the visible pet's body is never painted.
    const uid = useId();
    const gradientUid = "pp" + uid.replace(/[^a-zA-Z0-9]/g, "");

    if (!Pet) return null;

    return (
        <span className={`pp-wrap ${className}`}>
            <Pet uid={gradientUid} />
        </span>
    );
}