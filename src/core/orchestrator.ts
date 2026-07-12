/**
 * ORCHESTRATOR — the reliability engine.
 *
 * Walks an ordered list of (provider, model) candidates. On rate limits,
 * outages, timeouts, bad requests or stream interruptions it fails over to the
 * next candidate; the UI sees a `restart` and the switch is invisible to the
 * user. Providers that fail get a class-appropriate cooldown so the next
 * request doesn't re-try a dead provider.
 *
 * Failover policy for mid-stream failures: if meaningful output has already
 * been shown (> PARTIAL_KEEP_CHARS), we keep the partial and surface a retry
 * option instead of silently restarting with a possibly-different answer.
 */
import { getAdapter } from "./providers";
import { classifyError, ChatRequest, ErrorClass, StreamEvent } from "./types";
import type { ProviderRuntime } from "./types";

export interface Candidate {
  key: string; // provider row id — cooldown scope
  providerName: string;
  adapter: string;
  model: string;
  runtime: ProviderRuntime;
}

export type OrchestratorEvent =
  | { type: "provider"; provider: string; model: string; attempt: number }
  | { type: "restart" } // partial output discarded, next candidate starting
  | { type: "stream"; event: StreamEvent }
  | { type: "failed"; message: string; errorClass: ErrorClass; partial: boolean };

const PARTIAL_KEEP_CHARS = 300;

const COOLDOWN_MS: Record<ErrorClass, number> = {
  auth: 10 * 60_000,
  rate_limit: 30_000,
  server: 60_000,
  timeout: 60_000,
  network: 30_000,
  bad_request: 0, // usually model/param-specific — don't punish the provider
  aborted: 0,
};

// Module-level health map. Single-process state: perfect for the dev server
// and single-node deploys; swap for a shared store (Redis/pg) when scaling out.
const cooldowns = new Map<string, { until: number; reason: string }>();

/** Clear a provider's cooldown — call when its credentials/config change. */
export function clearCooldown(key: string) {
  cooldowns.delete(key);
}

export function providerHealth(): Array<{ key: string; until: number; reason: string }> {
  const now = Date.now();
  return [...cooldowns.entries()]
    .filter(([, v]) => v.until > now)
    .map(([key, v]) => ({ key, ...v }));
}

function coolDown(key: string, clazz: ErrorClass, detail: string) {
  const ms = COOLDOWN_MS[clazz];
  if (ms > 0) cooldowns.set(key, { until: Date.now() + ms, reason: `${clazz}: ${detail}` });
}

export async function* orchestrate(
  candidates: Candidate[],
  req: Omit<ChatRequest, "model">,
): AsyncGenerator<OrchestratorEvent> {
  let lastError = "No enabled providers are available.";
  let lastClass: ErrorClass = "network";
  let attempt = 0;

  for (const c of candidates) {
    const cooling = cooldowns.get(c.key);
    if (cooling && cooling.until > Date.now()) continue;

    let emitted = 0;
    yield { type: "provider", provider: c.providerName, model: c.model, attempt: attempt++ };

    try {
      const adapter = getAdapter(c.adapter);
      for await (const ev of adapter.chat({ ...req, model: c.model }, c.runtime)) {
        if (ev.type === "text") emitted += ev.delta.length;
        yield { type: "stream", event: ev };
      }
      cooldowns.delete(c.key); // success clears any stale cooldown
      return;
    } catch (e) {
      if (req.signal?.aborted) return; // user pressed stop — not a failure

      const clazz = classifyError(e);
      const detail = e instanceof Error ? e.message : String(e);
      lastError = `${c.providerName} (${c.model}): ${detail}`;
      lastClass = clazz;
      coolDown(c.key, clazz, detail.slice(0, 200));

      if (emitted > PARTIAL_KEEP_CHARS) {
        // Keep what the user already read; let them retry explicitly.
        yield { type: "failed", message: lastError, errorClass: clazz, partial: true };
        return;
      }
      yield { type: "restart" }; // clean slate, next candidate
    }
  }

  yield { type: "failed", message: lastError, errorClass: lastClass, partial: false };
}
