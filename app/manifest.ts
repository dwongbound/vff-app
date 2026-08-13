import type { MetadataRoute } from "next";
import { CLUB_NAME, CLUB_SHORT_NAME } from "@/lib/constants";

// Web app manifest — lets phones install the site as a home-screen app
// (iOS "Add to Home Screen", Android "Install app"). Next.js serves this at
// /manifest.webmanifest and links it from every page automatically.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: CLUB_NAME,
    // Label under the home-screen icon (keep it short or iOS truncates it).
    short_name: CLUB_SHORT_NAME,
    description: "Reserve the airplane, run the preflight, and file the flight log.",
    start_url: "/",
    // Open without browser chrome, like a native app.
    display: "standalone",
    background_color: "#F9FAFB", // matches bg-gray-50
    theme_color: "#F9FAFB",
    // The installed icon, and deliberately NOT the favicon: /icon.svg draws
    // its own disc on a transparent field, which a launcher then masks a
    // second time — a circle inside a circle, ringed by dead space. These are
    // the full-bleed square mark rasterised from /icons/icon-square.svg, which
    // is committed beside them, so the tile IS the mark, edge to edge.
    //
    // The 512 is listed TWICE, same file, once per purpose. That says two
    // things about it: it's a complete icon, AND its edges are safe to crop to
    // whatever silhouette the launcher uses — which holds because the swoosh
    // crosses the middle and the corners are plain white field. (The manifest
    // spec would take `purpose: "any maskable"` on one entry; Next's own
    // Manifest type only types the single values, so it's two entries.)
    //
    // Listing /icon.svg here as well would undo the whole point: its
    // `sizes: "any"` outranks a fixed size, so it would be the one picked, and
    // installed with its transparent corners.
    icons: [
      { src: "/icons/icon-192.png", type: "image/png", sizes: "192x192", purpose: "any" },
      { src: "/icons/icon-512.png", type: "image/png", sizes: "512x512", purpose: "any" },
      { src: "/icons/icon-512.png", type: "image/png", sizes: "512x512", purpose: "maskable" },
    ],
  };
}
