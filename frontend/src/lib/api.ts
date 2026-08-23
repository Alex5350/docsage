/**
 * Typed fetch client for the DocSage REST API (docs/CONTRACT.md).
 * Cookie auth: requests carry credentials so the HttpOnly `docsage_session`
 * round-trips. Non-2xx JSON errors surface as ApiError {status, detail}.
 */
import type {
  AdminOverview,
  ChatMessage,
  ChatScope,
  ChatSession,
  ChatStreamEvent,
  DocumentDetail,
  DocumentScope,
  DocumentSummary,
  EmbeddingProvider,
  HealthStatus,
  ReviewDecision,
  Topic,
  User,
} from "@/lib/types";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    detail: string,
  ) {
    super(detail);
    this.name = "ApiError";
  }
}

async function parseError(response: Response): Promise<ApiError> {
  let detail = response.statusText || "The request failed.";
  try {
    const body = (await response.json()) as { detail?: string };
    if (body.detail) detail = body.detail;
  } catch {
    // Non-JSON failure (proxy, network, HTML error page): keep the default.
  }
  return new ApiError(response.status, detail);
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}/api${path}`, {
    credentials: "include",
    ...init,
    headers: {
      accept: "application/json",
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) throw await parseError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/* -- health + auth -------------------------------------------------------- */

export function getHealth(): Promise<HealthStatus> {
  return requestJson<HealthStatus>("/health");
}

export function register(body: {
  email: string;
  password: string;
  display_name: string;
}): Promise<User> {
  return requestJson<User>("/auth/register", { method: "POST", body: JSON.stringify(body) });
}

export function login(body: { email: string; password: string }): Promise<User> {
  return requestJson<User>("/auth/login", { method: "POST", body: JSON.stringify(body) });
}

export async function logout(): Promise<void> {
  await requestJson<void>("/auth/logout", { method: "POST" });
}

export function getMe(): Promise<User> {
  return requestJson<User>("/auth/me");
}

/* -- documents ------------------------------------------------------------- */

export async function listDocuments(scope: DocumentScope): Promise<DocumentSummary[]> {
  const data = await requestJson<{ items: DocumentSummary[] }>(`/documents?scope=${scope}`);
  return data.items;
}

export function getDocument(id: string): Promise<DocumentDetail> {
  return requestJson<DocumentDetail>(`/documents/${id}`);
}

/** Multipart upload; the pipeline starts in the background (202 + summary). */
export async function uploadDocument(body: {
  file: File;
  provider: EmbeddingProvider;
  scope: DocumentScope;
  title?: string;
  topicId?: string;
}): Promise<DocumentSummary> {
  const form = new FormData();
  form.append("file", body.file);
  form.append("provider", body.provider);
  form.append("scope", body.scope);
  if (body.title?.trim()) form.append("title", body.title.trim());
  if (body.topicId) form.append("topic_id", body.topicId);

  // No explicit content-type: the browser must set the multipart boundary.
  const response = await fetch(`${API_BASE}/api/documents`, {
    method: "POST",
    credentials: "include",
    headers: { accept: "application/json" },
    body: form,
  });
  if (!response.ok) throw await parseError(response);
  return (await response.json()) as DocumentSummary;
}

export async function deleteDocument(id: string): Promise<void> {
  await requestJson<void>(`/documents/${id}`, { method: "DELETE" });
}

/* -- topics + SME designations --------------------------------------------- */

export async function listTopics(): Promise<Topic[]> {
  const data = await requestJson<{ items: Topic[] }>("/topics");
  return data.items;
}

export function createTopic(body: { name: string; description?: string }): Promise<Topic> {
  return requestJson<Topic>("/topics", { method: "POST", body: JSON.stringify(body) });
}

export function addTopicSme(topicId: string, userId: string): Promise<void> {
  return requestJson<void>(`/topics/${topicId}/smes`, {
    method: "POST",
    body: JSON.stringify({ user_id: userId }),
  });
}

export function removeTopicSme(topicId: string, userId: string): Promise<void> {
  return requestJson<void>(`/topics/${topicId}/smes/${userId}`, { method: "DELETE" });
}

/* -- SME review queue ------------------------------------------------------- */

export async function listPendingReviews(): Promise<DocumentSummary[]> {
  const data = await requestJson<{ items: DocumentSummary[] }>("/reviews/pending");
  return data.items;
}

export function decideReview(
  documentId: string,
  decision: ReviewDecision,
  note?: string,
): Promise<DocumentSummary> {
  return requestJson<DocumentSummary>(`/reviews/${documentId}`, {
    method: "POST",
    body: JSON.stringify(note?.trim() ? { decision, note: note.trim() } : { decision }),
  });
}

/* -- admin overview --------------------------------------------------------- */

export function getAdminOverview(): Promise<AdminOverview> {
  return requestJson<AdminOverview>("/admin/overview");
}

/* -- chat sessions -------------------------------------------------------- */

export function createChatSession(scope: ChatScope): Promise<ChatSession> {
  return requestJson<ChatSession>("/chat/sessions", {
    method: "POST",
    body: JSON.stringify({ scope }),
  });
}

export async function listChatSessions(): Promise<ChatSession[]> {
  const data = await requestJson<{ items: ChatSession[] }>("/chat/sessions");
  return data.items;
}

export async function listChatMessages(sessionId: string, signal?: AbortSignal): Promise<ChatMessage[]> {
  const data = await requestJson<{ items: ChatMessage[] }>(`/chat/sessions/${sessionId}/messages`, {
    signal,
  });
  return data.items;
}

/* -- chat streaming (SSE) -------------------------------------------------- */

/**
 * POST a message and consume the text/event-stream reply. Emits parsed
 * ChatStreamEvents as they arrive; resolves when the stream ends.
 *
 * The server sends JSON payloads on `data:` lines: {type:'delta'|'citations'|
 * 'done'|'error'}. Parsing is manual (fetch + ReadableStream reader + line
 * buffering) because EventSource cannot POST.
 */
export async function streamChatMessage(
  sessionId: string,
  content: string,
  onEvent: (event: ChatStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(`${API_BASE}/api/chat/sessions/${sessionId}/messages`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json", accept: "text/event-stream" },
    body: JSON.stringify({ content }),
    signal,
  });
  if (!response.ok) throw await parseError(response);
  if (!response.body) throw new ApiError(0, "The response had no body to stream.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const handleChunk = (chunk: string) => {
    // SSE events are separated by blank lines; each event's payload is one or
    // more `data:` lines. The backend emits single-line JSON payloads.
    const raw = chunk.replace(/^\s*data:\s?/, "");
    if (!raw) return;
    try {
      onEvent(JSON.parse(raw) as ChatStreamEvent);
    } catch {
      // Ignore keep-alives / partial non-JSON lines.
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    for (;;) {
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex === -1) break;
      const line = buffer.slice(0, newlineIndex).replace(/\r$/, "");
      buffer = buffer.slice(newlineIndex + 1);
      handleChunk(line);
    }
  }
  handleChunk(buffer.replace(/\r$/, ""));
}
