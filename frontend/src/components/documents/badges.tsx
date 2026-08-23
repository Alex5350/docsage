"use client";

import {
  BadgeCheckIcon,
  BanIcon,
  CheckCircle2Icon,
  ClockIcon,
  HourglassIcon,
  Loader2Icon,
  TriangleAlertIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { providerInfo } from "@/lib/providers";
import type { DocumentStatus, EmbeddingProvider, ReviewStatus } from "@/lib/types";

const IN_FLIGHT = new Set<DocumentStatus>(["extracting", "enriching", "embedding"]);

export function isInFlight(status: DocumentStatus): boolean {
  return IN_FLIGHT.has(status);
}

const STATUS_META: Record<
  DocumentStatus,
  { label: string; className?: string; icon?: typeof ClockIcon; spin?: boolean }
> = {
  queued: { label: "Queued", icon: ClockIcon },
  extracting: { label: "Extracting", icon: Loader2Icon, spin: true },
  enriching: { label: "Enriching", icon: Loader2Icon, spin: true },
  embedding: { label: "Embedding", icon: Loader2Icon, spin: true },
  ready: {
    label: "Ready",
    className: "border-emerald-500/25 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
    icon: CheckCircle2Icon,
  },
  failed: {
    label: "Failed",
    className: "border-red-500/25 bg-red-500/12 text-red-700 dark:text-red-300",
    icon: TriangleAlertIcon,
  },
};

/**
 * Pipeline status badge. Failed documents expose `status_error` on hover or
 * keyboard focus (same tooltip pattern as the citation chips).
 */
export function PipelineStatusBadge({
  status,
  statusError,
  className,
}: {
  status: DocumentStatus;
  statusError?: string | null;
  className?: string;
}) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return (
    <Badge
      variant="outline"
      className={cn("gap-1 text-muted-foreground", meta.className, statusError && "group relative", className)}
      {...(status === "failed" && statusError ? { title: statusError } : {})}
    >
      {status === "failed" && statusError ? (
        <span
          role="tooltip"
          className="pointer-events-none absolute bottom-full left-0 z-20 mb-2 hidden w-72 rounded-xl border bg-popover p-3 text-left text-xs leading-relaxed font-normal whitespace-normal text-popover-foreground shadow-lg group-hover:block group-focus-within:block"
        >
          {statusError}
        </span>
      ) : null}
      {Icon ? <Icon className={cn(meta.spin && "animate-spin")} aria-hidden /> : null}
      {meta.label}
    </Badge>
  );
}

const REVIEW_META: Record<
  Exclude<ReviewStatus, "not_required">,
  { label: string; icon: typeof ClockIcon; className: string }
> = {
  pending_sme: {
    label: "Pending review",
    icon: HourglassIcon,
    className: "border-amber-500/25 bg-amber-500/12 text-amber-700 dark:text-amber-300",
  },
  approved: {
    label: "Approved",
    icon: BadgeCheckIcon,
    className: "border-emerald-500/25 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  },
  rejected: {
    label: "Rejected",
    icon: BanIcon,
    className: "border-red-500/25 bg-red-500/12 text-red-700 dark:text-red-300",
  },
};

/** SME review badge — only rendered for library documents. */
export function ReviewStatusBadge({
  reviewStatus,
  className,
}: {
  reviewStatus: ReviewStatus;
  className?: string;
}) {
  if (reviewStatus === "not_required") return null;
  const meta = REVIEW_META[reviewStatus];
  const Icon = meta.icon;
  return (
    <Badge variant="outline" className={cn("gap-1", meta.className, className)}>
      <Icon aria-hidden />
      {meta.label}
    </Badge>
  );
}

/** Embedding provider chip with the model id shown small. */
export function ProviderChip({
  provider,
  model,
  className,
}: {
  provider: EmbeddingProvider;
  model?: string;
  className?: string;
}) {
  const info = providerInfo(provider);
  const modelId = model?.trim() || info.model;
  return (
    <Badge variant="secondary" className={cn("gap-1.5 font-normal", className)}>
      <span
        aria-label={`${info.name} embeddings`}
        className="size-1.5 shrink-0 rounded-full bg-primary/70"
      />
      <span className="capitalize">{provider}</span>
      <span className="font-mono text-[0.65rem] opacity-60">{modelId}</span>
    </Badge>
  );
}
