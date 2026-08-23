import { defineConfig } from "@playwright/test";

/**
 * Which backend the suite drives: E2E_BACKEND=fastapi (default) or
 * E2E_BACKEND=dotnet for the ASP.NET Core parity implementation. Both serve
 * the same /api contract on :8100 against the same isolated database, so the
 * identical tests run unchanged against either runtime — that is the
 * contract-parity guarantee (ADR 0001). `npm run test:dotnet` is the shortcut.
 */
const backend = process.env.E2E_BACKEND === "dotnet" ? "dotnet" : "fastapi";
const backendServer =
  backend === "dotnet"
    ? { command: "dotnet run --project Docsage.Api --urls http://localhost:8100", cwd: "../dotnet" }
    : { command: "uv run uvicorn docsage_api.main:app --port 8100", cwd: "../backend" };

/**
 * DocSage E2E configuration.
 *
 * `npx playwright test` boots everything the suite needs:
 *   - an isolated database (docsage_e2e) on the docker compose pgvector server,
 *     migrated and seeded by globalSetup through the backend's uv environment
 *   - the FastAPI backend on :8100 pointed at that database
 *   - the Next.js dev server on :3000 (the only origin the backend's CORS
 *     allowlist accepts) pointed at that backend
 *
 * Browsers run headless by default; add --headed (or npm run test:headed) to
 * watch them drive, --ui for the interactive runner, --debug for Inspector.
 */
export default defineConfig({
  testDir: "./specs",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    // Port 3000 (not an arbitrary e2e port): the backend's CORS allowlist
    // only accepts http://localhost:3000 / 127.0.0.1:3000 origins, so the
    // browser app only works against the API when served from there.
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    locale: "en-US",
    timezoneId: "America/Chicago",
  },
  outputDir: "./.results",
  globalSetupDir: ".",
  globalSetup: "./global-setup.ts",
  globalTeardown: "./global-teardown.ts",
  webServer: [
    {
      command: backendServer.command,
      cwd: backendServer.cwd,
      url: "http://localhost:8100/api/health",
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        DOCSAGE_DATABASE_URL:
          process.env.E2E_DATABASE_URL ??
          "postgresql+psycopg://docsage:docsage@localhost:5433/docsage_e2e",
        DOCSAGE_SESSION_SECRET: "e2e-session-secret",
        DOCSAGE_DEMO_MODE: "true",
      },
    },
    {
      // `rm -rf .next` first: Turbopack's dev cache inlines NEXT_PUBLIC_*
      // values at compile time, so a cache left over from a plain `npm run
      // dev` (which bakes in the default http://localhost:8000) would
      // silently override the env below and point the app at the wrong
      // backend. Clearing it keeps every run hermetic.
      command: "rm -rf .next && npm run dev -- --port 3000",
      cwd: "../frontend",
      url: "http://localhost:3000/login",
      reuseExistingServer: false,
      timeout: 180_000,
      env: { NEXT_PUBLIC_API_BASE_URL: "http://localhost:8100" },
    },
  ],
});
