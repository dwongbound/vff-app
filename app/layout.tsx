import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { IBM_Plex_Mono } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";
import Providers from "./providers";
import AppShell from "@/components/AppShell";
import { CLUB_NAME, CLUB_SHORT_NAME } from "@/lib/constants";
import { storageStatus } from "@/lib/storage";

/* Typography. Two faces, one job each — see tailwind.config.ts, which maps
   them onto `font-sans` and `font-mono`.
   ──────────────────────────────────────────────────────────────────────────
   Overpass is drawn from the US Highway Gothic used on road and airfield
   signage, which is why it's here: it reads as the airfield's own lettering
   rather than as a theme laid over a generic app. Open apertures and roomy
   counters are the reason it's this one and not a narrower signage grotesk —
   at the sizes this app uses, a condensed face turns a page of checkout items
   into a wall. Headings are the same face at a heavier weight; there is no
   separate display family, because a second voice at h3-and-smaller sizes
   reads as noise rather than as hierarchy.

   IBM Plex Mono carries anything you READ OFF something: tach and Hobbs, W&B
   tables, sign-up codes. Those are compared digit-to-digit or read down a
   phone, so the fixed advance is the point.

   Overpass is a VARIABLE font, so it lists no `weight` — one file covers every
   weight the app asks for, rather than one download per `font-semibold`. Plex
   Mono is not, hence the explicit (and deliberately short) weight list.

   The CSS variables are deliberately NOT called `--font-sans`/`--font-mono`:
   Tailwind v4 ships theme variables under exactly those names, so pointing
   `fontFamily.sans` at `var(--font-sans)` would define the variable in terms
   of itself and quietly fall through to the browser default. */

/* Overpass is self-hosted from `app/fonts/` rather than pulled through
   `next/font/google` for ONE reason: its shipped vertical metrics are
   lopsided, and only `next/font/local` lets us restate them.
   ──────────────────────────────────────────────────────────────────────────
   Straight off the file (v19, 2000 units/em): ascent 1766, descent −766, cap
   height 1400. So in a line box, a capital letter has 0.183em of air above it
   and 0.383em below — the glyphs sit a full 0.100em ABOVE the middle of the
   box they're drawn in. Nothing in CSS moves them back: half-leading is added
   equally top and bottom, so `line-height` can't do it, and `items-center`
   dutifully centres the BOX with the text riding high inside it.

   The app centres almost everything that way, so that 0.100em showed up
   everywhere at once — 1.5px at `text-sm`. The label in a filled nav tab, a
   Badge's text in its pill, the initial in the avatar circle, and every icon
   sitting next to a label in a flex row (the icon is a geometric box and
   centres honestly; the text beside it did not).

   `ascent-override`/`descent-override` restate the two numbers so that the
   air above the cap height equals the drop below the baseline — the same
   "cap to baseline" centring `text-box-edge: cap alphabetic` would give us,
   but supported by every browser today. The two are chosen to keep their SUM
   at the original 1.266em, so line boxes are exactly the height they were and
   nothing reflows; only the glyphs move down within them.

     ascent  = (1.266 + 0.700) / 2 = 0.983
     descent =  1.266 − 0.983     = 0.283

   The trimmed descent still clears Overpass's ordinary descenders (p, g, y);
   what it gives up is room for a stacked diacritic UNDER a descender, which
   this app's copy doesn't have.

   IBM Plex Mono below is left on `next/font/google`: the same arithmetic puts
   it 0.026em (~0.4px) off cap-centre, which is not worth self-hosting three
   static weights to correct. */
const fontSans = localFont({
  src: "./fonts/overpass-latin-variable.woff2",
  variable: "--font-app-sans",
  display: "swap",
  // Matches what `next/font/google` fetched for `subsets: ["latin"]`: the one
  // variable file, covering weights 100–900.
  weight: "100 900",
  style: "normal",
  declarations: [
    { prop: "ascent-override", value: "98.3%" },
    { prop: "descent-override", value: "28.3%" },
    { prop: "line-gap-override", value: "0%" },
  ],
});

const fontMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-app-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: CLUB_NAME,
  description: "Reserve the airplane, run the preflight, and file the flight log.",
  // "Add to Home Screen" on iOS: open standalone (no Safari chrome) with a
  // short icon label. The manifest (app/manifest.ts) covers Android; older iOS
  // needs these apple-mobile-web-app-* meta tags too.
  appleWebApp: {
    capable: true,
    title: CLUB_SHORT_NAME,
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  // Colors the status bar / browser UI around the page. Media-query based, so
  // it follows the OS setting (close enough to lib/theme.ts's "system"
  // default; a manual in-app override won't be reflected here).
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F9FAFB" }, // gray-50
    { media: "(prefers-color-scheme: dark)", color: "#111827" }, // gray-900
  ],
};

// Runs before hydration so the right theme applies without a flash.
// Mode is "light" | "dark" | "system"; anything else (incl. unset) = system,
// which follows the OS preference. Keep this in sync with lib/theme.ts.
const THEME_SCRIPT = `
try {
  var stored = localStorage.getItem('theme');
  var system = window.matchMedia('(prefers-color-scheme: dark)').matches;
  var dark = stored === 'dark' ||
    (stored !== 'light' && stored !== 'dark' && system);
  document.documentElement.classList.toggle('dark', dark);
} catch (e) {}
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Read here, on the server, where the environment actually lives. Handed to
  // the client as one boolean + one sentence, so no bucket configuration ever
  // reaches the browser and no page has to fetch to find out whether the
  // camera button is worth showing.
  const photos = storageStatus();

  return (
    // suppressHydrationWarning: the theme script may add `dark` to <html>
    // before react hydrates, which is expected.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${fontSans.variable} ${fontMono.variable}`}
    >
      <head>
        {/* Tell the Dark Reader extension to keep its hands off: the app ships
            its own dark theme, and letting Dark Reader invert an already-dark
            page collapses text and backgrounds to the same color. */}
        <meta name="darkreader-lock" />
        <Script id="theme-script" dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      {/* A full-height flex column that never scrolls itself: the header is a
          static row, the content column below it is the app's only scroller
          (see `.app-scroll` in globals.css). That's what keeps the top bar and
          the nav rail still while the content rubber-bands. */}
      <body className="flex h-dvh flex-col overflow-hidden bg-gray-50 font-sans text-gray-900 antialiased dark:bg-gray-900 dark:text-gray-100">
        <Providers photos={{ enabled: photos.configured, reason: photos.reason }}>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
