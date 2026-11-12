import { describe, expect, it } from "vitest";
import {
  parseBookingArgs,
  parseBookingUpdateArgs,
  parseCancelArgs,
  parseClubTime,
  parseFlightArgs,
  parseFlightUpdateArgs,
  pickAircraft,
  pickInstructor,
} from "@/lib/agentWrites";

describe("parseClubTime", () => {
  it("reads a bare local time as the CLUB's clock, whatever the server's zone", () => {
    // November: Pacific Standard Time, UTC-8.
    expect(parseClubTime("2026-11-14T09:00")?.toISOString()).toBe("2026-11-14T17:00:00.000Z");
    // July: Pacific Daylight Time, UTC-7.
    expect(parseClubTime("2026-07-04 09:30")?.toISOString()).toBe("2026-07-04T16:30:00.000Z");
  });
  it("takes an instant with an offset as it is", () => {
    expect(parseClubTime("2026-11-14T09:00:00-08:00")?.toISOString()).toBe("2026-11-14T17:00:00.000Z");
    expect(parseClubTime("2026-11-14T17:00:00Z")?.toISOString()).toBe("2026-11-14T17:00:00.000Z");
  });
  it("refuses anything vaguer", () => {
    for (const v of ["tomorrow at 9", "2026-11-14", "", 42, null, "2026-13-01T09:00"]) {
      expect(parseClubTime(v)).toBeNull();
    }
  });
});

describe("parseBookingArgs", () => {
  it("defaults the purpose to a local flight", () => {
    const r = parseBookingArgs({ startsAt: "2026-11-14T09:00", endsAt: "2026-11-14T11:00" });
    expect(r).toMatchObject({ value: { purpose: "LOCAL", tailNumber: null, instructor: null } });
  });
  it("keeps a lesson's instructor and the airplane named", () => {
    const r = parseBookingArgs({
      startsAt: "2026-11-14T09:00",
      endsAt: "2026-11-14T11:00",
      purpose: "TRAINING",
      instructor: " Matt ",
      tailNumber: "n8318b",
      notes: "pattern work",
    });
    expect(r).toMatchObject({
      value: { purpose: "TRAINING", instructor: "Matt", tailNumber: "n8318b", notes: "pattern work" },
    });
  });
  it("says what's wrong with bad times or an unknown purpose", () => {
    expect(parseBookingArgs({ startsAt: "9am", endsAt: "11am" })).toHaveProperty("error");
    expect(
      parseBookingArgs({ startsAt: "2026-11-14T09:00", endsAt: "2026-11-14T11:00", purpose: "JOYRIDE" })
    ).toEqual({ error: 'Unknown purpose "JOYRIDE".' });
  });
});

describe("parseCancelArgs", () => {
  it("needs a booking id", () => {
    expect(parseCancelArgs({ bookingId: "b1" })).toEqual({ value: { bookingId: "b1" } });
    expect(parseCancelArgs({})).toHaveProperty("error");
  });
});

describe("parseFlightArgs", () => {
  const now = new Date("2026-11-11T05:00:00Z"); // still Nov 10 at the club

  it("needs the tach at shutdown", () => {
    expect(parseFlightArgs({ tachStart: 1500 }, now)).toEqual({
      error: "Give tachEnd, the tach reading at shutdown.",
    });
  });
  it("files on the club's today by default, at club midnight", () => {
    const r = parseFlightArgs({ tachEnd: 1501.2 }, now);
    expect(r).toMatchObject({ value: { body: { tachEnd: 1501.2, flownOn: "2026-11-10T08:00:00.000Z" } } });
  });
  it("passes the numbers and words the route reads, and nothing it didn't get", () => {
    const r = parseFlightArgs(
      {
        flownOn: "2026-11-09",
        tachStart: "1500.0",
        tachEnd: 1501.2,
        landings: 3,
        departure: "KTOA",
        arrival: "KTOA",
        purpose: "TRAINING",
        instructor: "Matt",
        fuelPaidPersonally: false,
        requestId: "jarvis-1",
      },
      now
    );
    expect(r).toEqual({
      value: {
        body: {
          tachStart: 1500,
          tachEnd: 1501.2,
          landings: 3,
          flownOn: "2026-11-09T08:00:00.000Z",
          purpose: "TRAINING",
          departure: "KTOA",
          arrival: "KTOA",
          fuelPaidPersonally: false,
          requestId: "jarvis-1",
        },
        tailNumber: null,
        instructor: "Matt",
      },
    });
  });
  it("refuses a number that isn't one, and a day that isn't a day", () => {
    expect(parseFlightArgs({ tachEnd: "lots" }, now)).toEqual({ error: "tachEnd has to be a number." });
    expect(parseFlightArgs({ tachEnd: 1, flownOn: "yesterday" }, now)).toHaveProperty("error");
  });
});

describe("pickAircraft", () => {
  const fleet = [{ tailNumber: "N8318B" }, { tailNumber: "N12345" }];
  it("finds the one named, however it's typed", () => {
    expect(pickAircraft(fleet, "n 8318b")).toEqual({ value: fleet[0] });
  });
  it("takes the only airplane when none is named, and asks when there are two", () => {
    expect(pickAircraft([fleet[0]], null)).toEqual({ value: fleet[0] });
    expect(pickAircraft(fleet, null)).toEqual({ error: "Say which airplane: N8318B, N12345." });
    expect(pickAircraft(fleet, "N99999")).toHaveProperty("error");
  });
});

describe("pickInstructor", () => {
  const cfis = [
    { id: "1", name: "Matt Reyes" },
    { id: "2", name: "Matthew Chen" },
    { id: "3", name: "Priya Shah" },
  ];
  it("matches a full name, then a unique first name, then a unique part", () => {
    expect(pickInstructor(cfis, "matthew chen")).toEqual({ value: cfis[1] });
    expect(pickInstructor(cfis, "Matt")).toEqual({ value: cfis[0] });
    expect(pickInstructor(cfis, "shah")).toEqual({ value: cfis[2] });
  });
  it("never guesses between two", () => {
    expect(pickInstructor(cfis, "chen")).toEqual({ value: cfis[1] });
    expect(pickInstructor(cfis, "mat")).toEqual({
      error: 'More than one instructor matches "mat": Matt Reyes, Matthew Chen.',
    });
    expect(pickInstructor(cfis, "Zed")).toHaveProperty("error");
  });
});

describe("parseBookingUpdateArgs", () => {
  it("sends only what changes, with times on the club's clock", () => {
    expect(parseBookingUpdateArgs({ bookingId: "b1", startsAt: "2026-11-12T09:00", endsAt: "2026-11-12T12:00" })).toEqual({
      value: {
        bookingId: "b1",
        body: { startsAt: "2026-11-12T17:00:00.000Z", endsAt: "2026-11-12T20:00:00.000Z" },
        instructor: undefined,
      },
    });
  });
  it("can clear the notes or the instructor, which is different from leaving them", () => {
    expect(parseBookingUpdateArgs({ bookingId: "b1", notes: "", instructor: null })).toEqual({
      value: { bookingId: "b1", body: { notes: null }, instructor: null },
    });
    expect(parseBookingUpdateArgs({ bookingId: "b1", purpose: "TRAINING", instructor: "Matt" })).toEqual({
      value: { bookingId: "b1", body: { purpose: "TRAINING" }, instructor: "Matt" },
    });
  });
  it("needs a booking and something to change, and refuses a bad time or purpose", () => {
    expect(parseBookingUpdateArgs({ startsAt: "2026-11-12T09:00" })).toHaveProperty("error");
    expect(parseBookingUpdateArgs({ bookingId: "b1" })).toHaveProperty("error");
    expect(parseBookingUpdateArgs({ bookingId: "b1", endsAt: "noon" })).toHaveProperty("error");
    expect(parseBookingUpdateArgs({ bookingId: "b1", purpose: "JOYRIDE" })).toHaveProperty("error");
  });
});

describe("parseFlightUpdateArgs", () => {
  it("sends only what changes, and null clears a meter or a word", () => {
    expect(
      parseFlightUpdateArgs({ flightId: "f1", tachEnd: "1502.4", hobbsEnd: null, route: null, logEntry: "Steep turns." })
    ).toEqual({
      value: {
        flightId: "f1",
        body: { tachEnd: 1502.4, hobbsEnd: null, route: null, logEntry: "Steep turns." },
        instructor: undefined,
      },
    });
  });
  it("moves the day to club midnight and passes the instructor to look up", () => {
    expect(parseFlightUpdateArgs({ flightId: "f1", flownOn: "2026-11-09", instructor: "Matt" })).toEqual({
      value: { flightId: "f1", body: { flownOn: "2026-11-09T08:00:00.000Z" }, instructor: "Matt" },
    });
  });
  it("needs a flight and something to change, and refuses what isn't a number or a day", () => {
    expect(parseFlightUpdateArgs({ tachEnd: 1 })).toHaveProperty("error");
    expect(parseFlightUpdateArgs({ flightId: "f1" })).toHaveProperty("error");
    expect(parseFlightUpdateArgs({ flightId: "f1", tachEnd: "lots" })).toEqual({ error: "tachEnd has to be a number." });
    expect(parseFlightUpdateArgs({ flightId: "f1", flownOn: "yesterday" })).toHaveProperty("error");
  });
});
