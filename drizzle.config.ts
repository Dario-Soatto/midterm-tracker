import { config } from "dotenv";
import type { Config } from "drizzle-kit";

// Next.js's local convention is .env.local; load that explicitly.
config({ path: ".env.local" });

if (!process.env.DATABASE_URL) {
  // drizzle-kit reads .env automatically via dotenv/config above; bail loudly
  // if it's still missing rather than silently emitting a broken config.
  throw new Error(
    "DATABASE_URL is not set. Run `vercel env pull .env.local` to populate it.",
  );
}

export default {
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  strict: true,
} satisfies Config;
