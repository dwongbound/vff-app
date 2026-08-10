// Prisma 7 keeps CLI connection settings here instead of schema.prisma.
// DATABASE_URL is injected by dotenv-cli in npm scripts or by Docker Compose.
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    // Runs on `prisma db seed`.
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: env("DATABASE_URL"),
    // Only for `migrate dev` and the CI drift check, both of which replay the
    // migrations directory into a scratch database. Spread conditionally
    // because env() THROWS on an unset variable, and everything else here
    // (generate, db push, migrate deploy) needs no shadow database at all.
    ...(process.env.SHADOW_DATABASE_URL
      ? { shadowDatabaseUrl: env("SHADOW_DATABASE_URL") }
      : {}),
  },
});
