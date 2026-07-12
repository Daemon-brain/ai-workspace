/**
 * GET    /api/conversations/:id — conversation + messages
 * PATCH  /api/conversations/:id — { title?, pinned? }
 * DELETE /api/conversations/:id
 */
import { NextRequest } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { userIdFrom } from "@/server/context";

type Params = { params: Promise<{ id: string }> };

async function owned(userId: string, id: string) {
  return db.query.conversations.findFirst({
    where: and(eq(schema.conversations.id, id), eq(schema.conversations.userId, userId)),
  });
}

export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const conv = await owned(userIdFrom(req), id);
  if (!conv) return Response.json({ error: "Not found" }, { status: 404 });
  const msgs = await db.query.messages.findMany({
    where: eq(schema.messages.conversationId, id),
    orderBy: [asc(schema.messages.createdAt)],
  });
  return Response.json({ ...conv, messages: msgs });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const conv = await owned(userIdFrom(req), id);
  if (!conv) return Response.json({ error: "Not found" }, { status: 404 });
  const body = (await req.json()) as { title?: string; pinned?: boolean };
  const patch: Partial<typeof schema.conversations.$inferInsert> = {};
  if (typeof body.title === "string" && body.title.trim()) patch.title = body.title.trim().slice(0, 120);
  if (typeof body.pinned === "boolean") patch.pinned = body.pinned;
  if (!Object.keys(patch).length) return Response.json({ error: "Nothing to update" }, { status: 400 });
  const [row] = await db
    .update(schema.conversations)
    .set(patch)
    .where(eq(schema.conversations.id, id))
    .returning();
  return Response.json(row);
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const conv = await owned(userIdFrom(req), id);
  if (!conv) return Response.json({ error: "Not found" }, { status: 404 });
  await db.delete(schema.conversations).where(eq(schema.conversations.id, id));
  return Response.json({ ok: true });
}
