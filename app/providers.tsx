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
import GuidedTour from "@/components/GuidedTour";
import LoadingProvider from "@/components/LoadingProvider";
import MeProvider from "@/components/MeProvider";
import OutboxProvider from "@/components/OutboxProvider";
import {
  PhotoSupportProvider,
  type PhotoSupport,
} from "@/components/PhotoSupportProvider";

export default function Providers({
  children,
  photos,
}: {
  children: ReactNode;
  /** Decided on the server from the env — see app/layout.tsx. */
  photos: PhotoSupport;
}) {
  return (
    <PhotoSupportProvider value={photos}>
    <SessionProvider>
      <LoadingProvider>
        <AircraftProvider>
          {/* MeProvider wraps AuthGate: AuthGate's /api/me probe populates the
              shared profile, so the profile page reads it instead of
              refetching. */}
          <MeProvider>
            {/* Inside MeProvider because a queued submission is only ever sent
                as the member who made it — see OutboxProvider. */}
            <OutboxProvider>
              <AuthGate>
                {children}
                {/* Inside AuthGate so it can't appear over the login page or
                    before we know who the member is. */}
                <GuidedTour />
              </AuthGate>
            </OutboxProvider>
          </MeProvider>
        </AircraftProvider>
      </LoadingProvider>
    </SessionProvider>
    </PhotoSupportProvider>
  );
}
