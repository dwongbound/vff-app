import { describe, expect, it } from "vitest";
import { PURPOSES, PURPOSE_LABELS, isPurpose, purposeFromBody } from "@/lib/constants";

describe("flight types", () => {
  it("offers Training (Solo) beside the lesson it isn't", () => {
    expect(PURPOSE_LABELS.TRAINING_SOLO).toBe("Training (Solo)");
    expect(PURPOSES.indexOf("TRAINING_SOLO")).toBe(PURPOSES.indexOf("TRAINING") + 1);
  });

  it("knows its own values and nothing else", () => {
    expect(isPurpose("TRAINING_SOLO")).toBe(true);
    expect(isPurpose("toString")).toBe(false);
    expect(isPurpose("SOLO")).toBe(false);
    expect(isPurpose(null)).toBe(false);
  });

  it("reads a body: set, cleared, unmentioned or refused", () => {
    expect(purposeFromBody({ purpose: "LOCAL" })).toBe("LOCAL");
    expect(purposeFromBody({ purpose: "" })).toBeNull();
    expect(purposeFromBody({ purpose: null })).toBeNull();
    expect(purposeFromBody({})).toBeUndefined();
    expect(purposeFromBody({ purpose: "JOYRIDE" })).toBe("invalid");
    expect(purposeFromBody({ purpose: 3 })).toBe("invalid");
  });
});
