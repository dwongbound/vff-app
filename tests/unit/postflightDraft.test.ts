import { describe, expect, it } from "vitest";
import {
  POSTFLIGHT_DRAFT_KEY_PREFIX,
  pruneDrafts,
  type DraftStore,
} from "@/lib/checkoutDraft";
import { TURNOFF_CHECKOUT, allItemIds } from "@/lib/checkouts";
import {
  clearPostflightDraft,
  parsePostflightDraft,
  postflightDraftHasProgress,
  postflightDraftKey,
  readPostflightDraft,
  writePostflightDraft,
  type PostflightDraft,
  type PostflightForm,
} from "@/lib/postflightDraft";

/** A Map-backed `Storage`, so this file runs under vitest's node environment. */
function fakeStore(seed: Record<string, string> = {}): DraftStore {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
  };
}

const IDENTITY = {
  memberId: "member-1",
  aircraftId: "aircraft-1",
  turnoffVersion: TURNOFF_CHECKOUT.version,
};

const EMPTY: PostflightForm = {
  reservationId: "",
  flownOn: "2026-08-12",
  tachStart: "",
  tachEnd: "",
  hobbsStart: "",
  hobbsEnd: "",
  landings: "1",
  nightLandings: "0",
  withInstructor: false,
  instructorId: "",
  departure: "",
  arrival: "",
  route: "",
  fuelAdded: "",
  fuelCost: "",
  oilAdded: "",
  landingFee: "",
  notes: "",
  turnoffAnswers: {},
  turnoffValues: {},
  edited: {
    tachStart: false,
    tachEnd: false,
    hobbsStart: false,
    hobbsEnd: false,
    landingFee: false,
  },
  squawks: [],
  hadPhotos: false,
};

function draft(form: Partial<PostflightForm> = {}): PostflightDraft {
  return {
    ...EMPTY,
    ...form,
    ...IDENTITY,
    savedAt: "2026-08-12T02:30:00.000Z",
  };
}

describe("round trip", () => {
  it("comes back exactly as it went in", () => {
    const store = fakeStore();
    const original = draft({
      tachStart: "1505.9",
      tachEnd: "1506.1",
      route: "KTOA → KCMA → KTOA",
      turnoffAnswers: { [allItemIds("TURNOFF")[0]]: true },
      edited: {
        tachStart: false,
        tachEnd: true,
        hobbsStart: false,
        hobbsEnd: false,
        landingFee: false,
      },
    });

    expect(writePostflightDraft(store, original)).toBe(true);
    expect(readPostflightDraft(store, IDENTITY)).toEqual(original);
  });

  it("stores one draft per member per airplane", () => {
    const store = fakeStore();
    writePostflightDraft(store, draft({ route: "mine" }));
    writePostflightDraft(store, { ...draft({ route: "theirs" }), memberId: "member-2" });

    expect(readPostflightDraft(store, IDENTITY)?.route).toBe("mine");
    expect(
      readPostflightDraft(store, { ...IDENTITY, memberId: "member-2" })?.route
    ).toBe("theirs");
  });

  it("degrades to no draft when the device has no storage at all", () => {
    expect(readPostflightDraft(null, IDENTITY)).toBeNull();
    expect(writePostflightDraft(null, draft())).toBe(false);
  });

  it("reports a write it could not make", () => {
    const full = fakeStore();
    full.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    expect(writePostflightDraft(full, draft())).toBe(false);
  });

  it("clears on request", () => {
    const store = fakeStore();
    writePostflightDraft(store, draft({ route: "somewhere" }));
    clearPostflightDraft(store, IDENTITY);
    expect(readPostflightDraft(store, IDENTITY)).toBeNull();
  });
});

// A stored entry is discarded rather than repaired whenever it can't be trusted
// to be about THIS member, THIS airplane and THIS version of the turn-off card.
describe("parsePostflightDraft discards", () => {
  const stored = JSON.stringify(draft({ route: "KTOA" }));

  it("a turn-off card that has been reworded since", () => {
    expect(
      parsePostflightDraft(stored, {
        ...IDENTITY,
        turnoffVersion: TURNOFF_CHECKOUT.version + 1,
      })
    ).toBeNull();
  });

  it("another member's or another airplane's entry", () => {
    expect(
      parsePostflightDraft(stored, { ...IDENTITY, memberId: "someone-else" })
    ).toBeNull();
    expect(
      parsePostflightDraft(stored, { ...IDENTITY, aircraftId: "another-plane" })
    ).toBeNull();
  });

  it("junk, and anything with no usable timestamp", () => {
    expect(parsePostflightDraft(null, IDENTITY)).toBeNull();
    expect(parsePostflightDraft("{oh no", IDENTITY)).toBeNull();
    expect(parsePostflightDraft("[1,2,3]", IDENTITY)).toBeNull();
    expect(
      parsePostflightDraft(JSON.stringify({ ...draft(), savedAt: "soon" }), IDENTITY)
    ).toBeNull();
  });

  // Unlike the identity checks, a missing FIELD is not a reason to throw the
  // entry away: it's form state, and the other fifteen boxes are still the
  // member's work.
  it("but keeps an entry saved before a field existed", () => {
    const old = JSON.stringify({ ...draft({ route: "KTOA" }), notes: undefined });
    const parsed = parsePostflightDraft(old, IDENTITY);
    expect(parsed?.route).toBe("KTOA");
    expect(parsed?.notes).toBe("");
  });

  // Item ids that no longer exist go the same way they do in the API.
  it("and drops ticks for items no longer on the card", () => {
    const withStale = JSON.stringify(
      draft({ turnoffAnswers: { "shutdown.gone-away": true } })
    );
    expect(parsePostflightDraft(withStale, IDENTITY)?.turnoffAnswers).toEqual({});
  });

  it("and drops a squawk with no title, which could never be filed", () => {
    const raw = JSON.stringify(
      draft({
        squawks: [
          { title: "", description: "typed nothing", hadPhotos: false },
          { title: "Left brake soft", description: "", hadPhotos: true },
        ],
      })
    );
    expect(parsePostflightDraft(raw, IDENTITY)?.squawks).toEqual([
      { title: "Left brake soft", description: "", hadPhotos: true },
    ]);
  });
});

// The form does NOT open empty — today's date, one landing, a stopped timer —
// so "something is filled in" can't be the test, or opening the tab would save
// a draft and then offer to restore it.
describe("postflightDraftHasProgress", () => {
  it("is false for a form nobody has touched", () => {
    expect(postflightDraftHasProgress(EMPTY)).toBe(false);
  });

  it("is true once a tick or a note is entered", () => {
    expect(postflightDraftHasProgress({ ...EMPTY, notes: "ran rough" })).toBe(true);
    expect(postflightDraftHasProgress({ ...EMPTY, route: "KTOA → KCMA" })).toBe(true);
    expect(
      postflightDraftHasProgress({
        ...EMPTY,
        turnoffAnswers: { [allItemIds("TURNOFF")[0]]: true },
      })
    ).toBe(true);
  });

  // The meters are the subtle one. They arrive PREFILLED — tach start off the
  // airplane's last filed flight — so a number in the box is not evidence that
  // anybody did anything. Typing in it is.
  it("ignores a meter box that was merely prefilled, and counts one that was typed in", () => {
    expect(postflightDraftHasProgress({ ...EMPTY, tachStart: "1505.9" })).toBe(false);
    expect(
      postflightDraftHasProgress({
        ...EMPTY,
        tachEnd: "1506.1",
        edited: { ...EMPTY.edited, tachEnd: true },
      })
    ).toBe(true);
  });

  // …and a reading that came off the turn-off card still saves the form, via
  // the tick that recording it made. Nothing is lost by ignoring the box.
  it("saves a form whose meters came from the turn-off card, through its ticks", () => {
    expect(
      postflightDraftHasProgress({
        ...EMPTY,
        tachEnd: "1506.1",
        turnoffAnswers: { "shutdown.tach": true },
      })
    ).toBe(true);
  });

  // The two that matter most: a reported fault, and a photo of one.
  it("is true for a squawk or an attached photo", () => {
    expect(
      postflightDraftHasProgress({
        ...EMPTY,
        squawks: [{ title: "Left brake soft", description: "", hadPhotos: false }],
      })
    ).toBe(true);
    expect(postflightDraftHasProgress({ ...EMPTY, hadPhotos: true })).toBe(true);
  });

  it("ignores whitespace typed into a box and left there", () => {
    expect(postflightDraftHasProgress({ ...EMPTY, route: "   " })).toBe(false);
  });
});

// One sweep has to clear up after both pages: whichever the member opens next
// is the one doing the housekeeping.
describe("pruneDrafts covers post-flight entries too", () => {
  const now = new Date("2026-08-12T00:00:00.000Z");
  const key = postflightDraftKey(IDENTITY);

  it("sweeps one left untouched past the abandoned age", () => {
    const store = fakeStore({
      [key]: JSON.stringify({ ...draft(), savedAt: "2026-07-01T00:00:00.000Z" }),
    });
    expect(pruneDrafts(store, now)).toEqual([key]);
    expect(store.getItem(key)).toBeNull();
  });

  it("leaves a live one exactly where it is", () => {
    const store = fakeStore({
      [key]: JSON.stringify({ ...draft(), savedAt: "2026-08-11T20:00:00.000Z" }),
    });
    expect(pruneDrafts(store, now)).toEqual([]);
    expect(store.getItem(key)).not.toBeNull();
  });

  it("sweeps an older format's keys on sight, since nothing can read them", () => {
    const stale = "vff:postflight-draft:v0:member-1:aircraft-1";
    const store = fakeStore({ [stale]: JSON.stringify({ savedAt: now.toISOString() }) });
    expect(pruneDrafts(store, now)).toEqual([stale]);
  });

  it("and never touches anything it doesn't own", () => {
    const store = fakeStore({ "some-other-app:state": "hands off" });
    expect(pruneDrafts(store, now)).toEqual([]);
    expect(store.getItem("some-other-app:state")).toBe("hands off");
  });

  it("keys post-flight drafts under their own prefix", () => {
    expect(key.startsWith(`${POSTFLIGHT_DRAFT_KEY_PREFIX}:`)).toBe(true);
  });
});
