// Session cookie naming, shared by the NextAuth config (lib/auth.ts) and the
// edge proxy (proxy.ts) — which reads the token itself and would otherwise
// look for NextAuth's default name and never find ours.
//
// Why rename it at all: cookies are scoped to a HOST, not a port, so every app
// you run on localhost shares them. With NextAuth's default
// `next-auth.session-token`, another local app's token arrives here, fails to
// decrypt, and ours does the same over there.
//
// Keep this module free of server-only imports (no prisma, no bcrypt): the
// proxy runs on the edge runtime and pulls in whatever it touches.

// `__Secure-` is the production convention — browsers refuse that prefix over
// plain http, so it can only be used once the app is served over https.
const isHttps = process.env.NEXTAUTH_URL?.startsWith("https://") ?? false;

export const SESSION_COOKIE_NAME = isHttps
  ? "__Secure-vff.session-token"
  : "vff.session-token";

const options = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  secure: isHttps,
};

// The rest of NextAuth's cookies get our prefix too, for the same reason. The
// session token was renamed first; these were left on their defaults until
// Google sign-in was switched on, and then a Google round trip on localhost
// failed with "State cookie was missing" whenever another local NextAuth app
// had written its own `next-auth.state` / `next-auth.pkce.code_verifier`
// (and `next-auth.callback-url` could send a member to the other app).
const prefix = isHttps ? "__Secure-vff" : "vff";

export const authCookies = {
  sessionToken: { name: SESSION_COOKIE_NAME, options },
  // `__Host-` is NextAuth's own production choice for this one: host-only,
  // path "/", secure — it can't be overwritten from a subdomain.
  csrfToken: { name: isHttps ? "__Host-vff.csrf-token" : "vff.csrf-token", options },
  callbackUrl: { name: `${prefix}.callback-url`, options },
  // The OAuth round trip's one-time values. 15 minutes, NextAuth's default.
  state: { name: `${prefix}.state`, options: { ...options, maxAge: 900 } },
  pkceCodeVerifier: { name: `${prefix}.pkce.code_verifier`, options: { ...options, maxAge: 900 } },
  nonce: { name: `${prefix}.nonce`, options },
};
