import { describe, expect, it } from "vitest";
import {
  allDayLabel,
  bookedBy,
  conflictMessage,
  daysCovered,
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

describe("bookedBy / conflictMessage", () => {
  it("names the member, or the Google event's own title", () => {
    expect(bookedBy({ user: { name: "George" }, title: "George Flight with Matt" })).toBe("George");
    expect(bookedBy({ user: null, title: "Strut Maintanence" })).toBe("Strut Maintanence");
    expect(bookedBy({ user: null, title: null })).toBe("Someone");
  });

  it("words a clash with a member and with an ownerless event", () => {
    const at = { startsAt: iso(9), endsAt: iso(11) };
    expect(conflictMessage({ ...at, user: { name: "George" } }, "N8318B", "9–11")).toBe(
      "George already has N8318B from 9–11."
    );
    expect(
      conflictMessage({ ...at, user: null, title: "Strut Maintanence" }, "N8318B", "9–11")
    ).toBe('N8318B is already booked from 9–11 ("Strut Maintanence").');
  });
});

describe("daysCovered / allDayLabel", () => {
  const local = (d: number, h = 0) => new Date(2026, 7, d, h);

  it("lists every day a booking touches, end exclusive at midnight", () => {
    const days = daysCovered({ startsAt: local(27), endsAt: local(31) });
    expect(days.map((d) => d.getDate())).toEqual([27, 28, 29, 30]);
  });

  it("covers both days of an overnight booking", () => {
    const days = daysCovered({ startsAt: local(8, 21), endsAt: local(9, 22) });
    expect(days.map((d) => d.getDate())).toEqual([8, 9]);
  });

  it("is one day for an ordinary booking, and capped for a runaway one", () => {
    expect(daysCovered({ startsAt: local(8, 9), endsAt: local(8, 12) })).toHaveLength(1);
    expect(
      daysCovered({ startsAt: local(1), endsAt: new Date(2030, 0, 1) })
    ).toHaveLength(62);
  });

  it("labels all-day bookings in days", () => {
    expect(allDayLabel({ startsAt: local(27), endsAt: local(28) })).toBe("All day");
    expect(allDayLabel({ startsAt: local(27), endsAt: local(31) })).toBe("4 days");
  });
});
