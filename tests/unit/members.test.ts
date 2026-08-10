import { describe, expect, it } from "vitest";
import { adminChangeError } from "@/lib/members";

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
