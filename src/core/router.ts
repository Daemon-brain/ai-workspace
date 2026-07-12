/**
 * SMART MODEL ROUTER (v1: deterministic heuristics)
 *
 * When the user picks "Auto", the router classifies the prompt and re-ranks
 * the candidate chain so the best-suited model goes first — failover order is
 * preserved behind it. Rules are data (regex preference lists), overridable
 * per-user via the settings table (key: "routing"), so behavior is
 * configurable without code changes.
 *
 * v2 (roadmap): tiny-model classification + cost/quality/speed weights.
 */
import type { Candidate } from "./orchestrator";

export type TaskClass = "coding" | "reasoning" | "long-context" | "general";

export type RoutingRules = Record<TaskClass, string[]>; // regex sources, best first

export const DEFAULT_ROUTING: RoutingRules = {
  coding: ["sonnet", "opus", "gpt-5", "deepseek", "coder", "grok"],
  reasoning: ["opus", "fable", "gpt-5", "sonnet", "r1|reasoner", "gemini.*pro"],
  "long-context": ["gemini", "claude", "gpt-5", "llama-4"],
  general: ["llama", "haiku", "flash", "gpt-5.*mini", "sonnet", "gpt"],
};

export function classifyPrompt(content: string, historyChars: number): TaskClass {
  if (historyChars > 60_000) return "long-context";
  if (/```|\bstack ?trace\b|\berror:|\bfunction\b|\bimport\b|\bclass\b|\bdef\b|\bconst\b|\brefactor\b|\bdebug\b/i.test(content)) {
    return "coding";
  }
  if (
    content.length > 600 ||
    /\bprove\b|\banalyz|\banalys|\bstep.by.step\b|\bstrateg|\bcompare\b|\btrade-?offs?\b|\bwhy\b.{40,}/i.test(content)
  ) {
    return "reasoning";
  }
  return "general";
}

/** Stable re-rank: score by rule position, ties keep provider priority order. */
export function rankCandidates(
  candidates: Candidate[],
  cls: TaskClass,
  rules: RoutingRules = DEFAULT_ROUTING,
): Candidate[] {
  const prefs = rules[cls] ?? [];
  const score = (modelId: string): number => {
    for (let i = 0; i < prefs.length; i++) {
      try {
        if (new RegExp(prefs[i], "i").test(modelId)) return prefs.length - i;
      } catch {
        /* ignore invalid user-provided regex */
      }
    }
    return 0;
  };
  return [...candidates].sort((a, b) => score(b.model) - score(a.model));
}
