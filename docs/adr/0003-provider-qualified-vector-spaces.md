# ADR 0003 - Vector spaces are provider-qualified; queries embed per provider

**Status:** Accepted

## Context

Users choose the embedding provider per document at upload. Gemini and OpenAI
embeddings are trained independently: a cosine similarity between a Gemini
document vector and an OpenAI query vector is meaningless - same dimension
count, incompatible geometry. Naively embedding the query once with whichever
provider the operator prefers would silently rank cross-provider documents by
noise.

## Decision

1. `documents.embedding_provider` records which space each document's chunks
   live in; the value is chosen at upload and immutable thereafter.
2. At query time the retrieval layer computes the **distinct set of providers
   present in the candidate corpus** (typically one, at most two) and embeds
   the query once per provider, using each vendor's recommended query-side
   task settings (`RETRIEVAL_QUERY` task type for Gemini; same model and
   `dimensions` as ingestion).
3. Per-provider nearest-neighbor searches run against the shared HNSW index
   with the matching query vector; results are merged by cosine similarity
   before the top-k cut. Scores are never compared across providers beyond
   this practical merge - the corpus is expected to be provider-homogeneous
   per deployment in practice.

## Consequences

- Mixed corpora retrieve correctly from every document.
- Worst case doubles embedding cost per question (one extra call only when a
  second provider actually exists in scope).
- Re-embedding a document under a different provider requires a migration
  command, not a flag flip; that is intentionally out of scope for v1 and
  recorded, with the other extension paths, in `docs/limitations.md`.
- The demo provider follows the same rule - it is a third, deterministic space
  (see ADR 0006), which is exactly why query embedding must route by stored
  provider rather than by current configuration.
