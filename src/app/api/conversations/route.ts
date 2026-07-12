/** GET /api/conversations — list (pinned first, most recent next). */
import { NextRequest } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { userIdFrom } from "@/server/context";

export async function GET(req: NextRequest) {
  const userId = userIdFrom(req);
  const rows = await db.query.conversations.findMany({
    where: eq(schema.conversations.userId, userId),
    orderBy: [desc(schema.conversations.pinned), desc(schema.conversations.updatedAt)],
    limit: 200,
  });
  return Response.json(rows);
}
