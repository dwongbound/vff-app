"use client";
// The signed-in member's profile, fetched once by AuthGate's session probe and
// shared from there. Without this, the profile page and the currency reminders
// would each fire their own /api/me on mount.
import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import type { ApiMe } from "@/lib/types";

interface MeCtx {
  me: ApiMe | null;
  /** Refetch; returns the HTTP status so AuthGate can detect a ghost session. */
  refreshMe: () => Promise<{ status: number; me: ApiMe | null }>;
  setMe: (me: ApiMe | null) => void;
}

const Ctx = createContext<MeCtx | null>(null);

export default function MeProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<ApiMe | null>(null);

  const refreshMe = useCallback(async () => {
    const res = await fetch("/api/me");
    if (!res.ok) return { status: res.status, me: null };
    const data = (await res.json()) as ApiMe;
    setMe(data);
    return { status: res.status, me: data };
  }, []);

  return (
    <Ctx.Provider value={{ me, refreshMe, setMe }}>{children}</Ctx.Provider>
  );
}

export function useMe(): MeCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useMe must be used within a MeProvider");
  return ctx;
}
