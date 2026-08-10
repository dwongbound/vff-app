import { describe, expect, it } from "vitest";
import { modelError, normalizeTailNumber, tailNumberError } from "@/lib/aircraft";

describe("normalizeTailNumber", () => {
  it("upper-cases and strips whitespace", () => {
    expect(normalizeTailNumber(" nb 3188 ")).toBe("NB3188");
  });

  it("keeps dashes, which non-US registrations use", () => {
    expect(normalizeTailNumber("g-abcd")).toBe("G-ABCD");
  });

  it("is idempotent", () => {
    expect(normalizeTailNumber(normalizeTailNumber("NB3188"))).toBe("NB3188");
  });
});

describe("tailNumberError", () => {
  it("accepts a normal registration", () => {
    expect(tailNumberError("NB3188")).toBeNull();
  });

  it("accepts input that only normalizes to something valid", () => {
    expect(tailNumberError(" nb3188 ")).toBeNull();
  });

  it("requires a tail number", () => {
    expect(tailNumberError("")).toMatch(/required/i);
    expect(tailNumberError("   ")).toMatch(/required/i);
  });

  it("rejects punctuation that isn't a dash", () => {
    expect(tailNumberError("NB3188!")).toMatch(/letters, numbers and dashes/i);
  });

  it("rejects an absurdly long tail number", () => {
    expect(tailNumberError("N".repeat(13))).toMatch(/at most/i);
  });
});

describe("modelError", () => {
  it("accepts a model", () => {
    expect(modelError("Cessna 172S Skyhawk")).toBeNull();
  });

  it("requires one", () => {
    expect(modelError("  ")).toMatch(/required/i);
  });
});
