import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
if (existsSync(".env")) process.loadEnvFile(".env");
const url = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
if (!url)
  throw new Error(
    "需要 TEST_DATABASE_URL 或 DATABASE_URL；不会静默降级到 PGlite。",
  );
const result = spawnSync(
  process.execPath,
  ["node_modules/vitest/vitest.mjs", "run"],
  { stdio: "inherit", env: { ...process.env, TEST_DATABASE_URL: url } },
);
process.exit(result.status ?? 1);
