/**
 * ADAPTER REGISTRY — adding a provider family = one import + one line here.
 */
import { ProviderAdapter } from "../types";
import { anthropicAdapter } from "./anthropic";
import { openaiCompat } from "./openai-compat";

export const ADAPTERS: Record<string, ProviderAdapter> = {
  [openaiCompat.id]: openaiCompat,
  [anthropicAdapter.id]: anthropicAdapter,
};

export function getAdapter(id: string): ProviderAdapter {
  const a = ADAPTERS[id];
  if (!a) throw new Error(`Unknown adapter: ${id}`);
  return a;
}
