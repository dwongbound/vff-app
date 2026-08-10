import { describe, expect, it } from "vitest";
import {
  MAX_SIGNUP_CODE_LENGTH,
  SIGNUP_CODE_KINDS,
  SIGNUP_CODE_KIND_BLURBS,
  SIGNUP_CODE_KIND_LABELS,
  accountFromCodeKind,
  normalizeCode,
  parseSignupCodeKind,
  redemptionError,
  signupCodeError,
  signupCodeRequired,
} from "@/lib/signupCodes";

describe("normalizeCode", () => {
  it("is case- and space-insensitive", () => {
    expect(normalizeCode("vff-2026")).toBe("VFF-2026");
    expect(normalizeCode("  VFF 2026 ")).toBe("VFF2026");
    // A code copied out of an email with a line break through it.
    expect(normalizeCode("VFF-\n2026")).toBe("VFF-2026");
  });

  it("keeps punctuation the admin chose", () => {
    expect(normalizeCode("vff_cfi-01")).toBe("VFF_CFI-01");
  });

  it("survives junk", () => {
    expect(normalizeCode(null)).toBe("");
    expect(normalizeCode(undefined)).toBe("");
    expect(normalizeCode(42)).toBe("42");
  });
});

describe("signupCodeError", () => {
  it("accepts an ordinary code", () => {
    expect(signupCodeError("VFF-2026")).toBeNull();
    // Validated after normalising, so the admin's lower-case typing is fine.
    expect(signupCodeError("vff 2026")).toBeNull();
  });

  it("refuses an empty or too-short code", () => {
    expect(signupCodeError("")).toMatch(/enter a code/i);
    expect(signupCodeError("  ")).toMatch(/enter a code/i);
    expect(signupCodeError("AB")).toMatch(/at least/i);
  });

  it("refuses a code too long to read out", () => {
    expect(signupCodeError("A".repeat(MAX_SIGNUP_CODE_LENGTH + 1))).toMatch(
      /under/i
    );
  });

  it("refuses punctuation that won't survive being retyped", () => {
    expect(signupCodeError("VFF/2026")).toMatch(/letters, numbers/i);
    expect(signupCodeError("VFF@2026")).toMatch(/letters, numbers/i);
  });
});

describe("parseSignupCodeKind", () => {
  it("narrows a known kind", () => {
    expect(parseSignupCodeKind("INSTRUCTOR")).toBe("INSTRUCTOR");
    expect(parseSignupCodeKind("MEMBER")).toBe("MEMBER");
  });

  // The safe default: an unrecognised kind must never mint the account with
  // more reach, and MEMBER is the one that can't sign anything off.
  it("falls back to MEMBER on anything else", () => {
    expect(parseSignupCodeKind("ADMIN")).toBe("MEMBER");
    expect(parseSignupCodeKind(null)).toBe("MEMBER");
    expect(parseSignupCodeKind(7)).toBe("MEMBER");
  });
});

describe("accountFromCodeKind", () => {
  it("makes a member code a flying member with no office", () => {
    expect(accountFromCodeKind("MEMBER")).toEqual({
      positions: [],
      clubMember: true,
    });
  });

  // The instructor account: teaches here, doesn't fly here. An admin can tick
  // "flying member" afterwards, which is why the code doesn't decide that.
  it("makes an instructor code a CFI who isn't a member", () => {
    expect(accountFromCodeKind("INSTRUCTOR")).toEqual({
      positions: ["INSTRUCTOR"],
      clubMember: false,
    });
  });

  it("never mints an admin", () => {
    for (const kind of SIGNUP_CODE_KINDS) {
      expect(accountFromCodeKind(kind)).not.toHaveProperty("isAdmin");
    }
  });
});

describe("signupCodeRequired", () => {
  // The bootstrap exception. A fresh install has nobody who could have issued
  // a code, so requiring one would lock the first admin out of their own club.
  it("is waived for the very first account", () => {
    expect(signupCodeRequired(0)).toBe(false);
  });

  it("applies to every account after it", () => {
    expect(signupCodeRequired(1)).toBe(true);
    expect(signupCodeRequired(50)).toBe(true);
  });
});

describe("redemptionError", () => {
  const live = { code: "VFF-2026", kind: "MEMBER" as const, active: true };

  it("lets a live code through", () => {
    expect(redemptionError(live)).toBeNull();
  });

  // Deliberately the same message for both, so a stranger who guesses a real
  // code isn't told they guessed right.
  it("gives an unknown and a retired code the same answer", () => {
    const unknown = redemptionError(null);
    const retired = redemptionError({ ...live, active: false });
    expect(unknown).toBeTruthy();
    expect(retired).toBe(unknown);
  });

  it("treats a missing row as a refusal", () => {
    expect(redemptionError(undefined)).toBeTruthy();
  });
});

describe("the code lists themselves", () => {
  it("labels and explains both", () => {
    for (const kind of SIGNUP_CODE_KINDS) {
      expect(SIGNUP_CODE_KIND_LABELS[kind]).toBeTruthy();
      expect(SIGNUP_CODE_KIND_BLURBS[kind]?.length, kind).toBeGreaterThan(20);
    }
  });
});
