# ADR 0006 - First-class offline demo mode

**Status:** Accepted

## Context

A portfolio reviewer (or a new developer on day one) must be able to run the
full product without provider API keys. Silently degrading (uploading works,
search returns garbage because embeddings errored) is worse than failing
loudly. But the app also must not *require* keys to demonstrate the pipeline,
the approval workflow, or the chat experience.

## Decision

A third embedding provider, `demo`, plus extractive chat and deterministic
enrichment, selected automatically when keys are absent or
`DOCSAGE_DEMO_MODE=true`:

- **Embeddings:** SHA-256(text) seeds a fixed xorshift64star PRNG expanded to
  a normalized 1536-vector. The algorithm is implemented **byte-identically**
  in Python and C# so demo vectors interoperate across both backends. Same
  input always produces the same vector - so demo retrieval works, is stable
  across restarts, and honors the provider-qualification rule (ADR 0003).
- **Enrichment:** deterministic stand-ins (extractive first-sentences summary,
  frequency keywords) - the *pipeline stages and artifacts* are identical,
  only the model behind them differs.
- **Chat:** extractive answer assembled from top passages with citations,
  explicitly labeled "Demo mode" in the UI.
- **Honesty rule:** `/api/health` reports `demo_mode`, the UI shows a banner,
  and the provider picker badges real providers as unavailable until keys are
  configured. Demo results are never presented as model output.

## Consequences

- `docker compose up db` + two processes = fully working product, zero keys,
  deterministic - which also makes it the backbone of E2E tests and
  screenshots.
- Demo vectors carry no semantics; retrieval quality in demo mode is
  representative of mechanics, not of quality. Documented in the README.
- The demo provider is a real provider implementation behind the same
  interface - it exercises batching, dimension handling, and error paths, so
  provider code paths run in CI without credentials.
