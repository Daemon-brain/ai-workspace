"use client";

/**
 * DASHBOARD HUB — the single entry point.
 * Two doors: the Brain (Daemon second-brain vault) and the Workspace (this
 * multi-provider AI workspace). Daemon aesthetic: cream/forest, canopy green,
 * Georgia serif wordmark.
 *
 * The Brain URL is configurable via NEXT_PUBLIC_BRAIN_URL (defaults to the
 * production Daemon deployment).
 */
import { useEffect, useState } from "react";

const BRAIN_URL = process.env.NEXT_PUBLIC_BRAIN_URL || "https://brain.daemon-tech.fr";

export default function Hub() {
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.classList.contains("dark")), []);
  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("aiw-theme", next ? "dark" : "light");
  };

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6 py-12">
      <button
        onClick={toggleTheme}
        className="absolute right-5 top-5 text-sm text-neutral-500 hover:underline"
      >
        {dark ? "☀" : "🌙"}
      </button>

      <header className="mb-12 text-center">
        <div className="mb-3 text-4xl">🜂</div>
        <h1 className="wordmark text-4xl font-semibold text-neutral-800 dark:text-neutral-100">
          Daemon
        </h1>
        <p className="mt-3 text-[15px] text-neutral-500">
          Where would you like to go?
        </p>
      </header>

      <div className="grid w-full max-w-2xl grid-cols-1 gap-5 sm:grid-cols-2">
        <Card
          href={BRAIN_URL}
          emoji="🧠"
          title="The Brain"
          desc="Your second-brain vault — capture, organize, and retrieve knowledge with an AI knowledge architect."
          cta="Open Brain"
        />
        <Card
          href="/"
          emoji="✦"
          title="The Workspace"
          desc="Multi-provider AI chat with automatic failover, smart routing, projects and skills. One assistant, every model."
          cta="Open Workspace"
        />
      </div>

      <footer className="mt-14 text-xs text-neutral-400">
        One account · two tools · same green.
      </footer>
    </div>
  );
}

function Card({
  href,
  emoji,
  title,
  desc,
  cta,
}: {
  href: string;
  emoji: string;
  title: string;
  desc: string;
  cta: string;
}) {
  const external = href.startsWith("http");
  return (
    <a
      href={href}
      {...(external ? { target: "_self" } : {})}
      className="group flex flex-col rounded-2xl border border-neutral-200 bg-neutral-100/60 p-6 transition
                 hover:border-blue-600 hover:shadow-lg dark:border-neutral-800 dark:bg-neutral-800/40 dark:hover:border-blue-500"
    >
      <div className="mb-3 text-3xl">{emoji}</div>
      <h2 className="wordmark mb-2 text-xl font-semibold text-neutral-800 dark:text-neutral-100">
        {title}
      </h2>
      <p className="flex-1 text-sm leading-relaxed text-neutral-500">{desc}</p>
      <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-blue-600 group-hover:gap-2 dark:text-blue-400">
        {cta} <span className="transition-all">→</span>
      </span>
    </a>
  );
}
