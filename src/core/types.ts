/**
 * CORE TYPES — the provider-agnostic contract.
 *
 * Everything above this layer (orchestrator, API routes, UI) speaks ONLY these
 * types. Everything below (adapters) translates them to a specific provider's
 * wire format. Adding a provider = implementing ProviderAdapter, nothing else.
 */

export type Role = "system" | "user" | "assistant" | "tool";

export interface ToolCall {
  id: string;
  name: string;
  /** JSON-encoded arguments, exactly as produced by the model. */
  arguments: string;
}

export interface ToolDef {
  name: string;
  description: string;
  /** JSON Schema for the tool input. */
  parameters: Record<string, unknown>;
}

export interface ChatMessage {
  role: Role;
  content: string;
  toolCalls?: ToolCall[];
  /** For role:"tool" — which call this result answers. */
  toolCallId?: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  system?: string;
  maxTokens?: number;
  temperature?: number;
  jsonMode?: boolean;
  tools?: ToolDef[];
  signal?: AbortSignal;
}

/** Unified streaming events every adapter must emit. */
export type StreamEvent =
  | { type: "text"; delta: string }
  | { type: "reasoning"; delta: string }
  | { type: "tool_call"; call: ToolCall }
  | { type: "usage"; inputTokens: number; outputTokens: number }
  | { type: "done"; finishReason: string };

/** Per-request runtime config resolved from the DB (key already decrypted). */
export interface ProviderRuntime {
  baseUrl: string;
  apiKey?: string;
  timeoutMs: number;
  headers?: Record<string, string>;
}

export interface ProviderAdapter {
  id: string;
  chat(req: ChatRequest, cfg: ProviderRuntime): AsyncGenerator<StreamEvent>;
  listModels(cfg: ProviderRuntime): Promise<string[]>;
}

/* ----------------------------- error taxonomy ---------------------------- */

export type ErrorClass =
  | "auth" // 401/403 — bad key; long cooldown
  | "rate_limit" // 429 — short cooldown, fail over
  | "server" // 5xx — provider outage
  | "timeout"
  | "network"
  | "bad_request" // 400 — usually model/param specific; fail over, no cooldown
  | "aborted";

export class ProviderError extends Error {
  constructor(
    message: string,
    public status?: number,
    public detail?: string,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export function classifyError(e: unknown): ErrorClass {
  if (e instanceof Error && e.name === "AbortError") return "aborted";
  if (e instanceof Error && e.name === "TimeoutError") return "timeout";
  const status =
    e instanceof ProviderError
      ? e.status
      : typeof e === "object" && e !== null && "status" in e
        ? Number((e as { status: unknown }).status)
        : undefined;
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limit";
  if (status !== undefined && status >= 500) return "server";
  if (status !== undefined && status >= 400) return "bad_request";
  return "network";
}
