"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ClipboardCheckIcon,
  HourglassIcon,
  InboxIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
} from "lucide-react";
import { toast } from "sonner";

import { MimeIcon } from "@/components/documents/mime-icon";
import { ProviderChip } from "@/components/documents/badges";
import { DocumentDetailDialog } from "@/components/documents/document-detail-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, decideReview, listPendingReviews } from "@/lib/api";
import { cn } from "@/lib/utils";
import { formatBytes, formatRelative } from "@/lib/format";
import type { DocumentSummary, ReviewDecision } from "@/lib/types";

function describeError(err: unknown): string {
  return err instanceof ApiError ? err.message : "Could not reach the server. Is the backend running?";
}

/** SME + admin queue: pending library documents awaiting an approval decision. */
export default function ReviewsPage() {
  const [queue, setQueue] = useState<DocumentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const [selected, setSelected] = useState<DocumentSummary | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const [decisionTarget, setDecisionTarget] = useState<DocumentSummary | null>(null);
  const [decision, setDecision] = useState<ReviewDecision>("approved");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Mount + retry fetches; state resets live in the retry handler.
  useEffect(() => {
    let cancelled = false;
    listPendingReviews()
      .then((items) => {
        if (cancelled) return;
        items.sort((a, b) => b.created_at.localeCompare(a.created_at));
        setQueue(items);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 403) {
          setForbidden(true);
        } else {
          setError(describeError(err));
          toast.error("Review queue unavailable", { description: describeError(err) });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const openDetail = useCallback((document: DocumentSummary) => {
    setSelected(document);
    setDetailOpen(true);
  }, []);

  const openDecision = useCallback((document: DocumentSummary, planned: ReviewDecision) => {
    setDecisionTarget(document);
    setDecision(planned);
    setNote("");
  }, []);

  const noteRequired = decision === "rejected" && note.trim().length === 0;

  async function submitDecision() {
    if (!decisionTarget || submitting || noteRequired) return;
    const target = decisionTarget;
    // Optimistic removal from the queue; restored if the request fails.
    setQueue((prev) => prev.filter((document) => document.id !== target.id));
    setSubmitting(true);
    try {
      await decideReview(target.id, decision, note);
      toast.success(decision === "approved" ? "Document approved" : "Document rejected", {
        description: `“${target.title}” ${decision === "approved" ? "is now visible agency-wide" : "was removed from the library pipeline"}.`,
      });
      setDecisionTarget(null);
      if (selected?.id === target.id) setDetailOpen(false);
    } catch (err) {
      setQueue((prev) => [target, ...prev].sort((a, b) => b.created_at.localeCompare(a.created_at)));
      toast.error("Could not record decision", { description: describeError(err) });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-8 sm:px-6">
        <header className="space-y-1">
          <h1 className="font-display text-2xl font-semibold tracking-tight">SME review queue</h1>
          <p className="text-sm text-muted-foreground">
            Library documents waiting for a subject-matter decision. Approved documents become
            searchable agency-wide; rejected ones stay hidden from members.
          </p>
        </header>

        {loading ? (
          <div className="space-y-3" aria-busy="true" aria-label="Loading review queue">
            {Array.from({ length: 3 }, (_, index) => (
              <div key={index} className="space-y-3 rounded-xl border bg-card p-4">
                <div className="flex items-center gap-3">
                  <Skeleton className="size-9 rounded-lg" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-3 w-1/3" />
                  </div>
                  <Skeleton className="h-8 w-20" />
                </div>
                <Skeleton className="h-3 w-1/2" />
              </div>
            ))}
          </div>
        ) : forbidden ? (
          <div className="ds-aurora grid place-items-center rounded-2xl border border-dashed border-border px-6 py-16 text-center">
            <div className="flex max-w-sm flex-col items-center gap-3">
              <div className="grid size-12 place-items-center rounded-2xl border border-primary/25 bg-primary/10 text-primary">
                <ShieldCheckIcon className="size-6" aria-hidden />
              </div>
              <h2 className="font-display text-lg font-semibold tracking-tight">Reviewers only</h2>
              <p className="text-sm text-muted-foreground">
                This queue is for admins and SMEs designated on at least one library topic.
              </p>
            </div>
          </div>
        ) : error ? (
          <div
            role="alert"
            className="flex flex-col items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-6"
          >
            <p className="text-sm text-destructive">{error}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setError(null);
                setForbidden(false);
                setLoading(true);
                setReloadToken((token) => token + 1);
              }}
            >
              <RefreshCwIcon aria-hidden />
              Try again
            </Button>
          </div>
        ) : queue.length === 0 ? (
          <div className="ds-aurora grid place-items-center rounded-2xl border border-dashed border-border px-6 py-16 text-center">
            <div className="flex max-w-sm flex-col items-center gap-3">
              <div className="grid size-12 place-items-center rounded-2xl border border-primary/25 bg-primary/10 text-primary">
                <ClipboardCheckIcon className="size-6" aria-hidden />
              </div>
              <h2 className="font-display text-lg font-semibold tracking-tight">Queue is clear</h2>
              <p className="text-sm text-muted-foreground">
                No library documents are waiting for approval right now.
              </p>
            </div>
          </div>
        ) : (
          <ul className="space-y-3" aria-label="Pending reviews">
            {queue.map((document) => (
              <li
                key={document.id}
                className="flex flex-col gap-4 rounded-xl border border-amber-500/25 bg-card p-4 shadow-sm"
              >
                <div className="flex items-start gap-3">
                  <div className="grid size-9 shrink-0 place-items-center rounded-lg border border-primary/25 bg-primary/10 text-primary">
                    <MimeIcon mimeType={document.mime_type} className="size-4.5" />
                  </div>
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="truncate text-sm font-medium">{document.title}</p>
                    <p className="truncate font-mono text-xs text-muted-foreground">
                      {document.source_filename}
                    </p>
                  </div>
                  <Badge variant="warning" className="shrink-0 gap-1">
                    <HourglassIcon aria-hidden />
                    Pending
                  </Badge>
                </div>

                <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-muted-foreground">
                  {document.topic ? (
                    <Badge variant="outline" className="text-muted-foreground">
                      {document.topic.name}
                    </Badge>
                  ) : null}
                  <ProviderChip
                    provider={document.embedding_provider}
                    model={document.embedding_model}
                  />
                  <span>
                    {document.chunk_count} {document.chunk_count === 1 ? "chunk" : "chunks"}
                  </span>
                  <span aria-hidden>·</span>
                  <span>{formatBytes(document.size_bytes)}</span>
                  <span aria-hidden>·</span>
                  <span>submitted {formatRelative(document.created_at)}</span>
                  {document.owner ? (
                    <>
                      <span aria-hidden>·</span>
                      <span>by {document.owner.display_name}</span>
                    </>
                  ) : null}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => openDetail(document)}>
                    <InboxIcon aria-hidden />
                    Review details
                  </Button>
                  <div className="ml-auto flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-emerald-500/30 text-emerald-700 hover:bg-emerald-500/10 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300"
                      onClick={() => openDecision(document, "approved")}
                    >
                      <ThumbsUpIcon aria-hidden />
                      Approve
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-red-500/30 text-red-700 hover:bg-red-500/10 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                      onClick={() => openDecision(document, "rejected")}
                    >
                      <ThumbsDownIcon aria-hidden />
                      Reject
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <DocumentDetailDialog
        document={selected}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onUpdate={(updated) =>
          setQueue((prev) =>
            prev.map((document) =>
              document.id === updated.id ? { ...document, ...updated } : document,
            ),
          )
        }
      />

      {/* -- decision dialog ----------------------------------------------------- */}
      <Dialog
        open={decisionTarget !== null}
        onOpenChange={(open) => {
          if (!open && !submitting) setDecisionTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {decision === "approved" ? (
                <ThumbsUpIcon className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
              ) : (
                <ThumbsDownIcon className="size-4 text-red-600 dark:text-red-400" aria-hidden />
              )}
              {decision === "approved" ? "Approve document?" : "Reject document?"}
            </DialogTitle>
            <DialogDescription className="line-clamp-2">
              “{decisionTarget?.title ?? ""}” — {decision === "approved"
                ? "it becomes searchable by every agency member."
                : "it stays hidden from members; the uploader can revise and resubmit."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="review-note">
              Note{" "}
              <span className={cn("font-normal", decision === "rejected" ? "text-destructive" : "text-muted-foreground")}>
                {decision === "rejected" ? "(required)" : "(optional)"}
              </span>
            </Label>
            <Textarea
              id="review-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={
                decision === "approved"
                  ? "e.g. Verified against the current field manual."
                  : "e.g. Contains outdated figures — see the 2026 revision instead."
              }
              aria-required={decision === "rejected"}
              maxLength={500}
              className="min-h-24"
            />
            {noteRequired ? (
              <p role="alert" className="text-xs text-destructive">
                A note is required when rejecting a document.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                The note is recorded on the approval trail of the document.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDecisionTarget(null)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={noteRequired || submitting}
              className={cn(
                decision === "approved" &&
                  "bg-emerald-600 text-white hover:bg-emerald-600/90 dark:bg-emerald-500 dark:text-emerald-950 dark:hover:bg-emerald-400",
                decision === "rejected" && "bg-red-600 text-white hover:bg-red-600/90 dark:bg-red-500 dark:text-red-950 dark:hover:bg-red-400",
              )}
              onClick={() => void submitDecision()}
            >
              {submitting ? "Recording…" : decision === "approved" ? "Approve" : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
