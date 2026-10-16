import { afterEach, describe, expect, it, vi } from "vitest";
import { appBaseUrl, calendarRedirectUri, consentUrl } from "@/lib/googleCalendar";

// What the dev container actually sees: Next binds 0.0.0.0:3000 inside it,
// while the browser is on localhost:3001.
const insideDocker = (headers: Record<string, string> = {}) =>
  new Request("http://0.0.0.0:3000/api/calendar/callback?code=x", { headers });

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("appBaseUrl", () => {
  it("uses NEXTAUTH_URL over the server's own view of itself", () => {
    vi.stubEnv("NEXTAUTH_URL", "http://localhost:3001");
    expect(appBaseUrl(insideDocker({ host: "0.0.0.0:3000" }))).toBe("http://localhost:3001");
  });

  it("drops any path on NEXTAUTH_URL", () => {
    vi.stubEnv("NEXTAUTH_URL", "https://vardafreeflyers.com/");
    expect(appBaseUrl(insideDocker())).toBe("https://vardafreeflyers.com");
  });

  it("falls back to the forwarded host a proxy reports", () => {
    vi.stubEnv("NEXTAUTH_URL", "");
    expect(
      appBaseUrl(
        insideDocker({ "x-forwarded-host": "staging.example.com", "x-forwarded-proto": "https" })
      )
    ).toBe("https://staging.example.com");
  });

  it("then to the Host header", () => {
    vi.stubEnv("NEXTAUTH_URL", "");
    expect(appBaseUrl(insideDocker({ host: "localhost:3001" }))).toBe("http://localhost:3001");
  });
});

describe("the OAuth round trip", () => {
  it("sends Google the redirect registered on the OAuth client", () => {
    vi.stubEnv("NEXTAUTH_URL", "http://localhost:3001");
    expect(calendarRedirectUri(insideDocker())).toBe(
      "http://localhost:3001/api/calendar/callback"
    );
  });

  it("asks for offline calendar access, and carries the state", () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "client-123");
    const url = new URL(consentUrl("http://localhost:3001/api/calendar/callback", "st4te"));
    expect(url.searchParams.get("client_id")).toBe("client-123");
    expect(url.searchParams.get("access_type")).toBe("offline");
    // Without prompt=consent Google skips the refresh token on a reconnect.
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("state")).toBe("st4te");
    expect(url.searchParams.get("scope")).toContain(
      "https://www.googleapis.com/auth/calendar.events"
    );
  });
});
