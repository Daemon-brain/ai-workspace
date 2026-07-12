import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Workspace",
  description: "Provider-agnostic AI workspace — chat, orchestration, failover",
};

// Apply the saved theme before first paint to avoid a flash.
const themeInit = `
try {
  const t = localStorage.getItem('aiw-theme');
  if (t === 'dark' || (!t && matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.documentElement.classList.add('dark');
  }
} catch {}
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body className="h-dvh bg-white text-neutral-900 antialiased dark:bg-neutral-950 dark:text-neutral-100">
        {children}
      </body>
    </html>
  );
}
