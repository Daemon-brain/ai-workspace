/**
 * OPENAI-COMPATIBLE ADAPTER
 *
 * One adapter for every provider speaking the OpenAI chat-completions wire
 * format: OpenAI, Groq, Cerebras, Gemini (compat endpoint), Mistral, DeepSeek,
 * xAI, Together, Fireworks, OpenRouter, Ollama, LM Studio, …
 *
 * Uses fetch directly (no per-provider SDK) so the module stays light and the
 * base URL is fully configurable.
 */
import {
  ChatMessage,
  ChatRequest,
  ProviderAdapter,
  ProviderError,
  ProviderRuntime,
  StreamEvent,
  ToolCall,
} from "../types";

function headers(cfg: ProviderRuntime): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
    ...cfg.headers,
  };
}

function combineSignals(cfg: ProviderRuntime, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(cfg.timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

/** Map unified messages to OpenAI wire messages. */
function toWire(req: ChatRequest): Array<Record<string, unknown>> {
  const wire: Array<Record<string, unknown>> = [];
  if (req.system) wire.push({ role: "system", content: req.system });
  for (const m of req.messages) {
    if (m.role === "tool") {
      wire.push({ role: "tool", tool_call_id: m.toolCallId, content: m.content });
    } else if (m.role === "assistant" && m.toolCalls?.length) {
      wire.push({
        role: "assistant",
        content: m.content || null,
        tool_calls: m.toolCalls.map((c) => ({
          id: c.id,
          type: "function",
          function: { name: c.name, arguments: c.arguments },
        })),
      });
    } else {
      wire.push({ role: m.role, content: m.content });
    }
  }
  return wire;
}

function buildBody(req: ChatRequest, includeUsageOption: boolean): Record<string, unknown> {
  return {
    model: req.model,
    messages: toWire(req),
    stream: true,
    ...(includeUsageOption ? { stream_options: { include_usage: true } } : {}),
    ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
    ...(req.temperature != null ? { temperature: req.temperature } : {}),
    ...(req.jsonMode ? { response_format: { type: "json_object" } } : {}),
    ...(req.tools?.length
      ? {
          tools: req.tools.map((t) => ({
            type: "function",
            function: { name: t.name, description: t.description, parameters: t.parameters },
          })),
        }
      : {}),
  };
}

async function requestStream(req: ChatRequest, cfg: ProviderRuntime): Promise<Response> {
  const signal = combineSignals(cfg, req.signal);
  const post = (body: Record<string, unknown>) =>
    fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: headers(cfg),
      body: JSON.stringify(body),
      signal,
    });

  let res = await post(buildBody(req, true));
  if (res.status === 400) {
    // A few providers reject stream_options; retry once without it.
    const text = await res.text();
    if (/stream_options/i.test(text)) {
      res = await post(buildBody(req, false));
    } else {
      throw new ProviderError(`HTTP 400: ${text.slice(0, 300)}`, 400);
    }
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ProviderError(`HTTP ${res.status}: ${text.slice(0, 300)}`, res.status);
  }
  if (!res.body) throw new ProviderError("Empty response body", res.status);
  return res;
}

export const openaiCompat: ProviderAdapter = {
  id: "openai-compat",

  async listModels(cfg) {
    const res = await fetch(`${cfg.baseUrl}/models`, {
      headers: headers(cfg),
      signal: AbortSignal.timeout(Math.min(cfg.timeoutMs, 15000)),
    });
    if (!res.ok) {
      throw new ProviderError(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`, res.status);
    }
    const json = (await res.json()) as { data?: Array<{ id: string }> };
    return (json.data ?? []).map((m) => m.id).sort();
  },

  async *chat(req, cfg): AsyncGenerator<StreamEvent> {
    const res = await requestStream(req, cfg);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    let buffer = "";
    let finishReason = "stop";
    // Tool calls arrive as fragments keyed by index; accumulate then emit.
    const toolAcc = new Map<number, ToolCall>();
    let usage: { inputTokens: number; outputTokens: number } | null = null;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let nl: number;
        while ((nl = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (payload === "[DONE]") continue;

          let chunk: {
            choices?: Array<{
              delta?: {
                content?: string | null;
                reasoning?: string | null;
                tool_calls?: Array<{
                  index: number;
                  id?: string;
                  function?: { name?: string; arguments?: string };
                }>;
              };
              finish_reason?: string | null;
            }>;
            usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
          };
          try {
            chunk = JSON.parse(payload);
          } catch {
            continue; // tolerate malformed keep-alives
          }

          const choice = chunk.choices?.[0];
          if (choice?.delta?.content) yield { type: "text", delta: choice.delta.content };
          if (choice?.delta?.reasoning) yield { type: "reasoning", delta: choice.delta.reasoning };
          for (const tc of choice?.delta?.tool_calls ?? []) {
            const acc = toolAcc.get(tc.index) ?? { id: "", name: "", arguments: "" };
            if (tc.id) acc.id = tc.id;
            if (tc.function?.name) acc.name += tc.function.name;
            if (tc.function?.arguments) acc.arguments += tc.function.arguments;
            toolAcc.set(tc.index, acc);
          }
          if (choice?.finish_reason) finishReason = choice.finish_reason;
          if (chunk.usage) {
            usage = {
              inputTokens: chunk.usage.prompt_tokens ?? 0,
              outputTokens: chunk.usage.completion_tokens ?? 0,
            };
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    for (const call of toolAcc.values()) yield { type: "tool_call", call };
    if (usage) yield { type: "usage", ...usage };
    yield { type: "done", finishReason };
  },
};
