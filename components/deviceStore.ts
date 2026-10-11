"use client";
// The device's draft store — localStorage, or null wherever it isn't usable
// (server render, private mode, a kiosk that blocks storage).
//
// One copy, shared by every page that keeps a draft (the checkouts, the
// post-flight form, Quick Log). The lib/*Draft modules take the store as an
// argument rather than reaching for `window` themselves, which is what keeps
// them testable under vitest's node environment.
import type { DraftStore } from "@/lib/checkoutDraft";

/** localStorage, or null where it can't be used. */
export function deviceStore(): DraftStore | null {
  if (typeof window === "undefined") return null;
  try {
    // The property ACCESS itself throws when storage is blocked by policy, so
    // this is inside the try rather than beside it.
    return window.localStorage;
  } catch {
    return null;
  }
}
