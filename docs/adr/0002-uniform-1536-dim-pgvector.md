# ADR 0002 - One vector column: uniform 1536 dimensions in pgvector

**Status:** Accepted

## Context

Documents are embedded at upload with the provider the user chose (Google
Gemini or OpenAI) and retrieval happens later with a query embedded at ask
time. The two providers emit different native dimensionalities, and pgvector's
indexing limits bite at exactly the wrong place:

- pgvector `vector` columns can *store* up to 16,000 dimensions, but HNSW and
  IVFFlat **indexes top out at 2,000 dimensions** for `vector`.
- Gemini's embedding model emits up to 3,072 dimensions natively; OpenAI's
  `text-embedding-3-large` also emits 3,072. Both are over the 2,000-dim index
  ceiling. `halfvec` raises the index ceiling to 4,000 at half precision.

## Decision

Every chunk is stored in a single `vector(1536)` column with one HNSW index
(`vector_cosine_ops`), regardless of provider:

- **Gemini:** request `outputDimensionality: 1536` at embed time (Matryoshka
  truncation server-side).
- **OpenAI:** request `dimensions: 1536` at embed time (`text-embedding-3-small`
  is natively 1536; `-large` truncates). OpenAI's guidance is to shorten via the
  API parameter rather than post-hoc slicing, and both vendors document
  Matryoshka truncation with modest, measured quality loss.

## Consequences

- One index serves all documents; no per-provider tables, partial indexes, or
  query-time routing by column.
- 1536 is the natural meeting point: it is `text-embedding-3-small`'s native
  size, a documented truncation target for both larger models, and comfortably
  within every pgvector index limit.
- We accept the (documented, small) quality delta of truncating 3072→1536 for
  Gemini and `3-large`, in exchange for operational simplicity. An upgrade path
  exists if quality ever demands it: `halfvec(3072)` with an HNSW index, at the
  cost of two column families.
- Truncated vectors from the API arrive pre-normalized; any manual truncation
  path must re-normalize to unit length (per OpenAI's embedding guide).
