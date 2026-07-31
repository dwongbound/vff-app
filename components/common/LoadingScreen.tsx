"use client";
// Full-screen loading splash shown while the app boots or a route loads.
//
// The club's orange-and-white 172 holds a gentle cruise while clouds stream
// past and the prop spins; the club name breathes underneath. Wired into
// app/loading.tsx so Next.js shows it during route-level Suspense, and into
// LoadingProvider for in-app navigations.
//
// Everything is inline SVG + CSS keyframes (see tailwind.config.ts): no image
// requests, so the splash paints on the very first frame.
import { CLUB_NAME } from "@/lib/constants";

// Fixed subtext — the same on every full-screen loader, by design. It's what
// you shout out the window before you turn the key.
const SUBTEXT = "Clear prop!";

// Paint scheme, pulled from the airplane: white with an orange cheatline.
const ORANGE = "#e9601c";
const ORANGE_DARK = "#c64912";
const BODY = "#ffffff";
const OUTLINE = "#94a3b8"; // slate-400 — keeps the white body readable on light bg
const GLASS = "#7dd3fc"; // sky-300 windows

// Clouds streaming past: each gets its own lane, size, and timing so the sky
// never looks like a repeating loop.
const CLOUDS = [
  { top: "12%", scale: 0.7, delay: "0s", dur: "5.5s", opacity: 0.55 },
  { top: "62%", scale: 1, delay: "1.4s", dur: "4s", opacity: 0.8 },
  { top: "38%", scale: 0.5, delay: "2.8s", dur: "6.5s", opacity: 0.4 },
];

export default function LoadingScreen() {
  return (
    // z-20 sits below the sticky navbar (z-30) so the nav stays visible while
    // a page loads.
    <div
      role="status"
      aria-label="Loading"
      className="fixed inset-0 z-20 flex flex-col items-center justify-center gap-8
        bg-gray-50 dark:bg-gray-900"
    >
      {/* Sky: the drifting clouds and the sun glare sit behind the airplane. */}
      <div className="relative flex h-44 w-72 items-center justify-center overflow-hidden">
        {/* Sun glare through haze — the same radiating rings the app uses for
            any "something is happening" moment. */}
        <span
          className="absolute h-24 w-24 rounded-full animate-radiate"
          style={{ backgroundColor: "rgba(233,96,28,0.18)" }}
        />
        <span
          className="absolute h-24 w-24 rounded-full animate-radiate"
          style={{ backgroundColor: "rgba(125,211,252,0.20)", animationDelay: "1s" }}
        />

        {CLOUDS.map((cloud, i) => (
          <span
            key={i}
            aria-hidden="true"
            className="absolute left-0 animate-drift"
            style={{
              top: cloud.top,
              animationDelay: cloud.delay,
              animationDuration: cloud.dur,
              transform: `scale(${cloud.scale})`,
              opacity: cloud.opacity,
            }}
          >
            <Cloud />
          </span>
        ))}

        {/* The airplane itself — stationary, bobbing, with the world moving
            past it (which is what flying actually feels like). */}
        <svg
          viewBox="0 0 260 130"
          className="relative h-36 w-64 animate-fly"
          aria-hidden="true"
        >
          {/* Horizontal stabilizer */}
          <path
            d="M22 68 L74 64 L74 76 L22 78 Z"
            fill={BODY}
            stroke={OUTLINE}
            strokeWidth="2"
            strokeLinejoin="round"
          />
          {/* Vertical fin, orange like the real airplane's tail */}
          <path
            d="M28 72 L46 26 L62 26 Q70 44 74 66 Z"
            fill={ORANGE}
            stroke={ORANGE_DARK}
            strokeWidth="2"
            strokeLinejoin="round"
          />

          {/* Fuselage: tailcone on the left, blunt cowling on the right */}
          <path
            d="M26 74
               Q70 84 108 86
               L176 86
               Q206 86 216 76
               Q220 70 216 64
               Q204 54 176 52
               L120 50
               Q70 54 26 70 Z"
            fill={BODY}
            stroke={OUTLINE}
            strokeWidth="2"
            strokeLinejoin="round"
          />
          {/* Orange cheatline sweeping up over the tailcone */}
          <path
            d="M30 72 Q80 80 130 80 L206 78 Q212 76 214 72 L130 74 Q80 72 30 68 Z"
            fill={ORANGE}
            opacity="0.95"
          />

          {/* Cabin glass: windshield + two side windows */}
          <path d="M150 56 L176 57 Q192 59 198 66 L150 66 Z" fill={GLASS} opacity="0.9" />
          <rect x="124" y="58" width="20" height="10" rx="3" fill={GLASS} opacity="0.85" />
          <rect x="100" y="59" width="18" height="9" rx="3" fill={GLASS} opacity="0.7" />

          {/* High wing + strut — the giveaway that this is a 172 */}
          <path
            d="M78 40 L206 44 Q212 46 212 49 L206 52 L78 50 Q72 45 78 40 Z"
            fill={BODY}
            stroke={OUTLINE}
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <rect x="150" y="40" width="46" height="5" fill={ORANGE} opacity="0.9" />
          <path d="M104 52 L124 62" stroke={OUTLINE} strokeWidth="3" strokeLinecap="round" />

          {/* Fixed gear: mains under the cabin, nose gear up front */}
          <path d="M138 86 L128 104" stroke={OUTLINE} strokeWidth="4" strokeLinecap="round" />
          <circle cx="126" cy="108" r="8" fill="#334155" />
          <circle cx="126" cy="108" r="3" fill="#cbd5e1" />
          <path d="M196 84 L202 100" stroke={OUTLINE} strokeWidth="4" strokeLinecap="round" />
          <circle cx="203" cy="104" r="6.5" fill="#334155" />
          <circle cx="203" cy="104" r="2.5" fill="#cbd5e1" />

          {/* Spinner + propeller. The blades rotate about the Y axis, which is
              what a prop looks like edge-on: they flatten to a line and swell
              back out, reading as a blur disc rather than a spinning pinwheel. */}
          <g
            className="animate-prop"
            style={{ transformBox: "fill-box", transformOrigin: "center" }}
          >
            <path
              d="M222 22 Q228 46 228 70 Q228 94 222 118 Q234 94 234 70 Q234 46 222 22 Z"
              fill={ORANGE_DARK}
              opacity="0.85"
            />
          </g>
          <ellipse cx="218" cy="70" rx="7" ry="10" fill={ORANGE} stroke={ORANGE_DARK} strokeWidth="2" />
        </svg>
      </div>

      {/* Pulsing club name in the airplane's orange. */}
      <h1
        className="animate-pulse-name text-2xl font-bold tracking-tight"
        style={{ color: ORANGE_DARK }}
      >
        {CLUB_NAME}
      </h1>

      <p className="text-sm text-gray-500 dark:text-gray-400">{SUBTEXT}</p>
      <span className="sr-only">Loading…</span>
    </div>
  );
}

// One cloud: three overlapping circles on a flat base, the way every child
// draws them. Drawn in slate so it reads in both themes.
function Cloud() {
  return (
    <svg viewBox="0 0 120 50" className="h-10 w-24" aria-hidden="true">
      <g className="fill-slate-300 dark:fill-slate-600">
        <circle cx="36" cy="30" r="18" />
        <circle cx="60" cy="22" r="22" />
        <circle cx="86" cy="32" r="16" />
        <rect x="30" y="32" width="62" height="16" rx="8" />
      </g>
    </svg>
  );
}
