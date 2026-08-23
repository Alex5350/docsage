"use client";

import Link from "next/link";
import { ArrowRightIcon, CheckIcon, TriangleAlertIcon, XIcon } from "lucide-react";

import { MimeIcon } from "@/components/documents/mime-icon";
import { ProviderChip } from "@/components/documents/badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatBytes } from "@/lib/format";
import type { DocumentSummary } from "@/lib/types";

const STAGES = ["queued", "extracting", "enriching", "embedding", "ready"] as const;
const STAGE_LABELS: Record<(typeof STAGES)[number], string> = {
  queued: "Queued",
  extracting: "Extracting",
  enriching: "Enriching",
  embedding: "Embedding",
  ready: "Ready",
};

/**
 * Live ingestion card for one uploaded document: a stepper through the
 * pipeline stages (check marks for finished, a pulsing ring for the current
 * stage) plus the terminal ready/failed state.
 */
export function PipelineCard({
  document,
  onDismiss,
}: {
  document: DocumentSummary;
  onDismiss: (id: string) => void;
}) {
  const failed = document.status === "failed";
  const ready = document.status === "ready";
  const activeIndex = STAGES.indexOf(document.status as (typeof STAGES)[number]);

  return (
    <li
      className={cn(
        "rounded-xl border bg-card p-4 shadow-sm transition-colors",
        failed ? "border-red-500/30" : "border-border",
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg border",
            failed ? "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400" : "border-primary/25 bg-primary/10 text-primary",
          )}
        >
          <MimeIcon mimeType={document.mime_type} className="size-4.5" />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="truncate text-sm font-medium">{document.title}</p>
          <p className="truncate font-mono text-xs text-muted-foreground">
            {document.source_filename} · {formatBytes(document.size_bytes)}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          <ProviderChip provider={document.embedding_provider} model={document.embedding_model} />
          <Badge variant={document.scope === "library" ? "default" : "outline"} className={document.scope === "library" ? "" : "text-muted-foreground"}>
            {document.scope === "library" ? "Agency library" : "Personal"}
          </Badge>
          {document.topic ? (
            <Badge variant="outline" className="text-muted-foreground">
              {document.topic.name}
            </Badge>
          ) : null}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Dismiss ${document.title} from the pipeline list`}
            onClick={() => onDismiss(document.id)}
          >
            <XIcon aria-hidden />
          </Button>
        </div>
      </div>

      {failed ? (
        <div
          role="alert"
          className="mt-4 flex items-start gap-2.5 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2.5 text-sm text-red-700 dark:text-red-300"
        >
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div className="min-w-0">
            <p className="font-medium">Pipeline failed</p>
            <p className="mt-0.5 break-words text-red-700/85 dark:text-red-300/85">
              {document.status_error || "The document could not be processed."}
            </p>
          </div>
        </div>
      ) : (
        <>
          <ol
            className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center"
            aria-label={`Pipeline progress: ${STAGE_LABELS[document.status as (typeof STAGES)[number]] ?? "stopped"}`}
          >
            {STAGES.map((stage, index) => {
              const done = ready || index < activeIndex;
              const active = !ready && index === activeIndex;
              return (
                <li key={stage} className="flex flex-1 items-center gap-2.5 sm:flex-none">
                  <span
                    aria-hidden
                    className={cn(
                      "relative grid size-5 shrink-0 place-items-center rounded-full border transition-colors",
                      done
                        ? "border-primary bg-primary text-primary-foreground"
                        : active
                          ? "border-primary text-primary"
                          : "border-border text-muted-foreground/50",
                    )}
                  >
                    {active && (
                      <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary/40" />
                    )}
                    {done ? <CheckIcon className="size-3" /> : null}
                  </span>
                  <span
                    className={cn(
                      "text-xs font-medium whitespace-nowrap",
                      done
                        ? "text-foreground"
                        : active
                          ? "text-primary"
                          : "text-muted-foreground/70",
                    )}
                  >
                    {STAGE_LABELS[stage]}
                  </span>
                  {index < STAGES.length - 1 ? (
                    <span
                      aria-hidden
                      className={cn(
                        "hidden h-px flex-1 sm:block",
                        done ? "bg-primary/60" : "bg-border",
                      )}
                    />
                  ) : null}
                </li>
              );
            })}
          </ol>

          {ready ? (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-2.5 text-sm">
              <p className="text-emerald-700 dark:text-emerald-300" role="status">
                <span className="font-medium">Ready</span> — {document.chunk_count}{" "}
                {document.chunk_count === 1 ? "chunk" : "chunks"} indexed
                {document.scope === "library" &&
                document.review_status === "pending_sme"
                  ? " · awaiting SME approval"
                  : ""}
                .
              </p>
              <Link
                href="/documents"
                className="inline-flex items-center gap-1 font-medium text-emerald-700 underline-offset-4 hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none dark:text-emerald-300"
              >
                View in Documents
                <ArrowRightIcon className="size-3.5" aria-hidden />
              </Link>
            </div>
          ) : null}
        </>
      )}
    </li>
  );
}
