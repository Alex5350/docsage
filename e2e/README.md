# DocSage E2E suite

Playwright user-journey tests for the whole DocSage stack: the Next.js
frontend, the FastAPI backend, and the Postgres + pgvector database - all real,
no mocks. One command boots everything against an isolated database, runs the
suite, and tears it down.

```bash
cd e2e
npm install         # first time only
npx playwright test
```

## What the suite covers

| Spec | Feature area | What it proves |
| --- | --- | --- |
| `auth.spec.ts` | Authentication | Register lands on `/chat` with the welcome state; duplicate email and wrong password surface errors; sign-out and unauthenticated visits to app routes redirect to `/login`. |
| `upload-multiformat.spec.ts` | Ingestion, all formats | All 8 accepted formats (DOCX, XLSX, PDF, PNG, JPG, TXT, MD, CSV) upload through the UI, reach **Ready - N chunks indexed**, and appear in Documents; DOCX detail dialog shows summary / keywords / likely questions; `.zip` is rejected client-side; a 28 MB file trips the 25 MB guard; Gemini/OpenAI provider cards are disabled with "requires API key", Demo is selected. |
| `documents.spec.ts` | Document workspace | Two uploads are listed with Ready status; detail dialog shows provider + model provenance; delete with confirmation removes the card and the deletion survives a reload. |
| `chat.spec.ts` | Grounded chat | Riley's seeded "Telework question" transcript loads - and re-selecting the active conversation still renders it (regression for the re-select bug); a freshly uploaded press release is cited when asking about its content; brand-new users see suggested questions; **isolation**: user B's citations never include user A's personal uploads. |
| `reviews-sme.spec.ts` | SME approval workflow | Admin uploads to the library under a topic (reviewers chip shown, "awaiting SME approval"); the topic's SME approves → visible agency-wide for Riley; reject path enforces the required note and the document stays hidden. |
| `admin.spec.ts` | Admin surface | `/admin` renders stat cards + pipeline distribution; "Admin cross-search" opens an admin-scope session (badge "Admin · all documents") whose answer cites the admin's personal drill log; non-admins get no Admin nav and an "Admins only" panel. |
| `theming-navigation.spec.ts` | Chrome & theming | Landing hero + CTA to `/login`; theme toggle flips `dark`↔`light` on `<html>` and persists via localStorage across reload; the demo-mode banner shows on app pages. |

Thirty-six tests total, run serially (`workers: 1`) because the features under test
share one database story (uploads accumulate, reviews gate library visibility).

## Prerequisites

- **Docker database**: `docker compose up -d db` from the repo root
  (Postgres 17 + pgvector on port **5433**). Your dev databases are never
  touched - the suite drops/recreates a dedicated `docsage_e2e` database.
- **Node 20+** (frontend + Playwright).
- **[uv](https://docs.astral.sh/uv/)** - globalSetup runs the backend's
  migrations, seed, and fixture generator through `uv run` in `../backend`.
- First run downloads the Chromium browser and generates the fixture corpus
  (`e2e/fixtures/`), so expect it to take a few minutes.

## Running

```bash
npx playwright test            # headless, the default
npm run test:headed            # --headed: watch the browser drive the app
npm run test:ui                # interactive runner: pick, retry, inspect tests
npm run test:debug             # Playwright Inspector: step through a test
npm run report                 # open the HTML report (playwright-report/)
```

Filtering:

```bash
npx playwright test chat                       # one file by substring
npx playwright test -g "cooling centers"       # by test-title regex
npx playwright test upload-multiformat:83      # by line number
```

## Running against the ASP.NET Core backend

The same 36 tests run unchanged against the .NET parity API - that is the
contract-parity guarantee (ADR 0001) made executable:

```bash
npm run test:dotnet                 # E2E_BACKEND=dotnet playwright test
npm run test:dotnet:headed          # same, headed
E2E_BACKEND=dotnet npx playwright test chat -g "isolation"   # any filter works
```

`E2E_BACKEND` only swaps which server occupies :8100 (uvicorn vs
`dotnet run --project Docsage.Api`); the database, seed, fixtures, and
frontend are identical. CI runs both variants. A test that passes on
FastAPI but fails here is a parity bug - see `docs/CONTRACT.md` for the
binding behavior and fix the .NET side (two examples this suite already
caught: register not setting the session cookie, and
`documents.embedding_model` missing from the summary DTO).

## How the run is wired

`playwright.config.ts` starts two web servers before any test runs
(and stops them afterwards):

- **backend** - `uvicorn` on `:8100` against `docsage_e2e` (env-overridden
  `DOCSAGE_DATABASE_URL`, demo mode on).
- **frontend** - `next dev` on `:3000` with `NEXT_PUBLIC_API_BASE_URL`
  pointing at `:8100`. Port 3000 is not arbitrary: the backend's CORS
  allowlist only accepts `http://localhost:3000`, so the browser app only
  works from there. The command also clears `frontend/.next` first -
  Turbopack's dev cache inlines `NEXT_PUBLIC_*` values at compile time, and a
  cache left over from a plain `npm run dev` bakes in the default `:8000`
  backend and silently breaks every authenticated flow.

`global-setup.ts` then:

1. checks the docker database is reachable on 5433,
2. creates `docsage_e2e` only when absent, migrates, and reseeds it via the
   seeder's truncate-and-reseed (the seeder pushes the demo corpus through
   the **real** pipeline with the demo embedding provider). The database is
   deliberately NOT dropped each run: Postgres assigns pgvector's `vector`
   type a fresh OID in every new database incarnation, and pooled server
   connections would keep writing against the stale OID,
3. generates the fixture corpus if `e2e/fixtures/` is missing.

`global-teardown.ts` drops `docsage_e2e` for a tidy `psql -l`; re-runs are
deterministic regardless, and unique emails/titles guard within-run
collisions (`uniqueEmail()` in `helpers/stack.ts`).

### Seeded accounts (password `docsage-demo`)

| Email | Role / SME topics |
| --- | --- |
| `admin@docsage.dev` | admin |
| `riley@docsage.dev` | regular user (owns the seeded chat session) |
| `casey@docsage.dev` | SME for Security, Records Management |
| `morgan@docsage.dev` | SME for Workplace Policy, Budget & Finance |

The seed corpus contains 4 approved library documents, 4 personal documents,
and Riley's "Telework question" chat exchange.

### Fixtures

`e2e/fixtures/` is generated by `generate-fixtures.py` (deterministic, seeded,
fictional "Meridian County" content). The suite regenerates it automatically
when missing; force a regeneration with:

```bash
npm run fixtures          # runs the generator through the backend's uv env
rm -rf fixtures           # ...or just delete; the next run recreates it
```

## Failure artifacts

On failure each test keeps a trace, video, and screenshots under `.results/`
(the configured `outputDir`), plus the HTML report in `playwright-report/`:

```bash
npx playwright show-trace .results/<test-name>/trace.zip
npm run report
```

## Adding your own test

Specs live in `specs/`, shared flows in `helpers/stack.ts`. The helpers are
thin page objects over accessible names; prefer using them before rolling new
selectors.

```ts
// specs/my-feature.spec.ts
import { expect, test } from "@playwright/test";
import {
  DEMO_PASSWORD,            // "docsage-demo"
  askAndWait,               // ask in chat, wait for the stream to land
  loginViaUi,               // sign in through /login
  registerViaUi,            // register through /login
  startConversation,        // new session, transcript fetch settled
  uniqueEmail,              // collision-proof qa-...@docsage.dev
  uploadAndWaitReady,       // upload a fixture, wait for Ready
} from "../helpers/stack";

test("my journey", async ({ page }) => {
  // 1. Arrange: a fresh identity per run keeps tests order-independent.
  const email = uniqueEmail("mine");
  await registerViaUi(page, email, DEMO_PASSWORD, "My Checker");

  // 2. Act through the real UI. uploadAndWaitReady drives the dropzone,
  //    waits through the polled pipeline, and returns the status line.
  const status = await uploadAndWaitReady(page, "press-release.md");
  expect(status).toMatch(/Ready - \d+ chunks? indexed/);

  // 3. Assert on outcomes, not counts other tests mutate. For chat, settle
  //    the session first (see startConversation's doc comment), then ask.
  await page.goto("/chat");
  await startConversation(page);
  const { answerText, citations } = await askAndWait(page, "...");
  expect(citations.length).toBeGreaterThan(0);
});
```

Notes that save debugging time:

- **Multiple users in one test**: create separate contexts
  (`browser.newContext()`), one page each - cookies are per-context.
- **Demo retrieval is deterministic hash-noise ranking**, not semantics. If a
  test must assert that a *specific* document is cited, the question wording
  decides the ranking. Verify it through the backend's own
  `retrieve()` against the exact candidate set your test produces, then pin
  the exact string - see `chat.spec.ts` and `admin.spec.ts` for worked
  examples with comments. Personal-scope isolation assertions (B must not see
  A's docs) are safe with any wording - the database enforces them.
- **Ask your question only in a settled conversation.** Sending the first
  message in the instant a session is created races the empty-transcript
  fetch; a late response replaces the message list and the streamed answer
  vanishes from the UI (it is persisted server-side). `startConversation()`
  waits for that fetch so tests stay deterministic.

### Selector conventions

Everything targets **accessible names** (`getByRole` / `getByText` / aria
labels), which the components already expose thoughtfully - they survive
restyling and read like the user's experience:

- Buttons by role+name: `getByRole("button", { name: "Create account" })`.
- Form fields by label: `getByRole("textbox", { name: "Email" })`.
- Custom widgets by aria-label: citation chips `[aria-label^="Citation"]`, the
  messages `role="log"`, pipeline status `role="status"` filtered by text.
- Two gotchas baked into the helpers: Next.js adds its own empty
  `role="alert"` route announcer, so error copy is matched with
  `p[role="alert"]`; the upload scope radios are `sr-only` inputs inside
  labels, so tests click the visible label text within the
  `"Scope"` radiogroup instead of the 1px input.

## Troubleshooting

- **"Cannot reach Postgres on localhost:5433"** - the docker database is
  down: `docker compose up -d db` from the repo root.
- **Port conflicts (8100 / 3000)** - a previous run's server or your own dev
  server is still listening (`lsof -i :8100 -i :3000`). Stop it. The backend
  must be on 8100 and the frontend on 3000 (CORS) - other ports break the
  browser↔API contract.
- **`ObjectInUse: database "docsage_e2e" is being accessed by other users`**
  during globalSetup - shouldn't happen anymore (setup terminates stray
  sessions first), but a manual
  `docker exec docsage-db psql -U docsage -d docsage -c 'DROP DATABASE IF EXISTS docsage_e2e'`
  clears it.
- **Everything auth-ish fails with "Could not reach the server"** - the
  frontend bundle is pointing at the wrong backend. The run clears
  `frontend/.next` for exactly this reason; if you started the frontend
  yourself instead of letting Playwright do it, that cache holds a stale
  `NEXT_PUBLIC_API_BASE_URL`.
- **Flaky-looking waits** - the UI polls pipeline status on a 1.5s cadence,
  so never `waitForTimeout`; use `expect(...).toBeVisible({ timeout })` /
  `expect.poll` (see `uploadAndWaitReady` / `askAndWait`) with a ~20s budget.
- **First run is slow** - browser download, fixture generation, and a cold
  Next.js compile; subsequent runs take about a minute.
