# ADR 0004 - Agentic enrichment at ingestion, not at query time

**Status:** Accepted

## Context

Enterprise documents are hostile to plain chunk-and-embed retrieval: PDFs hide
tables in layout, Word files carry images with no alt text, spreadsheets are
grids with no prose, and policy language answers questions it never literally
states ("Can I work from home 4 days a week?" vs "maximum three remote days per
week"). Two places exist to fix this: at query time (rewrite, expand, rerank;
every user pays, every time) or at ingestion (pay once per document).

## Decision

Ingestion is a multi-stage **agentic pipeline**, run in the background after
upload, with visible status (`queued → extracting → enriching → embedding →
ready`):

1. **Extract** per format into ordered parts: text blocks, tables serialized
   as markdown rows, and image parts (PDF pages via pypdf/pdfplumber; docx via
   python-docx incl. inline images; xlsx via openpyxl; PNG/JPEG as image parts;
   txt/md/csv raw).
2. **Enrich** - LLM passes whose outputs are persisted, versioned artifacts:
   - document-level summary, keyword set, and *hypothetical questions users
     would ask* (stored in `enrichments`);
   - vision captions for image parts, persisted as `image_description` chunks -
     the documented pattern for multimodal retrieval on text-only embedding
     models (OpenAI), and universally useful for citations and snippets;
   - one-line "what this table contains" preambles for table parts.
3. **Embed with modality awareness** - Gemini Embedding 2 accepts image bytes
   natively, so with the Gemini provider PNG/JPEG chunks embed directly from
   pixel data while captions remain as an additional text chunk; with OpenAI
   (text-only embeddings) images enter the index only through their captions.
3. **Embed** chunks of ~1,100 tokens with 150-token overlap. Each chunk's
   embedding text is content prefixed with lightweight enrichment context
   (document title + summary line + keywords), following both vendors'
   retrieval guidance of pairing documents with contextual titles.

## Consequences

- Retrieval at question time stays a single indexed vector search - latency
  and cost move from per-query to per-document, which is the right trade for
  a knowledge base read many times.
- Hypothetical questions close the vocabulary gap between policy language and
  user questions; captions make images retrievable; table preambles make
  spreadsheets answerable.
- Ingestion is slower and depends on provider availability; failures land the
  document in `failed` with `status_error` rather than blocking the upload.
- Enrichment quality is bounded by the enrichment model; the demo mode uses
  deterministic extractive stand-ins so the pipeline shape is identical
  without keys.
