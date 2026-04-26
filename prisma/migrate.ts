// Idempotent migration runner for the local SQLite dev DB.
//
// Why this exists: the previous `db:migrate` script just shelled out to
// `sqlite3 dev.db < migration.sql` for every migration, in order, every time.
// That works exactly once; on the second run a migration like
// `000005_remove_demo_concept` (which does `ALTER TABLE ... DROP COLUMN`) blows
// up because the column is already gone.
//
// This runner records which migrations have been applied in a small
// `_migration_history` table, so re-running is a no-op for already-applied
// migrations. It mirrors what `prisma migrate deploy` would do for us if we
// were managing the DB through Prisma's own migration engine.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(HERE, "migrations");
const DB_PATH = path.resolve(HERE, "dev.db");

function listMigrations(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((entry) => {
      const full = path.join(MIGRATIONS_DIR, entry);
      return statSync(full).isDirectory() && existsSync(path.join(full, "migration.sql"));
    })
    .sort(); // 000001_*, 000002_*, ... lexicographic order is the migration order.
}

function sqlite(sql: string): string {
  // Run a single SQL statement via the sqlite3 CLI and return stdout.
  // We pipe via stdin so semicolons inside the SQL don't confuse the shell.
  return execFileSync("sqlite3", [DB_PATH], {
    input: sql,
    encoding: "utf8",
  });
}

function ensureHistoryTable(): void {
  sqlite(
    `CREATE TABLE IF NOT EXISTS "_migration_history" (
       "id" TEXT PRIMARY KEY,
       "appliedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
     );`,
  );
}

function appliedMigrations(): Set<string> {
  const out = sqlite(`SELECT id FROM "_migration_history";`).trim();
  if (!out) return new Set();
  return new Set(out.split(/\r?\n/).filter(Boolean));
}

function tableExists(name: string): boolean {
  return sqlite(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='${name.replace(/'/g, "''")}';`,
  ).trim().length > 0;
}

function columnExists(table: string, column: string): boolean {
  // PRAGMA returns rows like: cid|name|type|notnull|dflt|pk
  const out = sqlite(`PRAGMA table_info('${table.replace(/'/g, "''")}');`);
  return out
    .split(/\r?\n/)
    .map((line) => line.split("|")[1])
    .filter(Boolean)
    .includes(column);
}

// Per-migration "has this already been applied?" probes. Each one looks at
// some structural side-effect that migration introduces. We run these only
// when the history table is empty so existing dev DBs don't replay
// destructive migrations like 000005's DROP COLUMN.
const MIGRATION_PROBES: Record<string, () => boolean> = {
  "000001_init": () => tableExists("User"),
  "000002_real_context": () => tableExists("CommerceZone"),
  "000003_city_import": () => tableExists("MerchantImportRun"),
  "000004_merchant_scale": () => tableExists("Merchant") && columnExists("Merchant", "categoryRank"),
  "000005_remove_demo_concept":
    // 000005 explicitly drops the demoPartnerCount column from MerchantImportRun.
    () => tableExists("MerchantImportRun") && !columnExists("MerchantImportRun", "demoPartnerCount"),
  "000006_user_context_agent": () => tableExists("MockContextProfile"),
  "000007_mock_profile_overrides":
    () => columnExists("MockContextProfile", "profileOverridesJson"),
};

function backfillHistoryIfNeeded(allMigrations: string[]): void {
  const known = appliedMigrations();
  if (known.size > 0) return;
  for (const id of allMigrations) {
    const probe = MIGRATION_PROBES[id];
    if (probe && probe()) {
      sqlite(`INSERT OR IGNORE INTO "_migration_history" (id) VALUES ('${id.replace(/'/g, "''")}');`);
    }
  }
}

function applyMigration(id: string): void {
  const file = path.join(MIGRATIONS_DIR, id, "migration.sql");
  const sql = readFileSync(file, "utf8");
  sqlite(sql);
  sqlite(`INSERT INTO "_migration_history" (id) VALUES ('${id.replace(/'/g, "''")}');`);
}

function main(): void {
  if (!existsSync(MIGRATIONS_DIR)) {
    console.error(`No migrations directory at ${MIGRATIONS_DIR}.`);
    process.exit(1);
  }
  const all = listMigrations();
  if (all.length === 0) {
    console.log("No migrations found.");
    return;
  }

  ensureHistoryTable();
  backfillHistoryIfNeeded(all);
  const already = appliedMigrations();

  const pending = all.filter((id) => !already.has(id));
  if (pending.length === 0) {
    console.log(`All ${all.length} migration(s) already applied.`);
    return;
  }
  console.log(`Applying ${pending.length} pending migration(s):`);
  for (const id of pending) {
    process.stdout.write(`  - ${id} ... `);
    try {
      // Self-heal: if the migration's structural footprint already exists
      // (e.g. user applied an earlier migration manually before this runner
      // existed), just record it as applied instead of replaying.
      const probe = MIGRATION_PROBES[id];
      if (probe && probe()) {
        sqlite(`INSERT OR IGNORE INTO "_migration_history" (id) VALUES ('${id.replace(/'/g, "''")}');`);
        process.stdout.write("already applied (recorded)\n");
        continue;
      }
      applyMigration(id);
      process.stdout.write("ok\n");
    } catch (err) {
      process.stdout.write("FAILED\n");
      console.error(err);
      process.exit(1);
    }
  }
  console.log("Done.");
}

main();
