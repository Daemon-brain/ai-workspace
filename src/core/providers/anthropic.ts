/**
 * ANTHROPIC ADAPTER — official @anthropic-ai/sdk (Messages API).
 *
 * Notes on current API behavior (2026):
 *  - Claude 4.6+ / Sonnet 5 / Fable 5 use adaptive thinking; `budget_tokens`
 *    is removed and sampling params (temperature/top_p/top_k) are rejected on
 *    Opus 4.7+/Sonnet 5/Fable 5 — so temperature is only forwarded to models
 *    that still accept it.
 *  - Thinking deltas stream as `thinking_delta`; we surface them as unified
 *    "reasoning" events (collapsible in the UI).
 */
import Anthropic from "@anthropic-ai/sdk";
import {
  ChatRequest,
  ProviderAdapter,
  ProviderError,
  ProviderRuntime,
  StreamEvent,
} from "../types";

const DEFAULT_BASE = "https://api.anthropic.com";
/** Models on the adaptive-thinking API surface (no sampling params). */
const ADAPTIVE = /(opus-4-[6-9]|sonnet-4-6|sonnet-5|fable-5|mythos)/;

function client(cfg: ProviderRuntime): Anthropic {
  return new Anthropic({
    apiKey: cfg.apiKey,
    ...(cfg.baseUrl && cfg.baseUrl !== DEFAULT_BASE ? { baseURL: cfg.baseUrl } : {}),
    timeout: cfg.timeoutMs,
    maxRetries: 0, // retries/failover belong to the orchestrator, not the SDK
  });
}

function toAnthropicMessages(req: ChatRequest): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  for (const m of req.messages) {
    if (m.role === "system") continue; // carried via top-level `system`
    if (m.role === "tool") {
      out.push({
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: m.toolCallId ?? "", content: m.content },
        ],
      });
    } else if (m.role === "assistant" && m.toolCalls?.length) {
      const blocks: Anthropic.ContentBlockParam[] = [];
      if (m.content) blocks.push({ type: "text", text: m.content });
      for (const c of m.toolCalls) {
        let input: unknown = {};
        try {
          input = JSON.parse(c.arguments || "{}");
        } catch {
          /* keep {} */
        }
        blocks.push({ type: "tool_use", id: c.id, name: c.name, input });
      }
      out.push({ role: "assistant", content: blocks });
    } else {
      out.push({ role: m.role, content: m.content });
    }
  }
  return out;
}

export const anthropicAdapter: ProviderAdapter = {
  id: "anthropic",

  async listModels(cfg) {
    const ids: string[] = [];
    for await (const m of client(cfg).models.list()) ids.push(m.id);
    return ids.sort();
  },

  async *chat(req, cfg): AsyncGenerator<StreamEvent> {
    const adaptive = ADAPTIVE.test(req.model);
    const params: Anthropic.MessageStreamParams = {
      model: req.model,
      max_tokens: req.maxTokens ?? 8192,
      messages: toAnthropicMessages(req),
      ...(req.system ? { system: req.system } : {}),
      ...(adaptive ? { thinking: { type: "adaptive" as const } } : {}),
      ...(!adaptive && req.temperature != null ? { temperature: req.temperature } : {}),
      ...(req.tools?.length
        ? {
            tools: req.tools.map((t) => ({
              name: t.name,
              description: t.description,
              input_schema: t.parameters as Anthropic.Tool.InputSchema,
            })),
          }
        : {}),
    };

    let stream: ReturnType<Anthropic["messages"]["stream"]>;
    try {
      stream = client(cfg).messages.stream(params, { signal: req.signal });
    } catch (e) {
      throw wrap(e);
    }

    try {
      for await (const event of stream) {
        if (event.type === "content_block_delta") {
          if (event.delta.type === "text_delta") {
            yield { type: "text", delta: event.delta.text };
          } else if (event.delta.type === "thinking_delta") {
            yield { type: "reasoning", delta: event.delta.thinking };
          }
        }
      }
      const final = await stream.finalMessage();
      for (const block of final.content) {
        if (block.type === "tool_use") {
          yield {
            type: "tool_call",
            call: { id: block.id, name: block.name, arguments: JSON.stringify(block.input) },
          };
        }
      }
      yield {
        type: "usage",
        inputTokens: final.usage.input_tokens,
        outputTokens: final.usage.output_tokens,
      };
      yield { type: "done", finishReason: final.stop_reason ?? "end_turn" };
    } catch (e) {
      throw wrap(e);
    }
  },
};

function wrap(e: unknown): ProviderError {
  if (e instanceof Anthropic.APIError) {
    return new ProviderError(`Anthropic ${e.status}: ${e.message.slice(0, 300)}`, e.status);
  }
  return e instanceof ProviderError ? e : new ProviderError(String(e));
}
