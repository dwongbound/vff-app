"use client";
// The club's airplanes, loaded once and shared by every tab.
//
// The club flies one 172 today, so `selected` is almost always that airplane —
// but every page reads it from here rather than hard-coding, which is what
// makes adding a second airplane a data change instead of a rewrite. The
// choice is persisted so it survives a reload.
//
// It also carries the grounded state: any OPEN squawk with GROUNDING severity
// puts a red banner across the app (see Navbar).
import { useSession } from "next-auth/react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { fetchJsonArray } from "@/lib/api";
import type { ApiAircraft } from "@/lib/types";

const STORAGE_KEY = "aircraftId";

/** Fired after a squawk is opened/resolved so the grounded banner re-reads. */
export const AIRCRAFT_CHANGED_EVENT = "aircraft-changed";

/**
 * Tell the app the airplane's state changed (new squawk, meters advanced).
 *
 * Always prefer this over calling `refreshAircraft()` directly from a page:
 * the provider already listens for the event, so doing both fires two
 * identical requests for one change.
 */
export function notifyAircraftChanged(): void {
  window.dispatchEvent(new Event(AIRCRAFT_CHANGED_EVENT));
}

interface AircraftCtx {
  /** null until the first successful fetch. */
  aircraft: ApiAircraft[] | null;
  /** True while we don't yet know the fleet — pages hold their splash on this. */
  loading: boolean;
  selected: ApiAircraft | null;
  selectAircraft: (id: string) => void;
  refreshAircraft: () => Promise<void>;
}

const Ctx = createContext<AircraftCtx | null>(null);

export default function AircraftProvider({ children }: { children: ReactNode }) {
  const [aircraft, setAircraft] = useState<ApiAircraft[] | null>(null);
  const [selectedId, setSelectedId] = useState<string>("");
  // /api/aircraft needs a session. The provider mounts once for the whole app —
  // including on /login, where the fetch would 401 — so it keys off the session
  // status and (re)loads the moment sign-in completes. Without this the fleet
  // stays empty after logging in until a full page reload.
  const { status } = useSession();

  const refreshAircraft = useCallback(async () => {
    const rows = await fetchJsonArray<ApiAircraft>("/api/aircraft");
    setAircraft(rows);
    // Settle the selection: the persisted airplane if it still exists,
    // otherwise the first active one.
    setSelectedId((current) => {
      if (current && rows.some((a) => a.id === current)) return current;
      const stored =
        typeof window === "undefined" ? null : localStorage.getItem(STORAGE_KEY);
      if (stored && rows.some((a) => a.id === stored)) return stored;
      return rows.find((a) => a.active)?.id ?? rows[0]?.id ?? "";
    });
  }, []);

  useEffect(() => {
    if (status !== "authenticated") {
      // Signed out: drop the fleet so a different member never sees the
      // previous one's selection.
      if (status === "unauthenticated") setAircraft(null);
      return;
    }
    refreshAircraft();
    const onChanged = () => refreshAircraft();
    window.addEventListener(AIRCRAFT_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(AIRCRAFT_CHANGED_EVENT, onChanged);
  }, [status, refreshAircraft]);

  const selectAircraft = useCallback((id: string) => {
    setSelectedId(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // private mode — the choice just won't persist
    }
  }, []);

  const selected = useMemo(
    () => aircraft?.find((a) => a.id === selectedId) ?? null,
    [aircraft, selectedId]
  );

  return (
    <Ctx.Provider
      value={{
        aircraft,
        // A club with zero airplanes is loaded, not loading — the pages need to
        // get past their splash to show the "seed one" message.
        loading: aircraft === null,
        selected,
        selectAircraft,
        refreshAircraft,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useAircraft(): AircraftCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAircraft must be used within an AircraftProvider");
  return ctx;
}
