import { describe, expect, it } from "vitest";
import { QUEUED_NOTICE, stripMessage } from "@/lib/offline";
import { flightJob, squawkJob, type OutboxJob } from "@/lib/outbox";

const owner = { userId: "u1", userName: "Alex Rivera" };
const flight = () =>
  flightJob({ owner, label: "Post-flight", aircraftId: "ac1", body: {} });
const squawk = () =>
  squawkJob({
    owner,
    label: "Squawk",
    aircraftId: "ac1",
    squawk: { title: "Nav light", description: "", photos: [] },
  });

const none = {
  problems: [] as OutboxJob[],
  waiting: [] as OutboxJob[],
  sending: false,
  staleSince: null,
  staleTime: null,
  others: [] as OutboxJob[],
};

/**
 * The strip has to fit on ONE line of a 402px phone at text-xs, next to its
 * "Details" button — about 55 characters. It truncates rather than wrapping,
 * so a longer message would lose its end, which is usually the useful part.
 */
const ONE_LINE = 55;

describe("stripMessage", () => {
  it("says nothing in the ordinary case", () => {
    expect(stripMessage(none)).toBeNull();
  });

  it("puts a refusal first, whatever else is going on", () => {
    const msg = stripMessage({
      ...none,
      problems: [{ ...flight(), state: "refused" }],
      waiting: [flight()],
      staleSince: "2026-10-07T14:40:00Z",
      staleTime: "7:40 AM",
    });
    expect(msg).toEqual({ tone: "red", text: "1 item wasn't sent" });
  });

  it("counts what's waiting, by kind", () => {
    expect(stripMessage({ ...none, waiting: [flight(), squawk()] })).toEqual({
      tone: "amber",
      text: "1 flight, 1 squawk waiting for signal",
    });
  });

  it("says when the page is showing cached data, and from when", () => {
    expect(
      stripMessage({ ...none, staleSince: "2026-10-07T14:40:00Z", staleTime: "7:40 AM" })
    ).toEqual({ tone: "grey", text: "Offline · showing data from 7:40 AM" });
  });

  it("names whose items are held for another member", () => {
    expect(stripMessage({ ...none, others: [{ ...flight(), userName: "Casey Nguyen" }] })?.text).toBe(
      "1 saved here for Casey Nguyen"
    );
  });

  it("keeps every message to one line on a phone", () => {
    const cases = [
      stripMessage({ ...none, problems: [flight(), flight()] }),
      stripMessage({ ...none, waiting: [flight(), squawk(), squawk()] }),
      stripMessage({ ...none, waiting: [flight()], sending: true }),
      stripMessage({ ...none, staleSince: "x", staleTime: "10:40 AM" }),
      stripMessage({ ...none, staleSince: "x", staleTime: null }),
    ];
    for (const msg of cases) expect(msg!.text.length).toBeLessThanOrEqual(ONE_LINE);
  });
});

describe("QUEUED_NOTICE", () => {
  it("is one short line", () => {
    expect(QUEUED_NOTICE.length).toBeLessThanOrEqual(60);
  });

  it("never calls it an error, or asks the member to do anything", () => {
    expect(QUEUED_NOTICE).not.toMatch(/error|failed|sorry|press|again/i);
  });
});
