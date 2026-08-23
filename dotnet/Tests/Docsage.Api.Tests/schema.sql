-- DocSage schema transcribed from docs/CONTRACT.md.
-- TEST-ONLY stand-in: production schema is owned by the FastAPI backend's alembic migrations
-- (backend/alembic). The python migrations were not present yet when this file was created,
-- so this file exists solely to create an equivalent schema in docsage_dotnet_test.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE users (
    id uuid PRIMARY KEY,
    email citext UNIQUE NOT NULL,
    password_hash text NOT NULL,
    display_name text NOT NULL,
    role text NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
    token text PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE topics (
    id uuid PRIMARY KEY,
    name text UNIQUE NOT NULL,
    description text NOT NULL DEFAULT '',
    created_by uuid REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sme_designations (
    id uuid PRIMARY KEY,
    topic_id uuid NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    designated_by uuid REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (topic_id, user_id)
);

CREATE TABLE documents (
    id uuid PRIMARY KEY,
    owner_id uuid NOT NULL REFERENCES users(id),
    scope text NOT NULL CHECK (scope IN ('personal','library')),
    title text NOT NULL,
    source_filename text NOT NULL,
    mime_type text NOT NULL,
    storage_path text NOT NULL,
    size_bytes bigint NOT NULL,
    checksum_sha256 text NOT NULL,
    status text NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued','extracting','enriching','embedding','ready','failed')),
    status_error text,
    embedding_provider text NOT NULL
        CHECK (embedding_provider IN ('gemini','openai','demo')),
    topic_id uuid REFERENCES topics(id),
    review_status text NOT NULL DEFAULT 'not_required'
        CHECK (review_status IN ('not_required','pending_sme','approved','rejected')),
    chunk_count int NOT NULL DEFAULT 0,
    page_count int,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE chunks (
    id uuid PRIMARY KEY,
    document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    ordinal int NOT NULL,
    content text NOT NULL,
    kind text NOT NULL DEFAULT 'text' CHECK (kind IN ('text','table','image_description')),
    page int,
    token_count int NOT NULL DEFAULT 0,
    embedding vector(1536),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX chunks_embedding_hnsw ON chunks USING hnsw (embedding vector_cosine_ops);

CREATE TABLE enrichments (
    id uuid PRIMARY KEY,
    document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    kind text NOT NULL CHECK (kind IN ('summary','keywords','questions','caption')),
    content text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE approvals (
    id uuid PRIMARY KEY,
    document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    reviewer_id uuid NOT NULL REFERENCES users(id),
    decision text NOT NULL CHECK (decision IN ('approved','rejected')),
    note text NOT NULL DEFAULT '',
    decided_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE chat_sessions (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    scope text NOT NULL DEFAULT 'personal' CHECK (scope IN ('personal','admin')),
    title text NOT NULL DEFAULT 'New conversation',
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE chat_messages (
    id uuid PRIMARY KEY,
    session_id uuid NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role text NOT NULL CHECK (role IN ('user','assistant')),
    content text NOT NULL,
    citations jsonb NOT NULL DEFAULT '[]',
    created_at timestamptz NOT NULL DEFAULT now()
);
