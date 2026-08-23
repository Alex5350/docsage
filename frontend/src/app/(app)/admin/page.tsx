"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIcon,
  BadgeCheckIcon,
  DatabaseIcon,
  FolderOpenIcon,
  HourglassIcon,
  KeyRoundIcon,
  LibraryIcon,
  RefreshCwIcon,
  ServerIcon,
  ShieldCheckIcon,
  TriangleAlertIcon,
  UsersIcon,
} from "lucide-react";
import { toast } from "sonner";

import { MimeIcon } from "@/components/documents/mime-icon";
import { PipelineStatusBadge } from "@/components/documents/badges";
import { DocumentDetailDialog } from "@/components/documents/document-detail-dialog";
import { useAuth } from "@/components/providers/auth-provider";
import { useHealth } from "@/components/providers/health-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, getAdminOverview, listDocuments } from "@/lib/api";
import { cn } from "@/lib/utils";
import { formatRelative } from "@/lib/format";
import { providerInfo } from "@/lib/providers";
import type { AdminOverview, DocumentStatus, DocumentSummary } from "@/lib/types";

const PIPELINE_ORDER: DocumentStatus[] = [
  "queued",
  "extracting",
  "enriching",
  "embedding",
  "ready",
  "failed",
];

const PIPELINE_SEGMENT: Record<DocumentStatus, string> = {
  queued: "bg-slate-400/70 dark:bg-slate-500/70",
  extracting: "bg-primary/40",
  enriching: "bg-primary/60",
  embedding: "bg-primary/85",
  ready: "bg-emerald-500",
  failed: "bg-red-500",
};

const PIPELINE_LABEL: Record<DocumentStatus, string> = {
  queued: "Queued",
  extracting: "Extracting",
  enriching: "Enriching",
  embedding: "Embedding",
  ready: "Ready",
  failed: "Failed",
};

function describeError(err: unknown): string {
  return err instanceof ApiError ? err.message : "Could not reach the server. Is the backend running?";
}

function StatCard({
  icon: Icon,
  label,
  value,
  loading,
}: {
  icon: typeof UsersIcon;
  label: string;
  value: number | undefined;
  loading: boolean;
}) {
  return (
    <Card className="gap-2 py-4">
      <CardContent className="flex items-center gap-3 px-4">
        <div className="grid size-10 shrink-0 place-items-center rounded-xl border border-primary/25 bg-primary/10 text-primary">
          <Icon className="size-5" aria-hidden />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
          {loading ? (
            <Skeleton className="mt-1 h-7 w-14" />
          ) : (
            <p className="font-display text-2xl leading-tight font-semibold tracking-tight">
              {value ?? "—"}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/** Admin-only overview: counts, pipeline distribution, provider health, recent activity. */
export default function AdminPage() {
  const { user, loading: authLoading } = useAuth();
  const { health, offline } = useHealth();
  const isAdmin = user?.role === "admin";

  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [recent, setRecent] = useState<DocumentSummary[] | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [selected, setSelected] = useState<DocumentSummary | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  // Overview is the source of truth; recent docs merge both scopes as admin.
  // Refresh/reset state is set in event handlers, never synchronously here.
  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    Promise.allSettled([getAdminOverview(), listDocuments("library"), listDocuments("personal")]).then(
      ([overviewResult, libraryResult, personalResult]) => {
        if (cancelled) return;
        if (overviewResult.status === "fulfilled") {
          setOverview(overviewResult.value);
        } else {
          setOverviewError(describeError(overviewResult.reason));
          toast.error("Admin overview unavailable", {
            description: describeError(overviewResult.reason),
          });
        }
        const docs = [
          ...(libraryResult.status === "fulfilled" ? libraryResult.value : []),
          ...(personalResult.status === "fulfilled" ? personalResult.value : []),
        ];
        docs.sort((a, b) => b.created_at.localeCompare(a.created_at));
        setRecent(docs.slice(0, 6));
        setLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [isAdmin, reloadToken]);

  const reload = useCallback(() => {
    setOverviewError(null);
    setLoading(true);
    setReloadToken((token) => token + 1);
  }, []);

  const pipelineTotal = useMemo(
    () => (overview ? Object.values(overview.pipeline).reduce((sum, count) => sum + (count ?? 0), 0) : 0),
    [overview],
  );

  if (!authLoading && !isAdmin) {
    return (
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl px-4 py-16 sm:px-6">
          <div className="ds-aurora grid place-items-center rounded-2xl border border-dashed border-border px-6 py-16 text-center">
            <div className="flex max-w-sm flex-col items-center gap-3">
              <div className="grid size-12 place-items-center rounded-2xl border border-primary/25 bg-primary/10 text-primary">
                <ShieldCheckIcon className="size-6" aria-hidden />
              </div>
              <h1 className="font-display text-lg font-semibold tracking-tight">Admins only</h1>
              <p className="text-sm text-muted-foreground">
                This overview is restricted to administrator accounts.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 sm:px-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-1">
            <h1 className="font-display text-2xl font-semibold tracking-tight">Admin overview</h1>
            <p className="text-sm text-muted-foreground">
              Agency-wide counts, ingestion health, and provider readiness.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {health?.demo_mode ? (
              <Badge variant="warning" className="gap-1">
                <ActivityIcon aria-hidden />
                Demo mode
              </Badge>
            ) : null}
            <Button variant="outline" size="sm" onClick={reload} disabled={loading}>
              <RefreshCwIcon className={cn(loading && "animate-spin")} aria-hidden />
              Refresh
            </Button>
          </div>
        </header>

        {overviewError ? (
          <div
            role="alert"
            className="flex flex-col items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-6"
          >
            <p className="text-sm text-destructive">{overviewError}</p>
            <Button variant="outline" size="sm" onClick={reload}>
              <RefreshCwIcon aria-hidden />
              Try again
            </Button>
          </div>
        ) : null}

        {/* -- stat cards ------------------------------------------------------- */}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard icon={UsersIcon} label="Users" value={overview?.users} loading={loading && !overview} />
          <StatCard
            icon={FolderOpenIcon}
            label="Personal documents"
            value={overview?.personal_documents}
            loading={loading && !overview}
          />
          <StatCard
            icon={LibraryIcon}
            label="Library documents"
            value={overview?.library_documents}
            loading={loading && !overview}
          />
          <StatCard
            icon={HourglassIcon}
            label="Pending reviews"
            value={overview?.pending_reviews}
            loading={loading && !overview}
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {/* -- pipeline distribution ------------------------------------------ */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Pipeline distribution</CardTitle>
              <p className="text-sm text-muted-foreground">
                {pipelineTotal} {pipelineTotal === 1 ? "document" : "documents"} across all users
                {overview ? ` · ${overview.total_documents} total` : ""}.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              {loading && !overview ? (
                <Skeleton className="h-3 w-full rounded-full" />
              ) : pipelineTotal === 0 ? (
                <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                  No documents ingested yet — the pipeline is idle.
                </p>
              ) : (
                <>
                  <div
                    className="flex h-3 w-full overflow-hidden rounded-full bg-muted"
                    role="img"
                    aria-label={PIPELINE_ORDER.map(
                      (status) => `${PIPELINE_LABEL[status]}: ${overview?.pipeline[status] ?? 0}`,
                    ).join(", ")}
                  >
                    {PIPELINE_ORDER.map((status) => {
                      const count = overview?.pipeline[status] ?? 0;
                      if (count === 0) return null;
                      return (
                        <div
                          key={status}
                          className={cn("h-full transition-[width]", PIPELINE_SEGMENT[status])}
                          style={{ width: `${(count / pipelineTotal) * 100}%` }}
                          title={`${PIPELINE_LABEL[status]}: ${count}`}
                        />
                      );
                    })}
                  </div>
                  <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
                    {PIPELINE_ORDER.map((status) => (
                      <li key={status} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span
                          aria-hidden
                          className={cn("size-2 rounded-full", PIPELINE_SEGMENT[status])}
                        />
                        {PIPELINE_LABEL[status]}
                        <span className="font-mono font-medium text-foreground">
                          {overview?.pipeline[status] ?? 0}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </CardContent>
          </Card>

          {/* -- provider configuration ------------------------------------------ */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Provider configuration</CardTitle>
              <p className="text-sm text-muted-foreground">
                Embedding + enrichment readiness reported by the backend.
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              {offline || !health ? (
                <p className="flex items-center gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
                  <TriangleAlertIcon className="size-4 shrink-0" aria-hidden />
                  Health unavailable — is the backend running?
                </p>
              ) : (
                <>
                  <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                    <span className="flex items-center gap-2.5 text-sm">
                      <span className="grid size-8 place-items-center rounded-lg border border-primary/25 bg-primary/10 text-primary">
                        <ServerIcon className="size-4" aria-hidden />
                      </span>
                      <span>
                        <span className="block font-medium">Database</span>
                        <span className="block font-mono text-xs text-muted-foreground">
                          postgres + pgvector
                        </span>
                      </span>
                    </span>
                    {health.database === "up" ? (
                      <Badge variant="success" className="gap-1">
                        <BadgeCheckIcon aria-hidden />
                        {health.database}
                      </Badge>
                    ) : (
                      <Badge variant="destructive" className="gap-1">
                        <TriangleAlertIcon aria-hidden />
                        {health.database}
                      </Badge>
                    )}
                  </div>

                  {(["gemini", "openai"] as const).map((providerId) => {
                    const info = providerInfo(providerId);
                    const configured = health.providers[providerId];
                    return (
                      <div
                        key={providerId}
                        className="flex items-center justify-between gap-3 rounded-lg border p-3"
                      >
                        <span className="flex items-center gap-2.5 text-sm">
                          <span className="grid size-8 place-items-center rounded-lg border border-primary/25 bg-primary/10 text-primary">
                            <ServerIcon className="size-4" aria-hidden />
                          </span>
                          <span>
                            <span className="block font-medium">{info.name}</span>
                            <span className="block font-mono text-xs text-muted-foreground">
                              {info.model}
                            </span>
                          </span>
                        </span>
                        {configured ? (
                          <Badge variant="success" className="gap-1">
                            <BadgeCheckIcon aria-hidden />
                            configured
                          </Badge>
                        ) : (
                          <Badge variant="warning" className="gap-1">
                            <KeyRoundIcon aria-hidden />
                            key missing
                          </Badge>
                        )}
                      </div>
                    );
                  })}

                  {health.demo_mode ? (
                    <p className="flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
                      <ActivityIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                      Demo mode is active — embeddings and answers use deterministic stand-ins until
                      provider keys are configured.
                    </p>
                  ) : null}
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* -- recent documents --------------------------------------------------- */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent documents</CardTitle>
            <p className="text-sm text-muted-foreground">
              Latest uploads across personal workspaces and the library.
            </p>
          </CardHeader>
          <CardContent>
            {loading && !recent ? (
              <div className="space-y-2" aria-busy="true" aria-label="Loading recent documents">
                {Array.from({ length: 3 }, (_, index) => (
                  <Skeleton key={index} className="h-11 w-full" />
                ))}
              </div>
            ) : !recent || recent.length === 0 ? (
              <p className="flex items-center gap-2 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                <DatabaseIcon className="size-4 shrink-0" aria-hidden />
                No documents yet.
              </p>
            ) : (
              <ul className="divide-y divide-border/70">
                {recent.map((document) => (
                  <li key={document.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelected(document);
                        setDetailOpen(true);
                      }}
                      aria-label={`Open details for ${document.title}`}
                      className="flex w-full items-center gap-3 rounded-lg px-1 py-2.5 text-left transition-colors hover:bg-muted/40 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
                    >
                      <MimeIcon mimeType={document.mime_type} className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{document.title}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {document.owner?.display_name ? `${document.owner.display_name} · ` : ""}
                          {formatRelative(document.created_at)}
                        </span>
                      </span>
                      <Badge
                        variant={document.scope === "library" ? "default" : "secondary"}
                        className="hidden shrink-0 font-normal sm:inline-flex"
                      >
                        {document.scope === "library" ? "Library" : "Personal"}
                      </Badge>
                      <PipelineStatusBadge
                        status={document.status}
                        statusError={document.status_error}
                        className="shrink-0"
                      />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <DocumentDetailDialog document={selected} open={detailOpen} onOpenChange={setDetailOpen} />
    </div>
  );
}
