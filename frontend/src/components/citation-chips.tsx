"use client";

import { FileTextIcon } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { Citation } from "@/lib/types";

/**
 * Citation chips under an answer: `[n] document title (+page)` buttons. Hover
 * or keyboard focus still reveals a quick-glance tooltip; click / Enter opens
 * the full popover with snippet, similarity, and page.
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
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="group relative inline-flex max-w-70 cursor-pointer items-center gap-1.5 rounded-full border border-border bg-muted/60 py-1 pr-2.5 pl-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
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
                  className="pointer-events-none absolute bottom-full left-0 z-20 mb-2 hidden w-72 rounded-xl border bg-popover p-3 text-left text-xs leading-relaxed text-popover-foreground shadow-lg group-hover:block group-focus-visible:block group-data-[state=open]:hidden"
                >
                  <span className="mb-1 block truncate font-medium">{citation.document_title}</span>
                  <span className="line-clamp-4 text-muted-foreground">{citation.snippet}</span>
                  <span className="mt-1.5 block font-mono text-[0.65rem] text-muted-foreground/80">
                    similarity {(citation.score * 100).toFixed(0)}%
                    {citation.page != null && ` · page ${citation.page}`}
                  </span>
                </span>
              </button>
            </PopoverTrigger>

            <PopoverContent align="start" className="w-80 gap-0 p-0 text-xs">
              <p className="flex items-center gap-2 border-b border-border/70 px-3.5 py-2.5 font-medium text-sm">
                <span className="grid size-4.5 shrink-0 place-items-center rounded-full bg-primary/15 font-mono text-[0.65rem] font-semibold text-primary">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1">{citation.document_title}</span>
                {citation.page != null && (
                  <span className="shrink-0 rounded-full border border-border bg-muted/60 px-2 py-0.5 font-mono text-[0.65rem] text-muted-foreground">
                    p.{citation.page}
                  </span>
                )}
              </p>
              <p className="line-clamp-5 px-3.5 py-2.5 leading-relaxed text-muted-foreground">
                {citation.snippet}
              </p>
              <p className="border-t border-border/70 px-3.5 py-2 font-mono text-[0.65rem] text-muted-foreground/80">
                similarity {(citation.score * 100).toFixed(0)}%
                {citation.page != null && ` · page ${citation.page}`}
              </p>
            </PopoverContent>
          </Popover>
        </li>
      ))}
    </ul>
  );
}
