/**
 * SERVER HELPERS shared by API routes.
 *
 * Identity: the host application authenticates users and forwards an id via
 * the `x-workspace-user` header (standalone use falls back to "local").
 * This module never handles passwords — embedding contract, documented in README.
 */
import { and, asc, eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { db, schema } from "@/db";
import { decryptSecret } from "@/core/crypto";
import type { Candidate } from "@/core/orchestrator";

export function userIdFrom(req: NextRequest): string {
  const raw = req.headers.get("x-workspace-user")?.trim();
  // constrain to something sane; ids come from the trusted host app
  return raw && /^[\w.@-]{1,128}$/.test(raw) ? raw : "local";
}

export async function getSetting<T>(userId: string, key: string, fallback: T): Promise<T> {
  const row = await db.query.settings.findFirst({
    where: and(eq(schema.settings.userId, userId), eq(schema.settings.key, key)),
  });
  return (row?.value as T) ?? fallback;
}

export interface ChatDefaults {
  system: string;
  maxTokens: number;
  temperature: number | null;
}

export const CHAT_DEFAULTS: ChatDefaults = {
  system:
    "You are a capable, concise assistant inside the user's AI workspace. Use markdown; use code blocks for code.",
  maxTokens: 4096,
  temperature: null,
};

/**
 * Build the failover chain for a request.
 * - explicit "providerRowId:modelId" → that pair first, then every other
 *   enabled provider's default model, in priority order.
 * - "auto" (or missing) → all enabled defaults in priority order (the router
 *   re-ranks them afterwards).
 */
export async function buildCandidates(
  userId: string,
  requested: string | undefined,
): Promise<{ requestedFirst: boolean; candidates: Candidate[] }> {
  const provs = await db.query.providers.findMany({
    where: and(eq(schema.providers.userId, userId), eq(schema.providers.enabled, true)),
    orderBy: [asc(schema.providers.priority), asc(schema.providers.createdAt)],
  });
  if (!provs.length) return { requestedFirst: false, candidates: [] };

  const allModels = await db.query.models.findMany({
    where: eq(schema.models.enabled, true),
  });
  const byProvider = new Map<string, typeof allModels>();
  for (const m of allModels) {
    const arr = byProvider.get(m.providerId) ?? [];
    arr.push(m);
    byProvider.set(m.providerId, arr);
  }

  const toCandidate = (p: (typeof provs)[number], modelId: string): Candidate => ({
    key: p.id,
    providerName: p.name,
    adapter: p.adapter,
    model: modelId,
    runtime: {
      baseUrl: p.baseUrl,
      apiKey: p.apiKeyEnc ? decryptSecret(p.apiKeyEnc) : undefined,
      timeoutMs: p.timeoutMs,
    },
  });

  const defaults: Candidate[] = [];
  for (const p of provs) {
    const mods = byProvider.get(p.id) ?? [];
    const def = mods.find((m) => m.isDefault) ?? mods[0];
    if (def) defaults.push(toCandidate(p, def.modelId));
  }

  if (requested && requested !== "auto") {
    const [pid, ...rest] = requested.split(":");
    const modelId = rest.join(":");
    const p = provs.find((x) => x.id === pid);
    const m = (byProvider.get(pid) ?? []).find((x) => x.modelId === modelId);
    if (p && m) {
      const first = toCandidate(p, m.modelId);
      return {
        requestedFirst: true,
        candidates: [first, ...defaults.filter((c) => c.key !== p.id)],
      };
    }
  }
  return { requestedFirst: false, candidates: defaults };
}
