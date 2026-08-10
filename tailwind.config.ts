import type { Config } from "tailwindcss";

const config: Config = {
  // "class" strategy: dark mode is toggled by adding/removing the `dark`
  // class on <html>. See the theme script in app/layout.tsx and the
  // toggle button in components/Navbar.tsx.
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // Body copy runs 1px larger than Tailwind's stock scale.
      // ──────────────────────────────────────────────────────────────────
      // This is deliberately done on the SCALE rather than on `body` or on
      // `html`. The app writes its copy almost entirely in `text-sm` (~230
      // uses) and `text-xs` (~120); barely anything renders at the unstyled
      // default. Those utilities are rem values resolved against the ROOT
      // element, so a font-size on `body` would not have moved them, and one
      // on `html` would have dragged every rem-based PADDING, gap and width
      // along with it — including the rail's `w-60` and `--app-header-h`,
      // which are measurements the layout depends on. Changing the type scale
      // alone moves type alone.
      //
      // Only the body-copy steps are touched. `lg` and up are headings, which
      // were not the thing reading small; they keep their stock sizes. The
      // line-heights are stock too — leading is what sets vertical rhythm, and
      // re-cutting it would change page density well beyond "1px bigger".
      fontSize: {
        xs: ["0.8125rem", { lineHeight: "1rem" }], // 13px (was 12)
        sm: ["0.9375rem", { lineHeight: "1.25rem" }], // 15px (was 14)
        base: ["1.0625rem", { lineHeight: "1.5rem" }], // 17px (was 16)
      },

      // The two faces loaded in app/layout.tsx, which is also where the
      // reasoning for each one lives. Headings are this same `sans` at a
      // heavier weight, so there is no `display` family. Each stack keeps a
      // system fallback for the frame before the webfont lands, and for anyone
      // who blocks webfonts outright.
      fontFamily: {
        sans: [
          "var(--font-app-sans)",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        mono: [
          "var(--font-app-mono)",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "Liberation Mono",
          "monospace",
        ],
      },
      colors: {
        // Brand accent. The app is written entirely in `indigo-*` utility
        // classes; we remap that whole palette to the club's Cessna orange so
        // every button, link, and highlight picks up the brand color without
        // touching individual class names. 600 (the fill behind white text)
        // is deliberately dark enough to clear WCAG AA at 4.8:1.
        indigo: {
          50: "#fff5ef",
          100: "#ffe6d5",
          200: "#fdc9a9",
          300: "#f9a674", // dark-mode text/links
          400: "#f2803f",
          500: "#e9601c",
          600: "#c64912", // primary buttons, today pill, active tab
          700: "#a53d10", // hover
          800: "#85340f",
          900: "#6d2d10",
          950: "#3c1405",
        },
      },
      keyframes: {
        // Three dots that "jump" out of phase (LoadingDots).
        jump: {
          "0%, 80%, 100%": { transform: "translateY(0)", opacity: "0.5" },
          "40%": { transform: "translateY(-60%)", opacity: "1" },
        },
        // Propeller blades on the splash plane. Fast + linear so it reads as a
        // blur disc rather than a countable rotation.
        prop: {
          "0%": { transform: "rotateY(0deg)" },
          "100%": { transform: "rotateY(360deg)" },
        },
        // The plane holding a gentle climb/descent oscillation in cruise.
        fly: {
          "0%, 100%": { transform: "translateY(0) rotate(-1.5deg)" },
          "50%": { transform: "translateY(-10px) rotate(1.5deg)" },
        },
        // Clouds streaming past the (stationary) plane, right to left.
        drift: {
          "0%": { transform: "translateX(120%)", opacity: "0" },
          "15%, 85%": { opacity: "0.9" },
          "100%": { transform: "translateX(-160%)", opacity: "0" },
        },
        // Soft breathing pulse for the app name on the splash.
        "pulse-name": {
          "0%, 100%": { opacity: "0.6", transform: "scale(0.99)" },
          "50%": { opacity: "1", transform: "scale(1.015)" },
        },
        // Radiating rings behind the splash mark (sun glare through haze).
        radiate: {
          "0%": { transform: "scale(0.6)", opacity: "0.6" },
          "100%": { transform: "scale(1.8)", opacity: "0" },
        },
        // Draws a checkmark by animating the SVG stroke into view (the path
        // sets `stroke-dasharray/-dashoffset: 24` so it starts hidden). Used
        // when a checkout item is ticked.
        "check-draw": {
          "0%": { strokeDashoffset: "24" },
          "100%": { strokeDashoffset: "0" },
        },
        // A menu rising into place. Used by the phone's checkouts sheet,
        // which mounts on tap and so can animate on entry alone (the desktop
        // Dropdown transitions both ways instead — it has to fade back out).
        "fade-in-up": {
          "0%": { opacity: "0", transform: "translateY(4px) scale(0.98)" },
          "100%": { opacity: "1", transform: "translateY(0) scale(1)" },
        },
      },
      animation: {
        jump: "jump 1.2s ease-in-out infinite",
        prop: "prop 0.32s linear infinite",
        fly: "fly 3.2s ease-in-out infinite",
        drift: "drift 4s linear infinite",
        "pulse-name": "pulse-name 1.8s ease-in-out infinite",
        radiate: "radiate 2s ease-out infinite",
        "check-draw": "check-draw 0.4s ease-out forwards",
        "fade-in-up": "fade-in-up 0.15s ease-out forwards",
      },
    },
  },
  plugins: [],
};

export default config;
