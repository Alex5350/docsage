import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Markdown-lite renderer for streamed answers: paragraphs, line breaks, bold,
 * code spans and citation refs like `[3]`. Built from React nodes (no
 * dangerouslySetInnerHTML, no heavy markdown dependency) so partial streaming
 * text renders safely.
 */

const INLINE_TOKEN = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\[\d{1,2}\])/g;

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const parts = text.split(INLINE_TOKEN).filter((part) => part !== "");
  return parts.map((part, index) => {
    const key = `${keyPrefix}-${index}`;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={key} className="font-semibold text-foreground">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code
          key={key}
          className="rounded-md border border-border/70 bg-muted px-1.5 py-0.5 font-mono text-[0.85em]"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    const citation = /^\[(\d{1,2})\]$/.exec(part);
    if (citation) {
      return (
        <sup
          key={key}
          className="ml-0.5 rounded-sm bg-primary/15 px-1 font-mono text-[0.7em] leading-none font-semibold text-primary"
          aria-label={`citation ${citation[1]}`}
        >
          {citation[1]}
        </sup>
      );
    }
    return part;
  });
}

export function MarkdownLite({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  const paragraphs = content.split(/\n{2,}/);

  return (
    <div className={cn("space-y-3 leading-relaxed", className)}>
      {paragraphs.map((paragraph, index) =>
        paragraph.trim() === "" ? null : (
          <p key={index} className="whitespace-pre-wrap">
            {renderInline(paragraph, `p${index}`)}
          </p>
        ),
      )}
    </div>
  );
}
