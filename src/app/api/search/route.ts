/**
 * GET /api/search?q= — conversations matching by title OR message content.
 * (ILIKE for M1; semantic search arrives with the pgvector/RAG milestone.)
 */
import { NextRequest } from "next/server";
import { desc, eq, exists, ilike, or, and } from "drizzle-orm";
import { db, schema } from "@/db";
import { userIdFrom } from "@/server/context";

export async function GET(req: NextRequest) {
  const userId = userIdFrom(req);
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (!q) return Response.json([]);
  const needle = `%${q.slice(0, 100)}%`;

  const rows = await db
    .select()
    .from(schema.conversations)
    .where(
      and(
        eq(schema.conversations.userId, userId),
        or(
          ilike(schema.conversations.title, needle),
          exists(
            db
              .select({ one: schema.messages.id })
              .from(schema.messages)
              .where(
                and(
                  eq(schema.messages.conversationId, schema.conversations.id),
                  ilike(schema.messages.content, needle),
                ),
              ),
          ),
        ),
      ),
    )
    .orderBy(desc(schema.conversations.updatedAt))
    .limit(30);

  return Response.json(rows);
}
