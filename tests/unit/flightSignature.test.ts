import { describe, expect, it } from "vitest";
import {
  SIGNATURE_LABELS,
  SIGNATURE_TONES,
  isAwaitingSignature,
  isAwaitingSignatureFrom,
  signatureError,
  signatureState,
  unsignError,
} from "@/lib/flightSignature";

const CFI = "cfi-1";
const OTHER_CFI = "cfi-2";

/** A flight with an instructor named and nothing signed yet. */
const lesson = (over: Record<string, unknown> = {}) => ({
  instructorId: CFI,
  signedAt: null,
  editedAt: null,
  ...over,
});

describe("signatureState", () => {
  it("has nothing to say about a flight with no instructor", () => {
    expect(
      signatureState({ instructorId: null, signedAt: null, editedAt: null })
    ).toBe("NOT_APPLICABLE");
  });

  it("waits on the instructor once one is named", () => {
    expect(signatureState(lesson())).toBe("AWAITING");
    expect(isAwaitingSignature(lesson())).toBe(true);
  });

  it("is signed once they've signed", () => {
    const signed = lesson({ signedAt: new Date("2026-08-01T10:00:00Z") });
    expect(signatureState(signed)).toBe("SIGNED");
    expect(isAwaitingSignature(signed)).toBe(false);
  });

  // The whole reason `editedAt` exists as its own column.
  it("flags an entry corrected AFTER it was signed", () => {
    expect(
      signatureState(
        lesson({
          signedAt: new Date("2026-08-01T10:00:00Z"),
          editedAt: new Date("2026-08-03T09:00:00Z"),
        })
      )
    ).toBe("SIGNED_THEN_EDITED");
  });

  it("does not flag an entry corrected BEFORE it was signed", () => {
    // The ordinary case: the pilot fixes a typo, then the CFI reads it and
    // signs. The signature covers what's on screen, so there's nothing to say.
    expect(
      signatureState(
        lesson({
          editedAt: new Date("2026-08-01T09:00:00Z"),
          signedAt: new Date("2026-08-01T10:00:00Z"),
        })
      )
    ).toBe("SIGNED");
  });

  // Signing is itself a write. If this ever compared against Prisma's
  // `updatedAt` instead of `editedAt`, every signed flight would come back
  // SIGNED_THEN_EDITED a millisecond after it was signed.
  it("is not fooled by a signature landing at the same instant", () => {
    const at = new Date("2026-08-01T10:00:00Z");
    expect(signatureState(lesson({ signedAt: at, editedAt: at }))).toBe("SIGNED");
  });

  it("reads a flight in either spelling — db row or wire shape", () => {
    expect(
      signatureState({ instructor: { id: CFI }, signedAt: null, editedAt: null })
    ).toBe("AWAITING");
    expect(
      signatureState({ instructor: null, signedAt: null, editedAt: null })
    ).toBe("NOT_APPLICABLE");
  });

  it("accepts ISO strings the way they arrive from the API", () => {
    expect(
      signatureState(
        lesson({ signedAt: "2026-08-01T10:00:00.000Z", editedAt: "2026-08-05T10:00:00.000Z" })
      )
    ).toBe("SIGNED_THEN_EDITED");
  });

  it("labels and tones every state", () => {
    for (const state of [
      "NOT_APPLICABLE",
      "AWAITING",
      "SIGNED",
      "SIGNED_THEN_EDITED",
    ] as const) {
      expect(SIGNATURE_LABELS[state]).toBeTruthy();
      expect(SIGNATURE_TONES[state]).toBeTruthy();
    }
  });
});

describe("isAwaitingSignatureFrom", () => {
  it("is only true for the instructor actually named", () => {
    expect(isAwaitingSignatureFrom(lesson(), CFI)).toBe(true);
    expect(isAwaitingSignatureFrom(lesson(), OTHER_CFI)).toBe(false);
  });

  it("is false once it's signed", () => {
    expect(isAwaitingSignatureFrom(lesson({ signedAt: new Date() }), CFI)).toBe(
      false
    );
  });
});

describe("signatureError", () => {
  it("lets the named instructor sign", () => {
    expect(signatureError(lesson(), { id: CFI })).toBeNull();
  });

  it("refuses a flight nobody is down to sign", () => {
    expect(
      signatureError(
        { instructorId: null, signedAt: null, editedAt: null },
        { id: CFI }
      )
    ).toMatch(/no instructor/i);
  });

  // The narrow rule that makes the signature worth anything.
  it("refuses another instructor", () => {
    expect(signatureError(lesson(), { id: OTHER_CFI })).toMatch(
      /only the instructor named/i
    );
  });

  // The one deliberate exception to "admins can do anything" — see the file.
  // `signatureError` takes only an id precisely so there is no admin flag here
  // to be tempted into checking.
  it("refuses anyone else, admin or not", () => {
    expect(signatureError(lesson(), { id: "the-club-president" })).toMatch(
      /only the instructor named/i
    );
  });

  it("refuses to sign twice", () => {
    expect(
      signatureError(lesson({ signedAt: new Date() }), { id: CFI })
    ).toMatch(/already signed/i);
  });
});

describe("unsignError", () => {
  it("lets the signer withdraw", () => {
    expect(
      unsignError(lesson({ signedAt: new Date() }), { id: CFI })
    ).toBeNull();
  });

  it("refuses when there's nothing to withdraw", () => {
    expect(unsignError(lesson(), { id: CFI })).toMatch(/isn't signed/i);
  });

  it("refuses somebody else's signature", () => {
    expect(
      unsignError(lesson({ signedAt: new Date() }), { id: OTHER_CFI })
    ).toMatch(/only the instructor named/i);
  });
});
