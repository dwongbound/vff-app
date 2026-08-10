import { describe, expect, it } from "vitest";
import { storageStatus } from "@/lib/storage";

// One function decides both what the UI offers and what the upload route
// accepts, so the two can never disagree about whether photos work.
describe("storageStatus", () => {
  it("is configured with no configuration at all", () => {
    // The default driver is a directory on disk — zero config, which is what
    // makes dev and the e2e suite work out of the box.
    expect(storageStatus({})).toEqual({ configured: true, reason: null });
    expect(storageStatus({ STORAGE_DRIVER: "local" }).configured).toBe(true);
  });

  it("is configured for s3 once its three variables are set", () => {
    expect(
      storageStatus({
        STORAGE_DRIVER: "s3",
        S3_BUCKET: "vff",
        S3_ACCESS_KEY_ID: "key",
        S3_SECRET_ACCESS_KEY: "secret",
      })
    ).toEqual({ configured: true, reason: null });
  });

  // The case this whole feature exists for: a deployment that MEANT to have
  // photos and doesn't. The app stays usable and says so.
  it("names the variables an s3 deployment is missing", () => {
    const status = storageStatus({ STORAGE_DRIVER: "s3", S3_BUCKET: "vff" });
    expect(status.configured).toBe(false);
    expect(status.reason).toContain("S3_ACCESS_KEY_ID");
    expect(status.reason).toContain("S3_SECRET_ACCESS_KEY");
    expect(status.reason).not.toContain("S3_BUCKET");
  });

  it("reads as singular when only one is missing", () => {
    const status = storageStatus({
      STORAGE_DRIVER: "s3",
      S3_ACCESS_KEY_ID: "key",
      S3_SECRET_ACCESS_KEY: "secret",
    });
    expect(status.reason).toBe("STORAGE_DRIVER=s3 but S3_BUCKET is not set.");
  });

  // An off switch, so a club with no bucket doesn't have to invent
  // credentials to make the camera buttons behave.
  it("can be switched off outright", () => {
    for (const driver of ["none", "off", "NONE"]) {
      const status = storageStatus({ STORAGE_DRIVER: driver });
      expect(status.configured).toBe(false);
      expect(status.reason).toMatch(/switched off/);
    }
  });

  it("ignores the case of the driver name", () => {
    expect(storageStatus({ STORAGE_DRIVER: "S3", S3_BUCKET: "b", S3_ACCESS_KEY_ID: "k", S3_SECRET_ACCESS_KEY: "s" }).configured).toBe(true);
    expect(storageStatus({ STORAGE_DRIVER: "S3" }).configured).toBe(false);
  });
});
