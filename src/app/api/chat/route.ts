/**
 * POST /api/chat — the streaming conversation endpoint (SSE).
 *
 * Body: { conversationId?, content?, model?: "auto" | "<providerId>:<modelId>",
 *         regenerate?: boolean }
 *
 * Emits `data: {...}` events:
 *   start    {conversationId}          conversation resolved/created
 *   provider {provider, model}         which engine is serving (may repeat on failover)
 *   restart                            partial output discarded, failover under way
 *   delta    {text}                    assistant text chunk
 *   reasoning{text}                    thinking chunk (collapsible in UI)
 *   error    {message}                 all candidates failed / mid-stream loss
 *   done     {messageId?}              stream finished (assistant msg persisted if any)
 */
import { NextRequest } from "next/server";
import { and, asc, desc, eq, gt } from "drizzle-orm";
import { db, schema } from "@/db";
import { orchestrate } from "@/core/orchestrator";
import { classifyPrompt, rankCandidates, DEFAULT_ROUTING, RoutingRules } from "@/core/router";
import type { ChatMessage } from "@/core/types";
import { buildCandidates, CHAT_DEFAULTS, getSetting, userIdFrom, ChatDefaults } from "@/server/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_HISTORY_MESSAGES = 40;
const MAX_HISTORY_CHARS = 80_000;
const MAX_CONTENT_CHARS = 32_000;

export async function POST(req: NextRequest) {
  const userId = userIdFrom(req);
  let body: {
    conversationId?: string;
    content?: string;
    model?: string;
    regenerate?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (!body.regenerate && (!content || content.length > MAX_CONTENT_CHARS)) {
    return Response.json({ error: "content is required (max 32k chars)" }, { status: 400 });
  }

  /* ------------------------- conversation & prompt ------------------------ */
  let conversationId = body.conversationId;
  if (conversationId) {
    const conv = await db.query.conversations.findFirst({
      where: and(
        eq(schema.conversations.id, conversationId),
        eq(schema.conversations.userId, userId),
      ),
    });
    if (!conv) return Response.json({ error: "Conversation not found" }, { status: 404 });
  } else {
    const [conv] = await db
      .insert(schema.conversations)
      .values({ userId, title: content.slice(0, 80) || "New chat" })
      .returning();
    conversationId = conv.id;
  }

  if (body.regenerate) {
    // Drop trailing assistant message(s); the last user message becomes the prompt.
    const msgs = await db.query.messages.findMany({
      where: eq(schema.messages.conversationId, conversationId),
      orderBy: [desc(schema.messages.createdAt)],
      limit: 5,
    });
    const lastUser = msgs.find((m) => m.role === "user");
    if (!lastUser) return Response.json({ error: "Nothing to regenerate" }, { status: 400 });
    await db
      .delete(schema.messages)
      .where(
        and(
          eq(schema.messages.conversationId, conversationId),
          eq(schema.messages.role, "assistant"),
          gt(schema.messages.createdAt, lastUser.createdAt),
        ),
      );
  } else {
    await db.insert(schema.messages).values({ conversationId, role: "user", content });
  }

  /* ------------------------------- history -------------------------------- */
  const rows = await db.query.messages.findMany({
    where: eq(schema.messages.conversationId, conversationId),
    orderBy: [asc(schema.messages.createdAt)],
  });
  let chars = 0;
  const history: ChatMessage[] = [];
  for (const m of rows.slice(-MAX_HISTORY_MESSAGES).reverse()) {
    chars += m.content.length;
    if (chars > MAX_HISTORY_CHARS && history.length) break;
    history.unshift({ role: m.role as ChatMessage["role"], content: m.content });
  }

  /* ------------------------------ candidates ------------------------------ */
  const { requestedFirst, candidates } = await buildCandidates(userId, body.model);
  if (!candidates.length) {
    return Response.json(
      { error: "No enabled providers/models. Add one in Settings." },
      { status: 409 },
    );
  }
  const defaults = await getSetting<ChatDefaults>(userId, "chat_defaults", CHAT_DEFAULTS);
  let chain = candidates;
  if (!requestedFirst) {
    const rules = await getSetting<RoutingRules>(userId, "routing", DEFAULT_ROUTING);
    const cls = classifyPrompt(history[history.length - 1]?.content ?? "", chars);
    chain = rankCandidates(candidates, cls, rules);
  }

  /* -------------------------------- stream -------------------------------- */
  const abort = new AbortController();
  req.signal.addEventListener("abort", () => abort.abort());
  const encoder = new TextEncoder();
  const t0 = Date.now();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

      let text = "";
      let reasoning = "";
      let provider = "";
      let model = "";
      let usage = { inputTokens: 0, outputTokens: 0 };
      let errorClass: string | null = null;

      send({ type: "start", conversationId });
      try {
        for await (const ev of orchestrate(chain, {
          messages: history,
          system: defaults.system,
          maxTokens: defaults.maxTokens,
          temperature: defaults.temperature ?? undefined,
          signal: abort.signal,
        })) {
          if (ev.type === "provider") {
            provider = ev.provider;
            model = ev.model;
            send({ type: "provider", provider, model });
          } else if (ev.type === "restart") {
            text = "";
            reasoning = "";
            send({ type: "restart" });
          } else if (ev.type === "stream") {
            const e = ev.event;
            if (e.type === "text") {
              text += e.delta;
              send({ type: "delta", text: e.delta });
            } else if (e.type === "reasoning") {
              reasoning += e.delta;
              send({ type: "reasoning", text: e.delta });
            } else if (e.type === "usage") {
              usage = { inputTokens: e.inputTokens, outputTokens: e.outputTokens };
            }
          } else if (ev.type === "failed") {
            errorClass = ev.errorClass;
            send({ type: "error", message: ev.message, partial: ev.partial });
          }
        }
      } catch (e) {
        errorClass = "internal";
        send({ type: "error", message: e instanceof Error ? e.message : "Internal error" });
      }

      /* ------------------------------ persist ------------------------------ */
      const latencyMs = Date.now() - t0;
      let messageId: string | undefined;
      try {
        if (text) {
          const [row] = await db
            .insert(schema.messages)
            .values({
              conversationId: conversationId!,
              role: "assistant",
              content: text,
              reasoning: reasoning || null,
              provider,
              model,
              inputTokens: usage.inputTokens || null,
              outputTokens: usage.outputTokens || null,
              latencyMs,
            })
            .returning({ id: schema.messages.id });
          messageId = row.id;
          await db
            .update(schema.conversations)
            .set({ updatedAt: new Date() })
            .where(eq(schema.conversations.id, conversationId!));
        }
        if (provider) {
          await db.insert(schema.usageLog).values({
            userId,
            provider,
            model,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            latencyMs,
            outcome: abort.signal.aborted ? "aborted" : errorClass ? "error" : "ok",
            errorClass,
          });
        }
      } catch {
        /* persistence failure must not kill the stream close */
      }

      send({ type: "done", messageId });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
