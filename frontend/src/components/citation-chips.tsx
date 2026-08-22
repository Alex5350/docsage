import { FileTextIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import type { Citation } from "@/lib/types";

/**
 * Citation chips under an answer: `[n] document title (+page)`; hover or
 * keyboard focus reveals the retrieved snippet and similarity score.
 */
export function CitationChips({
  citations,
  className,
}: {
  citations: Citation[];
  className?: string;
}) {
  if (citations.length === 0) return null;

  return (
    <ul className={cn("flex flex-wrap gap-1.5", className)} aria-label="Citations">
      {citations.map((citation, index) => (
        <li key={`${citation.chunk_id}-${index}`}>
          <span
            tabIndex={0}
            className="group relative inline-flex max-w-70 items-center gap-1.5 rounded-full border border-border bg-muted/60 py-1 pr-2.5 pl-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
            aria-label={`Citation ${index + 1}: ${citation.document_title}${
              citation.page ? `, page ${citation.page}` : ""
            }`}
          >
            <span className="grid size-4.5 shrink-0 place-items-center rounded-full bg-primary/15 font-mono text-[0.65rem] font-semibold text-primary">
              {index + 1}
            </span>
            <FileTextIcon className="size-3 shrink-0 opacity-60" aria-hidden />
            <span className="truncate">
              {citation.document_title}
              {citation.page != null && (
                <span className="text-foreground/60"> · p.{citation.page}</span>
              )}
            </span>

            <span
              role="tooltip"
              className="pointer-events-none absolute bottom-full left-0 z-20 mb-2 hidden w-72 rounded-xl border bg-popover p-3 text-left text-xs leading-relaxed text-popover-foreground shadow-lg group-hover:block group-focus-visible:block"
            >
              <span className="mb-1 block truncate font-medium">{citation.document_title}</span>
              <span className="line-clamp-4 text-muted-foreground">{citation.snippet}</span>
              <span className="mt-1.5 block font-mono text-[0.65rem] text-muted-foreground/80">
                similarity {(citation.score * 100).toFixed(0)}%
                {citation.page != null && ` · page ${citation.page}`}
              </span>
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}
