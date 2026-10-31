import { expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

it("默认首次启动只创建管理员和团队，重复初始化不写入演示数据", () => {
  const cwd = mkdtempSync(join(tmpdir(), "zhixu-bootstrap-"));
  const env = { ...process.env };
  for (const key of [
    "DATABASE_URL",
    "PGLITE_DIR",
    "ADMIN_PASSWORD",
    "SEED_DEMO",
  ])
    delete env[key];
  try {
    cpSync(resolve("migrations"), join(cwd, "migrations"), { recursive: true });
    const output = execFileSync(
      process.execPath,
      [
        "--import",
        resolve("node_modules/tsx/dist/loader.mjs"),
        "--input-type=module",
        "-e",
        `
        import { openDB, migrate } from ${JSON.stringify(pathToFileURL(resolve("src/server/db.ts")).href)};
        import { seed } from ${JSON.stringify(pathToFileURL(resolve("src/server/seed.ts")).href)};
        const db = await openDB();
        try {
          await migrate(db); await seed(db); await seed(db);
          const counts = {};
          for (const table of ['users','projects','memberships','sessions','candidates','knowledge','knowledge_versions','conflicts','recall_logs','audit_events','auth_tokens'])
            counts[table] = Number((await db.query('SELECT count(*) AS n FROM '+table))[0].n);
          console.log(JSON.stringify(counts));
        } finally { await db.close(); }
      `,
      ],
      { cwd, env, encoding: "utf8", timeout: 20000 },
    );
    expect(JSON.parse(output.trim().split("\n").at(-1)!)).toEqual({
      users: 1,
      projects: 1,
      memberships: 1,
      sessions: 0,
      candidates: 0,
      knowledge: 0,
      knowledge_versions: 0,
      conflicts: 0,
      recall_logs: 0,
      audit_events: 0,
      auth_tokens: 0,
    });
    const passwordFile = join(cwd, ".runtime/admin-password.txt");
    expect(
      readFileSync(passwordFile, "utf8").trim().length,
    ).toBeGreaterThanOrEqual(12);
    if (process.platform !== "win32")
      expect(statSync(passwordFile).mode & 0o777).toBe(0o600);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}, 30000);
