import { describe, expect, it } from "vitest";
import { pruneDrafts, type DraftStore } from "@/lib/checkoutDraft";
import {
  clearQuickLogDraft,
  parseQuickLogDraft,
  quickLogDraftKey,
  quickLogHasProgress,
  readQuickLogDraft,
  writeQuickLogDraft,
  type QuickLogDraft,
  type QuickLogForm,
} from "@/lib/quickLogDraft";

/** An in-memory localStorage. */
function memoryStore(): DraftStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get length() {
      return data.size;
    },
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

const WHO = { memberId: "m1", aircraftId: "a1" };
const EMPTY: QuickLogForm = {
  flownOn: "2026-10-10",
  tachStart: "1509.0",
  tachEnd: "",
  hobbsStart: "",
  hobbsEnd: "",
  airports: "",
  fuelAdded: "",
  fuelCost: "",
  oilAdded: "",
  paidPersonally: true,
  edited: { tachStart: false, hobbsStart: false },
};

function draft(over: Partial<QuickLogDraft> = {}): QuickLogDraft {
  return { ...EMPTY, ...WHO, savedAt: new Date().toISOString(), ...over };
}

describe("quickLogHasProgress", () => {
  it("ignores the prefilled start boxes — that's the app's number, not the member's", () => {
    expect(quickLogHasProgress(EMPTY)).toBe(false);
    expect(quickLogHasProgress({ ...EMPTY, edited: { tachStart: true, hobbsStart: false } })).toBe(
      false
    );
  });

  it("counts anything the member brought", () => {
    expect(quickLogHasProgress({ ...EMPTY, tachEnd: "15" })).toBe(true);
    expect(quickLogHasProgress({ ...EMPTY, airports: "KTOA" })).toBe(true);
    expect(quickLogHasProgress({ ...EMPTY, fuelAdded: "10" })).toBe(true);
  });
});

describe("the stored draft", () => {
  it("round-trips through the store, half-typed numbers and all", () => {
    const store = memoryStore();
    const saved = draft({ tachEnd: "151", airports: "KTOA, KSMO" });
    expect(writeQuickLogDraft(store, saved)).toBe(true);
    expect(readQuickLogDraft(store, WHO)).toEqual(saved);
  });

  it("is per member AND per airplane", () => {
    const store = memoryStore();
    writeQuickLogDraft(store, draft({ tachEnd: "151" }));
    expect(readQuickLogDraft(store, { memberId: "m2", aircraftId: "a1" })).toBeNull();
    expect(readQuickLogDraft(store, { memberId: "m1", aircraftId: "a2" })).toBeNull();
  });

  it("discards anything it doesn't recognise rather than guessing", () => {
    expect(parseQuickLogDraft("not json", WHO)).toBeNull();
    expect(parseQuickLogDraft(JSON.stringify({ ...draft(), tachEnd: 151 }), WHO)).toBeNull();
    expect(parseQuickLogDraft(JSON.stringify({ ...draft(), edited: null }), WHO)).toBeNull();
    expect(parseQuickLogDraft(JSON.stringify({ ...draft(), memberId: "m2" }), WHO)).toBeNull();
  });

  it("clears, and is swept with the other drafts once it's old", () => {
    const store = memoryStore();
    writeQuickLogDraft(store, draft({ tachEnd: "151" }));
    clearQuickLogDraft(store, WHO);
    expect(readQuickLogDraft(store, WHO)).toBeNull();

    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    writeQuickLogDraft(store, draft({ tachEnd: "151", savedAt: old }));
    expect(pruneDrafts(store)).toEqual([quickLogDraftKey(WHO)]);
    expect(store.data.size).toBe(0);
  });
});
