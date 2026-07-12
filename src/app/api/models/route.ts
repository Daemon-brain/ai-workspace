/** GET /api/models — enabled (provider, model) pairs for the model picker. */
import { NextRequest } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { userIdFrom } from "@/server/context";

export async function GET(req: NextRequest) {
  const userId = userIdFrom(req);
  const provs = await db.query.providers.findMany({
    where: and(eq(schema.providers.userId, userId), eq(schema.providers.enabled, true)),
    orderBy: [asc(schema.providers.priority)],
  });
  const mods = await db.query.models.findMany({
    where: eq(schema.models.enabled, true),
    orderBy: [asc(schema.models.modelId)],
  });
  const list = provs.flatMap((p) =>
    mods
      .filter((m) => m.providerId === p.id)
      .map((m) => ({
        value: `${p.id}:${m.modelId}`,
        label: m.modelId,
        provider: p.name,
        isDefault: m.isDefault,
      })),
  );
  return Response.json(list);
}
