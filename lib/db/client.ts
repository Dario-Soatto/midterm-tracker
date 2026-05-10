import "server-only";
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "./schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

// Neon's HTTP driver — single round trip per query, fast cold starts on
// Vercel serverless. For our workload (one SELECT per page render, one
// batch UPSERT per cron run) this is ideal.
const sql = neon(process.env.DATABASE_URL);

export const db = drizzle({ client: sql, schema });
