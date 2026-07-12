"use client";

/**
 * WORKSPACE — Claude-style chat surface.
 * Streaming SSE client, stop/regenerate/copy, provider badge (visible
 * failover), collapsible reasoning, sidebar with search/rename/pin/delete,
 * model picker with Auto routing, dark/light theme.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Markdown } from "@/components/Markdown";

/* ---------------------------------- types --------------------------------- */
interface Conv {
  id: string;
  title: string;
  pinned: boolean;
  updatedAt: string;
}
interface Msg {
  id?: string;
  role: "user" | "assistant";
  content: string;
  reasoning?: string | null;
  provider?: string | null;
  model?: string | null;
  streaming?: boolean;
  error?: string | null;
}
interface ModelOpt {
  value: string;
  label: string;
  provider: string;
  isDefault: boolean;
}

/* --------------------------------- page ----------------------------------- */
export default function Workspace() {
  const [convs, setConvs] = useState<Conv[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [models, setModels] = useState<ModelOpt[]>([]);
  const [model, setModel] = useState("auto");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [dark, setDark] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  /* ------------------------------ data loading ----------------------------- */
  const loadConvs = useCallback(async (q?: string) => {
    const url = q ? `/api/search?q=${encodeURIComponent(q)}` : "/api/conversations";
    const r = await fetch(url);
    if (r.ok) setConvs(await r.json());
  }, []);

  useEffect(() => {
    loadConvs();
    fetch("/api/models")
      .then((r) => r.json())
      .then(setModels)
      .catch(() => {});
    setDark(document.documentElement.classList.contains("dark"));
  }, [loadConvs]);

  useEffect(() => {
    const t = setTimeout(() => loadConvs(query || undefined), 250);
    return () => clearTimeout(t);
  }, [query, loadConvs]);

  const openConv = useCallback(async (id: string) => {
    setActiveId(id);
    const r = await fetch(`/api/conversations/${id}`);
    if (r.ok) {
      const data = await r.json();
      setMsgs(data.messages);
    }
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs]);

  /* -------------------------------- streaming ------------------------------ */
  const stream = useCallback(
    async (body: Record<string, unknown>) => {
      setBusy(true);
      const ac = new AbortController();
      abortRef.current = ac;

      setMsgs((m) => [...m, { role: "assistant", content: "", streaming: true }]);
      const patch = (fn: (last: Msg) => Msg) =>
        setMsgs((m) => m.map((x, i) => (i === m.length - 1 ? fn(x) : x)));

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...body, model }),
          signal: ac.signal,
        });
        if (!res.ok || !res.body) {
          const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
          patch((l) => ({ ...l, streaming: false, error: err.error ?? "Request failed" }));
          return;
        }
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let idx;
          while ((idx = buf.indexOf("\n\n")) !== -1) {
            const line = buf.slice(0, idx).trim();
            buf = buf.slice(idx + 2);
            if (!line.startsWith("data:")) continue;
            const ev = JSON.parse(line.slice(5));
            switch (ev.type) {
              case "start":
                if (!body.conversationId) {
                  setActiveId(ev.conversationId);
                  body.conversationId = ev.conversationId;
                }
                break;
              case "provider":
                patch((l) => ({ ...l, provider: ev.provider, model: ev.model }));
                break;
              case "restart":
                patch((l) => ({ ...l, content: "", reasoning: "" }));
                break;
              case "delta":
                patch((l) => ({ ...l, content: l.content + ev.text }));
                break;
              case "reasoning":
                patch((l) => ({ ...l, reasoning: (l.reasoning ?? "") + ev.text }));
                break;
              case "error":
                patch((l) => ({ ...l, error: ev.message }));
                break;
              case "done":
                patch((l) => ({ ...l, streaming: false, id: ev.messageId }));
                break;
            }
          }
        }
      } catch (e) {
        if ((e as Error).name !== "AbortError") {
          patch((l) => ({ ...l, streaming: false, error: "Connection lost" }));
        } else {
          patch((l) => ({ ...l, streaming: false }));
        }
      } finally {
        setBusy(false);
        abortRef.current = null;
        loadConvs();
        inputRef.current?.focus();
      }
    },
    [model, loadConvs],
  );

  const send = useCallback(() => {
    const content = input.trim();
    if (!content || busy) return;
    setInput("");
    setMsgs((m) => [...m, { role: "user", content }]);
    stream({ conversationId: activeId ?? undefined, content });
  }, [input, busy, activeId, stream]);

  const regenerate = useCallback(() => {
    if (!activeId || busy) return;
    setMsgs((m) => {
      const lastUser = [...m].reverse().find((x) => x.role === "user");
      return lastUser ? [...m.slice(0, m.lastIndexOf(lastUser) + 1)] : m;
    });
    stream({ conversationId: activeId, regenerate: true });
  }, [activeId, busy, stream]);

  const stop = () => abortRef.current?.abort();

  /* ---------------------------- conversation ops --------------------------- */
  const newChat = () => {
    setActiveId(null);
    setMsgs([]);
    inputRef.current?.focus();
  };
  const rename = async (c: Conv) => {
    const title = prompt("Rename conversation", c.title);
    if (!title?.trim()) return;
    await fetch(`/api/conversations/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    loadConvs();
  };
  const togglePin = async (c: Conv) => {
    await fetch(`/api/conversations/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned: !c.pinned }),
    });
    loadConvs();
  };
  const remove = async (c: Conv) => {
    if (!confirm(`Delete "${c.title}"?`)) return;
    await fetch(`/api/conversations/${c.id}`, { method: "DELETE" });
    if (activeId === c.id) newChat();
    loadConvs();
  };
  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("aiw-theme", next ? "dark" : "light");
  };

  /* ---------------------------------- view --------------------------------- */
  return (
    <div className="flex h-dvh">
      {/* ------------------------------ sidebar ----------------------------- */}
      <aside className="flex w-72 shrink-0 flex-col border-r border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex items-center gap-2 p-3">
          <button
            onClick={newChat}
            className="flex-1 rounded-lg bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
          >
            + New chat
          </button>
          <a
            href="/settings"
            title="Settings"
            className="rounded-lg border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-200 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            ⚙
          </a>
        </div>
        <div className="px-3 pb-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search conversations…"
            className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-950"
          />
        </div>
        <nav className="flex-1 overflow-y-auto px-2 pb-2">
          {convs.map((c) => (
            <div
              key={c.id}
              onClick={() => openConv(c.id)}
              className={`group flex cursor-pointer items-center gap-1 rounded-lg px-2 py-2 text-sm ${
                c.id === activeId
                  ? "bg-neutral-200 dark:bg-neutral-800"
                  : "hover:bg-neutral-200/60 dark:hover:bg-neutral-800/60"
              }`}
            >
              {c.pinned && <span title="Pinned">📌</span>}
              <span className="flex-1 truncate">{c.title}</span>
              <span className="hidden shrink-0 gap-0.5 group-hover:flex">
                <button title="Pin" onClick={(e) => { e.stopPropagation(); togglePin(c); }} className="rounded p-0.5 text-xs hover:bg-neutral-300 dark:hover:bg-neutral-700">📍</button>
                <button title="Rename" onClick={(e) => { e.stopPropagation(); rename(c); }} className="rounded p-0.5 text-xs hover:bg-neutral-300 dark:hover:bg-neutral-700">✏️</button>
                <button title="Delete" onClick={(e) => { e.stopPropagation(); remove(c); }} className="rounded p-0.5 text-xs hover:bg-neutral-300 dark:hover:bg-neutral-700">🗑</button>
              </span>
            </div>
          ))}
          {!convs.length && (
            <p className="px-2 py-4 text-xs text-neutral-500">No conversations yet.</p>
          )}
        </nav>
        <div className="border-t border-neutral-200 p-3 dark:border-neutral-800">
          <button onClick={toggleTheme} className="text-sm text-neutral-600 hover:underline dark:text-neutral-400">
            {dark ? "☀ Light mode" : "🌙 Dark mode"}
          </button>
        </div>
      </aside>

      {/* ------------------------------- chat ------------------------------- */}
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-4 py-6">
            {!msgs.length && (
              <div className="mt-24 text-center">
                <h1 className="text-2xl font-semibold">AI Workspace</h1>
                <p className="mt-2 text-sm text-neutral-500">
                  One assistant, every provider. Pick a model or let Auto route for you.
                </p>
                {!models.length && (
                  <a href="/settings" className="mt-4 inline-block rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-500">
                    Add your first provider →
                  </a>
                )}
              </div>
            )}
            {msgs.map((m, i) => (
              <MessageView
                key={m.id ?? i}
                msg={m}
                isLast={i === msgs.length - 1}
                busy={busy}
                onRegenerate={regenerate}
              />
            ))}
            <div ref={bottomRef} />
          </div>
        </div>

        {/* ------------------------------ composer ---------------------------- */}
        <div className="border-t border-neutral-200 dark:border-neutral-800">
          <div className="mx-auto max-w-3xl px-4 py-3">
            <div className="flex items-end gap-2 rounded-2xl border border-neutral-300 bg-white p-2 focus-within:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-900">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                rows={Math.min(8, Math.max(1, input.split("\n").length))}
                placeholder="Message the workspace…  (Enter to send, Shift+Enter for newline)"
                className="max-h-48 flex-1 resize-none bg-transparent px-2 py-1.5 text-[15px] outline-none"
              />
              {busy ? (
                <button
                  onClick={stop}
                  className="rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500"
                >
                  ■ Stop
                </button>
              ) : (
                <button
                  onClick={send}
                  disabled={!input.trim()}
                  className="rounded-xl bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900"
                >
                  Send ↑
                </button>
              )}
            </div>
            <div className="mt-2 flex items-center gap-2 text-xs text-neutral-500">
              <label htmlFor="model">Model</label>
              <select
                id="model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="rounded-md border border-neutral-300 bg-white px-2 py-1 dark:border-neutral-700 dark:bg-neutral-900"
              >
                <option value="auto">Auto (smart routing)</option>
                {models.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.provider} · {m.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

/* ------------------------------ message view ------------------------------ */
function MessageView({
  msg,
  isLast,
  busy,
  onRegenerate,
}: {
  msg: Msg;
  isLast: boolean;
  busy: boolean;
  onRegenerate: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [showReasoning, setShowReasoning] = useState(false);

  if (msg.role === "user") {
    return (
      <div className="mb-4 flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-blue-600 px-4 py-2.5 text-[15px] text-white">
          {msg.content}
        </div>
      </div>
    );
  }

  return (
    <div className="mb-6">
      <div className="mb-1 flex items-center gap-2 text-xs text-neutral-500">
        <span className="font-semibold uppercase tracking-wide">Assistant</span>
        {msg.provider && (
          <span className="rounded-full bg-neutral-200 px-2 py-0.5 dark:bg-neutral-800">
            {msg.provider} · {msg.model}
          </span>
        )}
      </div>

      {msg.reasoning && (
        <div className="mb-2">
          <button
            onClick={() => setShowReasoning(!showReasoning)}
            className="text-xs text-neutral-500 hover:underline"
          >
            {showReasoning ? "▾ Hide thinking" : "▸ Show thinking"}
          </button>
          {showReasoning && (
            <div className="mt-1 rounded-lg border border-dashed border-neutral-300 p-3 text-sm text-neutral-500 dark:border-neutral-700">
              {msg.reasoning}
            </div>
          )}
        </div>
      )}

      <div className={msg.streaming && !msg.error ? "stream-caret" : ""}>
        {msg.content ? (
          <Markdown content={msg.content} />
        ) : msg.streaming ? (
          <span className="text-sm text-neutral-400">Thinking…</span>
        ) : null}
      </div>

      {msg.error && (
        <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {msg.error}
        </p>
      )}

      {!msg.streaming && (msg.content || msg.error) && (
        <div className="mt-2 flex gap-3 text-xs text-neutral-500">
          {msg.content && (
            <button
              onClick={() => {
                navigator.clipboard.writeText(msg.content);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className="hover:underline"
            >
              {copied ? "✓ Copied" : "Copy"}
            </button>
          )}
          {isLast && !busy && (
            <button onClick={onRegenerate} className="hover:underline">
              ↻ Regenerate
            </button>
          )}
        </div>
      )}
    </div>
  );
}
