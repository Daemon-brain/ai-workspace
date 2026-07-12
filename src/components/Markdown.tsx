"use client";

/**
 * Markdown renderer for chat messages: GFM (tables, strikethrough, task
 * lists) + syntax-highlighted code blocks. react-markdown renders to React
 * elements (no dangerouslySetInnerHTML), which is our XSS boundary.
 */
import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

export const Markdown = memo(function Markdown({ content }: { content: string }) {
  return (
    <div className="prose-chat text-[15px]">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
        {content}
      </ReactMarkdown>
    </div>
  );
});
