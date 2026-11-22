import { describe, expect, it } from "vitest";
import { adminChangeError, removalError } from "@/lib/members";

const target = (isAdmin: boolean) => ({ id: "u1", isAdmin });

describe("adminChangeError", () => {
  it("allows promoting a member", () => {
    expect(
      adminChangeError({
        target: target(false),
        nextIsAdmin: true,
        totalAdmins: 1,
      })
    ).toBeNull();
  });

  it("allows demoting an admin while another one remains", () => {
    expect(
      adminChangeError({
        target: target(true),
        nextIsAdmin: false,
        totalAdmins: 2,
      })
    ).toBeNull();
  });

  it("refuses to demote the last admin", () => {
    expect(
      adminChangeError({
        target: target(true),
        nextIsAdmin: false,
        totalAdmins: 1,
      })
    ).toMatch(/at least one admin/i);
  });

  it("treats a no-op as allowed, even for the last admin", () => {
    // Re-saving "yes, still an admin" must not trip the last-admin guard.
    expect(
      adminChangeError({
        target: target(true),
        nextIsAdmin: true,
        totalAdmins: 1,
      })
    ).toBeNull();
    expect(
      adminChangeError({
        target: target(false),
        nextIsAdmin: false,
        totalAdmins: 1,
      })
    ).toBeNull();
  });

  it("still refuses when the count is somehow zero", () => {
    // Defensive: a demote request that raced another demote shouldn't slip
    // through just because the count came back lower than expected.
    expect(
      adminChangeError({
        target: target(true),
        nextIsAdmin: false,
        totalAdmins: 0,
      })
    ).toMatch(/at least one admin/i);
  });
});

describe("removalError", () => {
  const member = { id: "u2", isAdmin: false, removedAt: null };

  it("lets an admin remove a plain member", () => {
    expect(removalError(member, "u1")).toBeNull();
  });

  it("refuses removing yourself", () => {
    expect(removalError(member, "u2")).toMatch(/yourself/);
  });

  // Demote first: the last-admin rule lives on that route.
  it("refuses removing an admin", () => {
    expect(removalError({ ...member, isAdmin: true }, "u1")).toMatch(/admin/);
  });

  it("refuses removing somebody twice", () => {
    expect(removalError({ ...member, removedAt: new Date() }, "u1")).toMatch(/already/);
  });
});
