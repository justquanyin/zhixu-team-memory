import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import type { Server } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { openDB, migrate, type DB } from "../src/server/db.js";
import { createApp } from "../src/server/app.js";
import { hash, passwordHash, token } from "../src/server/security.js";
import { parseSession } from "../src/server/adapters.js";
import { extract, validateEvidence, terms } from "../src/server/extraction.js";
import type { Context } from "../src/shared/types.js";
let db: DB,
  service: ReturnType<typeof createApp>["service"],
  app: ReturnType<typeof createApp>["app"],
  server: Server;
const credentials: Record<string, string> = {},
  password = randomBytes(18).toString("hex");
let ctx: Context,
  readerCtx: Context,
  privateCtx: Context,
  rootDB: DB | undefined,
  schema = "";
const auth = (user = "admin") => ({
  Authorization: `Bearer ${credentials[user]}`,
});
const payload = (body: string, visibility = "team") => ({
  title: "集成测试会话",
  source: "generic",
  visibility,
  raw: JSON.stringify({ messages: [{ role: "assistant", content: body }] }),
});
async function proposal(body: string, visibility = "team", owner = ctx) {
  const s = await service.import(owner, payload(body, visibility) as any);
  const c = (await service.candidates(owner)).find(
    (c) => c.session_id === s.id,
  );
  return { s, c };
}
async function approved(body: string, visibility = "team", owner = ctx) {
  const { s, c } = await proposal(body, visibility, owner);
  const result = await service.review(owner, c.id, {
    action: "approve",
    note: "测试人工复核",
  });
  return { s, c, k: await service.knowledgeOne(owner, result.id!) };
}
beforeAll(async () => {
  process.env.EXTRACTOR = "rules";
  if (process.env.TEST_DATABASE_URL) {
    rootDB = await openDB(process.env.TEST_DATABASE_URL);
    schema = "test_" + randomBytes(6).toString("hex");
    await rootDB.exec(`CREATE SCHEMA ${schema}`);
    const url = new URL(process.env.TEST_DATABASE_URL);
    url.searchParams.set("options", `-c search_path=${schema},public`);
    db = await openDB(url.toString());
  } else db = await openDB("", "memory://");
  await migrate(db);
  ({ app, service } = createApp(db));
  for (const user of [
    "admin",
    "reviewer",
    "member",
    "reader",
    "private",
    "outsider",
  ]) {
    await db.query(
      "INSERT INTO users(id,username,name,password_hash) VALUES($1,$1,$1,$2)",
      [user, passwordHash(password)],
    );
    credentials[user] = token();
    await db.query(
      "INSERT INTO auth_tokens(id,user_id,token_hash,kind,expires_at) VALUES($1,$1,$2,'api',now()+interval '1 day')",
      [user, hash(credentials[user])],
    );
  }
  await db.exec(
    "INSERT INTO projects(id,name) VALUES('p1','主项目'),('p2','隔离项目'); INSERT INTO memberships VALUES('p1','admin','admin'),('p1','reviewer','reviewer'),('p1','member','member'),('p1','reader','reader'),('p1','private','reviewer'),('p2','outsider','admin')",
  );
  ctx = await service.context("admin", "p1");
  readerCtx = await service.context("reader", "p1");
  privateCtx = await service.context("private", "p1");
  server = await new Promise<Server>((done) => {
    const s = app.listen(0, "127.0.0.1", () => done(s));
  });
}, 30000);
afterAll(async () => {
  await new Promise<void>((done) => server?.close(() => done()));
  await db?.close();
  if (rootDB) {
    await rootDB.exec(`DROP SCHEMA ${schema} CASCADE`);
    await rootDB.close();
  }
});
describe("会话适配与证据", () => {
  it.each(["claude-code", "codex", "cursor"])(
    "%s JSON/JSONL 导入能提取证据引用",
    async (source) => {
      const raw = await readFile(
        `fixtures/${source}.${source === "cursor" ? "json" : "jsonl"}`,
        "utf8",
      );
      const events = parseSession(raw, source as any);
      const drafts = await extract(events);
      expect(events.length).toBeGreaterThan(0);
      expect(drafts.length).toBeGreaterThan(0);
      drafts.forEach((d) =>
        expect(() => validateEvidence(d, events)).not.toThrow(),
      );
    },
  );
  it("拒绝非法 JSON，保留密钥原文而时间线规则脱敏", async () => {
    await request(app)
      .post("/api/projects/p1/sessions")
      .set(auth())
      .send({ ...payload("hello"), raw: "bad json" })
      .expect(400);
    const raw = payload(
      "[事实:security.redact] api_key=sk-123456789abcdefghijk 邮箱 demo@example.test",
    );
    const response = await request(app)
      .post("/api/projects/p1/sessions")
      .set(auth())
      .send(raw)
      .expect(201);
    const s = await service.session(ctx, response.body.id);
    expect(s.raw_text).toBe(raw.raw);
    expect(s.raw_hash).toBe(hash(raw.raw));
    expect(JSON.stringify(s.events)).not.toContain("123456789");
    expect(JSON.stringify(s.events)).not.toContain("demo@example");
  });
  it("重复导入与重复提取是幂等的", async () => {
    const input = payload("[决策:import.idempotent] 必须保证重复导入幂等");
    const first = await service.import(ctx, input as any);
    const second = await service.import(ctx, input as any);
    expect(second.id).toBe(first.id);
    expect(second.duplicate).toBe(true);
    await service.extractSession(ctx, first.id);
    expect(
      (await service.candidates(ctx)).filter((c) => c.session_id === first.id),
    ).toHaveLength(1);
  });
  it("数据库触发器阻止篡改或删除证据", async () => {
    const { s } = await proposal(
      "[事实:evidence.immutable] 原始会话必须不可变",
    );
    await expect(
      db.query("UPDATE sessions SET title=$2 WHERE id=$1", [s.id, "篡改"]),
    ).rejects.toThrow("immutable");
    await expect(
      db.query("DELETE FROM sessions WHERE id=$1", [s.id]),
    ).rejects.toThrow("immutable");
  });
  it("伪造的证据引用无法保存", async () => {
    const { c } = await proposal("[事实:evidence.citation] 引用必须能够追溯");
    await request(app)
      .patch("/api/projects/p1/candidates/" + c.id)
      .set(auth())
      .send({ ...c, evidence: [{ eventId: "e999", quote: "伪造证据" }] })
      .expect(400);
  });
});
describe("审核、版本和治理", () => {
  it("端到端：未审核不可召回 → 审核晋升 → FTS + vector 召回 → 反馈", async () => {
    const { c } = await proposal(
      "[决策:payment.unique] 银河支付回调采用订单号作为幂等键",
    );
    expect(
      (await service.search(ctx, "银河支付")).results.some(
        (r) => r.topic_key === "payment.unique",
      ),
    ).toBe(false);
    const approved = await request(app)
      .post(`/api/projects/p1/candidates/${c.id}/review`)
      .set(auth("reviewer"))
      .send({ action: "approve", note: "核对证据后确认" })
      .expect(200);
    const result = await request(app)
      .post("/api/projects/p1/search")
      .set(auth("reader"))
      .send({ query: "银河支付 幂等" })
      .expect(200);
    expect(result.body.results[0].id).toBe(approved.body.id);
    expect(result.body.results[0].lexical_rank).toBeTruthy();
    expect(result.body.results[0].vector_rank).toBeTruthy();
    expect(result.body.context).toContain("@v1");
    await request(app)
      .post(`/api/projects/p1/logs/${result.body.logId}/feedback`)
      .set(auth("reader"))
      .send({ value: 1 })
      .expect(200);
    expect((await service.logs(readerCtx))[0].feedback).toBe(1);
  });
  it("拒绝候选不能被晋升，重复审批返回冲突", async () => {
    const { c } = await proposal("[事实:reject.example] 未证实的结论必须拒绝");
    await service.review(ctx, c.id, { action: "reject", note: "证据不足" });
    await expect(
      service.review(ctx, c.id, { action: "approve", note: "重试" }),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      (await service.knowledge(ctx)).some((k) => k.candidate_id === c.id),
    ).toBe(false);
  });
  it("冲突需要明确替代，旧知识退出召回且保留快照", async () => {
    const { k: old } = await approved(
      "[决策:cache.conflict] 海蓝缓存 TTL 使用 300 秒",
    );
    const { c } = await proposal(
      "[决策:cache.conflict] 海蓝缓存 TTL 改成 60 秒",
    );
    expect(
      (await service.conflicts(ctx)).some((f) => f.candidate_id === c.id),
    ).toBe(true);
    await expect(
      service.review(ctx, c.id, { action: "approve", note: "未解决" }),
    ).rejects.toMatchObject({ status: 409 });
    const next = await service.review(ctx, c.id, {
      action: "approve",
      note: "新方案已核实",
      replaceId: old.id,
    });
    const previous = await service.knowledgeOne(ctx, old.id);
    expect(previous.status).toBe("superseded");
    expect(previous.superseded_by).toBe(next.id);
    expect(await service.versions(ctx, old.id)).toHaveLength(2);
    const recall = await service.search(ctx, "海蓝缓存");
    expect(recall.results.some((r) => r.id === old.id)).toBe(false);
    expect(recall.results.some((r) => r.id === next.id)).toBe(true);
  });
  it("版本编辑采用乐观锁且快照不可变", async () => {
    const { k } = await approved(
      "[事实:version.edit] 红杉任务处理器采用批处理",
    );
    const input = {
      ...k,
      version: 1,
      body: "红杉任务处理器采用批处理，每批 100 条",
      expiresAt: null,
      reason: "验证批大小",
    };
    const updated = await service.editKnowledge(ctx, k.id, input);
    expect(updated.version).toBe(2);
    await expect(service.editKnowledge(ctx, k.id, input)).rejects.toMatchObject(
      { status: 409 },
    );
    const versions = await service.versions(ctx, k.id);
    expect(versions[1].snapshot.body).toBe(k.body);
    expect(versions[0].snapshot.body).toBe(input.body);
    await expect(
      db.query("UPDATE knowledge_versions SET reason=$2 WHERE id=$1", [
        versions[0].id,
        "篡改",
      ]),
    ).rejects.toThrow("immutable");
  });
  it("到期知识实时排除召回，续期生成新版本，手动停用有效", async () => {
    const { k } = await approved("[事实:expiry.guard] 琥珀配置必须每周复核");
    // Simulate the clock passing without timing-sensitive sleeps.
    await db.query(
      "UPDATE knowledge SET expires_at=now()-interval '1 second' WHERE id=$1",
      [k.id],
    );
    expect(
      (await service.search(ctx, "琥珀配置")).results.some(
        (r) => r.id === k.id,
      ),
    ).toBe(false);
    await service.editKnowledge(ctx, k.id, {
      ...k,
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      reason: "续期复核",
    });
    expect(
      (await service.search(ctx, "琥珀配置")).results.some(
        (r) => r.id === k.id,
      ),
    ).toBe(true);
    await service.expire(ctx, k.id, 2);
    expect((await service.knowledgeOne(ctx, k.id)).status).toBe("expired");
    expect(
      (await service.search(ctx, "琥珀配置")).results.some(
        (r) => r.id === k.id,
      ),
    ).toBe(false);
  });
  it("并发审批只有一次成功", async () => {
    const { c } = await proposal(
      "[事实:concurrency.once] 同一个候选只能晋升一次",
    );
    const results = await Promise.allSettled([
      service.review(ctx, c.id, { action: "approve", note: "A" }),
      service.review(ctx, c.id, { action: "approve", note: "B" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      (await service.knowledge(ctx)).filter((k) => k.candidate_id === c.id),
    ).toHaveLength(1);
  });
});
describe("权限与身份", () => {
  it("未登录、跨项目、伪造成员身份均被拒绝", async () => {
    await request(app).get("/api/projects/p1/sessions").expect(401);
    await request(app)
      .get("/api/projects/p1/sessions")
      .set(auth("outsider"))
      .expect(403);
    await request(app)
      .post("/api/projects/p2/search")
      .set(auth())
      .send({ query: "秘密" })
      .expect(403);
    await request(app)
      .get("/api/projects/p1/sessions")
      .set("X-User-Id", "admin")
      .expect(401);
  });
  it("私有会话、候选、知识、版本、搜索和原文不能被管理员越权读取", async () => {
    const { s, c, k } = await approved(
      "[事实:private.secret] 紫晶私有实验采用隔离策略",
      "private",
      privateCtx,
    );
    expect((await service.sessions(ctx)).some((x) => x.id === s.id)).toBe(
      false,
    );
    expect((await service.candidates(ctx)).some((x) => x.id === c.id)).toBe(
      false,
    );
    for (const path of [
      `sessions/${s.id}`,
      `sessions/${s.id}/raw`,
      `knowledge/${k.id}`,
      `knowledge/${k.id}/versions`,
    ])
      await request(app)
        .get("/api/projects/p1/" + path)
        .set(auth())
        .expect(404);
    expect(
      (await service.search(ctx, "紫晶私有实验")).results.some(
        (x) => x.id === k.id,
      ),
    ).toBe(false);
    expect(
      (await service.search(privateCtx, "紫晶私有实验")).results[0].id,
    ).toBe(k.id);
  });
  it("只读成员不能导入，贡献者不能审核或改权限", async () => {
    await request(app)
      .post("/api/projects/p1/sessions")
      .set(auth("reader"))
      .send(payload("[事实:roles] 必须验证权限"))
      .expect(403);
    const { c } = await proposal("[事实:roles.review] 必须人工审核");
    await request(app)
      .post(`/api/projects/p1/candidates/${c.id}/review`)
      .set(auth("member"))
      .send({ action: "approve", note: "试图越权" })
      .expect(403);
    await request(app)
      .patch("/api/projects/p1/members/reader")
      .set(auth("member"))
      .send({ role: "admin" })
      .expect(403);
  });
  it("查询日志和反馈仅调用者可见", async () => {
    const result = await service.search(privateCtx, "私有查询口令");
    expect((await service.logs(ctx)).some((l) => l.id === result.logId)).toBe(
      false,
    );
    await request(app)
      .post(`/api/projects/p1/logs/${result.logId}/feedback`)
      .set(auth())
      .send({ value: 1 })
      .expect(404);
  });
  it("登录 Cookie、来源校验、令牌撤销", async () => {
    const agent = request.agent(app);
    const r = await agent
      .post("/api/login")
      .send({ username: "admin", password })
      .expect(200);
    expect(r.headers["set-cookie"][0]).toContain("HttpOnly");
    await agent.get("/api/me").expect(200);
    await agent
      .post("/api/tokens")
      .set("Origin", "https://evil.example")
      .send({ name: "bad" })
      .expect(403);
    const t = await agent
      .post("/api/tokens")
      .send({ name: "test token" })
      .expect(201);
    await request(app)
      .get("/api/me")
      .set("Authorization", "Bearer " + t.body.token)
      .expect(200);
    await agent
      .delete("/api/tokens/" + t.body.id)
      .send({})
      .expect(200);
    await request(app)
      .get("/api/me")
      .set("Authorization", "Bearer " + t.body.token)
      .expect(401);
  });
  it("保留最后一个管理员，成员删除后旧令牌立即失去项目权限", async () => {
    await request(app)
      .patch("/api/projects/p1/members/admin")
      .set(auth())
      .send({ role: null })
      .expect(409);
    const created = await request(app)
      .post("/api/projects/p1/members")
      .set(auth())
      .send({
        username: "temporary",
        name: "测试临时成员",
        password,
        role: "reader",
      })
      .expect(201);
    expect(created.body.ok).toBe(true);
    const agent = request.agent(app);
    await agent
      .post("/api/login")
      .send({ username: "temporary", password })
      .expect(200);
    const t = await agent
      .post("/api/tokens")
      .send({ name: "temp" })
      .expect(201);
    const members = (
      await request(app).get("/api/projects/p1/members").set(auth())
    ).body;
    const target = members.find((m: any) => m.username === "temporary");
    await request(app)
      .patch("/api/projects/p1/members/" + target.id)
      .set(auth())
      .send({ role: null })
      .expect(200);
    await request(app)
      .get("/api/projects/p1/sessions")
      .set("Authorization", "Bearer " + t.body.token)
      .expect(403);
  });
});
describe("MCP 实际传输", () => {
  it("stdio 客户端能列出工具、召回并继承权限限制", async () => {
    const address = server.address() as any;
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [
        "--import",
        resolve("node_modules/tsx/dist/loader.mjs"),
        resolve("src/server/mcp.ts"),
      ],
      cwd: tmpdir(),
      env: {
        ...(Object.fromEntries(
          Object.entries(process.env).filter(([, v]) => typeof v === "string"),
        ) as Record<string, string>),
        MEMORY_API_URL: `http://127.0.0.1:${address.port}`,
        MEMORY_API_TOKEN: credentials.reader,
      },
      stderr: "pipe",
    });
    const client = new Client({ name: "integration-test", version: "1.0" });
    try {
      await client.connect(transport);
      const list = await client.listTools();
      expect(list.tools.map((t) => t.name)).toEqual(
        expect.arrayContaining(["recall", "get_session", "recall_feedback"]),
      );
      const response = await client.callTool({
        name: "recall",
        arguments: { projectId: "p1", query: "银河支付", limit: 5 },
      });
      expect(response.isError).not.toBe(true);
      const data = JSON.parse((response.content as any)[0].text);
      expect(
        data.results.some((r: any) => r.topic_key === "payment.unique"),
      ).toBe(true);
      const denied = await client.callTool({
        name: "recall",
        arguments: { projectId: "p2", query: "秘密" },
      });
      expect(denied.isError).toBe(true);
    } finally {
      await client.close();
    }
  }, 20000);
});
it("中文切词产生双字 token", () =>
  expect(terms("权限过滤 PostgreSQL")).toEqual(
    expect.arrayContaining(["权限", "过滤", "postgresql"]),
  ));

it("原文首尾空白也参与归档哈希，不因校验被裁剪", async () => {
  const raw =
    "  \n" +
    JSON.stringify({
      messages: [
        { role: "assistant", content: "[事实:raw.spaces] 证据保留空白" },
      ],
    }) +
    "\n  ";
  const response = await request(app)
    .post("/api/projects/p1/sessions")
    .set(auth())
    .send({ ...payload("x"), raw })
    .expect(201);
  const s = await service.session(ctx, response.body.id);
  expect(s.raw_text).toBe(raw);
  expect(s.raw_hash).toBe(hash(raw));
});
it.each(["null", '{"messages":{}}', "[null]"])(
  "非法结构 %s 返回 400，不写入证据",
  async (raw) => {
    await request(app)
      .post("/api/projects/p1/sessions")
      .set(auth())
      .send({ ...payload("x"), raw })
      .expect(400);
  },
);

it("单条 JSONL 事件也可导入", () => {
  const events = parseSession(
    JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: "[事实:single.line] 单条消息也必须可读",
      },
    }),
    "claude-code",
  );
  expect(events).toHaveLength(1);
  expect(events[0].role).toBe("assistant");
});
it("模型不可用时证据仍归档，提取失败可重试恢复", async () => {
  const previous = {
    EXTRACTOR: process.env.EXTRACTOR,
    LLM_API_KEY: process.env.LLM_API_KEY,
    LLM_MODEL: process.env.LLM_MODEL,
  };
  let sid = "";
  try {
    process.env.EXTRACTOR = "llm";
    delete process.env.LLM_API_KEY;
    delete process.env.LLM_MODEL;
    const result = await service.import(
      ctx,
      payload("[事实:retry.recovery] 失败的提取必须能够重试") as any,
    );
    sid = result.id;
    expect((result as any).extraction_status).toBe("failed");
    expect((await service.session(ctx, sid)).raw_hash).toBeTruthy();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  await service.extractSession(ctx, sid);
  expect(
    (await service.candidates(ctx)).some((c) => c.session_id === sid),
  ).toBe(true);
  const runs = await db.query(
    "SELECT status FROM extraction_runs WHERE session_id=$1 ORDER BY created_at",
    [sid],
  );
  expect(runs.map((r) => r.status)).toEqual(["failed", "completed"]);
});

it("HTTP 导入支持超过原 8 MiB 传输限制的会话且完整保留证据", async () => {
  const raw = JSON.stringify({
    messages: [
      { role: "tool", content: "x".repeat(8 * 1024 * 1024 + 1) },
      {
        role: "assistant",
        content: "[事实:large.import] 大文件导入必须保留完整原始证据",
      },
    ],
  });
  const response = await request(app)
    .post("/api/projects/p1/sessions")
    .set(auth())
    .send({ title: "large", source: "codex", visibility: "private", raw })
    .expect(201);
  const session = await service.session(ctx, response.body.id);
  expect(session.raw_hash).toBe(hash(raw));
  expect(session.raw_text.length).toBe(raw.length);
  expect(response.body.extracted).toBe(1);
}, 20000);
