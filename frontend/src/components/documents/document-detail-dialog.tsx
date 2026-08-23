"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  EyeIcon,
  FileTextIcon,
  ListChecksIcon,
  RefreshCwIcon,
  SearchIcon,
  ShieldCheckIcon,
  TagsIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/components/providers/auth-provider";
import { MimeIcon, mimeLabel } from "@/components/documents/mime-icon";
import { PipelineStatusBadge, ProviderChip, ReviewStatusBadge } from "@/components/documents/badges";
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
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, deleteDocument, getDocument } from "@/lib/api";
import { formatBytes, formatDateTime } from "@/lib/format";
import { useDocumentPolling } from "@/hooks/use-document-polling";
import type { DocumentDetail, DocumentSummary } from "@/lib/types";

interface DocumentDetailDialogProps {
  /** Summary snapshot to open with; the full detail is fetched on open. */
  document: DocumentSummary | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Propagates polled summary updates so the owning list stays in sync. */
  onUpdate?: (document: DocumentSummary) => void;
  onDeleted?: (id: string) => void;
}

/** Keywords may arrive as JSON arrays or plain comma/newline-separated text. */
function parseKeywords(content: string): string[] {
  try {
    const parsed: unknown = JSON.parse(content);
    if (Array.isArray(parsed)) {
      return parsed.map((entry) => String(entry).trim()).filter(Boolean);
    }
  } catch {
    // Fall through to plain-text splitting.
  }
  return content
    .split(/[,\n]/)
    .map((entry) => entry.trim().replace(/^[-•*]\s*/, ""))
    .filter(Boolean);
}

/** Questions arrive one per line, sometimes with `1.` or `-` prefixes. */
function parseQuestions(content: string): string[] {
  return content
    .split(/\n+/)
    .map((line) => line.trim().replace(/^\d+[.)]\s*/, "").replace(/^[-•*]\s*/, ""))
    .filter(Boolean);
}

function SectionHeading({ icon: Icon, children }: { icon: typeof TagsIcon; children: string }) {
  return (
    <h3 className="flex items-center gap-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
      <Icon className="size-3.5" aria-hidden />
      {children}
    </h3>
  );
}

interface FetchState {
  /** Key of the last completed fetch (`{documentId}:{reloadToken}`). */
  key: string | null;
  detail: DocumentDetail | null;
  error: string | null;
}

/**
 * Full-document dialog: metadata, the agentic enrichment artifacts (summary,
 * keywords, hypothetical questions, vision captions) and the approvals trail.
 * Shared by the documents list and the SME review queue.
 */
export function DocumentDetailDialog({
  document,
  open,
  onOpenChange,
  onUpdate,
  onDeleted,
}: DocumentDetailDialogProps) {
  const { user } = useAuth();
  const [fetchState, setFetchState] = useState<FetchState>({
    key: null,
    detail: null,
    error: null,
  });
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  const documentId = document?.id ?? null;
  // While a fetch for this key hasn't landed yet, the dialog shows skeletons.
  const fetchKey = open && documentId ? `${documentId}:${reloadToken}` : null;
  const loading = fetchKey !== null && fetchState.key !== fetchKey;

  // Fetch the detail whenever the dialog opens (or a retry is requested).
  useEffect(() => {
    if (!fetchKey || !documentId) return;
    let cancelled = false;
    getDocument(documentId).then(
      (data) => {
        if (!cancelled) setFetchState({ key: fetchKey, detail: data, error: null });
      },
      (err) => {
        if (!cancelled) {
          setFetchState({
            key: fetchKey,
            detail: null,
            error:
              err instanceof ApiError
                ? err.message
                : "Could not reach the server. Is the backend running?",
          });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [fetchKey, documentId]);

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) setConfirmingDelete(false);
    onOpenChange(nextOpen);
  }

  const detail = fetchState.detail;
  const error = fetchState.error;

  const handlePolled = useCallback(
    (updated: DocumentSummary) => {
      setFetchState((current) =>
        current.detail && current.detail.id === updated.id
          ? { ...current, detail: { ...current.detail, ...updated } }
          : current,
      );
      onUpdate?.(updated);
    },
    [onUpdate],
  );

  // While the pipeline runs, refresh this document on the same cadence as lists.
  const pollIds = useMemo(
    () => (open && detail && detail.status !== "ready" && detail.status !== "failed" ? [detail.id] : []),
    [open, detail],
  );
  useDocumentPolling(pollIds, handlePolled);

  const doc: DocumentSummary | null = detail ?? document;
  if (!doc) return null;

  const isAdmin = user?.role === "admin";
  const canDelete =
    !!user && (isAdmin || (doc.owner ? doc.owner.id === user.id : doc.scope === "personal"));

  const summary = detail?.enrichments.find((item) => item.kind === "summary");
  const keywords = detail?.enrichments.find((item) => item.kind === "keywords");
  const questions = detail?.enrichments.find((item) => item.kind === "questions");
  const captions = detail?.enrichments.filter((item) => item.kind === "caption") ?? [];
  const pipelineRunning = doc.status !== "ready" && doc.status !== "failed";

  async function handleDelete() {
    if (!documentId || !doc) return;
    setDeleting(true);
    try {
      await deleteDocument(documentId);
      toast.success("Document deleted", { description: doc.title });
      setConfirmingDelete(false);
      handleOpenChange(false);
      onDeleted?.(documentId);
    } catch (err) {
      toast.error("Could not delete document", {
        description: err instanceof ApiError ? err.message : "Is the backend running?",
      });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[85svh] gap-5 overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="pr-8 leading-snug">{doc.title}</DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="inline-flex items-center gap-1.5">
              <MimeIcon mimeType={doc.mime_type} className="size-3.5" />
              <span className="font-mono text-xs">{doc.source_filename}</span>
            </span>
            <span aria-hidden>·</span>
            <span className="uppercase">{mimeLabel(doc.mime_type)}</span>
            <span aria-hidden>·</span>
            <span>{formatBytes(doc.size_bytes)}</span>
            <span aria-hidden>·</span>
            <span>uploaded {formatDateTime(doc.created_at)}</span>
            {doc.owner ? (
              <>
                <span aria-hidden>·</span>
                <span>by {doc.owner.display_name}</span>
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-1.5">
          <PipelineStatusBadge status={doc.status} statusError={doc.status_error} />
          {doc.scope === "library" && <ReviewStatusBadge reviewStatus={doc.review_status} />}
          <ProviderChip provider={doc.embedding_provider} model={doc.embedding_model} />
          {doc.topic ? (
            <Badge variant="outline" className="text-muted-foreground">
              {doc.topic.name}
            </Badge>
          ) : null}
        </div>

        {loading ? (
          <div className="space-y-3" aria-busy="true" aria-label="Loading document detail">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-4 w-1/4" />
            <div className="flex gap-1.5">
              <Skeleton className="h-6 w-16 rounded-full" />
              <Skeleton className="h-6 w-20 rounded-full" />
              <Skeleton className="h-6 w-14 rounded-full" />
            </div>
          </div>
        ) : error ? (
          <div className="space-y-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4">
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
            <Button variant="outline" size="sm" onClick={() => setReloadToken((token) => token + 1)}>
              <RefreshCwIcon aria-hidden />
              Try again
            </Button>
          </div>
        ) : (
          <>
            {/* -- agentic enrichment artifacts --------------------------------- */}
            <section className="space-y-3" aria-label="Enrichments">
              {summary ? (
                <div className="space-y-2">
                  <SectionHeading icon={FileTextIcon}>Summary</SectionHeading>
                  <p className="text-sm leading-relaxed text-muted-foreground">{summary.content}</p>
                </div>
              ) : null}

              {keywords ? (
                <div className="space-y-2">
                  <SectionHeading icon={TagsIcon}>Keywords</SectionHeading>
                  <ul className="flex flex-wrap gap-1.5" aria-label="Keywords">
                    {parseKeywords(keywords.content).map((keyword, index) => (
                      <li key={`${keyword}-${index}`}>
                        <Badge variant="secondary" className="font-normal">
                          {keyword}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {questions ? (
                <div className="space-y-2">
                  <SectionHeading icon={ListChecksIcon}>Likely questions</SectionHeading>
                  <ul className="space-y-1.5" aria-label="Likely questions">
                    {parseQuestions(questions.content).map((question, index) => (
                      <li
                        key={`${index}-${question.slice(0, 24)}`}
                        className="flex items-center gap-2.5 rounded-full border border-border bg-muted/40 px-3.5 py-1.5 text-sm text-muted-foreground"
                      >
                        <SearchIcon className="size-3.5 shrink-0 opacity-50" aria-hidden />
                        <span className="min-w-0 truncate">{question}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {captions.length > 0 ? (
                <div className="space-y-2">
                  <SectionHeading icon={EyeIcon}>Vision captions</SectionHeading>
                  <ul className="space-y-1.5">
                    {captions.map((caption, index) => (
                      <li
                        key={`${caption.content.slice(0, 24)}-${index}`}
                        className="text-sm leading-relaxed text-muted-foreground"
                      >
                        {caption.content}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {!summary && !keywords && !questions && captions.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                  {pipelineRunning
                    ? "Enrichments appear here once the pipeline reaches the enriching stage."
                    : "No enrichments were recorded for this document."}
                </p>
              ) : null}
            </section>

            {/* -- approvals trail ------------------------------------------------ */}
            {doc.scope === "library" ? (
              <section className="space-y-3" aria-label="Approvals">
                <SectionHeading icon={ShieldCheckIcon}>Approvals</SectionHeading>
                {detail && detail.approvals.length > 0 ? (
                  <ol className="relative space-y-4 border-l border-border pl-5">
                    {detail.approvals.map((approval, index) => (
                      <li key={index} className="relative">
                        <span
                          aria-hidden
                          className={`absolute top-1 -left-[1.41rem] size-2.5 rounded-full border-2 border-card ${
                            approval.decision === "approved" ? "bg-emerald-500" : "bg-red-500"
                          }`}
                        />
                        <p className="text-sm">
                          <span className="font-medium">{approval.reviewer}</span>{" "}
                          <span
                            className={
                              approval.decision === "approved"
                                ? "text-emerald-600 dark:text-emerald-400"
                                : "text-red-600 dark:text-red-400"
                            }
                          >
                            {approval.decision === "approved" ? "approved" : "rejected"}
                          </span>{" "}
                          <span className="text-muted-foreground">
                            · {formatDateTime(approval.decided_at)}
                          </span>
                        </p>
                        {approval.note ? (
                          <p className="mt-1 text-sm text-muted-foreground italic">“{approval.note}”</p>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                    No review decisions yet.
                  </p>
                )}
              </section>
            ) : null}
          </>
        )}

        {canDelete ? (
          <DialogFooter>
            {confirmingDelete ? (
              <>
                <span className="mr-auto text-sm text-muted-foreground" role="alert">
                  Delete “{doc.title}”? Its chunks and embeddings are removed too.
                </span>
                <Button variant="ghost" size="sm" onClick={() => setConfirmingDelete(false)} disabled={deleting}>
                  Cancel
                </Button>
                <Button variant="destructive" size="sm" onClick={() => void handleDelete()} disabled={deleting}>
                  <Trash2Icon aria-hidden />
                  {deleting ? "Deleting…" : "Delete document"}
                </Button>
              </>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => setConfirmingDelete(true)}
              >
                <Trash2Icon aria-hidden />
                Delete
              </Button>
            )}
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
