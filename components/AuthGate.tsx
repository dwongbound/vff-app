"use client";
// Gates the whole app behind a confirmed, valid login so a logged-out (or
// "ghost") session never flashes the navbar/page before the redirect.
//
// Two cases it closes:
//   • unauthenticated — proxy.ts already redirects at the edge, but if a
//     client somehow reaches a protected page with no session we push to
//     /login and show the splash instead of chrome.
//   • ghost session — a NextAuth JWT stays valid even after its user row
//     disappears (account deleted, or a dev reseed rebuilt the table with new
//     ids). proxy.ts only inspects the token, so it lets the request through.
//     We probe /api/me once: a 401 means the token's user is gone → sign out.
//
// Providers mounts once for the whole app, so this gates only the first load —
// later client navigations keep `verified` and render instantly.
import { usePathname, useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import LoadingScreen from "@/components/common/LoadingScreen";
import { useMe } from "@/components/MeProvider";

function isPublicPath(pathname: string): boolean {
  return pathname === "/login" || pathname.startsWith("/login/");
}

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { status } = useSession();
  const { refreshMe } = useMe();
  const isPublic = isPublicPath(pathname);
  // Flips true once /api/me confirms the session's user still exists.
  const [verified, setVerified] = useState(false);

  useEffect(() => {
    if (isPublic || status !== "authenticated") return;
    let cancelled = false;
    refreshMe()
      .then(({ status: httpStatus }) => {
        if (cancelled) return;
        if (httpStatus === 401) {
          // Token's user is gone — clear the cookie and send to /login.
          signOut({ callbackUrl: "/login" });
          return;
        }
        setVerified(true);
      })
      .catch(() => {
        // Network hiccup — don't trap the user on the splash; a real ghost
        // still 401s on the next load.
        if (!cancelled) setVerified(true);
      });
    return () => {
      cancelled = true;
    };
  }, [status, isPublic, refreshMe]);

  // Belt-and-suspenders for the no-session case (proxy.ts handles it at the
  // edge, but if we ever get here client-side, redirect rather than render).
  useEffect(() => {
    if (!isPublic && status === "unauthenticated") {
      router.replace("/login");
    }
  }, [status, isPublic, router]);

  if (isPublic) return <>{children}</>;

  // Hold the splash until we're sure of a valid, logged-in user. Once verified
  // we keep rendering through transient "loading" states — e.g. a session
  // update() after a profile save — so the page doesn't remount and lose
  // in-page state.
  if (!verified || status === "unauthenticated") {
    return <LoadingScreen />;
  }

  return <>{children}</>;
}
