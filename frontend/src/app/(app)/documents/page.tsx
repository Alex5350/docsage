"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  FolderOpenIcon,
  LibraryIcon,
  RefreshCwIcon,
  UploadCloudIcon,
  UserIcon,
} from "lucide-react";
import { toast } from "sonner";

import { MimeIcon, mimeLabel } from "@/components/documents/mime-icon";
import { PipelineStatusBadge, ProviderChip, ReviewStatusBadge } from "@/components/documents/badges";
import { DocumentDetailDialog } from "@/components/documents/document-detail-dialog";
import { useAuth } from "@/components/providers/auth-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDocumentPolling } from "@/hooks/use-document-polling";
import { ApiError, listDocuments } from "@/lib/api";
import { cn } from "@/lib/utils";
import { formatBytes, formatRelative } from "@/lib/format";
import type { DocumentScope, DocumentSummary } from "@/lib/types";

function describeError(err: unknown): string {
  return err instanceof ApiError ? err.message : "Could not reach the server. Is the backend running?";
}

function DocumentCard({
  document,
  showOwner,
  onOpen,
}: {
  document: DocumentSummary;
  showOwner: boolean;
  onOpen: (document: DocumentSummary) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(document)}
      aria-label={`Open details for ${document.title}`}
      className="flex w-full flex-col gap-3 rounded-xl border border-border bg-card p-4 text-left shadow-sm transition-colors hover:border-primary/40 hover:bg-muted/30 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
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
        <PipelineStatusBadge status={document.status} statusError={document.status_error} className="shrink-0" />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <ProviderChip provider={document.embedding_provider} model={document.embedding_model} />
        {document.scope === "library" ? (
          <ReviewStatusBadge reviewStatus={document.review_status} />
        ) : null}
        {document.topic ? (
          <Badge variant="outline" className="text-muted-foreground">
            {document.topic.name}
          </Badge>
        ) : null}
      </div>

      <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
        <span className="uppercase">{mimeLabel(document.mime_type)}</span>
        <span aria-hidden>·</span>
        <span>
          {document.chunk_count} {document.chunk_count === 1 ? "chunk" : "chunks"}
        </span>
        <span aria-hidden>·</span>
        <span>{formatBytes(document.size_bytes)}</span>
        <span aria-hidden>·</span>
        <span>{formatRelative(document.created_at)}</span>
        {showOwner && document.owner ? (
          <>
            <span aria-hidden>·</span>
            <span className="inline-flex items-center gap-1">
              <UserIcon className="size-3" aria-hidden />
              {document.owner.display_name}
            </span>
          </>
        ) : null}
      </p>
    </button>
  );
}

function EmptyState({ scope }: { scope: DocumentScope }) {
  return (
    <div className="ds-aurora grid place-items-center rounded-2xl border border-dashed border-border px-6 py-16 text-center">
      <div className="flex max-w-sm flex-col items-center gap-3">
        <div className="grid size-12 place-items-center rounded-2xl border border-primary/25 bg-primary/10 text-primary">
          {scope === "personal" ? (
            <FolderOpenIcon className="size-6" aria-hidden />
          ) : (
            <LibraryIcon className="size-6" aria-hidden />
          )}
        </div>
        {scope === "personal" ? (
          <>
            <h2 className="font-display text-lg font-semibold tracking-tight">
              No personal documents yet
            </h2>
            <p className="text-sm text-muted-foreground">
              Upload a file and DocSage will extract, enrich, and embed it — ready to ground your
              next conversation.
            </p>
          </>
        ) : (
          <>
            <h2 className="font-display text-lg font-semibold tracking-tight">
              The agency library is empty
            </h2>
            <p className="text-sm text-muted-foreground">
              Documents submitted to the library appear agency-wide once topic SMEs approve them.
            </p>
          </>
        )}
        <Button asChild variant="outline" size="sm" className="mt-1">
          <Link href="/upload" className="focus-visible:ring-[3px] focus-visible:ring-ring/40">
            <UploadCloudIcon aria-hidden />
            Upload a document
          </Link>
        </Button>
      </div>
    </div>
  );
}

function CardGridSkeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true" aria-label="Loading documents">
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="space-y-3 rounded-xl border bg-card p-4">
          <div className="flex items-start gap-3">
            <Skeleton className="size-9 rounded-lg" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
          <div className="flex gap-1.5">
            <Skeleton className="h-6 w-24 rounded-full" />
            <Skeleton className="h-6 w-16 rounded-full" />
          </div>
          <Skeleton className="h-3 w-2/3" />
        </div>
      ))}
    </div>
  );
}

/** Personal workspace + agency library browser with live pipeline statuses. */
export default function DocumentsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [scope, setScope] = useState<DocumentScope>("personal");
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [selected, setSelected] = useState<DocumentSummary | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  // Scope changes and retries reset the fetch state in their event handlers
  // (chat-page convention); this effect only awaits and replaces.
  useEffect(() => {
    let cancelled = false;
    listDocuments(scope)
      .then((items) => {
        if (cancelled) return;
        items.sort((a, b) => b.created_at.localeCompare(a.created_at));
        setDocuments(items);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(describeError(err));
        toast.error("Documents unavailable", { description: describeError(err) });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [scope, reloadToken]);

  // Keep in-flight documents fresh while any visible card is still processing.
  const pollIds = useMemo(
    () =>
      documents
        .filter((doc) => doc.status !== "ready" && doc.status !== "failed")
        .map((doc) => doc.id),
    [documents],
  );
  useDocumentPolling(pollIds, (updated) =>
    setDocuments((prev) => prev.map((doc) => (doc.id === updated.id ? { ...doc, ...updated } : doc))),
  );

  const openDetail = useCallback((document: DocumentSummary) => {
    setSelected(document);
    setDetailOpen(true);
  }, []);

  const handleDeleted = useCallback((id: string) => {
    setDocuments((prev) => prev.filter((doc) => doc.id !== id));
  }, []);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 sm:px-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-1">
            <h1 className="font-display text-2xl font-semibold tracking-tight">Documents</h1>
            <p className="text-sm text-muted-foreground">
              Your personal workspace and the approved agency library. Click a card for enrichments,
              review trail, and actions.
            </p>
          </div>
          <Tabs
            value={scope}
            onValueChange={(value) => {
              setScope(value as DocumentScope);
              setLoading(true);
              setError(null);
            }}
          >
            <TabsList aria-label="Document scope">
              <TabsTrigger value="personal">
                <UserIcon aria-hidden />
                Personal
              </TabsTrigger>
              <TabsTrigger value="library">
                <LibraryIcon aria-hidden />
                Agency library
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </header>

        {loading ? (
          <CardGridSkeleton />
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
                setLoading(true);
                setReloadToken((token) => token + 1);
              }}
            >
              <RefreshCwIcon aria-hidden />
              Try again
            </Button>
          </div>
        ) : documents.length === 0 ? (
          <EmptyState scope={scope} />
        ) : (
          <div
            className={cn("grid gap-3 sm:grid-cols-2 xl:grid-cols-3")}
            aria-label={`${scope === "personal" ? "Personal" : "Agency library"} documents`}
          >
            {documents.map((document) => (
              <DocumentCard
                key={document.id}
                document={document}
                showOwner={scope === "library" && isAdmin}
                onOpen={openDetail}
              />
            ))}
          </div>
        )}
      </div>

      <DocumentDetailDialog
        document={selected}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onUpdate={(updated) =>
          setDocuments((prev) => prev.map((doc) => (doc.id === updated.id ? { ...doc, ...updated } : doc)))
        }
        onDeleted={handleDeleted}
      />
    </div>
  );
}
