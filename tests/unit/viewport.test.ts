import { describe, expect, it } from "vitest";
import { VIEWPORT_MARGIN, viewportShift } from "@/lib/viewport";

const W = 402; // an iPhone

describe("viewportShift", () => {
  it("leaves a popup that fits alone", () => {
    expect(viewportShift(100, 292, W)).toBe(0);
    expect(viewportShift(VIEWPORT_MARGIN, W - VIEWPORT_MARGIN, W)).toBe(0);
  });

  it("pushes one hanging off the left back in", () => {
    // The group sheet centred on the pill's first tab: 192px wide, centred at 40.
    expect(viewportShift(-56, 136, W)).toBe(64);
  });

  it("pulls one hanging off the right back in", () => {
    expect(viewportShift(300, 450, W)).toBe(W - VIEWPORT_MARGIN - 450);
  });

  it("pins one wider than the window to the left margin", () => {
    expect(viewportShift(-20, 500, W)).toBe(VIEWPORT_MARGIN + 20);
  });
});
