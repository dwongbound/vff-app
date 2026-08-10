"use client";
// The frame every page sits in: the nav rail, the content column, and the
// swipe pager between them.
//
// Navbar renders BOTH pieces of chrome, and the order here is what makes the
// top bar the full width of the window while the rail hangs below it: the
// header is a sibling of the padded column, not inside it. Only `<main>` is
// indented past the rail (`md:pl-60`, kept in step with the rail's `w-60` in
// Navbar.tsx).
//
// It's a client component so the login page can opt out of that indent. Navbar
// already returns null there; without this the login card would still be
// centred in a column 15rem narrower than the window and sit visibly off to
// the left.
//
// The rail's breakpoint is `md` (768px), which is the narrowest iPad: tablets
// get the desktop layout, and only phones fall back to the bottom pill. `sm`
// would have been too eager — 15rem out of a 640px window is a quarter of the
// screen spent on navigation.
import { usePathname } from "next/navigation";
import Navbar from "./Navbar";
import SwipePager from "./SwipePager";
import { SwipeProvider } from "./SwipeProvider";
import { APP_SCROLL_ID } from "@/lib/appScroll";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const chromeless = pathname === "/login";

  return (
    // SwipeProvider wraps the navbar (which registers the tab list) and the
    // pager (which runs the swipe gesture) so they share drag state.
    <SwipeProvider>
      <Navbar />
      {/* The app's ONLY scroller. Everything else — the top bar above it, the
          rail and the bottom pill beside it — sits outside this box, which is
          what lets the content rubber-band without the chrome moving. See
          `.app-scroll` in globals.css and lib/appScroll.ts for the read/listen
          rules that replaces `window.scrollY` with. */}
      <div
        id={APP_SCROLL_ID}
        className={`app-scroll ${chromeless ? "" : "md:pl-60"}`}
      >
        {/* Extra bottom padding below `md` so content can scroll clear of the
            floating bottom nav bar (see Navbar.tsx). */}
        <main className="mx-auto max-w-5xl px-4 pb-28 pt-6 md:pb-6">
          <SwipePager>{children}</SwipePager>
        </main>
      </div>
    </SwipeProvider>
  );
}
