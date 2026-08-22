# Embedding provider research: Gemini Embedding 2 vs OpenAI text-embedding-3

Research date: 2026-08-26. Every claim below was verified against the vendor's
official documentation on that date (sources listed at the end). This document
drives the provider design in `docs/CONTRACT.md` and ADRs 0002-0004.

## Why "Gemini Embedding 2" specifically

Google's current-generation embedding model is **`gemini-embedding-2`** (GA
April 22, 2026; the `-preview` id was retired Aug 10, 2026). It is Google's
first **natively multimodal** embedding model: one model, one vector space,
accepting:

| Modality | Limits per request |
|---|---|
| Text | shared 8,192-token budget |
| Images (PNG/JPEG) | max 6; 258 tokens each; ≤16,384 px |
| Video (MP4/MOV) | max 1; ≤120 s, ≤32 sampled frames |
| Audio (MP3/WAV) | ≤180 s; 25 tokens/s |
| PDF | 1 file; ≤6 pages; OCR always on (Gemini API) |

Output: 128-3,072 dimensions (Matryoshka), default 3072. Truncated outputs are
**automatically L2-normalized** - unlike the legacy `gemini-embedding-001`,
which requires manual normalization below 3072 dims.

The predecessor `gemini-embedding-001` is text-only and now legacy (earliest
shutdown May 2028); `text-embedding-004` was shut down Jan 14, 2026.

**The v2 API differs from everything before it:** `task_type` is NOT supported.
Instead, tasks are expressed as literal text prefixes that must match on both
sides of retrieval:

- documents: `title: {title} | text: {content}` (`title: none` if absent)
- queries: `task: search result | query: {question}`

Batching subtlety: with v2, multiple parts in a single request produce **one
aggregated embedding**; separate embeddings require one request per input
(`batchEmbedContents` with individual request objects, or the SDK's
`contents=[...]` string-list expansion which routes there).

## OpenAI's side of the comparison

The OpenAI embedding lineup is unchanged since Jan 2024: `text-embedding-3-small`
(1536 dims, **$0.02/1M tokens**), `text-embedding-3-large` (3072 dims,
$0.13/1M), legacy `ada-002`. **There is no OpenAI multimodal embedding model
as of Aug 2026** - input is text-only (8,192 tokens max per input, 300k tokens
per request, ≤2,048 inputs). The `dimensions` parameter provides Matryoshka
truncation; manual truncation must be re-normalized.

For images, OpenAI's documented pattern is exactly our enrichment design: a
vision-capable chat model (the entire GPT-5.6 family accepts image input)
describes the image, and the description is embedded as text.

| | Gemini Embedding 2 | OpenAI text-embedding-3 |
|---|---|---|
| Native input | text, image, video, audio, PDF | text only |
| Max input | 8,192 tokens (shared, multimodal) | 8,192 tokens/input |
| Dimensions | 128-3072, auto-normalized truncation | 1536/3072, `dimensions` param |
| Task signaling | text prefixes (`title: …`, `task: …`) | none needed |
| Text price /1M tok | $0.20 (batch $0.10) | $0.02 (small) |
| Image price | $0.00012/image | n/a (captioning chat cost instead) |

**Trade-off in one line:** Gemini Embedding 2 sees pixels natively at 10× the
text-token price of OpenAI small; OpenAI is dramatically cheaper for
text-heavy corpora but reaches images only through generated captions.

## What DocSage implements

1. **Provider is a per-document choice at upload** (`gemini` | `openai` |
   `demo`), recorded on `documents.embedding_provider` +
   `documents.embedding_model`.
2. **Uniform 1536 dimensions** in one `vector(1536)` pgvector column with one
   HNSW cosine index - inside pgvector's 2,000-dim `vector` index ceiling, a
   documented MRL target for Gemini, and `text-embedding-3-small`'s native
   size (ADR 0002).
3. **Gemini provider** (`gemini-embedding-2`, via the `google-genai` SDK):
   - text chunks embed as `title: {doc title} | text: {chunk}`;
   - queries embed as `task: search result | query: {question}`;
   - PNG/JPEG chunks embed **natively from image bytes** (`inline_data`), one
     request per image (separate embeddings, per the aggregation rule);
   - `output_dimensionality=1536`; vectors arrive pre-normalized.
4. **OpenAI provider** (`text-embedding-3-small`): `dimensions=1536`, input
   newlines collapsed to spaces; images enter the index through their
   caption chunks. Chat answers use the **Responses API** with streaming
   (`response.output_text.delta` events), model `gpt-5.6-terra` by default.
5. **Vector spaces never mix** (ADR 0003): retrieval groups the candidate
   corpus by stored provider, embeds the query once per provider present
   (max two), merges by cosine similarity. Google explicitly warns that
   embedding spaces from different model generations are incompatible -
   re-embedding is a migration, not a flag.
6. **Enrichment model follows the provider family**: Gemini uploads are
   enriched/captioned by Gemini flash models; OpenAI uploads by
   `gpt-5.6-terra`. Enrichment artifacts (summary, keywords, hypothetical
   questions, captions, table preambles) are stored rows, not prompt cache.
7. **Demo provider** closes the loop without keys (ADR 0006).

## Guidance we follow from the vendors

- Cosine similarity as the metric; both vendors recommend it and both note
  normalized vectors make cosine/dot/rankings equivalent.
- Stable instructions before dynamic content in prompts (OpenAI prompt-cache
  guidance) - our answer prompt puts the grounding instructions first and the
  retrieved passages + question last.
- Batching embeddings (Gemini batch = 50% price; OpenAI arrays up to 2,048
  inputs / 300k tokens); retries on 429/5xx with exponential backoff - the
  `google-genai` SDK has retries **off by default**, so we implement our own.
- Chunk sizing informed by both vendors: ~1,100 tokens with 150 overlap sits
  under every input ceiling (OpenAI File Search defaults to 800-token chunks
  with 400 overlap; Gemini's budget is 8,192 shared tokens).

## Sources

Google (verified 2026-08-26):
- Gemini API embeddings guide - https://ai.google.dev/gemini-api/docs/embeddings
- Embeddings REST reference (`batchEmbedContents`, `embedContentConfig`) - https://ai.google.dev/api/embeddings
- `gemini-embedding-2` model card - https://ai.google.dev/gemini-api/docs/models/gemini-embedding-2
- Deprecations (model timeline) - https://ai.google.dev/gemini-api/docs/deprecations
- Pricing - https://ai.google.dev/gemini-api/docs/pricing · Rate limits - https://ai.google.dev/gemini-api/docs/rate-limits
- Gemini Embedding 2 announcement - https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-embedding-2/
- Vertex multimodal embeddings - https://docs.cloud.google.com/vertex-ai/generative-ai/docs/embeddings/get-multimodal-embeddings
- `google-genai` SDK - https://googleapis.github.io/python-genai/

OpenAI (verified 2026-08-26):
- Embeddings guide - https://developers.openai.com/api/docs/guides/embeddings
- Embeddings API reference - https://developers.openai.com/api/reference/resources/embeddings/index.md
- Pricing - https://developers.openai.com/api/docs/pricing · Changelog - https://developers.openai.com/api/docs/changelog
- Models / GPT-5.6 family - https://developers.openai.com/api/docs/models
- Responses API + streaming - https://developers.openai.com/api/docs/guides/streaming-responses
- Images & vision input - https://developers.openai.com/api/docs/guides/images-vision
- Retrieval / File Search (hybrid + rerank options) - https://developers.openai.com/api/docs/guides/retrieval

pgvector:
- pgvector README (dimension limits, HNSW, tuning) - https://github.com/pgvector/pgvector
- pgvector-python (SQLAlchemy `Vector`, `cosine_distance`) - https://github.com/pgvector/pgvector-python
