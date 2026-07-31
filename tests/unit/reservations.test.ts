import { describe, expect, it } from "vitest";
import {
  findConflict,
  overlaps,
  past,
  upcoming,
  validateReservation,
} from "@/lib/reservations";
import { MAX_ADVANCE_DAYS, MAX_RESERVATION_HOURS } from "@/lib/constants";

const iso = (h: number, day = 1) =>
  new Date(Date.UTC(2026, 7, day, h, 0, 0)).toISOString();

describe("overlaps", () => {
  it("catches a booking that starts inside another", () => {
    expect(
      overlaps(
        { startsAt: iso(9), endsAt: iso(12) },
        { startsAt: iso(11), endsAt: iso(14) }
      )
    ).toBe(true);
  });

  it("catches one booking swallowing another", () => {
    expect(
      overlaps(
        { startsAt: iso(8), endsAt: iso(18) },
        { startsAt: iso(10), endsAt: iso(11) }
      )
    ).toBe(true);
  });

  // The reason intervals are half-open: back-to-back handoffs have to be
  // bookable, or the second pilot can never start when the first one lands.
  it("allows back-to-back bookings that touch at the boundary", () => {
    expect(
      overlaps(
        { startsAt: iso(9), endsAt: iso(12) },
        { startsAt: iso(12), endsAt: iso(15) }
      )
    ).toBe(false);
  });

  it("ignores bookings on different days", () => {
    expect(
      overlaps(
        { startsAt: iso(9, 1), endsAt: iso(12, 1) },
        { startsAt: iso(9, 2), endsAt: iso(12, 2) }
      )
    ).toBe(false);
  });
});

describe("findConflict", () => {
  const existing = [
    { id: "a", startsAt: iso(9), endsAt: iso(12) },
    { id: "b", startsAt: iso(14), endsAt: iso(16) },
  ];

  it("returns the colliding row", () => {
    expect(findConflict(existing, { startsAt: iso(11), endsAt: iso(13) })?.id).toBe("a");
  });

  it("returns null when the slot is free", () => {
    expect(findConflict(existing, { startsAt: iso(12), endsAt: iso(14) })).toBeNull();
  });

  // Editing a booking must not collide with its own former self.
  it("skips the row being edited", () => {
    expect(
      findConflict(existing, { startsAt: iso(9), endsAt: iso(13) }, "a")
    ).toBeNull();
  });
});

describe("validateReservation", () => {
  const now = new Date(Date.UTC(2026, 7, 1, 8, 0, 0));

  it("accepts a normal booking", () => {
    expect(
      validateReservation({ startsAt: iso(9), endsAt: iso(12) }, now)
    ).toBeNull();
  });

  it("rejects an end before the start", () => {
    expect(
      validateReservation({ startsAt: iso(12), endsAt: iso(9) }, now)
    ).toMatch(/after the start/);
  });

  it("rejects a block longer than the club maximum", () => {
    const end = new Date(
      Date.UTC(2026, 7, 1, 9 + MAX_RESERVATION_HOURS + 1, 0, 0)
    ).toISOString();
    expect(validateReservation({ startsAt: iso(9), endsAt: end }, now)).toMatch(
      /top out/
    );
  });

  it("rejects a block that has already finished", () => {
    expect(
      validateReservation({ startsAt: iso(5), endsAt: iso(7) }, now)
    ).toMatch(/in the past/);
  });

  it("rejects a booking beyond the advance-booking horizon", () => {
    const start = new Date(now.getTime() + (MAX_ADVANCE_DAYS + 2) * 86_400_000);
    const end = new Date(start.getTime() + 3_600_000);
    expect(
      validateReservation({ startsAt: start, endsAt: end }, now)
    ).toMatch(/days ahead/);
  });

  // A form submitted right as the slot begins shouldn't be rejected by the
  // round-trip latency.
  it("tolerates a start a few minutes in the past", () => {
    const start = new Date(now.getTime() - 2 * 60_000);
    const end = new Date(now.getTime() + 3_600_000);
    expect(validateReservation({ startsAt: start, endsAt: end }, now)).toBeNull();
  });
});

describe("upcoming / past", () => {
  const now = new Date(Date.UTC(2026, 7, 1, 13, 0, 0));
  const rows = [
    { id: "done", startsAt: iso(9), endsAt: iso(12) },
    { id: "later", startsAt: iso(16), endsAt: iso(18) },
    { id: "soon", startsAt: iso(14), endsAt: iso(15) },
  ];

  it("returns future bookings soonest first", () => {
    expect(upcoming(rows, now).map((r) => r.id)).toEqual(["soon", "later"]);
  });

  it("returns finished bookings most recent first", () => {
    expect(past(rows, now).map((r) => r.id)).toEqual(["done"]);
  });
});
