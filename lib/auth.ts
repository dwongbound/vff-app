// NextAuth configuration: email/username + password (credentials), plus
// optional Google OAuth for clubs that already live in Google Workspace.
import type { NextAuthOptions } from "next-auth";
import { getServerSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import bcrypt from "bcryptjs";
import { authCookies } from "./authCookies";
import { prisma } from "./prisma";

// Google sign-in is optional: it's only registered when its OAuth credentials
// are configured, so the app still runs (credentials-only) without them.
const googleEnabled =
  !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET;

export const authOptions: NextAuthOptions = {
  // Credentials logins require JWT sessions (no db session rows).
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  // Our own session cookie name, so two apps on localhost don't fight over
  // NextAuth's default one. proxy.ts has to be told the same name — see
  // lib/authCookies.ts.
  cookies: authCookies,
  providers: [
    Credentials({
      name: "Email & Password",
      credentials: {
        username: { label: "Email", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.username || !credentials.password) return null;

        const user = await prisma.user.findFirst({
          where: {
            OR: [
              { username: credentials.username },
              { email: credentials.username },
            ],
          },
        });
        if (!user || !user.passwordHash) return null;

        const passwordOk = await bcrypt.compare(
          credentials.password,
          user.passwordHash
        );
        if (!passwordOk) return null;

        // Whatever we return here lands in the `user` arg of the jwt callback.
        return {
          id: user.id,
          name: user.name,
          email: user.email ?? undefined,
        };
      },
    }),
    ...(googleEnabled
      ? [
          Google({
            clientId: process.env.GOOGLE_CLIENT_ID!,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
          }),
        ]
      : []),
  ],
  callbacks: {
    // Google sign-ins have no row in our User table yet: find-or-create one by
    // email. Credentials logins are already validated in authorize().
    async signIn({ user, account }) {
      if (account?.provider !== "google") return true;
      const email = user.email;
      if (!email) return false;

      const existing = await prisma.user.findUnique({ where: { email } });
      if (!existing) {
        await prisma.user.create({
          data: {
            email,
            username: email,
            name: user.name ?? email,
            passwordHash: "", // OAuth account — no usable password
          },
        });
      }
      return true;
    },

    async jwt({ token, user, account, trigger, session }) {
      // First sign-in: copy our own fields onto the token. For Google the
      // `user` is the OAuth profile, so resolve our real row by email.
      if (user) {
        const isOAuth = account?.provider === "google";
        if (isOAuth && user.email) {
          const dbUser = await prisma.user.findUnique({
            where: { email: user.email },
          });
          if (dbUser) {
            token.id = dbUser.id;
            token.name = dbUser.name;
          }
        } else {
          token.id = user.id;
        }
      }
      // The profile page calls useSession().update({ name }) after a save so
      // the navbar shows the new name without a re-login.
      if (trigger === "update" && session?.name) {
        token.name = session.name;
      }
      // isAdmin rides on the token as a UI hint (which controls render); every
      // admin API route re-checks it against the db. Refreshed on sign-in and
      // on any update() call.
      if (token.id && (user || trigger === "update")) {
        const row = await prisma.user.findUnique({
          where: { id: token.id as string },
          select: { isAdmin: true },
        });
        token.isAdmin = row?.isAdmin ?? false;
      }
      return token;
    },

    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.isAdmin = Boolean(token.isAdmin);
      }
      return session;
    },
  },
};

/** Current session user (or null) for API routes. */
export async function getSessionUser() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return null;
  // A NextAuth JWT stays cryptographically valid even after its user row is
  // gone (account deleted, or a dev reseed rebuilt the table with new ids).
  // Re-check the id so a "ghost" session is treated as logged out.
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, name: true, email: true, isAdmin: true },
  });
  return user;
}

/**
 * Guard for club-admin routes (aircraft edits, resolving squawks, canceling
 * someone else's booking). Re-reads isAdmin from the db — never trusts the
 * token, which could predate a revoked admin flag.
 */
export async function getAdminUser() {
  const user = await getSessionUser();
  if (!user?.isAdmin) return null;
  return user;
}
