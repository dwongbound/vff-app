"use client";
// Auth screen: sign in, sign up, and optional Google SSO (only shown when it's
// configured on the server, checked via getProviders).
import { getProviders, signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useEffect, useState } from "react";
import Button from "@/components/common/Button";
import Card from "@/components/common/Card";
import Input from "@/components/common/Input";
import Logo from "@/components/Logo";
import { CLUB_NAME } from "@/lib/constants";
import { normalizeCode } from "@/lib/signupCodes";

// useSearchParams() (used inside LoginForm to read ?callbackUrl) must sit
// under a Suspense boundary, so the page export just wraps the form in one.
export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  // Where to go after a successful login. The proxy appends ?callbackUrl when
  // it bounces you here from a protected page; otherwise land on the schedule.
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/reservations";
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [googleAvailable, setGoogleAvailable] = useState(false);
  // A refused Google sign-in comes back as ?error=<code> (see lib/auth.ts).
  const [error, setError] = useState(() => oauthErrorMessage(searchParams.get("error")));
  const [submitting, setSubmitting] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [password2, setPassword2] = useState("");
  // The club's sign-up code. Normalised as it's typed so what you see is what
  // gets compared — see lib/signupCodes.ts.
  const [code, setCode] = useState("");
  // False until React has hydrated. The submit buttons stay disabled until
  // then: this is the one page reachable before the JS lands, and a click on an
  // un-hydrated form does a native GET submit that silently wipes what you
  // typed. Better to be un-tappable for a moment than to eat a password.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(true);
    // The message above has been read off ?error=; drop it from the address
    // so a reload doesn't show it again.
    if (searchParams.get("error")) {
      const url = new URL(window.location.href);
      url.searchParams.delete("error");
      window.history.replaceState(null, "", url.pathname + url.search);
    }
    getProviders().then((providers) => setGoogleAvailable(!!providers?.google));
  }, []);

  function switchMode(next: "signin" | "signup") {
    setMode(next);
    setError("");
  }

  async function onSignIn(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    // redirect:false → we handle success/failure ourselves.
    const result = await signIn("credentials", {
      redirect: false,
      username: email,
      password,
      // Explicit, never the default: NextAuth's default is THIS page's URL,
      // and it reads success back as "no ?error= in the URL it returns". After
      // a refused Google sign-in this page is /login?error=GoogleNoAccount, so
      // the default made a successful sign-in report itself as a failure.
      callbackUrl,
    });
    setSubmitting(false);
    if (result?.error) {
      setError("Wrong email or password.");
    } else {
      router.push(callbackUrl);
      router.refresh();
    }
  }

  async function onSignUp(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== password2) {
      setError("Those passwords don't match.");
      return;
    }
    setSubmitting(true);
    const res = await fetch("/api/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password, code }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Could not create the account.");
      setSubmitting(false);
      return;
    }
    // Auto sign-in with the brand-new credentials (email is the username).
    const result = await signIn("credentials", {
      redirect: false,
      username: email,
      password,
      // Explicit, never the default: NextAuth's default is THIS page's URL,
      // and it reads success back as "no ?error= in the URL it returns". After
      // a refused Google sign-in this page is /login?error=GoogleNoAccount, so
      // the default made a successful sign-in report itself as a failure.
      callbackUrl,
    });
    setSubmitting(false);
    if (result?.error) {
      // Mode first: switchMode clears the error, so the other order showed a
      // blank sign-in form with no word of the account just created.
      switchMode("signin");
      setError("Account created — please sign in.");
    } else {
      router.push(callbackUrl);
      router.refresh();
    }
  }

  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <Card className="w-full max-w-sm">
        <div className="mb-4 flex justify-center">
          <Logo className="h-14 w-14" />
        </div>
        <h1 className="mb-1 text-center text-xl font-bold text-indigo-600 dark:text-indigo-400">
          {CLUB_NAME}
        </h1>
        <p className="mb-6 text-center text-sm text-gray-500">
          {mode === "signin" ? "Sign in to your account" : "Create your account"}
        </p>

        {googleAvailable && (
          <>
            <Button
              type="button"
              variant="secondary"
              className="w-full"
              onClick={() => signIn("google", { callbackUrl })}
            >
              Continue with Google
            </Button>
            <div className="my-4 flex items-center gap-3 text-xs text-gray-400">
              <span className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
              or
              <span className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
            </div>
          </>
        )}

        {mode === "signin" ? (
          <form onSubmit={onSignIn} className="space-y-4">
            <Input
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              required
            />
            <Input
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button type="submit" disabled={!ready || submitting} className="w-full">
              {submitting ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        ) : (
          <form onSubmit={onSignUp} className="space-y-4">
            {/* First, not last: without one you can't join at all, and finding
                that out after typing a password is the worst order to learn it
                in. Not marked `required` in the markup because the very first
                account at a brand-new club legitimately has no code to give —
                the server is what decides (see app/api/signup). */}
            <Input
              label="Sign-up code"
              value={code}
              onChange={(e) => setCode(normalizeCode(e.target.value))}
              className="font-mono"
              autoComplete="off"
              hint="From the club. Case and spaces don't matter."
            />
            <Input
              label="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              required
            />
            <Input
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
            <Input
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
              hint="At least 8 characters."
            />
            <Input
              label="Confirm password"
              type="password"
              value={password2}
              onChange={(e) => setPassword2(e.target.value)}
              autoComplete="new-password"
              required
            />
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button type="submit" disabled={!ready || submitting} className="w-full">
              {submitting ? "Creating account…" : "Sign up"}
            </Button>
          </form>
        )}

        <div className="mt-6 text-center text-sm text-gray-500">
          {mode === "signin" ? (
            <>
              New to the club?{" "}
              <button
                type="button"
                onClick={() => switchMode("signup")}
                className="font-medium text-indigo-600 hover:underline dark:text-indigo-400"
              >
                Sign up
              </button>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <button
                type="button"
                onClick={() => switchMode("signin")}
                className="font-medium text-indigo-600 hover:underline dark:text-indigo-400"
              >
                Sign in
              </button>
            </>
          )}
        </div>

        <VersionFooter />
      </Card>
    </div>
  );
}

// Build stamp: app version + the short commit sha, both inlined at build time
// by next.config.js. Hidden when the sha is unknown (git unavailable).
function VersionFooter() {
  const version = process.env.NEXT_PUBLIC_APP_VERSION;
  const sha = process.env.NEXT_PUBLIC_COMMIT_SHA;
  return (
    <p className="mt-4 text-center text-xs text-gray-400">
      v{version}
      {sha && <span className="ml-1 font-mono">{sha.slice(0, 7)}</span>}
    </p>
  );
}

/**
 * What a NextAuth ?error= code means, in words. The two Google ones are this
 * app's own refusals (lib/auth.ts); anything else is NextAuth's, and gets a
 * generic line rather than its code.
 */
function oauthErrorMessage(code: string | null): string {
  if (!code) return "";
  if (code === "GoogleNoAccount") {
    return "That Google account isn't a member here yet. Create an account with your sign-up code first — then Continue with Google will work.";
  }
  if (code === "GoogleNoEmail") {
    return "Google didn't share an email address, so we couldn't find your account.";
  }
  return "Sign-in didn't work. Please try again.";
}
