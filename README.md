# AI Workspace

A **drop-in, provider-agnostic AI workspace module**: one assistant backed by any
combination of LLM providers, with automatic failover, smart model routing, and a
Claude-style chat experience. Embed it in any web application — the host app owns
authentication; this module owns everything AI.

> ⚠️ **Security notice — read before deploying.** This module has **no built-in
> authentication**: it trusts the `x-workspace-user` header from the host app
> (see *Embedding contract*). If you expose a deployment publicly without putting
> your own auth in front of it, anyone who reaches it can spend **your provider
> API keys**. Put it behind your host app's login (or a reverse proxy with auth),
> keep `WORKSPACE_SECRET` private, and never commit `.env`.

**Core principle: the user never thinks about providers.** The orchestration layer
decides which provider/model serves each request, when to retry, when to switch,
and how to recover — invisibly.

---

## Quickstart

```bash
# prerequisites: Node 20+, Postgres
createdb ai_workspace
cp .env.example .env        # set DATABASE_URL + WORKSPACE_SECRET (openssl rand -hex 32)
npm install
npm run db:push             # create the aiw_* tables
npm run dev                 # http://localhost:3002
```

Open **Settings → Add provider**, pick a provider, paste its API key. The module
validates the key, imports the live model list, and picks a sensible default.
Then chat.

## Architecture

```
┌────────────────────────  UI (Next.js app router)  ───────────────────────┐
│  Chat (streaming, stop/regenerate/copy, reasoning, model picker)         │
│  Settings (providers, keys, priority, tests, health, usage)              │
└──────────────────────────────────┬────────────────────────────────────────┘
                                   │ SSE / JSON
┌──────────────────────────────────▼────────────────────────────────────────┐
│  API routes (/api/*) — thin, DB-aware, host-auth via x-workspace-user     │
└──────────────────────────────────┬────────────────────────────────────────┘
┌──────────────────────────────────▼────────────────────────────────────────┐
│  CORE (src/core — no framework imports, portable)                         │
│   orchestrator  candidates → try → classify error → cooldown → failover   │
│   router        prompt classification → model ranking (configurable)      │
│   adapters      openai-compat (≈12 providers) · anthropic (official SDK)  │
│   crypto        AES-256-GCM key encryption at rest                        │
└──────────────────────────────────┬────────────────────────────────────────┘
                          Postgres (aiw_* tables, Drizzle ORM)
```

**Adding a provider family = one adapter file + one registry line**
(`src/core/providers/`). Everything above adapters speaks unified types
(`ChatRequest`, `StreamEvent`) — zero provider-specific logic leaks upward.

### Failover semantics

- Errors are classified (`auth`, `rate_limit`, `server`, `timeout`, `network`,
  `bad_request`) and each class sets a proportionate provider cooldown
  (auth 10 min … rate limit 30 s; bad request none).
- Failures before meaningful output (≤300 chars) fail over silently — the UI
  gets a `restart` event and a clean answer from the next provider.
- Failures after meaningful output keep the partial text and surface a retry —
  never silently replace what the user already read.
- Fixing a key or re-enabling a provider clears its cooldown immediately.

### Smart routing (`model: "auto"`)

Prompts are classified (`coding` / `reasoning` / `long-context` / `general`) and
the candidate chain is re-ranked by per-class model preference lists — data, not
code; per-user overridable via the `aiw_settings` key `routing`.

## Embedding contract

| Concern | Contract |
|---|---|
| Identity | Host app authenticates, forwards `x-workspace-user: <id>` on every request. No header = single-user `local` mode. |
| Database | All tables prefixed `aiw_` — safe to point at the host's Postgres. |
| Secrets | Provider keys AES-256-GCM-encrypted with `WORKSPACE_SECRET`; only masked previews ever leave the server. |
| UI | Mount the app under any route or consume the API from your own frontend. |

## API

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/chat` | POST | Stream a reply (SSE). Body: `{conversationId?, content?, model?, regenerate?}`. Events: `start, provider, restart, delta, reasoning, error, done` |
| `/api/conversations` | GET | List (pinned first) |
| `/api/conversations/:id` | GET/PATCH/DELETE | Messages / rename+pin / delete |
| `/api/providers` | GET/POST | List (masked keys, health) / add + import live model list |
| `/api/providers/:id` | PATCH/DELETE | enabled, priority, key, default model, model toggles / remove |
| `/api/providers/:id/test` | POST | Auth latency + streaming first-token diagnostics |
| `/api/models` | GET | Enabled (provider, model) pairs for pickers |
| `/api/catalog` | GET | Provider presets for the add form |
| `/api/search?q=` | GET | Conversations by title/content |
| `/api/usage` | GET | 7-day per-provider totals |
| `/api/health` | GET | DB liveness + provider cooldowns |

## Provider coverage

Via **openai-compat** adapter: OpenAI, Groq, Cerebras, Google Gemini (compat
endpoint), Mistral, DeepSeek, xAI, Together, Fireworks, OpenRouter, Ollama,
LM Studio — and any other OpenAI-compatible endpoint via custom base URL.
Via **anthropic** adapter: Anthropic (official SDK; adaptive thinking streamed
as collapsible reasoning).

## Roadmap (spec → milestones)

- **M1 (this)** — provider engine, orchestration/failover, routing, streaming
  chat, conversations, provider admin, usage/health. ✅
- **M2** — Projects (own instructions/conversations), reusable system prompts,
  file upload + RAG (pgvector; schema already Postgres-native), semantic search.
- **M3** — Tools/MCP registry (adapter plumbing for tool calling already
  streams `tool_call` events end-to-end), Skills, memory levels.
- **M4** — Artifacts, vision/multimodal, command palette, cloud-IAM providers
  (Bedrock/Vertex/Azure adapters), multi-instance health store, RBAC/audit.

## Development

```bash
npm run typecheck   # strict TS across core + API + UI
npm run db:push     # sync schema changes
```
