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

export const authCookies = {
  sessionToken: {
    name: SESSION_COOKIE_NAME,
    options: {
      httpOnly: true,
      sameSite: "lax" as const,
      path: "/",
      secure: isHttps,
    },
  },
};
