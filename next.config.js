/** @type {import('next').NextConfig} */
import { execSync } from "node:child_process";
import { createRequire } from "node:module";

// package.json isn't importable as ESM without a JSON import assertion (and
// tooling support varies), so read it through a CJS require bridge instead.
const pkg = createRequire(import.meta.url)("./package.json");

// Commit sha for the build stamp on the login screen. Shelling out to git only
// works when there IS a .git — which is true locally and false in every
// container build, since .dockerignore excludes it. So builders pass the sha
// in: COMMIT_SHA is ours (Dockerfile ARG, fed by CI), VERCEL_GIT_COMMIT_SHA is
// Vercel's. Git is the local fallback, and "" means "not stamped".
function resolveCommitSha() {
  if (process.env.COMMIT_SHA) return process.env.COMMIT_SHA;
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA;
  try {
    return execSync("git rev-parse HEAD").toString().trim();
  } catch {
    return "";
  }
}

const nextConfig = {
  // Trace only the files the app actually imports into .next/standalone, so the
  // runtime image can drop node_modules entirely (~1.5GB → ~250MB). Matters
  // because the image is now pulled over the network on every deploy rather
  // than built in place, and ghcr's free private quota is 500MB.
  output: "standalone",
  // Next's dev overlay renders a floating indicator (<nextjs-portal>) pinned to
  // a corner of the viewport, and it swallows pointer events over its own
  // footprint. On a phone-sized viewport that footprint lands squarely on the
  // floating bottom tab bar, so Playwright can't tap a tab: every click is
  // rejected with "<nextjs-portal> … intercepts pointer events".
  //
  // The e2e suite runs against `next dev` (see the e2e:server script), so the
  // overlay has to go for that run only — developers keep it.
  ...(process.env.E2E ? { devIndicators: false } : {}),
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
    NEXT_PUBLIC_COMMIT_SHA: resolveCommitSha(),
  },
  // "/" → the Plane Status tab (the first one), as a plain HTTP redirect rather than an RSC
  // redirect() (which can crash hydration when an authenticated user lands on
  // "/" straight after an OAuth callback).
  async redirects() {
    return [{ source: "/", destination: "/status", permanent: false }];
  },
};

export default nextConfig;
