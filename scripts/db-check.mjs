// Quick read-only DB inspection — counts + most recent fetch.
import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";
config({ path: ".env.local" });

const sql = neon(process.env.DATABASE_URL);
const [counts] = await sql`
  SELECT
    count(*)                            AS total,
    count(*) FILTER (WHERE kind='district') AS district,
    count(*) FILTER (WHERE kind='senate')   AS senate,
    MAX(fetched_at)                     AS max_fetched_at
  FROM prices
`;
console.log(counts);
