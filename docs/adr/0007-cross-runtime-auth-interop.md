# ADR 0007 - Cross-runtime auth: argon2id PHC hashes and opaque server sessions

**Status:** Accepted

## Context

Two backends share one database and one user table. A user registered through
FastAPI must be able to log in through the .NET API and vice versa, and a
browser session created by one backend must be honored by the other (the
frontend may be pointed at either API with a restart).

## Decision

- **Password hashes:** argon2id in standard PHC string format
  (`$argon2id$v=19$m=...$salt$hash`). Python verifies/hashes via
  `argon2-cffi`; .NET via `Isopoh.Cryptography.Argon2`, which reads and
  produces the same PHC format. No proprietary encodings on either side.
- **Sessions:** opaque 256-bit URL-safe tokens in a `sessions` table with
  30-day expiry; the token travels in an HttpOnly `docsage_session` cookie
  (SameSite=Lax, Secure in production). Both backends resolve users by the
  same table lookup - a session created by either runtime authenticates
  against both.
- **JWTs rejected:** signed tokens would also interoperate, but server-side
  sessions give us revocation (logout means delete) and zero shared-secret
  coupling between runtimes; the scale assumptions here (agency portfolio,
  not internet-scale) favor simplicity.

## Consequences

- Register on one backend, log in on the other: works, tested.
- Session validation is one indexed primary-key read per request - fine at
  this scale, and identical in both stacks.
- Clock skew between backends only affects the 30-day expiry check, which is
  immaterial.
- If a future deployment puts the backends behind different domains, cookie
  scoping (not cryptography) becomes the work item.
