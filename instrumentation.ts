// Runs once when the Next server boots (Node runtime only).
//
// Vercel reserves the TZ env var, so the club's timezone is configured as
// APP_TZ and copied onto process.env.TZ here — before any date formatting
// happens — so `new Date().toLocaleString()` on the server matches what the
// club sees locally.
export function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const tz = process.env.APP_TZ;
  if (tz && process.env.TZ !== tz) {
    process.env.TZ = tz;
  }
}
