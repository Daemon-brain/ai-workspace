import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Next.js dev hot-reload re-evaluates modules; cache the pool on globalThis so
// we don't leak connections.
const g = globalThis as unknown as { aiwSql?: ReturnType<typeof postgres> };

const sql =
  g.aiwSql ??
  postgres(process.env.DATABASE_URL!, {
    max: 10,
    onnotice: () => {},
  });

if (process.env.NODE_ENV !== "production") g.aiwSql = sql;

export const db = drizzle(sql, { schema });
export { schema };
