import { describe, expect, it } from "vitest";
import {
  PROP,
  appEventProps,
  appEventTitle,
  bookingAttendees,
  cancelledTitle,
  eventInstant,
  eventTimes,
  eventToBooking,
  guessPurpose,
  isCancelledTitle,
  plainText,
  type GoogleEvent,
  type PeopleLookup,
} from "@/lib/calendarEvents";

const people: PeopleLookup = {
  userIdByEmail: (email) =>
    ({ "geo.thome@gmail.com": "u-george", "mattlarge8@gmail.com": "u-matt" })[
      email.toLowerCase()
    ] ?? null,
  isUser: (id) => ["u-george", "u-matt", "u-dylan"].includes(id),
  isInstructor: (id) => id === "u-matt",
};

// Shaped like the club's real N8318B calendar.
const handMade: GoogleEvent = {
  id: "591j5fmsdt3l44fc4s59qg5qsd",
  status: "confirmed",
  summary: "George Flight with Matt",
  creator: { email: "Geo.Thome@gmail.com" },
  start: { dateTime: "2026-10-15T14:00:00-07:00", timeZone: "America/Los_Angeles" },
  end: { dateTime: "2026-10-15T16:00:00-07:00", timeZone: "America/Los_Angeles" },
};

describe("isCancelledTitle / cancelledTitle", () => {
  it("recognises the ways the club already writes it", () => {
    expect(isCancelledTitle("CANCELLED (wx) Sasha checkout")).toBe(true);
    expect(isCancelledTitle("CANCELLED - Dylan — Lesson")).toBe(true);
    expect(isCancelledTitle("Canceled: lesson")).toBe(true);
    expect(isCancelledTitle("  cancelled")).toBe(true);
  });

  it("only counts the word at the START of the title", () => {
    expect(isCancelledTitle("Makeup for cancelled lesson")).toBe(false);
    expect(isCancelledTitle("Cancellation policy chat")).toBe(false);
    expect(isCancelledTitle(undefined)).toBe(false);
  });

  it("prefixes once, and never twice", () => {
    expect(cancelledTitle("George Flight with Matt")).toBe("CANCELLED - George Flight with Matt");
    expect(cancelledTitle("CANCELLED - George Flight with Matt")).toBe(
      "CANCELLED - George Flight with Matt"
    );
    expect(cancelledTitle("")).toBe("CANCELLED - Booking");
  });
});

describe("guessPurpose", () => {
  it("reads the club's own titles", () => {
    expect(guessPurpose("Lesson w/Veeryan")).toBe("TRAINING");
    expect(guessPurpose("Nikolai Flight Training w/Matt")).toBe("TRAINING");
    expect(guessPurpose("Sasha checkout")).toBe("TRAINING");
    expect(guessPurpose("Checkride")).toBe("CHECKRIDE");
    expect(guessPurpose("Strut Maintanence")).toBe("MAINTENANCE");
    expect(guessPurpose("XC to Bakersfield")).toBe("CROSS_COUNTRY");
    expect(guessPurpose("Sasha solo pattern work")).toBe("TRAINING_SOLO");
    expect(guessPurpose("Solo training")).toBe("TRAINING_SOLO");
  });

  it("falls back to LOCAL rather than guessing hard", () => {
    expect(guessPurpose("Personal res")).toBe("LOCAL");
    expect(guessPurpose("Apartment final inspection")).toBe("LOCAL");
    expect(guessPurpose(undefined)).toBe("LOCAL");
  });
});

describe("plainText", () => {
  it("turns Google's HTML description into text", () => {
    expect(plainText("Fuel at <b>KSMO</b><br>back by 5 &amp; tie down")).toBe(
      "Fuel at KSMO\nback by 5 & tie down"
    );
  });
  it("is null for nothing", () => {
    expect(plainText("")).toBeNull();
    expect(plainText("<br>")).toBeNull();
    expect(plainText(undefined)).toBeNull();
  });
});

describe("eventInstant", () => {
  it("reads an all-day DATE as the club's midnight, not UTC's", () => {
    // 27 Aug is PDT, UTC−7.
    expect(eventInstant({ date: "2026-08-27" })?.toISOString()).toBe("2026-08-27T07:00:00.000Z");
    // 19 Dec is PST, UTC−8.
    expect(eventInstant({ date: "2026-12-19" })?.toISOString()).toBe("2026-12-19T08:00:00.000Z");
  });
  it("takes a dateTime at its own offset", () => {
    expect(eventInstant({ dateTime: "2026-08-29T08:00:00-07:00" })?.toISOString()).toBe(
      "2026-08-29T15:00:00.000Z"
    );
  });
  it("is null for nothing usable", () => {
    expect(eventInstant(undefined)).toBeNull();
    expect(eventInstant({ dateTime: "not a date" })).toBeNull();
  });
});

describe("eventToBooking", () => {
  it("maps a hand-made event to its creator, keeping the title", () => {
    const b = eventToBooking(handMade, people);
    expect(b).toMatchObject({
      googleEventId: handMade.id,
      userId: "u-george",
      purpose: "LOCAL",
      instructorId: null,
      title: "George Flight with Matt",
      allDay: false,
      status: "CONFIRMED",
    });
  });

  it("leaves the member empty when the creator has no account here", () => {
    const b = eventToBooking(
      { ...handMade, creator: { email: "stranger@example.com" }, summary: "Strut Maintanence" },
      people
    );
    expect(b).toMatchObject({ userId: null, purpose: "MAINTENANCE", title: "Strut Maintanence" });
  });

  it("reads a multi-day all-day event as club midnights, end exclusive", () => {
    const b = eventToBooking(
      { ...handMade, summary: "Personal res", start: { date: "2026-08-27" }, end: { date: "2026-08-31" } },
      people
    );
    expect(b).not.toBe("removed");
    if (!b || b === "removed") throw new Error("expected a booking");
    expect(b.allDay).toBe(true);
    expect(b.startsAt.toISOString()).toBe("2026-08-27T07:00:00.000Z");
    expect(b.endsAt.toISOString()).toBe("2026-08-31T07:00:00.000Z");
  });

  it("treats a CANCELLED title as cancelled and a deleted event as removed", () => {
    const b = eventToBooking({ ...handMade, summary: "CANCELLED (wx) Sasha checkout" }, people);
    expect(b).toMatchObject({ status: "CANCELED" });
    expect(eventToBooking({ id: "x", status: "cancelled" }, people)).toBe("removed");
  });

  it("skips an event with no usable times", () => {
    expect(eventToBooking({ id: "x", summary: "?" }, people)).toBeNull();
    expect(
      eventToBooking({ ...handMade, end: handMade.start }, people)
    ).toBeNull();
  });

  it("trusts the app's own properties over the creator and the title", () => {
    const title = "Dylan Wong — Lesson w/ Matt Large";
    const b = eventToBooking(
      {
        ...handMade,
        summary: title,
        // Written through the club's connected account, not Dylan's.
        creator: { email: "mattlarge8@gmail.com" },
        extendedProperties: {
          private: {
            [PROP.userId]: "u-dylan",
            [PROP.purpose]: "TRAINING",
            [PROP.instructorId]: "u-matt",
            [PROP.summary]: title,
          },
        },
      },
      people
    );
    expect(b).toMatchObject({
      userId: "u-dylan",
      purpose: "TRAINING",
      instructorId: "u-matt",
      // The app's own title isn't stored — the calendar draws its own label.
      title: null,
    });
  });

  it("keeps a title once an app event is renamed in Google", () => {
    const b = eventToBooking(
      {
        ...handMade,
        summary: "Dylan — swapped with George",
        extendedProperties: { private: { [PROP.summary]: "Dylan Wong — Local flight" } },
      },
      people
    );
    expect(b).toMatchObject({ title: "Dylan — swapped with George" });
  });

  it("drops an instructor who isn't a CFI, or on a booking that isn't a lesson", () => {
    const notCfi = eventToBooking(
      {
        ...handMade,
        extendedProperties: {
          private: { [PROP.purpose]: "TRAINING", [PROP.instructorId]: "u-george" },
        },
      },
      people
    );
    expect(notCfi).toMatchObject({ instructorId: null });
    const notLesson = eventToBooking(
      {
        ...handMade,
        extendedProperties: { private: { [PROP.purpose]: "LOCAL", [PROP.instructorId]: "u-matt" } },
      },
      people
    );
    expect(notLesson).toMatchObject({ instructorId: null });
  });

  it("falls back to the creator when the stored member is gone", () => {
    const b = eventToBooking(
      { ...handMade, extendedProperties: { private: { [PROP.userId]: "u-deleted" } } },
      people
    );
    expect(b).toMatchObject({ userId: "u-george" });
  });
});

describe("writing events", () => {
  it("titles them in the club's style", () => {
    expect(appEventTitle({ memberName: "Dylan Wong", purpose: "LOCAL" })).toBe(
      "Dylan Wong — Local flight"
    );
    expect(
      appEventTitle({ memberName: "Dylan Wong", purpose: "TRAINING", instructorName: "Matt Large" })
    ).toBe("Dylan Wong — Lesson w/ Matt Large");
    expect(appEventTitle({ memberName: "Dylan Wong", purpose: "MAINTENANCE" })).toBe("Maintenance");
  });

  it("writes all-day bookings as club DATES and others as instants", () => {
    const allDay = eventTimes({
      startsAt: new Date("2026-08-27T07:00:00.000Z"),
      endsAt: new Date("2026-08-31T07:00:00.000Z"),
      allDay: true,
    });
    expect(allDay).toEqual({ start: { date: "2026-08-27" }, end: { date: "2026-08-31" } });
    const timed = eventTimes({
      startsAt: new Date("2026-10-15T21:00:00.000Z"),
      endsAt: new Date("2026-10-15T23:00:00.000Z"),
      allDay: false,
    });
    expect(timed.start).toEqual({
      dateTime: "2026-10-15T21:00:00.000Z",
      timeZone: "America/Los_Angeles",
    });
  });

  it("always writes the instructor key, so a PATCH can clear a stale one", () => {
    expect(appEventProps({ userId: "u-dylan", purpose: "LOCAL", instructorId: null })).toEqual({
      [PROP.userId]: "u-dylan",
      [PROP.purpose]: "LOCAL",
      [PROP.instructorId]: "",
    });
  });

  it("round-trips: what the app writes reads back as the same booking", () => {
    const title = appEventTitle({ memberName: "Dylan Wong", purpose: "TRAINING", instructorName: "Matt" });
    const startsAt = new Date("2026-10-16T15:00:00.000Z");
    const endsAt = new Date("2026-10-16T18:00:00.000Z");
    const event: GoogleEvent = {
      id: "abc",
      summary: title,
      description: "Pattern work",
      ...eventTimes({ startsAt, endsAt, allDay: false }),
      extendedProperties: {
        private: appEventProps({
          userId: "u-dylan",
          purpose: "TRAINING",
          instructorId: "u-matt",
          generatedTitle: title,
        }),
      },
    };
    expect(eventToBooking(event, people)).toEqual({
      googleEventId: "abc",
      startsAt,
      endsAt,
      allDay: false,
      userId: "u-dylan",
      purpose: "TRAINING",
      instructorId: "u-matt",
      notes: "Pattern work",
      title: null,
      status: "CONFIRMED",
    });
  });
});

describe("bookingAttendees", () => {
  it("invites the member and the CFI on a new booking", () => {
    expect(bookingAttendees([], ["sam@club.test", "priya@club.test"])).toEqual([
      { email: "sam@club.test" },
      { email: "priya@club.test" },
    ]);
  });

  it("skips a missing CFI and a booking with nobody to invite", () => {
    expect(bookingAttendees([], ["sam@club.test", null])).toEqual([{ email: "sam@club.test" }]);
    expect(bookingAttendees([], [null, undefined])).toBeNull();
  });

  it("changes nothing when everyone is already there, whatever the case", () => {
    expect(
      bookingAttendees(
        [{ email: "Sam@Club.test", responseStatus: "accepted" }, { email: "priya@club.test" }],
        ["sam@club.test", "priya@club.test"]
      )
    ).toBeNull();
  });

  it("swaps the old CFI for the new one and keeps everyone's RSVP", () => {
    expect(
      bookingAttendees(
        [
          { email: "sam@club.test", responseStatus: "accepted" },
          { email: "priya@club.test", responseStatus: "accepted" },
        ],
        ["sam@club.test", "jo@club.test"],
        ["priya@club.test"]
      )
    ).toEqual([
      { email: "sam@club.test", responseStatus: "accepted" },
      { email: "jo@club.test" },
    ]);
  });

  it("leaves a guest someone added in Google alone", () => {
    expect(
      bookingAttendees(
        [{ email: "passenger@gmail.com" }, { email: "priya@club.test" }],
        ["sam@club.test", null],
        ["priya@club.test"]
      )
    ).toEqual([{ email: "passenger@gmail.com" }, { email: "sam@club.test" }]);
  });

  it("never drops someone who is still wanted", () => {
    expect(
      bookingAttendees([{ email: "sam@club.test" }], ["sam@club.test"], ["sam@club.test"])
    ).toBeNull();
  });
});
