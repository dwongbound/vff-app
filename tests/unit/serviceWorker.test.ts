// The worker is a classic script served from public/, so it can't be imported
// like a module. Its `classify` is a top-level function declaration, which
// running the file in a vm context exposes as a property of that context.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { requestIdFrom } from "@/lib/idempotency";

type Classify = (
  url: URL,
  method: string,
  mode: string,
  headers: Headers,
  origin: string
) => string | null;

const source = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../../public/sw.js"), "utf8");
const context = vm.createContext({
  self: { location: { href: "https://club.test/sw.js?v=abc", origin: "https://club.test" }, addEventListener() {} },
  URL,
  Headers,
  Response,
  Symbol,
  setTimeout,
  clearTimeout,
});
vm.runInContext(source, context);
const classify = (context as unknown as { classify: Classify }).classify;

const ORIGIN = "https://club.test";
function kind(pathAndQuery: string, opts: { method?: string; mode?: string; rsc?: boolean } = {}) {
  const headers = new Headers(opts.rsc ? { RSC: "1" } : {});
  return classify(
    new URL(pathAndQuery, ORIGIN),
    opts.method ?? "GET",
    opts.mode ?? "cors",
    headers,
    ORIGIN
  );
}

describe("service worker classify", () => {
  it("never touches a write", () => {
    // Writes are the outbox's job. A worker silently replaying POSTs can't
    // freeze, key or report them.
    expect(kind("/api/flights", { method: "POST" })).toBeNull();
    expect(kind("/api/checkouts/x", { method: "PATCH" })).toBeNull();
  });

  it("caches hashed static files first", () => {
    expect(kind("/_next/static/chunks/app-abc123.js")).toBe("static");
  });

  it("treats a navigation as a page", () => {
    expect(kind("/preflight", { mode: "navigate" })).toBe("page");
  });

  it("leaves Next's RSC requests alone", () => {
    expect(kind("/preflight", { rsc: true })).toBeNull();
    expect(kind("/preflight?_rsc=1x2y")).toBeNull();
  });

  it("caches API reads, including the session NextAuth asks for", () => {
    expect(kind("/api/aircraft")).toBe("api");
    expect(kind("/api/flights?mine=1&open=1")).toBe("api");
    expect(kind("/api/auth/session")).toBe("api");
  });

  it("never answers a navigation to the API from the page cache", () => {
    // The Google sign-in callback is a NAVIGATION to /api/auth/callback/google.
    expect(kind("/api/auth/callback/google", { mode: "navigate" })).toBeNull();
    expect(kind("/api/flights", { mode: "navigate" })).toBeNull();
  });

  it("leaves the rest of auth, and photos, to the network", () => {
    expect(kind("/api/auth/csrf")).toBeNull();
    expect(kind("/api/auth/callback/credentials")).toBeNull();
    expect(kind("/api/photos/p1")).toBeNull();
  });

  it("ignores other origins and the worker script itself", () => {
    expect(classify(new URL("https://cdn.example/x.js"), "GET", "cors", new Headers(), ORIGIN)).toBeNull();
    expect(kind("/sw.js")).toBeNull();
  });

  it("revalidates the install icons", () => {
    expect(kind("/icons/icon-192.png")).toBe("asset");
    expect(kind("/manifest.webmanifest")).toBe("asset");
  });
});

describe("requestIdFrom", () => {
  it("accepts a UUID", () => {
    expect(requestIdFrom("3b241101-e2bb-4255-8caf-4136c566a962")).toBe(
      "3b241101-e2bb-4255-8caf-4136c566a962"
    );
  });

  it("refuses anything that isn't a plausible key", () => {
    for (const bad of [undefined, null, 42, "", "short", "has spaces in it", "x".repeat(101), "<script>"]) {
      expect(requestIdFrom(bad)).toBeNull();
    }
  });
});
