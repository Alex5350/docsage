# ADR 0005 - Personal scope, agency library, and SME-gated publication

**Status:** Accepted

## Context

Requirements pull in two directions: individuals must get real RAG over their
own uploads with strict isolation, while the agency needs a curated, trusted
knowledge base of policies anyone can query. Trust demands human
accountability: a policy answer is only citable if a subject matter expert
(SME) accepted responsibility for the content of the topic it belongs to.

## Decision

Two document scopes with one approval seam:

- **`personal`** - default. Visible to the owner (and to the admin cross-user
  chat scope only); `review_status` stays `not_required`; embedded and
  searchable immediately.
- **`library`** - admin-only ingestion for agency policy/requirements. Each
  library document is filed under a **topic**, and each topic carries
  **SME designations** (regular users granted review authority for that topic
  only). On reaching `ready`, a library document enters
  `review_status = 'pending_sme'`; it is invisible to regular users until a
  designated SME (or an admin) records an approval decision with an optional
  note. Approvals are append-only audit rows.

Chat scopes follow: **personal** chat retrieves from the user's own documents
plus approved library documents; the **admin chat** (admin-only section)
retrieves across every user and every state - the compliance lens.

## Consequences

- SME authority is scoped, not global: being the security SME grants no power
  over budget documents. Roles stay two (`user`, `admin`); SME is a
  relationship, not a role.
- Isolation is enforced in the retrieval SQL (owner/visibility predicates),
  not in the UI; admin visibility of personal documents exists only inside the
  admin chat scope and is labeled as such in the interface.
- A rejected library document stays in the corpus for admins (fix-and-resubmit
  workflow: edit/re-upload, new review) but never surfaces to regular users.
- No self-approval: an admin uploading a library document still needs an SME
  (or another admin) to approve it - the audit trail remains meaningful.
