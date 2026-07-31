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
    icons: [{ src: "/icon.svg", type: "image/svg+xml", sizes: "any" }],
  };
}
