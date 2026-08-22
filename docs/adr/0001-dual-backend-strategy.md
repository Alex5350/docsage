# ADR 0001 - Dual backend strategy: FastAPI reference, ASP.NET Core parity

**Status:** Accepted

## Context

DocSage needs an HTTP API for ingestion, retrieval, chat, and approval workflows.
The portfolio goals call for "the best most established" Python API framework
and explicitly ask to *evaluate* a .NET equivalent as an alternative. Two
candidate strategies emerged:

1. Build one backend, document the other as a paper exercise.
2. Build the FastAPI backend as the reference implementation and an ASP.NET
   Core backend implementing the same contract against the same database.

## Decision

We build both, with deliberately different depth:

- **`backend/` - FastAPI (reference).** Python owns the full pipeline: every
  extraction format, the agentic enrichment passes, both real embedding
  providers, SSE chat, approvals, and the alembic schema. FastAPI is chosen
  because it is the de-facto standard for Python HTTP APIs (automatic OpenAPI,
  Pydantic v2 validation, first-class async/SSE), and because the surrounding
  document-processing ecosystem (pypdf, pdfplumber, python-docx, openpyxl) is
  the strongest available in any language for enterprise document parsing.
- **`dotnet/` - ASP.NET Core minimal APIs (parity).** Implements the same
  `/api` contract (auth, documents, topics, reviews, chat SSE, admin) against
  the same Postgres instance, with its own extractors (OpenXML SDK, ClosedXML,
  PdfPig) and the same provider clients. It never runs migrations - alembic is
  the single schema authority. The frontend targets either backend by changing
  `NEXT_PUBLIC_API_BASE_URL`.

The .NET backend is labeled a *parity slice*, not a marketing equal: its
enrichment pass is deliberately simpler, and that honesty is part of the
portfolio story.

## Consequences

- Contract drift is the main risk; `docs/CONTRACT.md` is the single source of
  truth both backends code against, and integration tests run against the same
  schema both stacks migrate/verify.
- Cross-runtime details had to be solved once and shared: password hashes
  (argon2id PHC strings verified by both runtimes), session cookies, and the
  deterministic demo embedding algorithm (byte-identical xorshift64star PRNG
  seeded from SHA-256 so demo vectors interoperate across backends).
- Maintenance cost is roughly 1.5× a single backend; accepted because the
  comparison *is* a deliverable of this project.
