# DocSage internal contracts

Single source of truth shared by the FastAPI reference backend, the .NET parity
backend, and the Next.js frontend. Change it here first, then everywhere.

## Identity, roles, access

- Roles: `user` (personal workspace + agency library reads), `admin`
  (everything: admin chat across all users, library ingestion, topic/SME
  management), `sme` is NOT a role - SME authority is granted per topic via
  `sme_designations` and only applies to library document approval.
- Sessions: opaque token in HttpOnly cookie `docsage_session` (30-day expiry),
  server-side row in `sessions`.
- Personal documents are visible ONLY to their owner and to admins (admin
  visibility exists solely for the admin cross-user chat scope; admins cannot
  read personal docs in the regular UI lists).
- Library documents are visible to everyone once approved (`review_status =
  'approved'`); before approval only admins and designated SMEs see them.

## Database schema (Postgres 17 + pgvector)

All snake_case. Owned by the FastAPI backend's alembic migrations; the .NET
backend connects to the same database and NEVER migrates.

```
users(id uuid pk, email citext unique not null, password_hash text not null,
      display_name text not null, role text not null default 'user'
      check (role in ('user','admin')), created_at timestamptz not null default now())

sessions(token text pk, user_id uuid not null references users(id) on delete cascade,
         expires_at timestamptz not null, created_at timestamptz not null default now())

topics(id uuid pk, name text unique not null, description text not null default '',
       created_by uuid references users(id), created_at timestamptz not null default now())

sme_designations(id uuid pk, topic_id uuid not null references topics(id) on delete cascade,
                 user_id uuid not null references users(id) on delete cascade,
                 designated_by uuid references users(id),
                 created_at timestamptz not null default now(),
                 unique (topic_id, user_id))

documents(id uuid pk, owner_id uuid not null references users(id),
          scope text not null check (scope in ('personal','library')),
          title text not null, source_filename text not null,
          mime_type text not null, storage_path text not null,
          size_bytes bigint not null, checksum_sha256 text not null,
          status text not null default 'queued'
            check (status in ('queued','extracting','enriching','embedding','ready','failed')),
          status_error text,
          embedding_provider text not null
            check (embedding_provider in ('gemini','openai','demo')),
          embedding_model text not null default '',
            -- exact model id that produced the chunk vectors, e.g.
            -- 'gemini-embedding-2' or 'text-embedding-3-small'; embedding spaces
            -- of different models (even same vendor) are incompatible, so
            -- retrieval groups candidates by provider and can detect drift.
          topic_id uuid references topics(id),
          review_status text not null default 'not_required'
            check (review_status in ('not_required','pending_sme','approved','rejected')),
          chunk_count int not null default 0, page_count int,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now())

chunks(id uuid pk, document_id uuid not null references documents(id) on delete cascade,
       ordinal int not null, content text not null, kind text not null default 'text'
         check (kind in ('text','table','image_description')),
       page int, token_count int not null default 0,
       embedding vector(1536), created_at timestamptz not null default now())
  -- exactly one HNSW index on (embedding vector_cosine_ops); 1536 chosen because
  -- BOTH Gemini (output_dimensionality=1536) and OpenAI (dimensions=1536) support
  -- Matryoshka truncation to it and it is indexable by pgvector HNSW.

enrichments(id uuid pk, document_id uuid not null references documents(id) on delete cascade,
            kind text not null check (kind in ('summary','keywords','questions','caption')),
            content text not null, created_at timestamptz not null default now())

approvals(id uuid pk, document_id uuid not null references documents(id) on delete cascade,
          reviewer_id uuid not null references users(id),
          decision text not null check (decision in ('approved','rejected')),
          note text not null default '', decided_at timestamptz not null default now())

chat_sessions(id uuid pk, user_id uuid not null references users(id) on delete cascade,
              scope text not null default 'personal' check (scope in ('personal','admin')),
              title text not null default 'New conversation',
              created_at timestamptz not null default now())

chat_messages(id uuid pk, session_id uuid not null references chat_sessions(id) on delete cascade,
              role text not null check (role in ('user','assistant')),
              content text not null, citations jsonb not null default '[]',
              created_at timestamptz not null default now())
```

## Ingestion pipeline (runs in background after upload)

States: `queued -> extracting -> enriching -> embedding -> ready`, or `failed`
(from any state; `status_error` carries the reason).

1. **extract** - per mime: pdf (text + tables), docx (paragraphs + tables +
   inline images), xlsx (sheet tables), png/jpg (image part), txt/md/csv (raw).
   Produces ordered parts: `text`, `table` (serialized markdown table),
   `image_description` (placeholder until enrichment).
2. **enrich (agentic)** - LLM passes: document summary, keywords, hypothetical
   questions users would ask (stored in `enrichments`); each image part gets a
   vision caption (stored as an `image_description` chunk - it is always
   embedded as text so every provider can retrieve images); table parts get a
   one-line description prepended. Enrichment model follows the chosen provider
   family (Gemini flash models / OpenAI gpt-5.6-terra). Demo mode:
   deterministic extractive stand-ins.
3. **embed** - chunks (~1100 tokens, 150 overlap) embedded with the provider
   chosen AT UPLOAD (`gemini` | `openai` | `demo`), 1536 dims, stored with
   pgvector:
   - `gemini` (`gemini-embedding-2`): TEXT chunks embed as
     `"title: {document title} | text: {chunk}"`; QUERIES embed as
     `"task: search result | query: {question}"` (v2 task-instruction prefixes -
     `task_type` is NOT supported on v2; formats must match on both sides).
     PNG/JPEG image chunks are embedded NATIVELY as inline_data (the model
     accepts image bytes directly), output_dimensionality=1536, auto-normalized.
   - `openai` (`text-embedding-3-small`): `dimensions=1536`, newlines → spaces;
     images reach the index only through their caption chunk (text-only model).
   - `demo`: SHA-256-seeded xorshift64star PRNG → 1536 dims, normalized,
     byte-identical implementation in Python and C#.

Library documents additionally enter `review_status = 'pending_sme'` when they
reach `ready`; an SME designated for the document's topic approves/rejects.
`approved` => searchable agency-wide. `rejected` => invisible to non-admins.

## REST contract (both backends implement; prefix `/api`)

Cookie auth. All bodies JSON unless stated. Errors: `{detail: string}` with
proper status codes (401 unauthenticated, 403 forbidden, 404 missing, 409
conflict, 422 validation).

```
GET  /api/health                          -> {status:"ok", database:"up"|"down",
                                             demo_mode:bool, providers:{gemini:bool, openai:bool}}

POST /api/auth/register  {email,password,display_name}          -> 201 {id,email,display_name,role}
POST /api/auth/login     {email,password}                       -> 200 {id,email,display_name,role} + cookie
POST /api/auth/logout                                        -> 204
GET  /api/auth/me                                            -> 200 {id,email,display_name,role} | 401

GET  /api/documents?scope=personal|library                    -> {items:[DocumentSummary]}
     (personal: own docs only. library: everyone sees approved; admins+SME see all states)
POST /api/documents  multipart: file, provider, scope, title?, topic_id? (library/admin only)
                                                              -> 202 {DocumentSummary} (pipeline starts)
GET  /api/documents/{id}                                      -> 200 {DocumentDetail}
     (owner | admin | (library & approved) | SME-of-topic)
DELETE /api/documents/{id}                                    -> 204 (owner or admin)

DocumentSummary: {id,title,source_filename,mime_type,scope,status,status_error,
                  embedding_provider,embedding_model,topic:{id,name}|null,review_status,
                  chunk_count,size_bytes,created_at,owner:{id,display_name}?,pending_reviewer:bool}
DocumentDetail:  Summary + {enrichments:[{kind,content}], approvals:[{reviewer,decision,note,decided_at}]}

GET  /api/topics                       -> {items:[{id,name,description,smes:[{id,display_name,email}]}]}
POST /api/topics      {name,description}                        -> 201 (admin)
POST /api/topics/{id}/smes {user_id}                            -> 201 (admin)
DELETE /api/topics/{id}/smes/{user_id}                          -> 204 (admin)

GET  /api/reviews/pending              -> {items:[DocumentSummary]} (SME: topics they cover; admin: all pending)
POST /api/reviews/{document_id} {decision:"approved"|"rejected", note?} -> 200 DocumentSummary (SME-of-topic | admin)

POST /api/chat/sessions {scope:"personal"|"admin"}              -> 201 {id,scope,title,created_at}
       (scope=admin requires role admin)
GET  /api/chat/sessions                                         -> {items:[...]}
GET  /api/chat/sessions/{id}/messages                           -> {items:[{id,role,content,citations,created_at}]}
POST /api/chat/sessions/{id}/messages {content}                 -> SSE stream:
       events: {type:"delta",text} ... {type:"citations",citations:[{chunk_id,document_id,
                document_title,snippet,score,page?}]} {type:"done",message_id}
       final status 200; errors mid-stream as {type:"error",message}

GET  /api/admin/overview              -> {users,total_documents,personal_documents,
                                          library_documents,pending_reviews,pipeline:{<status>:count}}
                                          (admin)
```

## Chat retrieval rules

- scope `personal`: candidate documents = own personal docs (any review status
  is irrelevant - `not_required`) + library docs with `review_status='approved'`.
- scope `admin`: ALL documents (every owner, every state except `failed`).
- Query embedding MUST match each document's provider space: when the candidate
  set contains multiple providers, embed the query once per provider present
  (max two) and merge results by cosine score.
- top-k = 6, cosine distance (`<=>`). A 0.15 similarity floor filters noise
  for real providers (gemini/openai); demo retrieval is rank-only - demo
  vectors are deterministic hash noise whose similarities concentrate near
  zero (max ≈ 0.06 over the seed corpus), so a floor would blank every
  citation. Answer must cite `[n]` matching the citations array order.
- Demo mode answers are extractive (no LLM): lead sentence + top passage
  excerpts, clearly labeled as demo mode in the UI.

## Appendix: demo embedding algorithm (byte-identical in Python and C#)

Both backends implement EXACTLY this, so demo vectors interoperate:

1. `b = sha256(utf8(text))`; `seed0 = uint64_be(b[0..8])`,
   `seed1 = uint64_be(b[8..16])`.
2. Two xorshift64star generators (64-bit unsigned state, overflow wraps):
   `next(state)`: `state ^= state >> 12`; `state ^= (state << 25)`;
   `state ^= state >> 27`; return `state * 0x2545F4914F6CDD1D` (mod 2^64).
   Generator A starts with seed0, B with seed1.
3. For component `i` in `0..1535`: use generator A when `i` is even, B when
   odd. `double = (next() >> 11) / 2^53` (53-bit mantissa fraction in [0,1)),
   `v[i] = double - 0.5`.
4. L2-normalize `v`, then round each component to 7 decimals with
   half-away-from-zero semantics: `r = copysign(floor(abs(x)*1e7 + 0.5), x) / 1e7`.
