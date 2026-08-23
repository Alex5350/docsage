import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

/**
 * Suite bootstrap: prepare an isolated database and the fixture documents.
 *
 * Everything runs through the backend's uv environment (it already carries
 * alembic, the seed script, and the document libraries), so developers need
 * nothing beyond `uv` and the docker compose database.
 */

const ROOT = path.resolve(__dirname, "..");
const BACKEND = path.join(ROOT, "backend");
const E2E = path.join(ROOT, "e2e");

const DB_URL = process.env.E2E_DATABASE_URL ?? "postgresql+psycopg://docsage:docsage@localhost:5433/docsage_e2e";

function run(command: string, args: string[], env: NodeJS.ProcessEnv, cwd: string) {
  const result = spawnSync(command, args, { cwd, env: { ...process.env, ...env }, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed (exit ${result.status}):\n${result.stdout}\n${result.stderr}`,
    );
  }
  return result.stdout;
}

async function bootstrap() {
  // 1. The database server itself must be up (docker compose up -d db).
  try {
    run("uv", ["run", "python", "-c", "import psycopg; psycopg.connect('host=localhost port=5433 user=docsage password=docsage dbname=docsage').close()"], {}, BACKEND);
  } catch {
    throw new Error(
      "Cannot reach Postgres on localhost:5433. Start it first:\n" +
        "  docker compose up -d db\n" +
        "(see docs/onboarding.md — the E2E suite never touches your dev database)",
    );
  }

  // 2. Recreate the isolated e2e database, migrate, and seed demo data.
  //    The backend webServer is already up at this point (Playwright starts
  //    webServers before globalSetup) and its health check may hold a pooled
  //    connection to a leftover docsage_e2e, which would block DROP DATABASE
  //    with ObjectInUse. Terminate those sessions first — the backend uses
  //    pool_pre_ping, so it transparently reconnects to the fresh database.
  const env = { DOCSAGE_DATABASE_URL: DB_URL, DOCSAGE_SESSION_SECRET: "e2e-session-secret", DOCSAGE_DEMO_MODE: "true" };
  run("uv", ["run", "python", "-c",
    "import psycopg; admin = psycopg.connect('host=localhost port=5433 user=docsage password=docsage dbname=docsage', autocommit=True); admin.execute(\"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'docsage_e2e' AND pid <> pg_backend_pid()\"); admin.execute('DROP DATABASE IF EXISTS docsage_e2e'); admin.execute('CREATE DATABASE docsage_e2e'); admin.close()"], {}, BACKEND);
  run("uv", ["run", "alembic", "upgrade", "head"], env, BACKEND);
  run("uv", ["run", "python", "-m", "docsage_api.seed", "--fresh"], env, BACKEND);

  // 3. Generate the fixture documents (idempotent; skipped when present).
  const fixtures = path.join(E2E, "fixtures");
  if (!existsSync(path.join(fixtures, "press-release.md"))) {
    mkdirSync(fixtures, { recursive: true });
    run("uv", ["run", "python", path.join(E2E, "generate-fixtures.py"), "--out", fixtures], {}, BACKEND);
  }

  return () => {
    // Global teardown is a no-op: docsage_e2e is dropped and recreated on the
    // next run, so nothing accumulates.
  };
}

export default bootstrap;
