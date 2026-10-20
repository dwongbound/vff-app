import { describe, expect, it } from "vitest";
import {
  REFRESH_PX,
  arrowRotation,
  indicatorOffset,
  isPullDown,
  refreshProgress,
} from "@/lib/pullRefresh";
import { touchIntent } from "@/lib/swipe";

describe("isPullDown", () => {
  it("waits until the finger has really moved", () => {
    expect(isPullDown(touchIntent(2, 5), 5)).toBeNull();
  });
  it("is a downward vertical pull", () => {
    expect(isPullDown(touchIntent(3, 40), 40)).toBe(true);
  });
  it("is never an upward scroll", () => {
    expect(isPullDown(touchIntent(3, -40), -40)).toBe(false);
  });
  it("is never a sideways swipe — that's the tab change's", () => {
    expect(isPullDown(touchIntent(60, 20), 20)).toBe(false);
  });
});

describe("refreshProgress", () => {
  it("fills with the pull and is armed at a full one", () => {
    expect(refreshProgress(0)).toBe(0);
    expect(refreshProgress(REFRESH_PX / 2)).toBe(0.5);
    expect(refreshProgress(REFRESH_PX)).toBe(1);
    expect(refreshProgress(REFRESH_PX * 3)).toBe(1);
  });
});

describe("indicatorOffset", () => {
  it("follows at half speed, then resists", () => {
    expect(indicatorOffset(40)).toBe(20);
    const atArm = indicatorOffset(REFRESH_PX);
    const far = indicatorOffset(REFRESH_PX + 300);
    expect(far).toBeGreaterThan(atArm);
    expect(far - atArm).toBeLessThan(300 / 2);
  });
});

describe("arrowRotation", () => {
  it("turns over only once letting go will refresh", () => {
    expect(arrowRotation(0.9)).toBe(0);
    expect(arrowRotation(1)).toBe(180);
  });
});
