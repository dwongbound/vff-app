/** @type {import('next').NextConfig} */
import { execSync } from "node:child_process";
import { createRequire } from "node:module";

// package.json isn't importable as ESM without a JSON import assertion (and
// tooling support varies), so read it through a CJS require bridge instead.
const pkg = createRequire(import.meta.url)("./package.json");

// Commit sha for the build stamp on the login screen. Vercel exposes it as an
// env var (git isn't in the build sandbox); locally we shell out to git.
function resolveCommitSha() {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA;
  try {
    return execSync("git rev-parse HEAD").toString().trim();
  } catch {
    return "";
  }
}

const nextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
    NEXT_PUBLIC_COMMIT_SHA: resolveCommitSha(),
  },
  // "/" → the Reservations tab, as a plain HTTP redirect rather than an RSC
  // redirect() (which can crash hydration when an authenticated user lands on
  // "/" straight after an OAuth callback).
  async redirects() {
    return [{ source: "/", destination: "/reservations", permanent: false }];
  },
};

export default nextConfig;
