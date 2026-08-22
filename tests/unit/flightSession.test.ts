import { describe, expect, it } from "vitest";
import {
  END_FIELDS,
  RUNWAY_FIELDS,
  START_FIELDS,
  canEditFlight,
  canEditLogEntry,
  endFromTurnoff,
  isIncompleteEntry,
  isOpenSession,
  missingMeters,
  resolveTimes,
  sessionState,
  startFromPreflight,
  startFromRunway,
} from "@/lib/flightSession";
import {
  PREFLIGHT_CHECKOUT,
  RUNWAY_CHECKOUT,
  TURNOFF_CHECKOUT,
  type Checkout,
} from "@/lib/checkouts";

const DAY = "2026-08-21";

describe("sessionState", () => {
  it("is OPEN until the entry is filed", () => {
    expect(sessionState({ filedAt: null })).toBe("OPEN");
    expect(isOpenSession({ filedAt: null })).toBe(true);
  });

  it("is FILED once it is, whatever the meters say", () => {
    // The point of keying on `filedAt` alone: an entry filed with a blank tach
    // end is a record with a gap, not a flight still in the air.
    expect(sessionState({ filedAt: "2026-08-21T18:00:00Z", tachEnd: null })).toBe(
      "FILED"
    );
    expect(isOpenSession({ filedAt: new Date() })).toBe(false);
  });
});

/** Every field id on a card, so the constants can be checked against it. */
function fieldIds(checkout: Checkout): string[] {
  return checkout.sections.flatMap((section) =>
    section.items.flatMap((item) => (item.fields ?? []).map((f) => f.id))
  );
}

describe("the field ids the log reads off the cards", () => {
  // Renaming one of these is a silent break: `startFromPreflight` would find
  // nothing and open a session with no meters, and nothing else would complain.
  it("all still exist on their card", () => {
    const preflight = fieldIds(PREFLIGHT_CHECKOUT);
    expect(preflight).toContain(START_FIELDS.tach);
    expect(preflight).toContain(START_FIELDS.hobbs);
    expect(preflight).toContain(START_FIELDS.clock);

    expect(fieldIds(RUNWAY_CHECKOUT)).toContain(RUNWAY_FIELDS.clock);

    const turnoff = fieldIds(TURNOFF_CHECKOUT);
    expect(turnoff).toContain(END_FIELDS.tach);
    expect(turnoff).toContain(END_FIELDS.hobbs);
    expect(turnoff).toContain(END_FIELDS.clock);
  });
});

describe("startFromPreflight", () => {
  it("takes the meters and the clock the walk recorded", () => {
    const start = startFromPreflight(
      {
        [START_FIELDS.tach]: 1506.1,
        [START_FIELDS.hobbs]: 2210.4,
        [START_FIELDS.clock]: "09:15",
      },
      DAY
    );
    expect(start.tachStart).toBe(1506.1);
    expect(start.hobbsStart).toBe(2210.4);
    expect(start.startedAt).toBeInstanceOf(Date);
  });

  it("leaves out what the walk never recorded", () => {
    const start = startFromPreflight({}, DAY);
    expect(start).toEqual({ tachStart: null, hobbsStart: null, startedAt: null });
  });

  it("ignores a reading that isn't a number", () => {
    const start = startFromPreflight(
      { [START_FIELDS.tach]: "1506.1" as unknown as number },
      DAY
    );
    expect(start.tachStart).toBeNull();
  });

  it("ignores a clock that isn't a clock", () => {
    expect(startFromPreflight({ [START_FIELDS.clock]: "soon" }, DAY).startedAt).toBeNull();
  });
});

describe("startFromRunway", () => {
  it("contributes the flight timer and nothing else", () => {
    const out = startFromRunway({ [RUNWAY_FIELDS.clock]: "09:41" }, DAY);
    expect(out.startedAt).toBeInstanceOf(Date);
  });
});

describe("endFromTurnoff", () => {
  it("takes both meters and the stop time", () => {
    const end = endFromTurnoff(
      {
        [END_FIELDS.tach]: 1507.4,
        [END_FIELDS.hobbs]: 2212.0,
        [END_FIELDS.clock]: "11:20",
      },
      DAY
    );
    expect(end.tachEnd).toBe(1507.4);
    expect(end.hobbsEnd).toBe(2212);
    expect(end.endedAt).toBeInstanceOf(Date);
  });
});

describe("resolveTimes", () => {
  const at = (iso: string) => new Date(iso);

  it("leaves an ordinary pair alone", () => {
    const out = resolveTimes(at("2026-08-21T16:00:00Z"), at("2026-08-21T18:30:00Z"));
    expect(out.endedAt?.toISOString()).toBe("2026-08-21T18:30:00.000Z");
  });

  it("rolls an overnight leg's end forward a day", () => {
    // Off at 22:00, down at 00:30. Both clocks were read against the departure
    // day, so without the rollover this is minus twenty-one and a half hours.
    const out = resolveTimes(at("2026-08-21T22:00:00Z"), at("2026-08-21T00:30:00Z"));
    expect(out.endedAt?.toISOString()).toBe("2026-08-22T00:30:00.000Z");
    expect(out.endedAt!.getTime()).toBeGreaterThan(out.startedAt!.getTime());
  });

  it("rolls only once, so a mistyped time stays visibly wrong", () => {
    const out = resolveTimes(at("2026-08-21T22:00:00Z"), at("2026-08-19T00:30:00Z"));
    expect(out.endedAt?.toISOString()).toBe("2026-08-20T00:30:00.000Z");
  });

  it("has nothing to fix when either end is missing", () => {
    expect(resolveTimes(null, at("2026-08-21T18:00:00Z")).startedAt).toBeNull();
    expect(resolveTimes(at("2026-08-21T18:00:00Z"), null).endedAt).toBeNull();
  });
});

describe("who may change a log entry", () => {
  const entry = { userId: "pilot-1" };
  const pilot = { id: "pilot-1" };
  const admin = { id: "admin-1", isAdmin: true };
  const other = { id: "member-2" };

  it("lets the pilot correct their own", () => {
    expect(canEditFlight(entry, pilot)).toBe(true);
  });

  it("lets an admin correct anyone's", () => {
    expect(canEditFlight(entry, admin)).toBe(true);
  });

  it("refuses another member", () => {
    expect(canEditFlight(entry, other)).toBe(false);
    expect(canEditFlight(entry, null)).toBe(false);
  });

  it("reads the pilot off either spelling", () => {
    expect(canEditFlight({ pilot: { id: "pilot-1" } }, pilot)).toBe(true);
  });

  // The one deliberate narrowing: the write-up is the author's words.
  it("keeps the write-up to its author, admin or not", () => {
    expect(canEditLogEntry(entry, pilot)).toBe(true);
    expect(canEditLogEntry(entry, admin)).toBe(false);
    expect(canEditLogEntry(entry, other)).toBe(false);
  });
});

// ── A filed entry with a gap in it ──────────────────────────────────────────
//
// Filing incomplete is allowed: a member who never got the shutdown reading
// should still be able to record that the flight happened, because a row with
// a gap is a better record than no row. These pin the distinction that makes
// that safe — a GAP is not the same as a flight still in the air, even though
// both look like "no tach end" in the database.
describe("incomplete entries", () => {
  const filed = { filedAt: "2026-08-22T18:00:00.000Z" };

  it("is not the same question as 'is the airplane still out'", () => {
    // Open: no filedAt. Not incomplete — nothing is missing yet, the flight
    // simply hasn't finished. Badging this as a gap would ask somebody to go
    // and fix a flight that is currently happening.
    const open = { filedAt: null, tachStart: 1509.0, tachEnd: null };
    expect(isOpenSession(open)).toBe(true);
    expect(isIncompleteEntry(open)).toBe(false);
    expect(missingMeters(open)).toEqual([]);

    // Filed with the same missing reading: a record the club knows has a hole.
    const gap = { ...filed, tachStart: 1509.0, tachEnd: null };
    expect(isOpenSession(gap)).toBe(false);
    expect(isIncompleteEntry(gap)).toBe(true);
  });

  it("names which readings are missing", () => {
    expect(missingMeters({ ...filed, tachStart: 1509.0, tachEnd: null })).toEqual([
      "tach end",
    ]);
    expect(missingMeters({ ...filed, tachStart: null, tachEnd: 1510.2 })).toEqual([
      "tach start",
    ]);
    expect(missingMeters({ ...filed, tachStart: null, tachEnd: null })).toEqual([
      "tach start",
      "tach end",
    ]);
  });

  it("says nothing about a complete entry", () => {
    const whole = { ...filed, tachStart: 1509.0, tachEnd: 1510.2 };
    expect(isIncompleteEntry(whole)).toBe(false);
    expect(missingMeters(whole)).toEqual([]);
  });

  // Zero is a reading, not a gap. An airplane whose tach genuinely reads 0.0 is
  // a rebuilt instrument, and `!flight.tachStart` would call that missing.
  it("treats a zero reading as a reading", () => {
    expect(isIncompleteEntry({ ...filed, tachStart: 0, tachEnd: 0.4 })).toBe(false);
  });
});
