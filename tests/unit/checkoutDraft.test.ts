// The checkout draft store — what a half-walked card is worth before it
// reaches the server, and which copy wins when the device and the server
// disagree.
//
// Everything here runs under vitest's node environment with a fake Storage,
// which is the whole reason lib/checkoutDraft.ts takes its store as an argument
// rather than reaching for `window.localStorage`.
import { describe, expect, it } from "vitest";
import {
  ABANDONED_DRAFT_MS,
  DRAFT_KEY_PREFIX,
  clearDraft,
  draftHasProgress,
  draftKey,
  isDraftKey,
  parseDraft,
  pruneDrafts,
  readDraft,
  resolveResume,
  savedAgo,
  writeDraft,
  type CheckoutDraft,
  type DraftStore,
} from "@/lib/checkoutDraft";
import { allFields, allItemIds, checkoutFor } from "@/lib/checkouts";

/** A Map-backed Storage. `key(i)` walks insertion order, exactly as the real one does. */
class FakeStore implements DraftStore {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  key(index: number) {
    return [...this.map.keys()][index] ?? null;
  }
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  get keys() {
    return [...this.map.keys()];
  }
}

/** The private-browsing / full-quota case: every call throws. */
const HOSTILE_STORE: DraftStore = {
  get length(): number {
    throw new Error("storage disabled");
  },
  key() {
    throw new Error("storage disabled");
  },
  getItem() {
    throw new Error("storage disabled");
  },
  setItem() {
    throw new Error("storage disabled");
  },
  removeItem() {
    throw new Error("storage disabled");
  },
};

const VERSION = checkoutFor("PREFLIGHT").version;
const ITEM_A = allItemIds("PREFLIGHT")[0];
const ITEM_B = allItemIds("PREFLIGHT")[1];
const NUMBER_FIELD = allFields("PREFLIGHT").find((f) => f.kind === "number")!.id;

const IDENTITY = {
  memberId: "member-1",
  aircraftId: "aircraft-1",
  kind: "PREFLIGHT" as const,
};

function draft(overrides: Partial<CheckoutDraft> = {}): CheckoutDraft {
  return {
    ...IDENTITY,
    checkoutVersion: VERSION,
    answers: { [ITEM_A]: true },
    values: { [NUMBER_FIELD]: 6 },
    notes: "",
    serverId: null,
    savedAt: "2026-08-11T17:00:00.000Z",
    ...overrides,
  };
}

const EXPECT = { ...IDENTITY, checkoutVersion: VERSION };

describe("draftKey", () => {
  it("keys a draft by member, airplane and card", () => {
    expect(draftKey(IDENTITY)).toBe(
      `${DRAFT_KEY_PREFIX}:member-1:aircraft-1:PREFLIGHT`
    );
  });

  // The clubhouse iPad. Two members walking the same airplane on one device
  // must not inherit each other's ticks — on a preflight card that's a safety
  // bug, not an inconvenience.
  it("gives two members separate drafts on one device", () => {
    expect(draftKey(IDENTITY)).not.toBe(
      draftKey({ ...IDENTITY, memberId: "member-2" })
    );
  });

  it("separates the two cards and the two airplanes", () => {
    expect(draftKey(IDENTITY)).not.toBe(draftKey({ ...IDENTITY, kind: "RUNWAY" }));
    expect(draftKey(IDENTITY)).not.toBe(
      draftKey({ ...IDENTITY, aircraftId: "aircraft-2" })
    );
  });

  it("recognises its own keys and nothing else", () => {
    expect(isDraftKey(draftKey(IDENTITY))).toBe(true);
    expect(isDraftKey("theme")).toBe(false);
    expect(isDraftKey("vff:something-else:member-1")).toBe(false);
  });
});

describe("parseDraft", () => {
  it("round-trips a draft it wrote itself", () => {
    const written = draft({ notes: "left tyre looks soft", serverId: "run-9" });
    expect(parseDraft(JSON.stringify(written), EXPECT)).toEqual(written);
  });

  it("returns null for nothing at all", () => {
    expect(parseDraft(null, EXPECT)).toBeNull();
    expect(parseDraft("", EXPECT)).toBeNull();
  });

  it.each([
    ["unparseable json", "{not json"],
    ["an array", "[]"],
    ["a bare string", '"hello"'],
    ["null", "null"],
  ])("returns null for %s", (_label, raw) => {
    expect(parseDraft(raw, EXPECT)).toBeNull();
  });

  // The card was reworded or reordered since these ticks were made, so what
  // they asserted is no longer what the member is looking at. Discard rather
  // than migrate — a checkout draft is not worth guessing at.
  it("discards a draft made against a different version of the card", () => {
    expect(
      parseDraft(JSON.stringify(draft({ checkoutVersion: VERSION - 1 })), EXPECT)
    ).toBeNull();
  });

  it.each([
    ["member", { memberId: "someone-else" }],
    ["airplane", { aircraftId: "another-plane" }],
    ["card", { kind: "RUNWAY" as const }],
  ])("discards a draft belonging to a different %s", (_label, override) => {
    expect(parseDraft(JSON.stringify(draft(override)), EXPECT)).toBeNull();
  });

  it.each([
    ["missing", undefined],
    ["not a date", "sometime tuesday"],
    ["not a string", 1_700_000_000],
  ])("discards a draft whose savedAt is %s", (_label, savedAt) => {
    const bad = { ...draft(), savedAt };
    expect(parseDraft(JSON.stringify(bad), EXPECT)).toBeNull();
  });

  // Same discipline the API applies, so the two stores can never end up
  // disagreeing about what was ticked.
  it("drops item ids that are no longer on the card", () => {
    const stale = { ...draft(), answers: { [ITEM_A]: true, "gone.item": true } };
    expect(parseDraft(JSON.stringify(stale), EXPECT)?.answers).toEqual({
      [ITEM_A]: true,
    });
  });

  it("drops readings whose field is no longer on the card", () => {
    const stale = { ...draft(), values: { [NUMBER_FIELD]: 6, "gone.field": 3 } };
    expect(parseDraft(JSON.stringify(stale), EXPECT)?.values).toEqual({
      [NUMBER_FIELD]: 6,
    });
  });

  it("defaults a missing notes and serverId rather than failing", () => {
    const partial = { ...draft() } as Record<string, unknown>;
    delete partial.notes;
    delete partial.serverId;
    const parsed = parseDraft(JSON.stringify(partial), EXPECT);
    expect(parsed?.notes).toBe("");
    expect(parsed?.serverId).toBeNull();
  });
});

describe("readDraft / writeDraft / clearDraft", () => {
  it("writes a draft and reads it back", () => {
    const store = new FakeStore();
    expect(writeDraft(store, draft({ notes: "oil at 6" }))).toBe(true);
    expect(readDraft(store, EXPECT)?.notes).toBe("oil at 6");
  });

  it("reads null when nothing has been written", () => {
    expect(readDraft(new FakeStore(), EXPECT)).toBeNull();
  });

  it("clears only the draft it was asked to clear", () => {
    const store = new FakeStore();
    writeDraft(store, draft());
    writeDraft(store, draft({ kind: "RUNWAY" }));
    clearDraft(store, IDENTITY);
    expect(readDraft(store, EXPECT)).toBeNull();
    expect(store.keys).toHaveLength(1);
  });

  // Private browsing, a locked-down kiosk, a full disk. The preflight page must
  // degrade to "no draft", never take the page down — but it must also not
  // claim to have saved something it hasn't.
  it("survives a storage that throws on every call", () => {
    expect(() => readDraft(HOSTILE_STORE, EXPECT)).not.toThrow();
    expect(readDraft(HOSTILE_STORE, EXPECT)).toBeNull();
    expect(writeDraft(HOSTILE_STORE, draft())).toBe(false);
    expect(() => clearDraft(HOSTILE_STORE, IDENTITY)).not.toThrow();
    expect(() => pruneDrafts(HOSTILE_STORE)).not.toThrow();
  });

  it("treats a null store (SSR) as no storage", () => {
    expect(readDraft(null, EXPECT)).toBeNull();
    expect(writeDraft(null, draft())).toBe(false);
    expect(pruneDrafts(null)).toEqual([]);
  });
});

describe("pruneDrafts", () => {
  const NOW = new Date("2026-08-11T12:00:00.000Z");
  const fresh = new Date(NOW.getTime() - 60_000).toISOString();
  const stale = new Date(NOW.getTime() - ABANDONED_DRAFT_MS - 60_000).toISOString();

  it("sweeps a draft nobody will ever resume", () => {
    const store = new FakeStore();
    writeDraft(store, draft({ savedAt: stale }));
    expect(pruneDrafts(store, NOW)).toEqual([draftKey(IDENTITY)]);
    expect(store.keys).toEqual([]);
  });

  it("keeps a live draft", () => {
    const store = new FakeStore();
    writeDraft(store, draft({ savedAt: fresh }));
    expect(pruneDrafts(store, NOW)).toEqual([]);
    expect(store.keys).toHaveLength(1);
  });

  // Age is the only fair rule on a shared device: this has to be able to clear
  // out a member who hasn't signed in for a fortnight, without touching the
  // walk somebody else has in progress right now.
  it("leaves another member's live draft alone while sweeping their stale one", () => {
    const store = new FakeStore();
    writeDraft(store, draft({ memberId: "member-2", savedAt: fresh }));
    writeDraft(store, draft({ memberId: "member-3", savedAt: stale }));
    const removed = pruneDrafts(store, NOW);
    expect(removed).toEqual([
      draftKey({ ...IDENTITY, memberId: "member-3" }),
    ]);
    expect(store.keys).toEqual([draftKey({ ...IDENTITY, memberId: "member-2" })]);
  });

  it("never touches keys it doesn't own", () => {
    const store = new FakeStore();
    store.setItem("theme", "dark");
    store.setItem("nextauth.message", "{}");
    writeDraft(store, draft({ savedAt: stale }));
    pruneDrafts(store, NOW);
    expect(store.keys).toEqual(["theme", "nextauth.message"]);
  });

  it("sweeps keys from an older draft format on sight", () => {
    const store = new FakeStore();
    // v0 is a format this build can't read, so its age can't be established.
    store.setItem("vff:checkout-draft:v0:member-1:aircraft-1:PREFLIGHT", "{}");
    expect(pruneDrafts(store, NOW)).toHaveLength(1);
    expect(store.keys).toEqual([]);
  });

  it("sweeps a draft whose payload can't be read", () => {
    const store = new FakeStore();
    store.setItem(draftKey(IDENTITY), "{truncated");
    expect(pruneDrafts(store, NOW)).toEqual([draftKey(IDENTITY)]);
  });

  // The trap this guards: removing entries while walking `key(i)` renumbers the
  // store underneath the loop, so every other stale draft gets skipped. All
  // three below are stale and all three must go in ONE pass.
  it("sweeps every stale draft in a single pass", () => {
    const store = new FakeStore();
    writeDraft(store, draft({ memberId: "a", savedAt: stale }));
    writeDraft(store, draft({ memberId: "b", savedAt: stale }));
    writeDraft(store, draft({ memberId: "c", savedAt: stale }));
    expect(pruneDrafts(store, NOW)).toHaveLength(3);
    expect(store.keys).toEqual([]);
  });

  // A month is the same as a week here: gone either way. Pinned so the
  // boundary can't drift without someone noticing.
  it("keeps a draft exactly at the cutoff and sweeps one just past it", () => {
    const store = new FakeStore();
    const atCutoff = new Date(NOW.getTime() - ABANDONED_DRAFT_MS).toISOString();
    writeDraft(store, draft({ memberId: "at", savedAt: atCutoff }));
    writeDraft(store, draft({
      memberId: "past",
      savedAt: new Date(NOW.getTime() - ABANDONED_DRAFT_MS - 1).toISOString(),
    }));
    const removed = pruneDrafts(store, NOW);
    expect(removed).toEqual([draftKey({ ...IDENTITY, memberId: "past" })]);
  });
});

describe("resolveResume", () => {
  const row = {
    id: "run-1",
    answers: { [ITEM_B]: true },
    values: {},
    notes: "from the server",
    updatedAt: "2026-08-11T17:00:00.000Z",
  };

  it("resumes nothing when neither store has anything", () => {
    expect(resolveResume(null, null)).toBeNull();
  });

  it("resumes the server's run when the device has none", () => {
    expect(resolveResume(null, row)).toEqual({
      source: "server",
      answers: row.answers,
      values: row.values,
      notes: "from the server",
      serverId: "run-1",
      savedAt: row.updatedAt,
    });
  });

  it("turns a null server note into an empty string", () => {
    expect(resolveResume(null, { ...row, notes: null })?.notes).toBe("");
  });

  // The row this draft used to sync to is gone — reset on another device, or
  // swept as abandoned. Forgetting the id is what makes the next sync POST a
  // fresh row rather than PATCH a 404 forever.
  it("forgets the server id when the device's draft has outlived its row", () => {
    const local = draft({ serverId: "run-gone" });
    const picked = resolveResume(local, null);
    expect(picked?.source).toBe("device");
    expect(picked?.serverId).toBeNull();
    expect(picked?.answers).toEqual(local.answers);
  });

  // The failure this whole rule exists to prevent: tick three items on the
  // phone, reload inside the debounce window, and the server's older copy
  // silently undoes them.
  it("prefers the device when it is ahead of the server", () => {
    const local = draft({ savedAt: "2026-08-11T17:00:30.000Z", notes: "on the ramp" });
    const picked = resolveResume(local, row);
    expect(picked?.source).toBe("device");
    expect(picked?.notes).toBe("on the ramp");
    expect(picked?.answers).toEqual(local.answers);
  });

  it("prefers the server when it is ahead of the device", () => {
    const local = draft({ savedAt: "2026-08-11T16:59:00.000Z" });
    const picked = resolveResume(local, row);
    expect(picked?.source).toBe("server");
    expect(picked?.notes).toBe("from the server");
    expect(picked?.answers).toEqual(row.answers);
  });

  // A tie means the sync had just landed, so the two agree on content anyway.
  // Preferring the device keeps the rule off the phone-vs-server clock skew.
  it("gives an exact tie to the device", () => {
    const local = draft({ savedAt: row.updatedAt });
    expect(resolveResume(local, row)?.source).toBe("device");
  });

  // Whichever copy wins the CONTENT, the row is still the one open run the API
  // guarantees — adopting its id is what stops one walk forking into two rows.
  it("always adopts the server's row id when there is one", () => {
    expect(resolveResume(draft({ serverId: null }), row)?.serverId).toBe("run-1");
    expect(resolveResume(draft({ serverId: "stale" }), row)?.serverId).toBe("run-1");
  });
});

describe("draftHasProgress", () => {
  it("is false for an untouched card", () => {
    expect(draftHasProgress({}, "")).toBe(false);
  });

  it("is true once anything is ticked", () => {
    expect(draftHasProgress({ [ITEM_A]: true }, "")).toBe(true);
  });

  it("is true for notes alone, but not for whitespace", () => {
    expect(draftHasProgress({}, "wind picking up")).toBe(true);
    expect(draftHasProgress({}, "   \n ")).toBe(false);
  });

  it("ignores an unticked entry", () => {
    expect(draftHasProgress({ [ITEM_A]: false }, "")).toBe(false);
  });

  // The runway card's "Preflight — complete" is answered by the app before
  // anyone touches the page. Counting it would autosave a draft — and create a
  // server row — for a member who has done nothing at all.
  it("ignores items the app answers for itself", () => {
    expect(draftHasProgress({ "start.preflight": true }, "", ["start.preflight"])).toBe(
      false
    );
  });

  it("still counts a real tick alongside a derived one", () => {
    expect(
      draftHasProgress({ "start.preflight": true, [ITEM_A]: true }, "", [
        "start.preflight",
      ])
    ).toBe(true);
  });
});

describe("savedAgo", () => {
  const NOW = new Date("2026-08-11T12:00:00.000Z");
  const ago = (ms: number) => savedAgo(new Date(NOW.getTime() - ms).toISOString(), NOW);

  it("reads the first three quarters of a minute as 'just now'", () => {
    expect(ago(0)).toBe("just now");
    expect(ago(44_000)).toBe("just now");
  });

  it("counts minutes, then hours, then days", () => {
    expect(ago(3 * 60_000)).toBe("3 min ago");
    expect(ago(90 * 60_000)).toBe("2 hrs ago");
    expect(ago(60 * 60_000)).toBe("1 hr ago");
    expect(ago(3 * 24 * 60 * 60_000)).toBe("3 days ago");
    expect(ago(24 * 60 * 60_000)).toBe("1 day ago");
  });

  // A clock that has gone backwards (a device syncing its time mid-walk)
  // must not produce "saved -3 min ago".
  it("never reports a negative age", () => {
    expect(ago(-60_000)).toBe("just now");
  });

  it("degrades to a bare word rather than NaN", () => {
    expect(savedAgo("not a date", NOW)).toBe("saved");
  });
});
