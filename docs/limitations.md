# Known limitations and extension paths

What DocSage deliberately does not do yet, and the honest shape of each
extension. Companion to the ADRs (which record what it *does* do and why).

## Retrieval quality

- **Cross-provider merge is raw cosine, not rank-normalized.** When a corpus
  contains both Gemini and OpenAI documents, per-provider results are merged
  by sorting similarity scores directly (`services/retrieval.py`). Scores
  from different embedding spaces are not truly comparable; the corpus is
  expected to be provider-homogeneous per deployment. *Extension:* merge by
  reciprocal rank fusion (RRF) per provider list - deliberately not done now
  because it would change rankings the E2E suite pins per backend.
- **`hnsw.ef_search` is left at the pgvector default (40).** With top-k of 6
  this is ample; larger corpora may want `SET LOCAL hnsw.ef_search = 100`
  per retrieval transaction.
- **Vector-only retrieval.** No BM25/hybrid keyword lane and no reranker;
  OpenAI's File Search documents RRF + rerankers for a reason. *Extension:*
  a `tsvector` column on chunks + RRF fusion is the postgres-native path.
- **Demo embeddings are hash noise.** Mechanics-faithful, semantics-free;
  demo retrieval is rank-only with a noise floor exemption (ADR 0006).

## Ingestion

- **PDFs embed via extracted text, not native page images** - citations need
  text snippets. Gemini Embedding 2 could additionally embed page pixels
  (≤6 pages/request) for layout-heavy documents.
- **No video or audio ingestion** although the Gemini embedding model accepts
  both; the extractors simply don't produce parts for them yet.
- **No re-embedding migrations.** Switching a document between providers or
  model generations is a re-upload, not a flag (ADR 0003's migration note).
- **Background pipeline is in-process** (BackgroundTasks / Task.Run). One
  worker, no queue: a crash mid-document strands it (the startup sweep now
  fails such documents) and there is no retry/resume. *Extension:* a worker
  process over the same tables.
- **Enrichment is document-level.** Per-chunk hypothetical questions (rather
  than per-document) would tighten long-document retrieval further.

## Application

- **Rate limiting is in-process** (single-process sliding window) - correct
  for the deployment story, insufficient behind multiple replicas without a
  shared store.
- **Auth is email/password + opaque sessions.** No SSO/OIDC; the seam is the
  session table, so an Entra-style provider would slot in at login.
- **Uploads cap at 25 MB and 400 parts** with client-side and pipeline-side
  caps respectively; no resumable/chunked upload.
- **SSE parser handles single-line `data:` events** (what both backends
  emit); multi-line SSE data joining is a non-goal until a backend needs it.
- **.NET enrichment is deterministic** in real-provider mode (locally derived
  summary/keywords) while the FastAPI reference uses LLM passes - a depth
  difference documented in ADR 0001; demo mode is byte-identical.

## Operations

- **No horizontal scale story**: uploads on local disk (`var/uploads`),
  in-process background work, single-database assumptions.
- **No observability stack**: structured logs only; traces/metrics are an
  OpenTelemetry away but nothing emits them yet.
