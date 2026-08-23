/**
 * Embedding provider catalog (contract: gemini | openai | demo) plus the
 * client-side upload constraints. `available` comes from /api/health.
 */
import type { EmbeddingProvider, HealthStatus } from "@/lib/types";

export interface ProviderInfo {
  id: EmbeddingProvider;
  name: string;
  model: string;
  blurb: string;
  /** True unless health reports the provider's key missing. */
  available: (health: HealthStatus | null) => boolean;
}

export const PROVIDERS: ProviderInfo[] = [
  {
    id: "gemini",
    name: "Gemini Embedding 2",
    model: "gemini-embedding-2",
    blurb: "Native text + image embeddings with task-tuned prefixes.",
    available: (health) => health?.providers.gemini ?? false,
  },
  {
    id: "openai",
    name: "OpenAI text-embedding-3-small",
    model: "text-embedding-3-small",
    blurb: "1536-dimension text embeddings; images via their captions.",
    available: (health) => health?.providers.openai ?? false,
  },
  {
    id: "demo",
    name: "Demo deterministic",
    model: "deterministic-hash",
    blurb: "No key needed — seeded PRNG vectors for local evaluation.",
    available: () => true,
  },
];

export function providerInfo(id: EmbeddingProvider): ProviderInfo {
  return PROVIDERS.find((provider) => provider.id === id) ?? PROVIDERS[PROVIDERS.length - 1];
}

/** Ingestion-supported mime types (contract pipeline step 1). */
export const ACCEPTED_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "image/png",
  "image/jpeg",
  "text/plain",
  "text/markdown",
  "text/csv",
] as const;

export const ACCEPTED_EXTENSIONS = [
  ".pdf",
  ".docx",
  ".xlsx",
  ".png",
  ".jpg",
  ".jpeg",
  ".txt",
  ".md",
  ".csv",
] as const;

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** Client-side gate before anything is queued for upload. */
export function validateUploadFile(file: File): string | null {
  const extension = `.${file.name.split(".").pop()?.toLowerCase() ?? ""}`;
  const mimeKnown = (ACCEPTED_MIME_TYPES as readonly string[]).includes(file.type);
  const extensionKnown = (ACCEPTED_EXTENSIONS as readonly string[]).includes(extension);
  if (!mimeKnown && !extensionKnown) {
    return "Unsupported type — allowed: PDF, DOCX, XLSX, PNG, JPG, TXT, MD, CSV.";
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return `Too large (${Math.round(file.size / (1024 * 1024))} MB) — the limit is 25 MB.`;
  }
  if (file.size === 0) {
    return "This file is empty.";
  }
  return null;
}
