import { mkdir, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import type { DB } from "./db.js";
import { passwordHash } from "./security.js";
import { MemoryService } from "./service.js";
export async function seed(db: DB) {
  if ((await db.query("SELECT id FROM users LIMIT 1")).length) return;
  const password =
    process.env.ADMIN_PASSWORD || randomBytes(15).toString("base64url");
  if (password.length < 12) throw new Error("ADMIN_PASSWORD 至少 12 位");
  await db.tx(async (tx) => {
    await tx.query(
      "INSERT INTO users(id,username,name,password_hash) VALUES($1,$2,$3,$4)",
      ["admin", "admin", "管理员", passwordHash(password)],
    );
    await tx.query(
      "INSERT INTO projects(id,name,description) VALUES($1,$2,$3)",
      ["atlas", "默认团队", "Coding Agent Session → 可追溯的团队共识"],
    );
    await tx.query(
      "INSERT INTO memberships(project_id,user_id,role) VALUES('atlas','admin','admin')",
    );
  });
  await mkdir(".runtime", { recursive: true });
  await writeFile(".runtime/admin-password.txt", password + "\n", {
    mode: 0o600,
  });
  console.log(
    "管理员：admin；初始密码已写入 .runtime/admin-password.txt（仅本机可读）。",
  );
  if (process.env.SEED_DEMO !== "true") return;
  const svc = new MemoryService(db),
    ctx = await svc.context("admin", "atlas");
  await db.query(
    "INSERT INTO users(id,username,name,password_hash) VALUES($1,$2,$3,$4)",
    [
      "reviewer",
      "reviewer",
      "周宁 · 审核员",
      passwordHash(randomBytes(20).toString("hex")),
    ],
  );
  await db.query(
    "INSERT INTO users(id,username,name,password_hash) VALUES($1,$2,$3,$4)",
    [
      "reader",
      "reader",
      "陈简 · 观察员",
      passwordHash(randomBytes(20).toString("hex")),
    ],
  );
  await db.query(
    "INSERT INTO memberships VALUES('atlas','reviewer','reviewer'),('atlas','reader','reader')",
  );
  const fixtures = [
    {
      source: "claude-code",
      title: "支付服务 · 幂等与重试策略",
      messages: [
        {
          role: "user",
          content: "讨论支付回调重复投递。所有服务名和数据为脱敏模拟。",
        },
        {
          role: "assistant",
          content:
            "[决策:payments.idempotency] 支付回调采用业务订单号作为幂等键，重复请求返回首次处理结果。\n[流程:payments.retry] 下游超时最多重试 3 次，使用指数退避并添加随机抖动。",
        },
        { role: "user", content: "确认以上决策，避免重复扣款。" },
      ],
    },
    {
      source: "codex",
      title: "检索服务 · 缓存 TTL 基线",
      messages: [
        { role: "user", content: "梳理检索服务缓存的失效时间。" },
        {
          role: "assistant",
          content:
            "[决策:search.cache.ttl] 检索结果缓存 TTL 设为 300 秒，权限变更时主动清除缓存。\n[经验:search.acl] 权限过滤必须先于向量排序，禁止先检索全库再在客户端过滤。",
        },
      ],
    },
    {
      source: "cursor",
      title: "Web 控制台 · 组件与状态约定",
      messages: [
        { role: "user", content: "约定控制台的状态管理与 UI 规范。" },
        {
          role: "assistant",
          content:
            "[决策:web.state] 当前后台采用 React 本地状态；否决立即引入 Redux，跨页面复杂状态出现后重新评估。\n[流程:web.a11y] 所有表单必须包含可访问标签，提交失败时保留用户输入。",
        },
      ],
    },
  ];
  for (const fixture of fixtures) {
    const result = await svc.import(ctx, {
      raw: JSON.stringify({ messages: fixture.messages }, null, 2),
      source: fixture.source as any,
      title: fixture.title,
      visibility: "team",
    });
    const cs = (await svc.candidates(ctx)).filter(
      (c) => c.session_id === result.id,
    );
    for (const c of cs.filter((c) => !c.topic_key.startsWith("note.")))
      await svc.review(ctx, c.id, {
        action: "approve",
        note: "脱敏演示：已人工复核来源和适用范围",
        expiresAt: new Date(Date.now() + 90 * 86400000).toISOString(),
      });
  }
  const cache = (await svc.knowledge(ctx)).find(
    (k) => k.topic_key === "search.cache.ttl",
  );
  await svc.editKnowledge(ctx, cache.id, {
    ...cache,
    title: cache.title,
    body: cache.body,
    version: cache.version,
    expiresAt: new Date(Date.now() + 3 * 86400000).toISOString(),
    reason: "演示：调整复核日期，保留旧版本",
  });
  await svc.import(ctx, {
    raw: JSON.stringify({
      messages: [
        { role: "user", content: "新一轮流量实验，需要重新评估缓存。" },
        {
          role: "assistant",
          content:
            "[决策:search.cache.ttl] 检索结果缓存 TTL 改为 60 秒，权限变更时主动清除缓存。\n[经验:search.observability] 召回日志应保存知识版本与证据来源，帮助定位失效决策。",
        },
      ],
    }),
    source: "codex",
    title: "检索服务 · 缓存新提案与冲突",
    visibility: "team",
  });
  await svc.import(ctx, {
    raw: JSON.stringify({
      messages: [
        { role: "user", content: "这是仅自己可见的探索记录。" },
        {
          role: "assistant",
          content:
            "[事实:personal.experiment] 私有实验尚未经过团队复核，不应直接作为公开工程规范。",
        },
      ],
    }),
    source: "claude-code",
    title: "个人探索 · 记忆评估实验",
    visibility: "private",
  });
  const result = await svc.search(ctx, "支付回调 幂等");
  await svc.feedback(ctx, result.logId, 1);
  await svc.search(ctx, "权限过滤");
  await svc.search(ctx, "不存在的火星水文");
}
