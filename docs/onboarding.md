# Onboarding - from clone to chatting with your documents

Target: a new developer reaches a running DocSage with demo data in under
ten minutes, then understands where everything lives. Every command below is
copy-pasteable from the repo root: `/Users/alex/portfolio/docsage` locally,
or your clone.

## 0. Prerequisites

| Tool | Version used | Check |
|---|---|---|
| Docker (any runtime: Docker Desktop, colima, OrbStack) | - | `docker ps` |
| Python + [uv](https://docs.astral.sh/uv/) | 3.13 / uv 0.9+ | `uv --version` |
| Node.js | 22 LTS | `node --version` |
| .NET SDK (only for the parity API) | 10 | `dotnet --version` |

No API keys are required - DocSage runs fully offline in demo mode
(ADR 0006). Add `GEMINI_API_KEY` and/or `OPENAI_API_KEY` later to unlock the
real providers.

## 1. Database

```bash
docker compose up -d db        # Postgres 17 + pgvector on localhost:5433
```

Health check: `docker exec docsage-db psql -U docsage -c "SELECT 1"`.

Port 5433 is deliberate - 5432 is very often taken by a local Postgres, and
this project must not fight it.

## 2. Backend (FastAPI - the reference implementation)

```bash
cd backend
uv sync                        # creates .venv, installs runtime + dev deps
cp ../.env.example .env        # DOCSAGE_DATABASE_URL already points at 5433
uv run alembic upgrade head    # creates schema + vector extension + HNSW index
uv run python -m docsage_api.seed --fresh   # demo users, topics, documents
uv run uvicorn docsage_api.main:app --port 8000 --reload
```

Sanity: `curl localhost:8000/api/health` →
`{"status":"ok","database":"up","demo_mode":true,...}`.

Demo accounts (all passwords `docsage-demo`):

| Account | Role | Why it exists |
|---|---|---|
| `admin@docsage.dev` | admin | library ingestion, topics, SME designation, admin chat scope |
| `morgan@docsage.dev` | user + SME (Workplace Policy, Budget & Finance) | approval queue |
| `casey@docsage.dev` | user + SME (Security, Records Management) | approval queue + personal docs |
| `riley@docsage.dev` | user | personal workspace + seeded chat history |

## 3. Frontend

```bash
cd frontend
npm install
cp .env.local.example .env.local   # NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
npm run dev -- --port 3000
```

Open http://localhost:3000, sign in as `riley@docsage.dev`, and ask the
seeded conversation *"How many remote days are allowed per week?"* - you
should get a demo-mode extractive answer citing the Telework policy.

## 4. The .NET parity API (optional)

Same database, same contract, different runtime (ADR 0001):

```bash
cd dotnet
dotnet test                          # integration tests spin up against 5433
DOCSAGE_DATABASE_URL=postgresql+psycopg://docsage:docsage@localhost:5433/docsage \
dotnet run --project Docsage.Api --urls http://localhost:8001
```

Point the frontend at it by changing `NEXT_PUBLIC_API_BASE_URL` to
`http://localhost:8001`. Sessions, password hashes, and demo embedding
vectors are interoperable across both backends (ADR 0007).

## 5. Tests

```bash
cd backend && uv run pytest -q       # integration tests against the docker db
cd dotnet  && dotnet test            # parity-slice integration tests
cd frontend && npm run lint && npm run build
cd e2e     && npx playwright test    # user-journey tests (boots their own stack)
```

The E2E suite needs `docker compose up -d db` and nothing else - it creates
its own `docsage_e2e` database, starts the backend on :8100 and the frontend
on :3000, generates a fictional fixture corpus, and runs headless. Watch it
drive the browser with `npm run test:headed` from `e2e/`, or step through
failures with `npm run test:debug`. The full guide - including how to write
your own tests - is **[e2e/README.md](../e2e/README.md)**.

The Python suite creates and destroys its own `docsage_test` database per
run - it never touches your dev data.

## 6. Where things live

```
backend/src/docsage_api/
  core/          settings, argon2 hashing, session tokens
  db/            SQLAlchemy models (the schema), engine + session factory
  routers/       one file per API area: auth, documents, topics, reviews, chat, admin, health
  services/
    extraction/  pdf / docx / xlsx / image / plain-text → ordered parts
    embeddings/  gemini-embedding-2, text-embedding-3, deterministic demo
    enrichment.py  the agentic pass: summaries, keywords, questions, captions
    ingestion.py   the pipeline state machine (queued→…→ready)
    retrieval.py   provider-qualified vector search
    answer.py      SSE answer composition (OpenAI Responses / Gemini / demo)
  seed.py        demo data through the REAL pipeline
frontend/src/
  app/           (app) group = authenticated shell; landing + login outside
  lib/           typed API client (SSE parsing) + contract DTOs
  components/    shadcn-style primitives + app shell
dotnet/          Docsage.Api (minimal APIs) + tests
docs/            CONTRACT.md is the single source of truth; ADRs; research
db/seed-corpus/  the eight demo documents (real docx/xlsx/pdf/png/md/txt/csv)
```

## 7. Turning on real providers

Full step-by-step guide - including OpenAI-compatible endpoints (vLLM,
Ollama, LiteLLM) and what adding a brand-new provider involves - lives in
**[docs/providers.md](providers.md)**. The short version:

1. Get a key (Gemini: https://aistudio.google.com/apikey · OpenAI:
   https://platform.openai.com/api-keys).
2. Add it to `backend/.env` **and set `DOCSAGE_DEMO_MODE=false`** - keys
   alone don't activate providers while demo mode is on.
3. Restart the backend; `/api/health` flips `"providers"` to true and the
   upload screen's provider cards unlock. Existing demo documents keep
   working (vector spaces are provider-qualified - ADR 0003).

Cost intuition (see `docs/embedding-research.md`): the entire seed corpus
costs well under one cent on either provider.

## 8. Troubleshooting

- **`connection refused` on 5433** - `docker compose up -d db` again; check
  `docker ps` shows `docsage-db (healthy)`.
- **`type "vector" does not exist`** - you skipped `alembic upgrade head`
  (the init migration creates the extension).
- **Upload returns 400 "provider not available"** - no API key for the chosen
  provider; use the Demo provider or add the key.
- **Chat says "Demo mode - extractive answer"** - that's demo mode doing its
  job; add provider keys for real grounded answers.
- **Port 3000/8000 busy** - `npm run dev -- --port 3100`,
  `uvicorn ... --port 8010`, and update `NEXT_PUBLIC_API_BASE_URL`.

## 9. Reading order for the curious

1. `docs/challenges.md` - the questions this codebase answers, narrated
2. `docs/CONTRACT.md` - schema, endpoints, pipeline, access rules
3. `docs/adr/` - each decision, formalized
4. `docs/embedding-research.md` - why Gemini Embedding 2 and OpenAI small,
   from vendor documentation
