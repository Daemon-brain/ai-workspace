/**
 * PROVIDER CATALOG — presets that make "add a provider" a one-field form.
 *
 * Two adapter families cover the whole list:
 *  - "openai-compat": any provider speaking the OpenAI chat-completions API
 *    (that is most of the industry, including Gemini's compatibility endpoint
 *    and local runtimes like Ollama / LM Studio).
 *  - "anthropic": the official Anthropic SDK (Messages API — richer streaming,
 *    adaptive thinking, first-class tool use).
 *
 * Models are NOT hardcoded: on provider creation the adapter's listModels()
 * fetches the live list. `defaultModelPattern` picks a sensible default from
 * whatever comes back, so new model launches need no code change.
 *
 * Cloud-IAM providers (Bedrock, Vertex, Azure) need per-cloud auth flows and
 * are planned as dedicated adapters — see README roadmap.
 */

export interface CatalogEntry {
  id: string;
  label: string;
  adapter: "openai-compat" | "anthropic";
  baseUrl: string;
  keyless?: boolean;
  keyHint?: string;
  defaultModelPattern: string; // regex source, first listModels() match becomes default
  docsUrl: string;
}

export const CATALOG: CatalogEntry[] = [
  {
    id: "anthropic",
    label: "Anthropic",
    adapter: "anthropic",
    baseUrl: "https://api.anthropic.com",
    keyHint: "sk-ant-…",
    defaultModelPattern: "^claude-opus-4-8",
    docsUrl: "https://platform.claude.com",
  },
  {
    id: "openai",
    label: "OpenAI",
    adapter: "openai-compat",
    baseUrl: "https://api.openai.com/v1",
    keyHint: "sk-…",
    defaultModelPattern: "^gpt-5(?!.*(mini|nano|audio|realtime|image))",
    docsUrl: "https://platform.openai.com",
  },
  {
    id: "google",
    label: "Google Gemini",
    adapter: "openai-compat",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    keyHint: "AIza…",
    defaultModelPattern: "gemini-.*(pro|flash)(?!.*(image|tts|live|embed))",
    docsUrl: "https://ai.google.dev",
  },
  {
    id: "groq",
    label: "Groq",
    adapter: "openai-compat",
    baseUrl: "https://api.groq.com/openai/v1",
    keyHint: "gsk_…",
    defaultModelPattern: "llama-3\\.3-70b|llama-4",
    docsUrl: "https://console.groq.com",
  },
  {
    id: "cerebras",
    label: "Cerebras",
    adapter: "openai-compat",
    baseUrl: "https://api.cerebras.ai/v1",
    keyHint: "csk-…",
    defaultModelPattern: "gpt-oss-120b|llama-3\\.3-70b",
    docsUrl: "https://cloud.cerebras.ai",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    adapter: "openai-compat",
    baseUrl: "https://openrouter.ai/api/v1",
    keyHint: "sk-or-…",
    defaultModelPattern: "anthropic/claude|openai/gpt",
    docsUrl: "https://openrouter.ai",
  },
  {
    id: "mistral",
    label: "Mistral",
    adapter: "openai-compat",
    baseUrl: "https://api.mistral.ai/v1",
    defaultModelPattern: "mistral-large|mistral-medium",
    docsUrl: "https://console.mistral.ai",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    adapter: "openai-compat",
    baseUrl: "https://api.deepseek.com/v1",
    defaultModelPattern: "deepseek-chat",
    docsUrl: "https://platform.deepseek.com",
  },
  {
    id: "xai",
    label: "xAI",
    adapter: "openai-compat",
    baseUrl: "https://api.x.ai/v1",
    defaultModelPattern: "grok-[0-9]+(?!.*(mini|image|vision))",
    docsUrl: "https://console.x.ai",
  },
  {
    id: "together",
    label: "Together AI",
    adapter: "openai-compat",
    baseUrl: "https://api.together.xyz/v1",
    defaultModelPattern: "Llama-3\\.3-70B|Llama-4",
    docsUrl: "https://api.together.ai",
  },
  {
    id: "fireworks",
    label: "Fireworks",
    adapter: "openai-compat",
    baseUrl: "https://api.fireworks.ai/inference/v1",
    defaultModelPattern: "llama-v3p3-70b|llama4",
    docsUrl: "https://fireworks.ai",
  },
  {
    id: "ollama",
    label: "Ollama (local)",
    adapter: "openai-compat",
    baseUrl: "http://localhost:11434/v1",
    keyless: true,
    defaultModelPattern: ".*",
    docsUrl: "https://ollama.com",
  },
  {
    id: "lmstudio",
    label: "LM Studio (local)",
    adapter: "openai-compat",
    baseUrl: "http://localhost:1234/v1",
    keyless: true,
    defaultModelPattern: ".*",
    docsUrl: "https://lmstudio.ai",
  },
];

export function catalogEntry(id: string): CatalogEntry | undefined {
  return CATALOG.find((c) => c.id === id);
}
