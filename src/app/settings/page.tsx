"use client";

/**
 * SETTINGS — provider administration.
 * Add/remove providers, set keys, enable/disable, priority (failover order),
 * default model, per-model enablement, live test (auth latency + streaming
 * first-token), cooldown/health display, 7-day usage.
 */
import { useCallback, useEffect, useState } from "react";

interface CatalogItem {
  id: string;
  label: string;
  keyless: boolean;
  keyHint: string | null;
  baseUrl: string;
  docsUrl: string;
}
interface ModelRow {
  id: string;
  modelId: string;
  enabled: boolean;
  isDefault: boolean;
}
interface Provider {
  id: string;
  catalogId: string;
  name: string;
  adapter: string;
  baseUrl: string;
  enabled: boolean;
  priority: number;
  maskedKey: string | null;
  cooldown: { until: number; reason: string } | null;
  models: ModelRow[];
}
interface UsageRow {
  provider: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  errors: number;
  avgLatencyMs: number;
}
type TestResult = {
  ok: boolean;
  stage?: string;
  error?: string;
  latencyMs?: number;
  modelCount?: number;
  defaultModel?: string | null;
  firstTokenMs?: number | null;
  streamError?: string | null;
};

export default function Settings() {
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [usage, setUsage] = useState<UsageRow[]>([]);
  const [tests, setTests] = useState<Record<string, TestResult | "running">>({});
  // add form
  const [addOpen, setAddOpen] = useState(false);
  const [catalogId, setCatalogId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [addMsg, setAddMsg] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    const [p, u] = await Promise.all([fetch("/api/providers"), fetch("/api/usage")]);
    if (p.ok) setProviders(await p.json());
    if (u.ok) setUsage(await u.json());
  }, []);

  useEffect(() => {
    fetch("/api/catalog").then((r) => r.json()).then(setCatalog);
    load();
  }, [load]);

  const selected = catalog.find((c) => c.id === catalogId);

  const addProvider = async () => {
    if (!catalogId) return;
    setAdding(true);
    setAddMsg(null);
    const r = await fetch("/api/providers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        catalogId,
        apiKey: apiKey.trim() || undefined,
        baseUrl: baseUrl.trim() || undefined,
      }),
    });
    const data = await r.json();
    setAdding(false);
    if (!r.ok) {
      setAddMsg(`✗ ${data.error}`);
      return;
    }
    setAddMsg(
      `✓ ${data.name} added (${data.modelCount} models)` + (data.warning ? ` — ${data.warning}` : ""),
    );
    setApiKey("");
    setBaseUrl("");
    setCatalogId("");
    load();
  };

  const patch = async (id: string, body: Record<string, unknown>) => {
    await fetch(`/api/providers/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    load();
  };

  const removeProvider = async (p: Provider) => {
    if (!confirm(`Remove ${p.name}? Its key and model list will be deleted.`)) return;
    await fetch(`/api/providers/${p.id}`, { method: "DELETE" });
    load();
  };

  const runTest = async (p: Provider) => {
    setTests((t) => ({ ...t, [p.id]: "running" }));
    const r = await fetch(`/api/providers/${p.id}/test`, { method: "POST" });
    setTests((t) => ({ ...t, [p.id]: r.ok ? (r.json() as never) : { ok: false, error: `HTTP ${r.status}` } }));
    if (r.ok) {
      const data = await r.json();
      setTests((t) => ({ ...t, [p.id]: data }));
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="hero text-2xl font-semibold">Settings</h1>
        <a href="/" className="text-sm text-blue-600 hover:underline dark:text-blue-400">
          ← Back to chat
        </a>
      </div>

      {/* ------------------------------ add form ------------------------------ */}
      <section className="mb-8 rounded-2xl border border-neutral-200 p-5 dark:border-neutral-800">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Providers</h2>
          <button
            onClick={() => setAddOpen(!addOpen)}
            className="rounded-lg bg-neutral-900 px-3 py-1.5 text-sm text-white dark:bg-neutral-100 dark:text-neutral-900"
          >
            {addOpen ? "Close" : "+ Add provider"}
          </button>
        </div>

        {addOpen && (
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap gap-2">
              {catalog.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setCatalogId(c.id)}
                  className={`rounded-full border px-3 py-1 text-sm ${
                    catalogId === c.id
                      ? "border-blue-600 bg-blue-600 text-white"
                      : "border-neutral-300 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
            {selected && (
              <div className="space-y-2">
                {!selected.keyless && (
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={`API key ${selected.keyHint ? `(${selected.keyHint})` : ""}`}
                    className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
                  />
                )}
                <input
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder={`Base URL (default: ${selected.baseUrl})`}
                  className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
                />
                <div className="flex items-center gap-3">
                  <button
                    onClick={addProvider}
                    disabled={adding || (!selected.keyless && !apiKey.trim())}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-40"
                  >
                    {adding ? "Validating…" : "Add & import models"}
                  </button>
                  <a href={selected.docsUrl} target="_blank" className="text-xs text-neutral-500 hover:underline">
                    Get a key ↗
                  </a>
                </div>
              </div>
            )}
            {addMsg && <p className="text-sm">{addMsg}</p>}
          </div>
        )}

        {/* ---------------------------- provider cards --------------------------- */}
        <div className="mt-5 space-y-4">
          {providers.map((p) => (
            <ProviderCard
              key={p.id}
              p={p}
              test={tests[p.id]}
              onPatch={(body) => patch(p.id, body)}
              onRemove={() => removeProvider(p)}
              onTest={() => runTest(p)}
            />
          ))}
          {!providers.length && (
            <p className="text-sm text-neutral-500">
              No providers yet — add one above to start chatting.
            </p>
          )}
        </div>
      </section>

      {/* -------------------------------- usage -------------------------------- */}
      <section className="rounded-2xl border border-neutral-200 p-5 dark:border-neutral-800">
        <h2 className="mb-3 text-lg font-medium">Usage (last 7 days)</h2>
        {usage.length ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-neutral-500 dark:border-neutral-800">
                <th className="py-1.5">Provider</th>
                <th>Requests</th>
                <th>Input tok</th>
                <th>Output tok</th>
                <th>Errors</th>
                <th>Avg latency</th>
              </tr>
            </thead>
            <tbody>
              {usage.map((u) => (
                <tr key={u.provider} className="border-b border-neutral-100 dark:border-neutral-900">
                  <td className="py-1.5">{u.provider}</td>
                  <td>{u.requests}</td>
                  <td>{u.inputTokens.toLocaleString()}</td>
                  <td>{u.outputTokens.toLocaleString()}</td>
                  <td className={u.errors ? "text-red-600" : ""}>{u.errors}</td>
                  <td>{u.avgLatencyMs} ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-neutral-500">No usage yet.</p>
        )}
      </section>
    </div>
  );
}

/* ------------------------------ provider card ------------------------------ */
function ProviderCard({
  p,
  test,
  onPatch,
  onRemove,
  onTest,
}: {
  p: Provider;
  test?: TestResult | "running";
  onPatch: (body: Record<string, unknown>) => void;
  onRemove: () => void;
  onTest: () => void;
}) {
  const [showModels, setShowModels] = useState(false);
  const cooling = p.cooldown && p.cooldown.until > Date.now();
  const defaultRow = p.models.find((m) => m.isDefault);

  return (
    <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
      <div className="flex flex-wrap items-center gap-3">
        <span
          title={cooling ? p.cooldown!.reason : p.enabled ? "Healthy" : "Disabled"}
          className={`h-2.5 w-2.5 rounded-full ${
            !p.enabled ? "bg-neutral-400" : cooling ? "bg-amber-500" : "bg-emerald-500"
          }`}
        />
        <span className="font-medium">{p.name}</span>
        <span className="text-xs text-neutral-500">{p.maskedKey ?? "no key"}</span>
        {cooling && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">
            cooling down
          </span>
        )}
        <span className="ml-auto flex items-center gap-2 text-xs">
          <label className="flex items-center gap-1">
            priority
            <input
              type="number"
              defaultValue={p.priority}
              onBlur={(e) => onPatch({ priority: Number(e.target.value) })}
              className="w-16 rounded border border-neutral-300 bg-white px-1.5 py-0.5 dark:border-neutral-700 dark:bg-neutral-900"
            />
          </label>
          <button
            onClick={() => onPatch({ enabled: !p.enabled })}
            className={`rounded-lg px-2.5 py-1 ${
              p.enabled
                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                : "bg-neutral-200 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400"
            }`}
          >
            {p.enabled ? "Enabled" : "Disabled"}
          </button>
          <button onClick={onTest} className="rounded-lg border border-neutral-300 px-2.5 py-1 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800">
            {test === "running" ? "Testing…" : "Test"}
          </button>
          <button onClick={onRemove} className="rounded-lg border border-red-300 px-2.5 py-1 text-red-600 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950">
            Remove
          </button>
        </span>
      </div>

      {test && test !== "running" && (
        <p className={`mt-2 text-xs ${test.ok ? "text-emerald-600" : "text-red-600"}`}>
          {test.ok
            ? `✓ auth ${test.latencyMs}ms · ${test.modelCount} models · first token ${test.firstTokenMs ?? "–"}ms (${test.defaultModel})`
            : `✗ ${test.error ?? test.streamError}`}
        </p>
      )}

      <div className="mt-2 text-xs text-neutral-500">
        default:{" "}
        <select
          value={defaultRow?.id ?? ""}
          onChange={(e) => onPatch({ defaultModelRowId: e.target.value })}
          className="rounded border border-neutral-300 bg-white px-1.5 py-0.5 dark:border-neutral-700 dark:bg-neutral-900"
        >
          {p.models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.modelId}
            </option>
          ))}
        </select>
        <button onClick={() => setShowModels(!showModels)} className="ml-3 hover:underline">
          {showModels ? "hide models" : `models (${p.models.filter((m) => m.enabled).length}/${p.models.length} enabled)`}
        </button>
      </div>

      {showModels && (
        <div className="mt-2 grid max-h-56 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2">
          {p.models.map((m) => (
            <label key={m.id} className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={m.enabled}
                onChange={(e) => onPatch({ modelToggles: [{ id: m.id, enabled: e.target.checked }] })}
              />
              <span className="truncate">{m.modelId}</span>
              {m.isDefault && <span className="text-neutral-400">(default)</span>}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
