/** GET /api/usage — 7-day per-provider totals for the settings page. */
import { NextRequest } from "next/server";
import { and, eq, gte, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { userIdFrom } from "@/server/context";

export async function GET(req: NextRequest) {
  const userId = userIdFrom(req);
  const since = new Date(Date.now() - 7 * 24 * 3600_000);
  const rows = await db
    .select({
      provider: schema.usageLog.provider,
      requests: sql<number>`count(*)::int`,
      inputTokens: sql<number>`coalesce(sum(${schema.usageLog.inputTokens}),0)::int`,
      outputTokens: sql<number>`coalesce(sum(${schema.usageLog.outputTokens}),0)::int`,
      errors: sql<number>`count(*) filter (where ${schema.usageLog.outcome} = 'error')::int`,
      avgLatencyMs: sql<number>`coalesce(avg(${schema.usageLog.latencyMs}),0)::int`,
    })
    .from(schema.usageLog)
    .where(and(eq(schema.usageLog.userId, userId), gte(schema.usageLog.ts, since)))
    .groupBy(schema.usageLog.provider);
  return Response.json(rows);
}
