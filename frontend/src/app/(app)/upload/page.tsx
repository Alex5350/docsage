"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LibraryIcon,
  Loader2Icon,
  RefreshCwIcon,
  ShieldCheckIcon,
  Trash2Icon,
  UploadCloudIcon,
  UserIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Dropzone } from "@/components/upload/dropzone";
import { PipelineCard } from "@/components/upload/pipeline-card";
import { ProviderPicker } from "@/components/upload/provider-picker";
import { MimeIcon } from "@/components/documents/mime-icon";
import { useAuth } from "@/components/providers/auth-provider";
import { useHealth } from "@/components/providers/health-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useDocumentPolling } from "@/hooks/use-document-polling";
import { ApiError, listTopics, uploadDocument } from "@/lib/api";
import { cn } from "@/lib/utils";
import { formatBytes } from "@/lib/format";
import { PROVIDERS, validateUploadFile } from "@/lib/providers";
import type {
  DocumentScope,
  DocumentSummary,
  EmbeddingProvider,
  Topic,
} from "@/lib/types";

interface PendingFile {
  key: string;
  file: File;
  title: string;
  scope: DocumentScope;
  topicId: string;
  provider: EmbeddingProvider;
  error: string | null;
  uploading: boolean;
}

interface TopicsState {
  status: "loading" | "ready" | "error";
  topics: Topic[];
}

function defaultTitle(filename: string): string {
  return filename.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim() || filename;
}

function describeError(err: unknown): string {
  return err instanceof ApiError ? err.message : "Could not reach the server. Is the backend running?";
}

/** Onboarding surface: drop files, configure scope + embedding provider, watch the pipeline run. */
export default function UploadPage() {
  const { user } = useAuth();
  const { health } = useHealth();
  const isAdmin = user?.role === "admin";

  const [items, setItems] = useState<PendingFile[]>([]);
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [uploading, setUploading] = useState(false);
  const [topicsState, setTopicsState] = useState<TopicsState>({ status: "loading", topics: [] });
  const [topicsToken, setTopicsToken] = useState(0);

  const keyCounter = useRef(0);
  const defaultProvider = useMemo(() => {
    if (health?.providers.gemini) return "gemini" as EmbeddingProvider;
    if (health?.providers.openai) return "openai" as EmbeddingProvider;
    return "demo" as EmbeddingProvider;
  }, [health]);

  // Topics feed the library-scope config (only admins can upload to the library).
  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    listTopics().then(
      (list) => {
        if (!cancelled) setTopicsState({ status: "ready", topics: list });
      },
      () => {
        if (!cancelled) setTopicsState({ status: "error", topics: [] });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [isAdmin, topicsToken]);

  // Derived: if the health probe lands after files were added, selections whose
  // provider turned out unavailable fall back to demo at render + submit time.
  const effectiveItems = useMemo(
    () =>
      health
        ? items.map((item) =>
            PROVIDERS.find((provider) => provider.id === item.provider)?.available(health)
              ? item
              : { ...item, provider: "demo" as EmbeddingProvider },
          )
        : items,
    [items, health],
  );

  const addFiles = useCallback(
    (files: File[]) => {
      setItems((prev) => [
        ...prev,
        ...files.map((file) => ({
          key: `file-${keyCounter.current++}`,
          file,
          title: defaultTitle(file.name),
          scope: "personal" as DocumentScope,
          topicId: "",
          provider: defaultProvider,
          error: validateUploadFile(file),
          uploading: false,
        })),
      ]);
    },
    [defaultProvider],
  );

  const updateItem = useCallback((key: string, patch: Partial<PendingFile>) => {
    setItems((prev) => prev.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  }, []);

  const removeItem = useCallback((key: string) => {
    setItems((prev) => prev.filter((item) => item.key !== key));
  }, []);

  const validItems = effectiveItems.filter((item) => !item.error);

  async function handleUpload() {
    if (uploading || validItems.length === 0) return;
    setUploading(true);
    for (const item of validItems) {
      updateItem(item.key, { uploading: true });
      try {
        const summary = await uploadDocument({
          file: item.file,
          provider: item.provider,
          scope: item.scope,
          title: item.title.trim() || undefined,
          topicId: item.scope === "library" ? item.topicId || undefined : undefined,
        });
        setDocuments((prev) => [summary, ...prev]);
        setItems((prev) => prev.filter((pending) => pending.key !== item.key));
        toast.success("Upload accepted", {
          description: `“${summary.title}” is entering the ingestion pipeline.`,
        });
      } catch (err) {
        updateItem(item.key, { uploading: false, error: describeError(err) });
        toast.error(`Could not upload ${item.file.name}`, { description: describeError(err) });
      }
    }
    setUploading(false);
  }

  // Live pipeline: poll in-flight uploads at the shared cadence.
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

  const dismissDocument = useCallback((id: string) => {
    setDocuments((prev) => prev.filter((doc) => doc.id !== id));
  }, []);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl space-y-8 px-4 py-8 sm:px-6">
        <header className="space-y-1">
          <h1 className="font-display text-2xl font-semibold tracking-tight">Upload documents</h1>
          <p className="text-sm text-muted-foreground">
            Drop files into your personal workspace — or, as an admin, the agency library. DocSage
            extracts the content, enriches it with a summary, keywords, and likely questions, then
            embeds every chunk for retrieval.
          </p>
        </header>

        <Dropzone onFiles={addFiles} />

        {/* -- per-file configuration ------------------------------------------- */}
        {effectiveItems.length > 0 ? (
          <section aria-label="Files to upload" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-display text-lg font-semibold tracking-tight">
                {effectiveItems.length} {effectiveItems.length === 1 ? "file" : "files"} ready to
                configure
              </h2>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => setItems([])} disabled={uploading}>
                  <Trash2Icon aria-hidden />
                  Clear all
                </Button>
                <Button
                  onClick={() => void handleUpload()}
                  disabled={uploading || validItems.length === 0}
                >
                  {uploading ? (
                    <Loader2Icon className="animate-spin" aria-hidden />
                  ) : (
                    <UploadCloudIcon aria-hidden />
                  )}
                  {uploading
                    ? "Uploading…"
                    : `Upload ${validItems.length} ${validItems.length === 1 ? "file" : "files"}`}
                </Button>
              </div>
            </div>

            <ul className="space-y-3">
              {effectiveItems.map((item) => {
                const selectedTopic =
                  topicsState.topics.find((topic) => topic.id === item.topicId) ?? null;
                return (
                  <li
                    key={item.key}
                    className={cn(
                      "space-y-4 rounded-xl border bg-card p-4 shadow-sm",
                      item.error ? "border-red-500/40" : "border-border",
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <div className="grid size-9 shrink-0 place-items-center rounded-lg border border-primary/25 bg-primary/10 text-primary">
                        <MimeIcon mimeType={item.file.type} className="size-4.5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{item.file.name}</p>
                        <p className="text-xs text-muted-foreground">{formatBytes(item.file.size)}</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Remove ${item.file.name}`}
                        onClick={() => removeItem(item.key)}
                        disabled={item.uploading}
                      >
                        <Trash2Icon aria-hidden />
                      </Button>
                    </div>

                    {item.error ? (
                      <p
                        role="alert"
                        className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300"
                      >
                        {item.error}
                      </p>
                    ) : null}

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor={`${item.key}-title`}>Title</Label>
                        <Input
                          id={`${item.key}-title`}
                          value={item.title}
                          onChange={(event) => updateItem(item.key, { title: event.target.value })}
                          maxLength={200}
                          placeholder="Document title"
                          disabled={item.uploading}
                        />
                      </div>

                      <div className="space-y-2">
                        <span id={`${item.key}-scope-label`} className="text-sm font-medium">
                          Scope
                        </span>
                        <div
                          role="radiogroup"
                          aria-labelledby={`${item.key}-scope-label`}
                          className="grid h-9 grid-cols-2 items-center gap-1 rounded-lg border border-input p-1"
                        >
                          {(
                            [
                              { value: "personal", label: "Personal", icon: UserIcon, enabled: true },
                              {
                                value: "library",
                                label: "Agency library",
                                icon: LibraryIcon,
                                enabled: isAdmin,
                              },
                            ] as const
                          ).map((option) => {
                            const Icon = option.icon;
                            const selected = item.scope === option.value;
                            return (
                              <label
                                key={option.value}
                                className={cn(
                                  "flex h-7 items-center justify-center gap-1.5 rounded-md text-sm font-medium transition-colors",
                                  selected
                                    ? "bg-accent text-accent-foreground"
                                    : "text-muted-foreground",
                                  option.enabled
                                    ? "cursor-pointer hover:text-foreground has-focus-visible:ring-[3px] has-focus-visible:ring-ring/40 has-focus-visible:outline-none"
                                    : "cursor-not-allowed opacity-50",
                                )}
                                title={
                                  option.value === "library" && !isAdmin
                                    ? "Agency library uploads are admin-only"
                                    : undefined
                                }
                              >
                                <input
                                  type="radio"
                                  name={`${item.key}-scope`}
                                  className="sr-only"
                                  checked={selected}
                                  disabled={!option.enabled || item.uploading}
                                  onChange={() => updateItem(item.key, { scope: option.value })}
                                />
                                <Icon className="size-3.5" aria-hidden />
                                {option.label}
                              </label>
                            );
                          })}
                        </div>
                        {!isAdmin ? (
                          <p className="text-xs text-muted-foreground">
                            Agency library uploads are admin-only.
                          </p>
                        ) : null}
                      </div>
                    </div>

                    {item.scope === "library" ? (
                      <div className="space-y-2 rounded-xl border border-primary/20 bg-accent/40 p-3">
                        <Label htmlFor={`${item.key}-topic`}>Library topic</Label>
                        {topicsState.status === "error" ? (
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            Could not load topics.
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setTopicsToken((token) => token + 1)}
                            >
                              <RefreshCwIcon aria-hidden />
                              Retry
                            </Button>
                          </div>
                        ) : topicsState.status === "loading" ? (
                          <Skeleton className="h-9 w-full" />
                        ) : topicsState.topics.length > 0 ? (
                          <Select
                            value={item.topicId || undefined}
                            onValueChange={(value) => updateItem(item.key, { topicId: value })}
                            disabled={item.uploading}
                          >
                            <SelectTrigger id={`${item.key}-topic`} className="w-full">
                              <SelectValue placeholder="Choose a topic" />
                            </SelectTrigger>
                            <SelectContent>
                              {topicsState.topics.map((topic) => (
                                <SelectItem key={topic.id} value={topic.id}>
                                  {topic.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <p className="text-sm text-muted-foreground">
                            No topics exist yet — create one (with SME reviewers) before uploading
                            to the library.
                          </p>
                        )}

                        <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-300">
                          <ShieldCheckIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                          Library documents require SME approval before they become visible
                          agency-wide.
                        </p>

                        {selectedTopic ? (
                          selectedTopic.smes.length > 0 ? (
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="text-xs text-muted-foreground">Reviewers:</span>
                              {selectedTopic.smes.map((sme) => (
                                <Badge key={sme.id} variant="secondary" className="font-normal">
                                  {sme.display_name}
                                </Badge>
                              ))}
                            </div>
                          ) : (
                            <p className="text-xs text-amber-700 dark:text-amber-300">
                              No SMEs are designated for this topic yet.
                            </p>
                          )
                        ) : null}
                      </div>
                    ) : null}

                    <div className="space-y-2">
                      <span id={`${item.key}-provider-label`} className="text-sm font-medium">
                        Embedding provider
                      </span>
                      <ProviderPicker
                        idPrefix={item.key}
                        value={item.provider}
                        onChange={(provider) => updateItem(item.key, { provider })}
                        disabled={item.uploading}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {/* -- live pipeline ------------------------------------------------------ */}
        {documents.length > 0 ? (
          <section aria-label="Ingestion pipeline" className="space-y-3">
            <h2 className="font-display text-lg font-semibold tracking-tight">Pipeline</h2>
            <ul className="space-y-3">
              {documents.map((doc) => (
                <PipelineCard key={doc.id} document={doc} onDismiss={dismissDocument} />
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}
