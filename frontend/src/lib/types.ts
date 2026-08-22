/**
 * Types mirroring docs/CONTRACT.md DTOs exactly (snake_case on the wire).
 * Consumed by api.ts and every page.
 */

export type Role = "user" | "admin";
export type DocumentScope = "personal" | "library";
export type ChatScope = "personal" | "admin";

export interface User {
  id: string;
  email: string;
  display_name: string;
  role: Role;
}

export interface HealthStatus {
  status: "ok";
  database: "up" | "down";
  demo_mode: boolean;
  providers: { gemini: boolean; openai: boolean };
}

export interface Topic {
  id: string;
  name: string;
  description: string;
  smes: { id: string; display_name: string; email: string }[];
}

export interface DocumentSummary {
  id: string;
  title: string;
  source_filename: string;
  mime_type: string;
  scope: DocumentScope;
  status: "queued" | "extracting" | "enriching" | "embedding" | "ready" | "failed";
  status_error: string | null;
  embedding_provider: "gemini" | "openai" | "demo";
  topic: { id: string; name: string } | null;
  review_status: "not_required" | "pending_sme" | "approved" | "rejected";
  chunk_count: number;
  size_bytes: number;
  created_at: string;
  owner?: { id: string; display_name: string } | null;
  pending_reviewer: boolean;
}

export interface Enrichment {
  kind: "summary" | "keywords" | "questions" | "caption";
  content: string;
}

export interface Approval {
  reviewer: string;
  decision: "approved" | "rejected";
  note: string;
  decided_at: string;
}

export interface DocumentDetail extends DocumentSummary {
  enrichments: Enrichment[];
  approvals: Approval[];
}

export interface ChatSession {
  id: string;
  scope: ChatScope;
  title: string;
  created_at: string;
}

export interface Citation {
  chunk_id: string;
  document_id: string;
  document_title: string;
  snippet: string;
  score: number;
  page?: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations: Citation[];
  created_at: string;
}

/** SSE event payloads from POST /api/chat/sessions/{id}/messages. */
export type ChatStreamEvent =
  | { type: "delta"; text: string }
  | { type: "citations"; citations: Citation[] }
  | { type: "done"; message_id: string }
  | { type: "error"; message: string };
