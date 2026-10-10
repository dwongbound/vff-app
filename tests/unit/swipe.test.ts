import { describe, expect, it } from "vitest";
import { COMMIT_PX, commitDistance, pullProgress, touchIntent } from "@/lib/swipe";

describe("touchIntent", () => {
  it("waits until the finger has really moved", () => {
    expect(touchIntent(5, 4)).toBe("undecided");
  });

  it("reads a vertical scroll that drifts sideways as a SCROLL", () => {
    // The whole point: a thumb scrolling down moves laterally too, and that
    // must never turn into a tab change.
    expect(touchIntent(14, 20)).toBe("scroll");
    expect(touchIntent(-16, 12)).toBe("scroll"); // sideways, but not by enough
  });

  it("reads a clearly sideways move as a swipe, either way", () => {
    expect(touchIntent(30, 10)).toBe("swipe");
    expect(touchIntent(-30, 10)).toBe("swipe");
  });
});

describe("commitDistance / pullProgress", () => {
  it("asks for the fixed distance on a wide screen", () => {
    expect(commitDistance(834)).toBe(COMMIT_PX);
  });

  it("asks a narrow screen for less", () => {
    expect(commitDistance(300)).toBe(120);
  });

  it("fades in with the pull and caps at a full one", () => {
    expect(pullProgress(70, 834, true)).toBeCloseTo(0.5);
    expect(pullProgress(-70, 834, true)).toBeCloseTo(0.5);
    expect(pullProgress(500, 834, true)).toBe(1);
  });

  it("shows nothing when there's no tab that way", () => {
    expect(pullProgress(200, 834, false)).toBe(0);
  });
});
