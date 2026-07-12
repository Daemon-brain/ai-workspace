/**
 * PATCH  /api/providers/:id — { enabled?, priority?, apiKey?, defaultModelRowId?,
 *                               modelToggles?: [{id, enabled}] }
 * DELETE /api/providers/:id — cascades to its models
 */
import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { encryptSecret } from "@/core/crypto";
import { clearCooldown } from "@/core/orchestrator";
import { userIdFrom } from "@/server/context";

type Params = { params: Promise<{ id: string }> };

async function owned(userId: string, id: string) {
  return db.query.providers.findFirst({
    where: and(eq(schema.providers.id, id), eq(schema.providers.userId, userId)),
  });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const prov = await owned(userIdFrom(req), id);
  if (!prov) return Response.json({ error: "Not found" }, { status: 404 });

  const body = (await req.json()) as {
    enabled?: boolean;
    priority?: number;
    apiKey?: string;
    defaultModelRowId?: string;
    modelToggles?: Array<{ id: string; enabled: boolean }>;
  };

  const patch: Partial<typeof schema.providers.$inferInsert> = {};
  if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
  if (Number.isInteger(body.priority)) patch.priority = body.priority;
  if (typeof body.apiKey === "string" && body.apiKey.trim()) {
    patch.apiKeyEnc = encryptSecret(body.apiKey.trim());
    clearCooldown(id); // fixed credentials shouldn't wait out a stale cooldown
  }
  if (body.enabled === true) clearCooldown(id); // re-enabling = user says try again
  if (Object.keys(patch).length) {
    await db.update(schema.providers).set(patch).where(eq(schema.providers.id, id));
  }

  if (body.defaultModelRowId) {
    await db
      .update(schema.models)
      .set({ isDefault: false })
      .where(eq(schema.models.providerId, id));
    await db
      .update(schema.models)
      .set({ isDefault: true, enabled: true })
      .where(and(eq(schema.models.id, body.defaultModelRowId), eq(schema.models.providerId, id)));
  }
  for (const t of body.modelToggles ?? []) {
    await db
      .update(schema.models)
      .set({ enabled: t.enabled })
      .where(and(eq(schema.models.id, t.id), eq(schema.models.providerId, id)));
  }

  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const prov = await owned(userIdFrom(req), id);
  if (!prov) return Response.json({ error: "Not found" }, { status: 404 });
  await db.delete(schema.providers).where(eq(schema.providers.id, id));
  return Response.json({ ok: true });
}
