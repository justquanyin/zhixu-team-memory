import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import pg from "pg";
import { readFile, readdir, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
export interface DB {
  query<T = any>(sql: string, params?: any[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
  tx<T>(fn: (db: DB) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
export async function openDB(
  url = process.env.DATABASE_URL,
  path = process.env.PGLITE_DIR || ".runtime/database",
): Promise<DB> {
  if (url) {
    const pool = new pg.Pool({ connectionString: url });
    function wrap(client: pg.Pool | pg.PoolClient): DB {
      return {
        query: async (sql, params) => (await client.query(sql, params)).rows,
        exec: async (sql) => {
          await client.query(sql);
        },
        tx: async (fn) => {
          const conn = await pool.connect();
          try {
            await conn.query("BEGIN");
            const value = await fn(wrap(conn));
            await conn.query("COMMIT");
            return value;
          } catch (e) {
            await conn.query("ROLLBACK");
            throw e;
          } finally {
            conn.release();
          }
        },
        close: () => pool.end(),
      };
    }
    return wrap(pool);
  }
  if (path !== "memory://") await mkdir(resolve(path), { recursive: true });
  const engine = new PGlite(path, { extensions: { vector } });
  await engine.waitReady;
  const wrap = (client: any): DB => ({
    query: async (sql, params) => (await client.query(sql, params)).rows,
    exec: async (sql) => {
      await client.exec(sql);
    },
    tx: (fn) => client.transaction((tx: any) => fn(wrap(tx))),
    close: () => engine.close(),
  });
  return wrap(engine);
}
export async function migrate(db: DB) {
  await db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
  );
  for (const name of (await readdir("migrations"))
    .filter((x) => x.endsWith(".sql"))
    .sort()) {
    if (
      (
        await db.query("SELECT name FROM schema_migrations WHERE name=$1", [
          name,
        ])
      ).length
    )
      continue;
    await db.tx(async (tx) => {
      await tx.exec(await readFile(`migrations/${name}`, "utf8"));
      await tx.query("INSERT INTO schema_migrations(name) VALUES($1)", [name]);
    });
  }
}
