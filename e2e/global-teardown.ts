import { spawnSync } from "node:child_process";
import path from "node:path";

/**
 * Drop the isolated E2E database after the run. The suite recreates it on the
 * next `playwright test`, so deleting here is cosmetic — it keeps `psql -l`
 * tidy. Failures are ignored on purpose.
 */
const BACKEND = path.resolve(__dirname, "..", "backend");

export default async function teardown() {
  spawnSync(
    "uv",
    ["run", "python", "-c",
      "import psycopg; admin = psycopg.connect('host=localhost port=5433 user=docsage password=docsage dbname=docsage', autocommit=True); admin.execute('DROP DATABASE IF EXISTS docsage_e2e'); admin.close()"],
    { cwd: BACKEND, encoding: "utf8" },
  );
}
