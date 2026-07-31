import type { Config } from "tailwindcss";

const config: Config = {
  // "class" strategy: dark mode is toggled by adding/removing the `dark`
  // class on <html>. See the theme script in app/layout.tsx and the
  // toggle button in components/Navbar.tsx.
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
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
        // when a preflight item is ticked.
        "check-draw": {
          "0%": { strokeDashoffset: "24" },
          "100%": { strokeDashoffset: "0" },
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
      },
    },
  },
  plugins: [],
};

export default config;
