# DocSage: the engineering view

The companion to the [README's product story](README.md): architecture,
end-to-end walks of one question and one document, and every major engineering
decision traced back to the document problem it exists to solve. Decision
records, the contract, and the research are linked throughout rather than
duplicated.

## Architecture

![DocSage architecture: Next.js UI against FastAPI reference and ASP.NET Core parity APIs, one Postgres+pgvector store, Gemini and OpenAI providers](docs/assets/architecture.svg)

Three services share one database:

- **Next.js 16 frontend** (App Router, React 19, Tailwind CSS v4). A chat-first
  UI with a typed API client that parses the SSE stream itself; it points at
  either backend through `NEXT_PUBLIC_API_BASE_URL`.
- **FastAPI reference API** (`backend/`). Owns the full pipeline: every
  extraction format, the agentic enrichment passes, both real embedding
  providers, SSE chat, approvals, and the alembic schema.
  ([ADR 0001](docs/adr/0001-dual-backend-strategy.md))
- **ASP.NET Core parity API** (`dotnet/`). Minimal APIs implementing the same
  `/api` contract with its own extractors (OpenXML SDK, ClosedXML, PdfPig) and
  the same provider clients; it connects to the same Postgres and never
  migrates. ([ADR 0001](docs/adr/0001-dual-backend-strategy.md))
- **PostgreSQL 17 + pgvector**. One store: users, sessions, topics, documents,
  chunks (a single `vector(1536)` column under one HNSW cosine index),
  enrichments, approvals, chat history.
  ([ADR 0002](docs/adr/0002-uniform-1536-dim-pgvector.md))
- **Providers**. Google Gemini (natively multimodal embeddings plus flash
  models for enrichment), OpenAI (text embeddings plus Responses streaming
  chat), and the deterministic demo provider.
  ([ADR 0006](docs/adr/0006-offline-demo-mode.md))

The layering rule: routers parse and map, services decide, retrieval and
ingestion own the vector work, and [docs/CONTRACT.md](docs/CONTRACT.md) is
the single source of truth both backends code against - it stopped being
paperwork the moment two runtimes executed it.

## How the tech solves the business problem

| Business problem | Engineering decision | Why this tech | What it buys | Where documented |
|---|---|---|---|---|
| People ask in different words than documents are written, and AI cost per question makes a knowledge base expensive | Agentic enrichment at ingestion: summary, keywords, hypothetical user questions, table preambles, and image captions persisted as data before anyone asks anything | Cost and latency move from per-query to per-document - the right trade for a knowledge base that is written once and read many times; question time stays a single indexed vector search | The vocabulary gap is closed once per document, not once per question; spreadsheets and images become retrievable | [ADR 0004](docs/adr/0004-agentic-enrichment-at-ingestion.md) |
| A policy answer nobody stands behind cannot drive decisions | SME access model: topics carry designated experts; library documents wait in `pending_sme`; approvals are append-only audit rows; no self-approval | Accountability has to be a relationship per topic, not a global flag, or being the security SME grants power over budget documents | Nothing becomes agency-wide until a subject matter expert accepts responsibility for the topic, and the uploader can never approve their own upload | [ADR 0005](docs/adr/0005-access-model-and-sme-approval.md) |
| Answers silently degrade when a corpus mixes providers or a provider changes models | Provider-qualified vector spaces: `embedding_provider` and `embedding_model` recorded per document; the query is embedded once per provider present and per-provider results merge before the top-k cut | Different geometries with the same dimension count rank noise with no error; qualification makes drift detectable rather than discoverable by users | Answers stay meaningful as providers change; mixed corpora never compare incompatible vector spaces | [ADR 0003](docs/adr/0003-provider-qualified-vector-spaces.md) |
| An API contract drifts the day it gets a second implementation, and users find out | One contract, two independent backends (FastAPI reference, ASP.NET Core parity), one E2E suite that runs unchanged against both | Parity enforced by execution beats parity enforced by review; drift surfaces as a failing test | Drift gets caught, not shipped - the suite has already caught real parity bugs | [ADR 0001](docs/adr/0001-dual-backend-strategy.md), [CONTRACT.md](docs/CONTRACT.md), [e2e/README.md](e2e/README.md) |
| A reviewer or CI run cannot be required to hold provider API keys | First-class offline demo mode: SHA-256-seeded PRNG embeddings byte-identical in Python and C#, extractive answers labeled in the UI, `demo_mode` reported by `/api/health` | Evaluation without keys, without silent degradation; the honesty rule keeps demo results from ever being presented as model output | Clone and chat in minutes; CI exercises the provider code paths, batching and error handling included, with no credentials | [ADR 0006](docs/adr/0006-offline-demo-mode.md) |
| Two backends share one user table, so accounts and sessions must interoperate | argon2id PHC password hashes plus opaque 256-bit session tokens in one `sessions` table behind an HttpOnly cookie; JWTs rejected | Server-side sessions give revocation and zero shared-secret coupling between runtimes | Register on one backend, log in on the other; a browser session works against both | [ADR 0007](docs/adr/0007-cross-runtime-auth-interop.md) |
| Charts and scans are invisible to text-only retrieval | Per-provider multimodal strategy: Gemini embeds PNG/JPEG chunks straight from pixel bytes; the OpenAI path generates a caption chunk and embeds that | Gemini Embedding 2 accepts image bytes natively; caption-then-embed is the documented pattern for text-only embedding models | Charts and scans are searchable like text, and citations still carry a snippet | [ADR 0004](docs/adr/0004-agentic-enrichment-at-ingestion.md), [embedding research](docs/embedding-research.md) |
| Native embedding dimensions exceed pgvector's HNSW index limit | One `vector(1536)` column: 1536 dimensions requested per provider at embed time (Matryoshka truncation, server-side), one HNSW index for every document | 1536 is `text-embedding-3-small`'s native size, a documented truncation target for both vendors, and comfortably indexable | One index serves the whole corpus; no per-provider tables, partial indexes, or query-time routing | [ADR 0002](docs/adr/0002-uniform-1536-dim-pgvector.md) |

The row that shaped the product most: agentic enrichment at ingestion. The
naive chunk-and-embed loop fails on enterprise documents in two specific
ways. The user asks "can I work from home four days a week?" while the policy
says "maximum three remote days per week": retrieval misses, and the answer is
a policy violation away from wrong. And the budget spreadsheet that IS the
answer embeds as noise when serialized as raw grid text. Moving the model work
to ingestion - writing the summary, keywords, and questions a document
answers, preambling tables, captioning images, and persisting all of it next
to the chunks - pays once per document and closes the gap permanently, while
question time keeps the shape that matters operationally: a single indexed
vector search ([ADR 0004](docs/adr/0004-agentic-enrichment-at-ingestion.md)).

## Request and data flow

One question, end to end:

1. The client sends `POST /api/chat/sessions/{id}/messages {content}` with
   the `docsage_session` HttpOnly cookie; the opaque 256-bit token resolves
   to a row in `sessions` (30-day expiry, the same lookup authenticates both
   backends, [ADR 0007](docs/adr/0007-cross-runtime-auth-interop.md)).
2. Scope decides the candidate set: personal chat retrieves the user's own
   documents plus approved library documents; the admin chat scope retrieves
   across every user and state. Visibility is enforced in the retrieval SQL
   itself, not in the UI ([ADR 0005](docs/adr/0005-access-model-and-sme-approval.md)).
3. Retrieval computes the distinct providers present in the candidate set and
   embeds the query once per provider (Gemini's documented query-side task
   prefix; OpenAI with the same model and dimensions as ingestion; demo is a
   third deterministic space). Per-provider nearest-neighbor searches run over
   the shared HNSW index at top-k 6 with cosine distance; results merge by
   score before the cut. A 0.15 similarity floor filters noise for the real
   providers; demo retrieval is rank-only, because demo vectors are
   deterministic hash noise whose similarities sit near zero
   ([ADR 0003](docs/adr/0003-provider-qualified-vector-spaces.md)).
4. The answer streams back over SSE: `delta` token events, then a
   `citations` event after the text (chunk id, document title, snippet,
   score, page) because the UI renders citation chips below the answer, then
   `done` with the message id for history. Errors mid-stream arrive as
   events, not status codes, because the status code has already shipped by
   the time retrieval or the model fails.
5. The answer must cite `[n]` markers whose order matches the citations
   array; the message and its citations persist in `chat_messages`.

One document, end to end:

1. `POST /api/documents` (multipart: file, provider, scope, optional title
   and topic) returns `202` immediately; the pipeline runs in the background
   through visible states `queued -> extracting -> enriching -> embedding ->
   ready`, or `failed` with the reason in `status_error`.
2. Extract runs per format (PDF text and tables, DOCX paragraphs and tables
   and inline images, XLSX sheets, PNG/JPEG image parts, txt/md/csv raw)
   into ordered parts.
3. Enrich passes write the document summary, keywords, and hypothetical
   questions into `enrichments`, caption every image part (persisted as an
   `image_description` chunk that every provider can embed as text), and
   prepend a one-line preamble to table parts. Demo mode substitutes
   deterministic extractive stand-ins with the same artifact shape.
4. Embed chunks of roughly 1,100 tokens with 150 overlap; each chunk's
   embedding text is prefixed with the document title and enrichment
   context; vectors store into `vector(1536)` under the provider chosen at
   upload, immutable thereafter.
5. A library document reaching `ready` enters `pending_sme`: invisible to
   regular users until a designated SME for its topic (or an admin) records
   an approval with an optional note, which makes it searchable agency-wide.
   A rejected document stays in the corpus for the admin fix-and-resubmit
   workflow but never surfaces to regular users.

## Stack, and why

| Area | Choice, and why |
|---|---|
| **Frontend** | Next.js 16 (App Router, React 19), Tailwind CSS v4, shadcn-style primitives, dark and light themes; typed API client that parses the SSE stream itself |
| **Reference API** | Python 3.13, FastAPI, SQLAlchemy 2 + psycopg 3, alembic: automatic OpenAPI, Pydantic v2 validation, first-class async and SSE, plus the strongest document-processing ecosystem in any language (pypdf, pdfplumber, python-docx, openpyxl) ([ADR 0001](docs/adr/0001-dual-backend-strategy.md)) |
| **Parity API** | .NET 10 minimal APIs, Npgsql + Dapper, OpenXML / ClosedXML / PdfPig extractors; connects to the same database and never migrates ([ADR 0001](docs/adr/0001-dual-backend-strategy.md)) |
| **Database** | PostgreSQL 17 + pgvector: one `vector(1536)` column under one HNSW cosine index, dimensions requested per provider at embed time ([ADR 0002](docs/adr/0002-uniform-1536-dim-pgvector.md)) |
| **Providers** | Google `gemini-embedding-2` (natively multimodal) plus flash models for enrichment; OpenAI `text-embedding-3-small` plus `gpt-5.6` Responses streaming; a deterministic demo provider with zero keys ([ADR 0006](docs/adr/0006-offline-demo-mode.md)) |
| **Auth** | argon2id PHC hashes and opaque 256-bit session tokens in HttpOnly cookies; both runtimes resolve the same rows ([ADR 0007](docs/adr/0007-cross-runtime-auth-interop.md)) |

## Testing

Counts live here because this is the engineer track; each tier protects
something specific.

- **42 backend integration tests** (`cd backend && uv run pytest -q`) run
  against a real Postgres + pgvector database the suite creates and destroys
  per run, including extraction goldens per format.
- **32 .NET tests** (`cd dotnet && dotnet test`) cover the parity slice,
  including cross-runtime vector parity: the demo embedding algorithm is
  implemented in both languages and must produce identical vectors.
- **10 frontend unit tests** (`npm run test:unit`) cover the SSE parser and
  formatters, alongside lint and a production build.
- **36 Playwright E2E tests** (`cd e2e && npx playwright test`) drive the
  real UI over the whole stack: all eight upload formats plus rejection
  cases, the pipeline, citations, SME approvals, admin cross-search, theming.
  One command boots both servers against an isolated `docsage_e2e` database
  your dev data never touches.

The dual-backend parity story: the same E2E suite runs unchanged against both
backends (`npm run test:dotnet`, 31 tests per backend; `E2E_BACKEND` only
swaps which server occupies :8100). A test that passes on FastAPI but fails on
.NET is a parity bug, and the suite has caught real ones: registration not
setting the session cookie, and `embedding_model` missing from the document
summary DTO. That is what "the contract is executable" means. Full guide,
including how to add tests: [e2e/README.md](e2e/README.md).

CI ([ci.yml](.github/workflows/ci.yml)) runs every suite on each push against
a pgvector service container, and the E2E job runs both backend variants.

## Security and operations

- **Auth:** argon2id PHC password hashes, opaque 256-bit tokens with 30-day
  expiry in HttpOnly cookies (Secure in production); JWTs were rejected in
  favor of server-side sessions, which give revocation and zero shared-secret
  coupling between runtimes ([ADR 0007](docs/adr/0007-cross-runtime-auth-interop.md)).
- **Isolation in SQL, not the UI:** owner and visibility predicates run in
  retrieval itself; admin visibility of personal documents exists only inside
  the admin chat scope and is labeled on screen
  ([ADR 0005](docs/adr/0005-access-model-and-sme-approval.md)).
- **Provider keys:** server-side only, in a gitignored `backend/.env`; the
  frontend only ever reads availability booleans from `/api/health`.
  Activation is more than the key: set `DOCSAGE_DEMO_MODE=false`, restart,
  confirm via `/api/health`. Step-by-step for Gemini, OpenAI, and
  OpenAI-compatible endpoints: [docs/providers.md](docs/providers.md).
- **Honesty rule:** demo mode is reported by `/api/health`, bannered in the
  UI, and provider cards stay badged "requires API key" until configured;
  demo results are never presented as model output
  ([ADR 0006](docs/adr/0006-offline-demo-mode.md)).
- **What is not built yet:** documented, not silent - vector-only retrieval
  with no reranker, no re-embedding migrations, an in-process background
  pipeline, no horizontal-scale story; see
  [docs/limitations.md](docs/limitations.md).

## Jargon

Terms used across this repo, from [RAG](docs/GLOSSARY.md) and
[SME](docs/GLOSSARY.md) to [provider-qualified space](docs/GLOSSARY.md) and
[parity testing](docs/GLOSSARY.md), are defined in the
[glossary](docs/GLOSSARY.md), plain English first, precisely second.
