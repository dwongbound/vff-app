import { describe, expect, it } from "vitest";
import {
  INVITE_DEFAULT_VALUE,
  INVITE_OTHER_VALUE,
  inviteAddress,
  inviteOptions,
  parseInviteEmail,
  selectedInviteValue,
  staleInviteAddresses,
} from "@/lib/calendarInvites";
import { bookingAttendees } from "@/lib/calendarEvents";
import { LIST_SCOPE, consentUrl } from "@/lib/googleCalendar";

const FLYING = "abc123@group.calendar.google.com";
const member = (over: Partial<Parameters<typeof inviteAddress>[0] & object> = {}) => ({
  email: "dylan@example.com",
  calendarInvites: true,
  calendarInviteEmail: null as string | null,
  ...over,
});

describe("inviteAddress", () => {
  it("is the account email by default", () => {
    expect(inviteAddress(member())).toBe("dylan@example.com");
  });

  it("is the chosen calendar's address when one is saved", () => {
    expect(inviteAddress(member({ calendarInviteEmail: ` ${FLYING.toUpperCase()} ` }))).toBe(FLYING);
  });

  it("is nobody once invites are switched off, whatever is saved", () => {
    expect(inviteAddress(member({ calendarInvites: false }))).toBeNull();
    expect(inviteAddress(member({ calendarInvites: false, calendarInviteEmail: FLYING }))).toBeNull();
  });

  it("is nobody for a member with no email at all, or no member", () => {
    expect(inviteAddress(member({ email: null }))).toBeNull();
    expect(inviteAddress(null)).toBeNull();
  });
});

describe("staleInviteAddresses", () => {
  it("is empty while invites go to the account email", () => {
    expect(staleInviteAddresses(member())).toEqual([]);
  });

  it("is the account email once invites go to another calendar", () => {
    expect(staleInviteAddresses(member({ calendarInviteEmail: FLYING }))).toEqual([
      "dylan@example.com",
    ]);
  });

  it("is every address the app knows for them once invites are off", () => {
    expect(
      staleInviteAddresses(member({ calendarInvites: false, calendarInviteEmail: FLYING }))
    ).toEqual(["dylan@example.com", FLYING]);
  });
});

describe("a booking's guest list honours the preferences", () => {
  it("moves the member from their account email to the calendar they picked", () => {
    const m = member({ calendarInviteEmail: FLYING });
    const next = bookingAttendees(
      [{ email: "dylan@example.com", responseStatus: "accepted" }, { email: "pax@example.com" }],
      [inviteAddress(m)],
      staleInviteAddresses(m)
    );
    // The passenger somebody added in Google is left exactly as they were.
    expect(next?.map((a) => a.email)).toEqual(["pax@example.com", FLYING]);
  });

  it("takes an opted-out member off the event and invites nobody new", () => {
    const m = member({ calendarInvites: false });
    const next = bookingAttendees(
      [{ email: "dylan@example.com" }],
      [inviteAddress(m)],
      staleInviteAddresses(m)
    );
    expect(next).toEqual([]);
  });

  it("changes nothing for a member already invited where they want to be", () => {
    const m = member();
    expect(
      bookingAttendees([{ email: "dylan@example.com" }], [inviteAddress(m)], staleInviteAddresses(m))
    ).toBeNull();
  });
});

describe("inviteOptions", () => {
  const cals = [
    { id: "dylan@example.com", name: "dylan@example.com", primary: true },
    { id: FLYING, name: "Flying", primary: false },
  ];

  it("leads with the account email and ends with another address", () => {
    const opts = inviteOptions(cals, "dylan@example.com", null);
    expect(opts.map((o) => o.value)).toEqual([INVITE_DEFAULT_VALUE, FLYING, INVITE_OTHER_VALUE]);
    expect(opts[0].label).toBe("My account email (dylan@example.com)");
  });

  it("lists the primary calendar when it lives on a different Google address", () => {
    const opts = inviteOptions(
      [{ id: "dylan.personal@gmail.com", name: "Dylan", primary: true }],
      "dylan@example.com",
      null
    );
    expect(opts[1]).toEqual({ value: "dylan.personal@gmail.com", label: "Dylan (main calendar)" });
  });

  it("keeps a saved address the list doesn't know, so the picker tells the truth", () => {
    const opts = inviteOptions(cals, "dylan@example.com", "old@group.calendar.google.com");
    expect(opts.map((o) => o.value)).toContain("old@group.calendar.google.com");
    expect(selectedInviteValue(opts, "old@group.calendar.google.com")).toBe(
      "old@group.calendar.google.com"
    );
  });

  it("selects the default for nothing saved and the calendar for its address", () => {
    const opts = inviteOptions(cals, "dylan@example.com", FLYING);
    expect(selectedInviteValue(opts, null)).toBe(INVITE_DEFAULT_VALUE);
    expect(selectedInviteValue(opts, FLYING.toUpperCase())).toBe(FLYING);
  });
});

describe("parseInviteEmail", () => {
  it("stores blank and the account's own address as null, which follows the account", () => {
    expect(parseInviteEmail("", "dylan@example.com")).toEqual({ value: null });
    expect(parseInviteEmail(null, "dylan@example.com")).toEqual({ value: null });
    expect(parseInviteEmail(" Dylan@Example.com ", "dylan@example.com")).toEqual({ value: null });
  });

  it("keeps a calendar's address as typed, trimmed", () => {
    expect(parseInviteEmail(` ${FLYING} `, "dylan@example.com")).toEqual({ value: FLYING });
  });

  it("refuses something that isn't an address", () => {
    expect(parseInviteEmail("not an email", "dylan@example.com")).toHaveProperty("error");
    expect(parseInviteEmail(42, "dylan@example.com")).toHaveProperty("error");
  });
});

describe("the member's picker consent", () => {
  it("asks for the calendar LIST only, never the events", () => {
    const url = new URL(consentUrl("http://localhost:3001/api/calendar/callback", "me.x", true));
    const scopes = url.searchParams.get("scope")!.split(" ");
    expect(scopes).toContain(LIST_SCOPE);
    expect(scopes.some((s) => s.includes("calendar.events"))).toBe(false);
    // The same registered redirect as the club's connection.
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:3001/api/calendar/callback");
  });
});
