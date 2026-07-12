/**
 * POST /api/providers/:id/test — live diagnostics for the settings page:
 *   1. auth + latency: listModels() round-trip
 *   2. streaming: 1-token chat against the default model, time-to-first-token
 */
import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { decryptSecret } from "@/core/crypto";
import { getAdapter } from "@/core/providers";
import { userIdFrom } from "@/server/context";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const prov = await db.query.providers.findFirst({
    where: and(eq(schema.providers.id, id), eq(schema.providers.userId, userIdFrom(req))),
  });
  if (!prov) return Response.json({ error: "Not found" }, { status: 404 });

  const runtime = {
    baseUrl: prov.baseUrl,
    apiKey: prov.apiKeyEnc ? decryptSecret(prov.apiKeyEnc) : undefined,
    timeoutMs: 20_000,
  };
  const adapter = getAdapter(prov.adapter);

  // 1. auth + latency
  let latencyMs: number;
  let modelCount: number;
  try {
    const t0 = Date.now();
    const ids = await adapter.listModels(runtime);
    latencyMs = Date.now() - t0;
    modelCount = ids.length;
  } catch (e) {
    return Response.json({
      ok: false,
      stage: "auth",
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // 2. streaming against the default model
  const def = await db.query.models.findFirst({
    where: and(eq(schema.models.providerId, id), eq(schema.models.isDefault, true)),
  });
  let firstTokenMs: number | null = null;
  let streamError: string | null = null;
  if (def) {
    try {
      const t0 = Date.now();
      for await (const ev of adapter.chat(
        {
          model: def.modelId,
          messages: [{ role: "user", content: "Reply with the single word: ok" }],
          maxTokens: 8,
        },
        runtime,
      )) {
        if (ev.type === "text" && firstTokenMs === null) firstTokenMs = Date.now() - t0;
        if (ev.type === "done") break;
      }
    } catch (e) {
      streamError = e instanceof Error ? e.message : String(e);
    }
  }

  return Response.json({
    ok: !streamError,
    latencyMs,
    modelCount,
    defaultModel: def?.modelId ?? null,
    firstTokenMs,
    streamError,
  });
}
