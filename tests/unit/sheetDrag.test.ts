import { describe, expect, it } from "vitest";
import {
  CLOSE_MAX_PX,
  RESIZE_PX,
  backdropFade,
  closeDistance,
  dragOffset,
  sheetRelease,
} from "@/lib/sheetDrag";

const base = { velocity: 0, height: 500, expanded: false, canExpand: true };

describe("closeDistance", () => {
  it("is a share of a short sheet", () => {
    expect(closeDistance(300)).toBe(90);
  });
  it("is capped for a tall one", () => {
    expect(closeDistance(800)).toBe(CLOSE_MAX_PX);
  });
});

describe("sheetRelease", () => {
  it("closes on a long enough pull down", () => {
    expect(sheetRelease({ ...base, dy: 160 })).toBe("close");
  });

  it("springs back from a short one", () => {
    expect(sheetRelease({ ...base, dy: 40 })).toBe("stay");
  });

  it("closes on a quick flick down, however short", () => {
    expect(sheetRelease({ ...base, dy: 30, velocity: 0.9 })).toBe("close");
  });

  it("doesn't count a tap's jitter as a flick", () => {
    expect(sheetRelease({ ...base, dy: 4, velocity: 2 })).toBe("stay");
  });

  it("expands on a pull up", () => {
    expect(sheetRelease({ ...base, dy: -RESIZE_PX })).toBe("expand");
    expect(sheetRelease({ ...base, dy: -20, velocity: -0.8 })).toBe("expand");
    expect(sheetRelease({ ...base, dy: -20 })).toBe("stay");
  });

  it("can't expand a sheet that's already as tall as it gets", () => {
    expect(sheetRelease({ ...base, dy: -200, canExpand: false })).toBe("stay");
    expect(sheetRelease({ ...base, dy: -200, expanded: true })).toBe("stay");
  });

  it("un-expands before it closes", () => {
    const expanded = { ...base, expanded: true };
    expect(sheetRelease({ ...expanded, dy: RESIZE_PX })).toBe("collapse");
    expect(sheetRelease({ ...expanded, dy: 30, velocity: 0.8 })).toBe("collapse");
    expect(sheetRelease({ ...expanded, dy: 20 })).toBe("stay");
    // A long pull goes all the way.
    expect(sheetRelease({ ...expanded, dy: 2 * CLOSE_MAX_PX })).toBe("close");
  });
});

describe("dragOffset", () => {
  it("follows the finger down exactly", () => {
    expect(dragOffset(120, 0)).toBe(120);
  });
  it("follows it up while there's room", () => {
    expect(dragOffset(-50, 100)).toBe(-50);
  });
  it("resists past the room", () => {
    const pulled = dragOffset(-200, 0);
    expect(pulled).toBeLessThan(0);
    expect(pulled).toBeGreaterThan(-200);
  });
});

describe("backdropFade", () => {
  it("is fully dark at rest and fades with the pull", () => {
    expect(backdropFade(0, 400)).toBe(1);
    expect(backdropFade(200, 400)).toBe(0.5);
    expect(backdropFade(800, 400)).toBe(0);
  });
});
