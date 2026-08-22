# The questions we had to answer - a build narrative

DocSage looks like a chat box. It isn't. It is a chain of decisions about
trust, geometry, money, and documents that fight back. This is the honest
narrative of the questions the build raised and how each one was resolved -
the companion to the ADRs, which record the *what*; this records the *why it
hurt*.

## 1. "Can't we just chunk and embed?"

The naive RAG loop (split the PDF, embed the pieces, cosine the question)
works beautifully on blog posts and collapses on enterprise documents. Three
failure modes, all observed while shaping the seed corpus:

- **Vocabulary mismatch.** The telework policy says *"maximum three remote
  days per week."* The user asks *"can I work from home four days a week?"*
  No lexical or strong semantic overlap. Retrieval misses; the answer is a
  policy violation away from wrong.
- **Modality mismatch.** The budget spreadsheet *is* the answer to "what is
  the Q3 security appliance spend?" - as raw grid text it embeds as noise.
  The ticket-volume chart is a picture; a text-only pipeline never sees it.
- **Grounding mismatch.** An answer about incident reporting timeframes is
  only useful if it says *which document, which page* said so.

The resolution is the agentic pipeline (ADR 0004): pay model cost **once per
document** at ingestion (summary, keywords, hypothetical user questions,
table preambles, image captions) and persist those artifacts next to the
chunks. Query time stays a single indexed vector search. The hypothetical
questions are the subtle win: embedding the *questions a document answers*
bridges the vocabulary gap better than embedding the policy sentence alone.

## 2. Which embedding model - and what does "multimodal" actually mean here?

We went to the vendor docs rather than the marketing pages (full research in
`embedding-research.md`), and the ground truth was surprising in both
directions:

- Google's **`gemini-embedding-2`** (GA April 2026) is *natively* multimodal:
  the same vector space consumes text, image bytes, video, audio, and PDF.
  A PNG can be embedded from pixels - no caption round-trip.
- OpenAI's embedding lineup (text-embedding-3) is text-only, full stop, and
  has been since Jan 2024. The *documented* OpenAI pattern for image retrieval
  is exactly the caption-then-embed dance.

So "which model" became "which *strategy*," and the honest answer is: both,
as a per-upload choice. Gemini uploads embed images natively; OpenAI uploads
reach images through generated captions. The trade is price (Gemini text at
$0.20/1M tokens vs OpenAI small at $0.02) against native perception. Making
the provider a visible, per-document decision (instead of a hidden config
constant) turned an architecture commit into a product feature.

## 3. One vector column or two? (The dimension ceiling nobody mentions)

Both providers default to 3,072 dimensions. pgvector's HNSW index tops out at
**2,000 dimensions** for `vector` columns. Build it naively and your index
creation fails at 3,072 - or worse, you skip the index and every question is
a full table scan.

The escape hatch is Matryoshka truncation, which both vendors support
*server-side*: request 1,536 dimensions at embed time. That number is not
arbitrary - it is `text-embedding-3-small`'s native size, a documented Gemini
truncation target, and comfortably indexable. One column, one HNSW index, all
providers (ADR 0002). The cost is a measured-but-small quality delta, and we
wrote the upgrade path (`halfvec`) down before we needed it.

## 4. The silent killer: two vector spaces in one index

Nothing stops you from writing a Gemini vector and an OpenAI vector into the
same column. Cosine similarity between them returns *numbers*. The numbers
are garbage - different geometries, incomparable axes. A mixed corpus queried
with one provider's query vector ranks half the corpus by noise, with no
error, ever.

This is why `documents.embedding_provider` exists and why retrieval embeds
the **query once per provider actually present in the candidate set** (at
most two calls, usually one) and merges per-provider results (ADR 0003). The
same discipline covers model *generations*: Google explicitly documents that
`gemini-embedding-001` and `-2` spaces are incompatible - hence
`embedding_model` on every document, so drift is detectable, not discoverable
by users receiving subtly wrong answers.

## 5. What exactly do you embed? Raw chunks lie less than you'd think - but still lie

Chunk content alone loses document context: a paragraph saying "approval
authority: Director" is meaningless without the policy it belongs to. Both
vendors' retrieval guidance points the same direction - pair documents with
titles/context. So the embedding text for a chunk is the document title plus
a compressed enrichment context line plus the content; queries use the
vendor's query-side format (Gemini v2's `task: search result | query:` prefix;
v2 dropped `task_type` entirely, a fact you only learn from the API
reference, not the marketing page).

## 6. Who is allowed to find what?

Requirements pull against each other: strict personal isolation, but an
agency-wide trusted library; admin power, but not admin creep. The model we
landed on (ADR 0005):

- personal documents: owner-only, embedded immediately, no review;
- library documents: admin-ingested, topic-filed, **invisible until a
  designated SME approves**, approvals append-only;
- the admin chat scope searches *everything* - and says so on the screen,
  because a compliance power that's invisible isn't a control, it's a
  liability.

The wrinkle we argued about longest: **no self-approval**. An admin who
uploads a policy cannot also approve it. The audit trail only means something
if the approver is a different person with topic authority - SME designation
is a relationship per topic, not a global role.

## 7. What happens when the answer needs to arrive word by word?

A chat product that blocks for eight seconds then dumps a paragraph feels
broken; an answer that streams but arrives without its sources feels worse.
The SSE protocol ended up as three event types: `delta` (tokens, live),
`citations` (chunk ids, titles, snippets, scores, pages; *after* the text,
because the UI renders chips below the answer), `done` (message id for
history), with errors as events mid-stream rather than status codes, because
the status code has already shipped by the time retrieval or the model fails.

## 8. How do you demo (and test) a key-gated system?

Everything above depends on provider APIs. A reviewer cloning the repo has no
keys. Silently degrading (uploads "succeed", search returns garbage) is the
worst outcome, so demo mode is a first-class provider (ADR 0006): a
deterministic SHA-256-seeded PRNG embedding, implemented **byte-identically
in Python and C#** so the demo corpus interops across both backends;
extractive chat answers clearly labeled as demo; the UI badges real providers
as "unavailable until configured." The pipeline shape (statuses, enrichments,
approvals, citations) is identical; only the model behind stage three
differs. Demo mode became the backbone of CI, not a consolation prize.

## 9. Two backends, one truth

Building the FastAPI reference *and* the ASP.NET Core parity slice (ADR 0001)
surfaced every implicit assumption: password hashes must verify across
runtimes (argon2id PHC strings, no proprietary encodings), sessions must be
rows both stacks read, the schema needs exactly one owner (alembic; the .NET
side connects, never migrates), and the demo PRNG needed a language-agnostic
spec before either side wrote a line. The contract document stopped being
paperwork the moment two runtimes executed it.

## 10. What we deliberately did not build (yet)

Documented extension paths, not silence: hybrid BM25+vector retrieval and a
reranker (OpenAI exposes RRF fusion in File Search; a `tsvector` column is
the postgres-native path); native PDF/video/audio page embeddings via Gemini
Embedding 2's multimodal inputs (text extraction won for v1 because
*citations need text snippets*); re-embedding migrations between models or
providers; query decomposition and multi-hop agentic retrieval. Each is a
scoped, describable next step - which is what a portfolio project is for.

---

*The ADRs (`docs/adr/`) record each decision formally; `docs/CONTRACT.md` is
the executable version of this narrative.*
