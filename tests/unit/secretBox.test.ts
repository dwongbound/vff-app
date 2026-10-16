import { describe, expect, it } from "vitest";
import { openBox, sealBox } from "@/lib/secretBox";

describe("sealBox / openBox", () => {
  it("round-trips under the same secret", () => {
    const sealed = sealBox("1//refresh-token", "s3cret");
    expect(sealed).not.toContain("refresh-token");
    expect(openBox(sealed, "s3cret")).toBe("1//refresh-token");
  });

  it("seals the same text differently every time", () => {
    expect(sealBox("x", "s")).not.toBe(sealBox("x", "s"));
  });

  it("won't open under a different secret, or once tampered with", () => {
    const sealed = sealBox("1//refresh-token", "s3cret");
    expect(openBox(sealed, "rotated")).toBeNull();
    const parts = sealed.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(openBox(parts.join("."), "s3cret")).toBeNull();
    expect(openBox("garbage", "s3cret")).toBeNull();
  });
});
