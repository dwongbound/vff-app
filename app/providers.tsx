"use client";
// Client-side context providers. SessionProvider makes useSession() work in
// any client component; LoadingProvider gives the app one shared full-page
// loader. AuthGate sits inside both so it can use the session + splash to hold
// rendering until a valid login is confirmed (no chrome flash for logged-out
// or "ghost" sessions).
import { SessionProvider } from "next-auth/react";
import { ReactNode } from "react";
import AircraftProvider from "@/components/AircraftProvider";
import AuthGate from "@/components/AuthGate";
import LoadingProvider from "@/components/LoadingProvider";
import MeProvider from "@/components/MeProvider";

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <LoadingProvider>
        <AircraftProvider>
          {/* MeProvider wraps AuthGate: AuthGate's /api/me probe populates the
              shared profile, so the profile page reads it instead of
              refetching. */}
          <MeProvider>
            <AuthGate>{children}</AuthGate>
          </MeProvider>
        </AircraftProvider>
      </LoadingProvider>
    </SessionProvider>
  );
}
