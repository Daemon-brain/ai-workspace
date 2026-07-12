/**
 * GET  /api/providers — providers with masked keys + their models (keys never leave the server)
 * POST /api/providers — { catalogId, apiKey?, baseUrl?, name? }
 *   On create, the adapter's listModels() imports the live model list and the
 *   catalog's defaultModelPattern enables a sensible default.
 */
import { NextRequest } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { catalogEntry, CATALOG } from "@/core/catalog";
import { decryptSecret, encryptSecret, maskSecret } from "@/core/crypto";
import { getAdapter } from "@/core/providers";
import { providerHealth } from "@/core/orchestrator";
import { userIdFrom } from "@/server/context";

export async function GET(req: NextRequest) {
  const userId = userIdFrom(req);
  const provs = await db.query.providers.findMany({
    where: eq(schema.providers.userId, userId),
    orderBy: [asc(schema.providers.priority), asc(schema.providers.createdAt)],
  });
  const mods = await db.query.models.findMany({ orderBy: [asc(schema.models.modelId)] });
  const health = new Map(providerHealth().map((h) => [h.key, h]));
  return Response.json(
    provs.map((p) => ({
      id: p.id,
      catalogId: p.catalogId,
      name: p.name,
      adapter: p.adapter,
      baseUrl: p.baseUrl,
      enabled: p.enabled,
      priority: p.priority,
      maskedKey: p.apiKeyEnc ? maskSecret(decryptSecret(p.apiKeyEnc)) : null,
      cooldown: health.get(p.id) ?? null,
      models: mods
        .filter((m) => m.providerId === p.id)
        .map((m) => ({ id: m.id, modelId: m.modelId, enabled: m.enabled, isDefault: m.isDefault })),
    })),
  );
}

export async function POST(req: NextRequest) {
  const userId = userIdFrom(req);
  const body = (await req.json()) as {
    catalogId?: string;
    apiKey?: string;
    baseUrl?: string;
    name?: string;
  };
  const entry = body.catalogId ? catalogEntry(body.catalogId) : undefined;
  if (!entry) {
    return Response.json(
      { error: `Unknown catalogId. Valid: ${CATALOG.map((c) => c.id).join(", ")}` },
      { status: 400 },
    );
  }
  const apiKey = body.apiKey?.trim();
  if (!entry.keyless && !apiKey) {
    return Response.json({ error: `${entry.label} requires an API key` }, { status: 400 });
  }

  const [prov] = await db
    .insert(schema.providers)
    .values({
      userId,
      catalogId: entry.id,
      name: body.name?.trim() || entry.label,
      adapter: entry.adapter,
      baseUrl: body.baseUrl?.trim() || entry.baseUrl,
      apiKeyEnc: apiKey ? encryptSecret(apiKey) : null,
    })
    .returning();

  // Import the live model list; a failure here should not orphan the provider.
  let modelCount = 0;
  let warning: string | undefined;
  try {
    const ids = await getAdapter(entry.adapter).listModels({
      baseUrl: prov.baseUrl,
      apiKey,
      timeoutMs: 15_000,
    });
    if (ids.length) {
      const pattern = new RegExp(entry.defaultModelPattern, "i");
      const defaultId = ids.find((m) => pattern.test(m));
      await db.insert(schema.models).values(
        ids.map((modelId) => ({
          providerId: prov.id,
          modelId,
          enabled: modelId === defaultId,
          isDefault: modelId === defaultId,
        })),
      );
      modelCount = ids.length;
      if (!defaultId) warning = "No default model matched — enable one in Settings.";
    }
  } catch (e) {
    warning = `Provider saved, but listing models failed: ${e instanceof Error ? e.message : e}`;
  }

  return Response.json({ id: prov.id, name: prov.name, modelCount, warning }, { status: 201 });
}
