"use client";
// Something pinned to the WINDOW from inside a page: the phone's "+" button,
// a toast.
//
// Rendered into <body> rather than where it's written, because `position:
// fixed` is only fixed to the window until an ancestor takes a transform —
// and the page's <main> does exactly that while it follows a pull-to-refresh.
// Left inside, the "+" rode along with the page instead of staying in its
// corner, landing wherever <main>'s own bottom edge happened to be.
//
// Disabled with the page it belongs to while that page is busy (see
// components/pageBusy.ts) — a portal escapes <main>'s `inert` along with its
// transform, so it has to take the flag itself.
import { ReactNode, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { usePageBusy } from "@/components/pageBusy";

export default function Floating({ children }: { children: ReactNode }) {
  // Portals need a document; render nothing on the server and on the first
  // client pass so hydration matches.
  const [mounted, setMounted] = useState(false);
  const busy = usePageBusy();
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(
    <div inert={busy} aria-busy={busy || undefined}>
      {children}
    </div>,
    document.body
  );
}
