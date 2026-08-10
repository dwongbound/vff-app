import { describe, expect, it } from "vitest";
import {
  ALL_CAPABILITIES,
  POSITIONS,
  POSITION_BLURBS,
  POSITION_LABELS,
  can,
  capabilitiesFor,
  isEmpowered,
  isInstructor,
  parsePositions,
} from "@/lib/positions";

const nobody = { isAdmin: false, positions: [] };

describe("positions", () => {
  it("labels and explains every office", () => {
    for (const position of POSITIONS) {
      expect(POSITION_LABELS[position]).toBeTruthy();
      expect(POSITION_BLURBS[position]?.length, position).toBeGreaterThan(20);
    }
  });

  it("gives the Finance Officer the books and nobody else", () => {
    const officer = { isAdmin: false, positions: ["FINANCE_OFFICER" as const] };
    expect(can(officer, "finance:read-all")).toBe(true);
    expect(can(officer, "finance:manage")).toBe(true);

    const secretary = { isAdmin: false, positions: ["SECRETARY" as const] };
    expect(can(secretary, "finance:read-all")).toBe(false);
    expect(can(secretary, "finance:manage")).toBe(false);
  });

  it("gives the Safety Officer squawk sign-off and nothing else", () => {
    const safety = { isAdmin: false, positions: ["SAFETY_OFFICER" as const] };
    expect(can(safety, "squawk:manage")).toBe(true);
    // Signing off the airplane is not a licence to touch the club's money.
    expect(can(safety, "finance:manage")).toBe(false);
    expect(can(safety, "finance:read-all")).toBe(false);
  });

  it("keeps the two offices' powers separate", () => {
    const finance = { isAdmin: false, positions: ["FINANCE_OFFICER" as const] };
    expect(can(finance, "squawk:manage")).toBe(false);
  });

  it("unions the capabilities of someone holding two offices", () => {
    const both = {
      isAdmin: false,
      positions: ["FINANCE_OFFICER" as const, "SAFETY_OFFICER" as const],
    };
    expect(can(both, "finance:manage")).toBe(true);
    expect(can(both, "squawk:manage")).toBe(true);
  });

  // The whole design rule: admins are a superset of officers, so the club is
  // never locked out of a job because one member is away.
  it("lets an admin do anything any office can", () => {
    const admin = { isAdmin: true, positions: [] };
    for (const capability of ALL_CAPABILITIES) {
      expect(can(admin, capability), capability).toBe(true);
    }
    expect(capabilitiesFor(admin).size).toBe(ALL_CAPABILITIES.length);
  });

  // A plain member holds no OFFICE powers — but membership itself carries two
  // capabilities, so "nothing" was only ever true while every account was a
  // flying member. Spelled out rather than counted, so adding a capability to
  // an office can't quietly satisfy this test.
  it("gives a plain member membership and no office powers", () => {
    expect([...capabilitiesFor(nobody)].sort()).toEqual([
      "finance:read-own",
      "reservation:book",
    ]);
    for (const capability of ["finance:read-all", "finance:manage", "squawk:manage", "flight:sign"] as const) {
      expect(can(nobody, capability), capability).toBe(false);
    }
  });

  // The instructor-only account: teaches here, doesn't fly here.
  it("gives a CFI who isn't a member the signature and nothing else", () => {
    const cfi = {
      isAdmin: false,
      positions: ["INSTRUCTOR" as const],
      clubMember: false,
    };
    expect(can(cfi, "flight:sign")).toBe(true);
    // The two that make the difference between a tab and no tab.
    expect(can(cfi, "reservation:book")).toBe(false);
    expect(can(cfi, "finance:read-own")).toBe(false);
    // And nothing an officer holds.
    expect(can(cfi, "squawk:manage")).toBe(false);
    expect(can(cfi, "finance:manage")).toBe(false);
  });

  it("gives a CFI who IS a member both halves", () => {
    const both = {
      isAdmin: false,
      positions: ["INSTRUCTOR" as const],
      clubMember: true,
    };
    expect(can(both, "flight:sign")).toBe(true);
    expect(can(both, "reservation:book")).toBe(true);
    expect(can(both, "finance:read-own")).toBe(true);
  });

  // The compatibility rule that keeps every pre-existing caller correct: a
  // Principal with no `clubMember` at all is a flying member, because that is
  // what every account was before instructor accounts existed.
  it("treats an absent clubMember as a flying member", () => {
    expect(can({ isAdmin: false, positions: [] }, "reservation:book")).toBe(true);
    expect(can({ isAdmin: false, positions: [], clubMember: undefined }, "finance:read-own")).toBe(
      true
    );
  });

  it("knows which offices are titles and which carry powers", () => {
    expect(isEmpowered("FINANCE_OFFICER")).toBe(true);
    expect(isEmpowered("PRESIDENT")).toBe(false);
    expect(isEmpowered("INSTRUCTOR")).toBe(true);
  });
});

describe("isInstructor", () => {
  it("is true only for someone holding the office", () => {
    expect(isInstructor({ positions: ["INSTRUCTOR"] })).toBe(true);
    expect(isInstructor({ positions: ["SAFETY_OFFICER", "INSTRUCTOR"] })).toBe(true);
    expect(isInstructor({ positions: [] })).toBe(false);
    expect(isInstructor({ positions: ["PRESIDENT"] })).toBe(false);
  });

  // The reason this isn't `can(user, "flight:sign")`. An admin may do anything,
  // but "is a CFI" is a claim about a certificate, and putting every admin in
  // the booking form's instructor picker would make it a lie.
  it("does not sweep in admins the way a capability check would", () => {
    const admin = { isAdmin: true, positions: [] };
    expect(can(admin, "flight:sign")).toBe(true);
    expect(isInstructor(admin)).toBe(false);
  });
});

describe("parsePositions", () => {
  it("drops junk and duplicates", () => {
    expect(parsePositions(["FINANCE_OFFICER", "NOPE", "FINANCE_OFFICER", 7])).toEqual([
      "FINANCE_OFFICER",
    ]);
    expect(parsePositions(null)).toEqual([]);
    expect(parsePositions("FINANCE_OFFICER")).toEqual([]);
  });

  it("returns the club's canonical order, not the client's", () => {
    expect(parsePositions(["SECRETARY", "PRESIDENT"])).toEqual([
      "PRESIDENT",
      "SECRETARY",
    ]);
  });
});
