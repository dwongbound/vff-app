import { describe, expect, it } from "vitest";
import { authCookies } from "@/lib/authCookies";

describe("authCookies", () => {
  // Cookies are per HOST, not per port: every NextAuth app on localhost shares
  // the default `next-auth.*` names, and a Google sign-in failed with "State
  // cookie was missing" once another one had written its own. Every cookie
  // NextAuth sets must carry this app's name.
  it("names every NextAuth cookie for this app", () => {
    for (const [key, cookie] of Object.entries(authCookies)) {
      expect(cookie.name, key).toMatch(/vff\./);
      expect(cookie.name, key).not.toMatch(/next-auth/);
    }
  });

  it("covers the OAuth round trip's cookies, not just the session", () => {
    expect(Object.keys(authCookies).sort()).toEqual(
      ["callbackUrl", "csrfToken", "nonce", "pkceCodeVerifier", "sessionToken", "state"].sort()
    );
  });
});
