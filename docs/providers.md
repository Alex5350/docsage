# Configuring AI model providers

DocSage runs fully offline in demo mode. This guide turns on the real thing:
Google Gemini, OpenAI, any OpenAI-compatible endpoint, and what it takes to
add a brand-new provider. Every step is copy-pasteable.

## How activation works (30-second version)

1. Provider keys live in **`backend/.env`** - never in the repository.
2. Keys alone are not enough: `DOCSAGE_DEMO_MODE=true` (the default) keeps
   providers off. **Set `DOCSAGE_DEMO_MODE=false` when you add keys.**
3. Restart the backend, then confirm with:
   ```bash
   curl -s localhost:8000/api/health
   # {"status":"ok", ... "demo_mode":false, "providers":{"gemini":true,"openai":false}}
   ```
4. The upload screen's provider cards unlock automatically - the UI reads the
   same health endpoint. Existing demo-mode documents keep working: retrieval
   routes queries by each document's stored provider.

## Google Gemini (embeddings + enrichment + chat fallback)

**What you get:** `gemini-embedding-2` (natively multimodal, so PNG/JPEG
chunks embed straight from pixels) plus a flash model for the agentic
enrichment passes (summaries, keywords, questions, image captions), and a
streaming fallback for chat answers when no OpenAI key is present.

**Steps:**

1. Go to **https://aistudio.google.com/apikey** and sign in with a Google
   account.
2. Click **Create API key** → choose or create a project → copy the key
   (starts with `AIza...`).
3. Put it in `backend/.env`:
   ```bash
   cp .env.example backend/.env      # if you haven't already
   cat >> backend/.env <<'EOF'
   GEMINI_API_KEY=AIza...your...key...
   DOCSAGE_DEMO_MODE=false
   EOF
   ```
4. Restart the backend (`uv run uvicorn docsage_api.main:app --port 8000`) and
   check `/api/health` shows `"gemini":true`.
5. In the app: **Upload → the "Gemini Embedding 2" card is now selectable.**
   Upload the same image twice (once with Gemini, once with Demo) and the
   documents page shows both with their models.

**Optional model overrides** (also in `backend/.env`):

| Variable | Default | What it controls |
|---|---|---|
| `DOCSAGE_GEMINI_EMBEDDING_MODEL` | `gemini-embedding-2` | embedding model at upload |
| `DOCSAGE_GEMINI_VISION_MODEL` | `gemini-2.5-flash` | enrichment + image captions |

**Cost intuition** (pricing page, per 1M tokens): text embedding $0.20,
images $0.00012 each, flash enrichment pennies per document. The entire
`db/seed-corpus` costs well under one cent. A free tier exists for trying
things out; rate limits are per project and visible at
https://aistudio.google.com/rate-limit.

## OpenAI (embeddings + grounded chat answers)

**What you get:** `text-embedding-3-small` embeddings (images reach the index
through generated captions; OpenAI embeddings are text-only), and streaming
chat answers from the Responses API with citations.

**Steps:**

1. Go to **https://platform.openai.com/api-keys** and sign in.
2. **Add billing credit first** (Settings → Billing): API keys do not work
   without prepaid balance. $5 goes a very long way for this app.
3. **Create new secret key** (optionally scoped to a project). Copy it
   immediately - it is shown once (`sk-...`).
4. Put it in `backend/.env` alongside the demo-mode flip:
   ```bash
   GEMINI_API_KEY=...        # optional, both providers can coexist
   OPENAI_API_KEY=sk-...your...key...
   DOCSAGE_DEMO_MODE=false
   ```
5. Restart the backend; `/api/health` shows `"openai":true`; the OpenAI
   provider card unlocks, and chat answers switch from extractive demo text
   to real model answers (still with citations).

**Optional model overrides:**

| Variable | Default | Notes |
|---|---|---|
| `DOCSAGE_OPENAI_EMBEDDING_MODEL` | `text-embedding-3-small` | `-large` also supported (truncated to 1536 via `dimensions`) |
| `DOCSAGE_OPENAI_CHAT_MODEL` | `gpt-5.6-terra` (balanced) | `gpt-5.6-luna` cheapest, `gpt-5.6-sol` flagship |

**Cost intuition:** embeddings $0.02/1M tokens (the seed corpus ≈ fractions of
a cent); chat on `terra` is $2/$12 per 1M input/output tokens - a typical
grounded answer with six passages is a few thousand tokens in, a few hundred
out.

**Both keys at once is fine** - the provider is chosen per document at
upload; chat answers prefer OpenAI and fall back to Gemini if only that key
is present.

## Other providers

### Any OpenAI-compatible endpoint (vLLM, Ollama, LiteLLM, gateways)

The OpenAI client honors `OPENAI_BASE_URL`, so self-hosted or proxied
OpenAI-compatible servers work without code changes:

```bash
# example: a local vLLM or Ollama OpenAI-compatible endpoint
OPENAI_BASE_URL=http://localhost:11434/v1
OPENAI_API_KEY=not-needed-for-local      # most local servers accept any value
DOCSAGE_OPENAI_EMBEDDING_MODEL=nomic-embed-text
DOCSAGE_OPENAI_CHAT_MODEL=llama3.3
DOCSAGE_DEMO_MODE=false
```

Caveat: DocSage requests `dimensions: 1536` on embeddings (the uniform
pgvector column, ADR 0002). Endpoints whose models don't support the
`dimensions` parameter will fail ingestion for that provider - the document
lands in `failed` with the reason in `status_error`. Use an embedding model
that emits 1536 dimensions natively.

### Adding a first-class provider

The provider seam is one interface: `services/embeddings/base.py`
(`EmbeddingProvider`: `embed_documents`, `embed_query`, optional
`embed_image`). To add, say, Cohere:

1. `backend/src/docsage_api/services/embeddings/cohere.py` - implement the
   protocol (1536-dim output, or truncate + re-normalize per ADR 0002).
2. Register it in the factory `get_provider(...)` and in
   `provider_available(...)` with its key env var.
3. **Schema:** `documents.embedding_provider` has a CHECK constraint listing
   the allowed values - add an alembic migration extending it, and update
   `docs/CONTRACT.md` (both backends implement the contract).
4. UI: add a card in `frontend/src/components/upload/provider-picker.tsx`
   following the existing three; the health endpoint already carries the
   availability flag.
5. Mirror or consciously skip the .NET side (`dotnet/Docsage.Api/Providers/`);
   the contract allows the parity API to lag, but document the decision in
   an ADR.
6. If the provider is multimodal, implement `embed_image` and wire it in
   `services/ingestion.py` the way Gemini's native image path is wired.

## Security practices

- `backend/.env` is gitignored - **never** commit keys. If one leaks, revoke
  and rotate it at the provider console immediately (both consoles support
  deletion; OpenAI also supports project-scoped keys).
- Keys are read **server-side only**; the frontend never sees them - it only
  reads booleans from `/api/health`.
- CI and E2E stay in demo mode on purpose: no secrets in logs, no
  non-determinism, no spend.
- For a real deployment, inject env vars from a secret manager instead of a
  file, and set `DOCSAGE_ENV=production` (also flips cookies to Secure).

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Provider cards still disabled after adding keys | `DOCSAGE_DEMO_MODE` still `true` (it defaults to true), or the backend wasn't restarted - check `/api/health` |
| Upload fails with "provider not available" | That provider's key is missing at upload time; pick Demo or add the key |
| Document lands in `failed` | Open its detail card - `status_error` carries the provider's error (often a rate limit) |
| Frequent 429s | Free-tier rate limits; the pipeline retries 429/5xx three times, then fails the document - retry later or raise limits |
| Custom endpoint ingestion fails | Endpoint rejected `dimensions:1536`; pick a 1536-dim embedding model |
| Surprising bill | Vision captions bill per image; big PDF/DOCX corpora multiply enrichment calls. Costs per provider are in `docs/embedding-research.md` |
