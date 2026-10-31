import { readFile, writeFile, mkdir, readdir, chmod } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { MAX_IMPORT_BYTES } from "../src/shared/limits.js";
if (existsSync(".env")) process.loadEnvFile(".env");
const base = process.env.MEMORY_API_URL || "http://127.0.0.1:4317";
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(base).hostname))
  throw new Error("本地会话导入器只允许发送到本机服务");
const project = process.env.MEMORY_PROJECT_ID || "atlas";
const option = process.argv.indexOf("--manifest");
const runDir = join(
  ".runtime",
  "imports",
  "codex",
  new Date().toISOString().replace(/[:.]/g, "-"),
);
await mkdir(runDir, { recursive: true, mode: 0o700 });
let manifest: any[];
if (option >= 0) {
  manifest = JSON.parse(await readFile(process.argv[option + 1], "utf8"));
} else {
  const codexRoot = process.env.CODEX_IMPORT_ROOT || join(homedir(), ".codex");
  async function walk(path: string): Promise<string[]> {
    if (!existsSync(path)) return [];
    const out: string[] = [];
    for (const e of await readdir(path, { withFileTypes: true })) {
      if (e.isDirectory()) out.push(...(await walk(join(path, e.name))));
      else if (e.isFile() && e.name.endsWith(".jsonl"))
        out.push(join(path, e.name));
    }
    return out;
  }
  const names = new Map<string, string>();
  const indexPath = join(codexRoot, "session_index.jsonl");
  if (existsSync(indexPath))
    for (const line of (await readFile(indexPath, "utf8"))
      .split("\n")
      .filter(Boolean)) {
      try {
        const r = JSON.parse(line);
        names.set(r.id, r.thread_name || r.title || r.name);
      } catch {}
    }
  manifest = [];
  for (const sourcePath of [
    ...(await walk(join(codexRoot, "sessions"))),
    ...(await walk(join(codexRoot, "archived_sessions"))),
  ].sort()) {
    let raw = await readFile(sourcePath);
    const end = raw.lastIndexOf(10) + 1;
    if (end && end < raw.length) {
      try {
        JSON.parse(raw.subarray(end).toString("utf8"));
      } catch {
        raw = raw.subarray(0, end);
      }
    }
    const meta = raw
      .toString("utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .find((r) => r.type === "session_meta")?.payload;
    if (!meta?.id) throw new Error("会话缺少 session_meta: " + sourcePath);
    const snapshotPath = join(runDir, meta.id + ".jsonl");
    await writeFile(snapshotPath, raw, { mode: 0o600 });
    manifest.push({
      id: meta.id,
      title: names.get(meta.id) || "Codex " + meta.id,
      sourcePath,
      snapshotPath,
      bytes: raw.length,
      sha256: createHash("sha256").update(raw).digest("hex"),
      capturedAt: new Date().toISOString(),
    });
  }
  await writeFile(
    join(runDir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    { mode: 0o600 },
  );
}
let cookie = "";
async function api(path: string, body?: unknown) {
  const r = await fetch(base + "/api" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(180000),
  });
  if (r.headers.get("set-cookie"))
    cookie = r.headers.get("set-cookie")!.split(";")[0];
  const data: any = await r.json();
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}
const password =
  process.env.MEMORY_PASSWORD ||
  (await readFile(".runtime/admin-password.txt", "utf8")).trim();
await api("/login", {
  username: process.env.MEMORY_USERNAME || "admin",
  password,
});
const receipt: any = {
  capturedAt: new Date().toISOString(),
  project,
  visibility: "private",
  sessions: [],
};
try {
  const dashboard = await api(`/projects/${project}/dashboard`);
  if (dashboard.extractor !== "离线规则提取")
    throw new Error(
      "服务当前启用了外部模型；本地批量导入要求 EXTRACTOR=rules，以免意外发送历史会话",
    );
  for (const row of manifest) {
    try {
      const bytes = await readFile(resolve(row.snapshotPath));
      if (bytes.length > MAX_IMPORT_BYTES)
        throw new Error("文件超过 32 MiB，未截断或导入");
      if (
        row.sha256 &&
        createHash("sha256").update(bytes).digest("hex") !== row.sha256
      )
        throw new Error("快照哈希不一致");
      const result = await api(`/projects/${project}/sessions`, {
        source: "codex",
        visibility: "private",
        title: row.title.slice(0, 200),
        raw: bytes.toString("utf8"),
      });
      const detail = await api(`/projects/${project}/sessions/${result.id}`);
      receipt.sessions.push({
        threadId: row.id,
        title: row.title,
        sessionId: result.id,
        sourceSha256: row.sha256,
        archivedSha256: detail.raw_hash,
        bytes: bytes.length,
        events: detail.events.length,
        extracted: result.extracted ?? null,
        duplicate: result.duplicate,
        status: result.extraction_status || "existing",
        capturedAt: row.capturedAt,
      });
      console.log(JSON.stringify(receipt.sessions.at(-1)));
    } catch (e) {
      receipt.sessions.push({
        threadId: row.id,
        title: row.title,
        status: "failed",
        error: (e as Error).message,
      });
      console.error("导入失败：" + row.title + "：" + (e as Error).message);
    }
  }
  const all = await api(`/projects/${project}/candidates`);
  const ids = new Set(receipt.sessions.map((r: any) => r.sessionId));
  receipt.totalCandidates = all.filter((c: any) =>
    ids.has(c.session_id),
  ).length;
  receipt.imported = receipt.sessions.filter((r: any) => r.sessionId).length;
  receipt.failed = receipt.sessions.filter(
    (r: any) => r.status === "failed",
  ).length;
  const receiptPath = join(runDir, "receipt.json");
  await writeFile(receiptPath, JSON.stringify(receipt, null, 2), {
    mode: 0o600,
  });
  await chmod(receiptPath, 0o600);
  console.log(
    JSON.stringify({
      imported: receipt.imported,
      failed: receipt.failed,
      candidates: receipt.totalCandidates,
      receiptPath,
    }),
  );
  if (receipt.failed) process.exitCode = 1;
} finally {
  await api("/logout", {});
}
