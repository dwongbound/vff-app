"use client";
// Whether this deployment can do photos at all, made available to the pages
// that offer them.
//
// The value is decided on the SERVER (lib/storage `storageStatus`, which reads
// the env) and handed down through the root layout, so there is no extra
// round trip and no need to leak bucket configuration onto the wire — the
// client learns one boolean and a sentence.
//
// Why bother: without it, a club running without a bucket gets a camera button
// that works right up until the upload, and the picture is lost after it has
// been taken — at the airplane, which is the worst possible moment to discover
// it. Saying "(no image support)" where the button would have been costs one
// line and is honest.
import { createContext, useContext, type ReactNode } from "react";

export interface PhotoSupport {
  enabled: boolean;
  /** Why not, for the places with room to explain. Null when enabled. */
  reason: string | null;
}

// Defaults to ENABLED so a component rendered outside the provider (a test, a
// story) behaves the way the app normally does. The provider is in the root
// layout, so in the real app this default is never the one in use.
const PhotoSupportContext = createContext<PhotoSupport>({
  enabled: true,
  reason: null,
});

export function PhotoSupportProvider({
  value,
  children,
}: {
  value: PhotoSupport;
  children: ReactNode;
}) {
  return (
    <PhotoSupportContext.Provider value={value}>
      {children}
    </PhotoSupportContext.Provider>
  );
}

export function usePhotoSupport(): PhotoSupport {
  return useContext(PhotoSupportContext);
}

/**
 * The stock "there is nowhere to put a photo" line.
 *
 * One component so the wording is identical everywhere it appears — a member
 * who sees it on the preflight card and again on a flight should recognise the
 * same message rather than wonder whether they're two different problems.
 */
export function NoImageSupport({ className = "" }: { className?: string }) {
  const { reason } = usePhotoSupport();
  return (
    <p
      title={reason ?? undefined}
      className={`text-xs text-gray-500 dark:text-gray-400 ${className}`}
    >
      (no image support)
    </p>
  );
}
