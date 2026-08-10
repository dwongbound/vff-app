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
const OUTLINE = "#64748b"; // slate-500 — holds the white airframe's shape on a pale bg
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
    // `absolute inset-0`, not `fixed`: this fills whatever box its parent
    // gives it, and LoadingProvider's is the CONTENT COLUMN — below the top
    // bar and right of the rail — rather than the whole window. Centring in
    // the window would put the airplane visibly left of the space it's
    // covering, because 15rem of that window is nav.
    <div
      role="status"
      aria-label="Loading"
      className="absolute inset-0 flex flex-col items-center justify-center gap-8
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
            past it (which is what flying actually feels like).

            Drawn as N8318B in profile, nose right: the shapes that make a 172
            read as a 172 rather than "a small aeroplane" are the wing sitting
            ON TOP of the cabin roof, the lift strut running down from it to the
            belly, and the fixed tricycle gear. The fin is the straight,
            rounded 1957 tail, not the swept one from the 60s onwards. */}
        <svg
          viewBox="0 0 260 130"
          className="relative h-36 w-64 animate-fly"
          aria-hidden="true"
        >
          {/* Draw order matters. The wing goes down FIRST so the fuselage
              paints over the seam where they meet — otherwise the wing keeps
              its own outline across the join and reads as a separate white
              lozenge sitting on the roof. The tail surfaces are the opposite
              case: the tailcone is deeper than they are, so drawing them first
              hides them completely. They go on top, after the fuselage. */}

          {/* High wing, sitting on the cabin roof and running most of the
              length of the airplane.

              Note this is NOT the true chord: edge-on, a 172's wing is only
              about a fifth of the fuselage length, and drawn that way it reads
              as a roof hatch rather than a wing. Like most side-view aircraft
              illustration this cheats the near wing toward the viewer, which is
              what makes the high wing legible at all. */}
          <path
            d="M112 38 L194 38 Q202 38 204 42.5 Q202 47 194 47 L112 47 Q105 42.5 112 38 Z"
            fill={BODY}
            stroke={OUTLINE}
            strokeWidth="2.2"
            strokeLinejoin="round"
          />
          {/* Fuselage. The shape that says "Cessna" rather than "light
              aircraft" is a flat belly and a flat cabin roof joined by a
              sharply raked windshield, with the tailcone sweeping UP to a tail
              post well above the belly line. */}
          <path
            d="M22 70
               Q78 76 128 84
               L195 84
               Q216 84 222 76
               Q229 68 222 59
               L196 58
               L178 47
               L128 47
               Q76 50 22 58 Z"
            fill={BODY}
            stroke={OUTLINE}
            strokeWidth="2.2"
            strokeLinejoin="round"
          />
          {/* Orange cheatline: level along the cabin at sill height, then
              sweeping up over the tailcone to meet the fin. Stroked rather than
              filled so it follows the fuselage line cleanly at any size. */}
          <path
            d="M197 72 L128 72 Q80 70 38 62"
            stroke={ORANGE}
            strokeWidth="5"
            fill="none"
            strokeLinecap="round"
          />

          {/* The 1957 straight tail: leading edge sweeping aft as it rises, a
              rounded top, an upright rudder. (The swept fin everyone pictures
              didn't arrive until the 60s.) Orange, like the real airplane's.
              Its root sits below the fuselage's top line, so the join is
              hidden and the fin grows out of the tailcone. */}
          <path
            d="M56 56 L42 34 Q35 26 29 34 L24 60 Z"
            fill={ORANGE}
            stroke={ORANGE_DARK}
            strokeWidth="2.2"
            strokeLinejoin="round"
          />
          {/* Horizontal stabilizer, overhanging the tail post the way a 172's
              elevator does. Same cheat as the wing: edge-on it would be
              invisible, so it's drawn as a surface. */}
          <path
            d="M4 62 L46 59 L46 67 L4 70 Z"
            fill={BODY}
            stroke={OUTLINE}
            strokeWidth="2.2"
            strokeLinejoin="round"
          />

          {/* Cabin glass: the raked windshield and the '57's two side windows,
              all tucked under the wing — which is what a high wing looks like. */}
          <path d="M193 59 L178 48 L170 48 L181 63 L193 63 Z" fill={GLASS} opacity="0.9" />
          <rect x="148" y="50" width="21" height="13" rx="3" fill={GLASS} opacity="0.85" />
          <rect x="127" y="50" width="17" height="12" rx="3" fill={GLASS} opacity="0.7" />

          {/* Lift strut: down from mid-span to the belly, leaning forward.
              Over the fuselage, since it's outboard of it. Along with the wing
              overhead it's the whole Cessna tell. */}
          <path
            d="M138 47 L166 82"
            stroke={OUTLINE}
            strokeWidth="3.5"
            strokeLinecap="round"
          />

          {/* Fixed tricycle gear: spring-steel mains under the cabin, nose leg
              under the engine, both sitting on the same ground line. */}
          <path d="M158 83 L148 100" stroke={OUTLINE} strokeWidth="5" strokeLinecap="round" />
          <circle cx="146" cy="105" r="8.5" fill="#334155" />
          <circle cx="146" cy="105" r="3.2" fill="#cbd5e1" />
          <path d="M202 84 L204 99" stroke={OUTLINE} strokeWidth="4.5" strokeLinecap="round" />
          <circle cx="204" cy="105.5" r="7.5" fill="#334155" />
          <circle cx="204" cy="105.5" r="2.8" fill="#cbd5e1" />

          {/* Spinner + propeller, sized to the real 76" blade — about two
              thirds of the cabin's length, not the full height of the drawing.
              The faint ellipse is the disc the blades sweep; the blade on top
              rotates about the Y axis, which is what a prop looks like edge-on:
              it flattens to a line and swells back out, reading as a blur
              rather than a spinning pinwheel. */}
          <ellipse cx="226" cy="70" rx="4.5" ry="25" fill={ORANGE} opacity="0.16" />
          <g
            className="animate-prop"
            style={{ transformBox: "fill-box", transformOrigin: "center" }}
          >
            <path
              d="M221 45 Q227 57 227 70 Q227 83 221 95 Q233 83 233 70 Q233 57 221 45 Z"
              fill={ORANGE_DARK}
              opacity="0.85"
            />
          </g>
          <ellipse cx="222" cy="70" rx="6.5" ry="8.5" fill={ORANGE} stroke={ORANGE_DARK} strokeWidth="2" />
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
