# Security policy

## Reporting a vulnerability

This is a portfolio project, but reports are still welcome and handled in
good faith: email **Alex5350@pm.me** with details and a reproduction. Please
do not open public issues for suspected vulnerabilities.

## Scope notes

- **No secrets in the repo.** Provider API keys are read from `backend/.env`
  (gitignored) or environment variables - see [docs/providers.md](docs/providers.md)
  for key handling and rotation guidance.
- The demo mode ships no credentials beyond intentionally-public demo
  accounts (`@docsage.dev`, password `docsage-demo`) that exist to let
  reviewers explore the app.
- Both backends run dependency scans via CI; the frontend builds with
  lint-clean strict TypeScript.

## Hardening already in place

- argon2id password hashing with cross-runtime PHC interop (ADR 0007)
- HttpOnly, SameSite=Lax session cookies (Secure in production)
- server-side upload validation (mime allowlist + magic-byte sniffing)
- login/register rate limiting (per email+IP sliding window)
- provider-qualified vector search with owner-scoped visibility predicates
- startup recovery and expired-session purge
