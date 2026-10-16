import { describe, expect, it } from "vitest";
import { photoContentType, photoProblem } from "@/lib/photoTypes";
import { MAX_PHOTO_BYTES } from "@/lib/constants";

describe("photoContentType", () => {
  it("takes the browser's type when it's one the club stores", () => {
    expect(photoContentType({ type: "image/jpeg", name: "hobbs.jpg" })).toBe("image/jpeg");
    expect(photoContentType({ type: "image/HEIC", name: "x" })).toBe("image/heic");
  });

  // The bug: the picker let these through and the server refused them later.
  it("refuses other image types the browser happily calls image/*", () => {
    expect(photoContentType({ type: "image/gif", name: "a.gif" })).toBeNull();
    expect(photoContentType({ type: "image/svg+xml", name: "a.svg" })).toBeNull();
    expect(photoContentType({ type: "image/avif", name: "a.avif" })).toBeNull();
  });

  it("reads the extension when the browser sent no type (iOS HEIC)", () => {
    expect(photoContentType({ type: "", name: "IMG_0412.HEIC" })).toBe("image/heic");
    expect(photoContentType({ type: "", name: "panel.jpeg" })).toBe("image/jpeg");
    expect(photoContentType({ type: "", name: "notes.txt" })).toBeNull();
    expect(photoContentType({ type: "", name: "no-extension" })).toBeNull();
  });
});

describe("photoProblem", () => {
  it("names the file and says what's wrong", () => {
    expect(photoProblem({ type: "image/gif", name: "a.gif", size: 10 })).toMatch(
      /^a\.gif isn't a photo.*JPEG, PNG, WebP or HEIC/
    );
    expect(photoProblem({ type: "image/png", name: "big.png", size: MAX_PHOTO_BYTES + 1 })).toMatch(
      /^big\.png is over 12 MB/
    );
  });

  it("is null for a photo the club takes", () => {
    expect(photoProblem({ type: "image/webp", name: "a.webp", size: 1000 })).toBeNull();
  });
});
