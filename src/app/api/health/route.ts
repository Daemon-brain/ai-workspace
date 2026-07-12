/** GET /api/health — module liveness + provider cooldown state. */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { providerHealth } from "@/core/orchestrator";

export async function GET() {
  let dbOk = true;
  try {
    await db.execute(sql`select 1`);
  } catch {
    dbOk = false;
  }
  return Response.json({ ok: dbOk, db: dbOk, cooldowns: providerHealth() });
}
