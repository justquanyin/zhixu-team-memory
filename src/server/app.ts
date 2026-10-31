import { MAX_IMPORT_BYTES } from "../shared/limits.js";
import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import cookieParser from "cookie-parser";
import { z, ZodError } from "zod";
import type { DB } from "./db.js";
import { MemoryService, id } from "./service.js";
import {
  AppError,
  assert,
  hash,
  token,
  passwordHash,
  verifyPassword,
} from "./security.js";
const text = z.string().trim().min(1);
const futureDate = z
  .string()
  .datetime()
  .refine((s) => new Date(s).getTime() > Date.now(), "有效期必须在未来");
const wrap =
  (fn: (req: any, res: Response) => Promise<any>) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
export function createApp(db: DB) {
  const app = express(),
    service = new MemoryService(db);
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "same-origin");
    next();
  });
  app.use(express.json({ limit: "64mb" }));
  app.use(cookieParser());
  app.use("/api", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.get(
    "/api/health",
    wrap(async (_req, res) => {
      await db.query("SELECT 1");
      res.json({
        status: "ok",
        database: process.env.DATABASE_URL ? "postgres" : "pglite",
      });
    }),
  );
  app.use("/api", (req, res, next) => {
    const origin = req.headers.origin;
    if (
      origin &&
      origin !== (process.env.APP_ORIGIN || "http://127.0.0.1:4317")
    )
      return res.status(403).json({ error: "请求来源不被允许" });
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      !req.is("application/json")
    )
      return res.status(415).json({ error: "仅接受 JSON 请求" });
    next();
  });
  const attempts = new Map<string, { count: number; at: number }>();
  app.post(
    "/api/login",
    wrap(async (req, res) => {
      const input = z
        .object({ username: text.max(100), password: text.max(200) })
        .parse(req.body);
      const key = req.ip || "local",
        previous = attempts.get(key),
        now = Date.now();
      const count = previous && now - previous.at < 60000 ? previous.count : 0;
      assert(count < 20, 429, "尝试次数过多，请一分钟后重试");
      attempts.set(key, {
        count: count + 1,
        at: previous && count ? previous.at : now,
      });
      const [user] = await db.query("SELECT * FROM users WHERE username=$1", [
        input.username,
      ]);
      assert(
        user && verifyPassword(input.password, user.password_hash),
        401,
        "用户名或密码错误",
      );
      attempts.delete(key);
      const value = token();
      await db.query(
        "INSERT INTO auth_tokens(id,user_id,token_hash,kind,expires_at) VALUES($1,$2,$3,'cookie',now()+interval '12 hours')",
        [id(), user.id, hash(value)],
      );
      res
        .cookie("memory_session", value, {
          httpOnly: true,
          sameSite: "strict",
          secure: process.env.COOKIE_SECURE === "true",
          maxAge: 12 * 3600000,
          path: "/",
        })
        .json({ ok: true });
    }),
  );
  app.use("/api", (req: any, res, next) => {
    Promise.resolve(
      (async () => {
        const bearer = req.headers.authorization?.startsWith("Bearer ")
          ? req.headers.authorization.slice(7)
          : undefined;
        const raw = bearer || req.cookies.memory_session;
        assert(raw, 401, "请先登录");
        const [user] = await db.query(
          "SELECT u.id,u.username,u.name,t.id AS token_id,t.kind FROM auth_tokens t JOIN users u ON u.id=t.user_id WHERE t.token_hash=$1 AND t.expires_at>now() AND t.kind=$2",
          [hash(raw), bearer ? "api" : "cookie"],
        );
        assert(user, 401, "登录已过期或令牌无效");
        req.user = user;
        next();
      })(),
    ).catch(next);
  });
  app.post(
    "/api/logout",
    wrap(async (req, res) => {
      await db.query("DELETE FROM auth_tokens WHERE id=$1", [
        req.user.token_id,
      ]);
      res.clearCookie("memory_session", { path: "/" }).json({ ok: true });
    }),
  );
  app.get(
    "/api/me",
    wrap(async (req, res) => {
      const projects = await db.query(
        "SELECT p.*,m.role FROM memberships m JOIN projects p ON p.id=m.project_id WHERE user_id=$1 ORDER BY p.name",
        [req.user.id],
      );
      res.json({ user: req.user, projects });
    }),
  );
  app.get(
    "/api/tokens",
    wrap(async (req, res) =>
      res.json(
        await db.query(
          "SELECT id,name,created_at,expires_at FROM auth_tokens WHERE user_id=$1 AND kind='api' AND expires_at>now() ORDER BY created_at DESC",
          [req.user.id],
        ),
      ),
    ),
  );
  app.post(
    "/api/tokens",
    wrap(async (req, res) => {
      const name = text.max(80).parse(req.body.name),
        value = token(),
        tid = id();
      await db.query(
        "INSERT INTO auth_tokens(id,user_id,token_hash,kind,name,expires_at) VALUES($1,$2,$3,'api',$4,now()+interval '30 days')",
        [tid, req.user.id, hash(value), name],
      );
      res.status(201).json({ id: tid, token: value });
    }),
  );
  app.delete(
    "/api/tokens/:id",
    wrap(async (req, res) => {
      await db.query(
        "DELETE FROM auth_tokens WHERE id=$1 AND user_id=$2 AND kind='api'",
        [req.params.id, req.user.id],
      );
      res.json({ ok: true });
    }),
  );
  app.use("/api/projects/:projectId", (req: any, _res, next) => {
    service
      .context(req.user.id, req.params.projectId)
      .then((ctx) => {
        req.ctx = ctx;
        next();
      })
      .catch(next);
  });
  const base = "/api/projects/:projectId";
  app.get(
    `${base}/dashboard`,
    wrap(async (req, res) => res.json(await service.dashboard(req.ctx))),
  );
  app.get(
    `${base}/sessions`,
    wrap(async (req, res) => res.json(await service.sessions(req.ctx))),
  );
  app.post(
    `${base}/sessions`,
    wrap(async (req, res) => {
      const input = z
        .object({
          raw: z
            .string()
            .min(1)
            .refine(
              (value) => Buffer.byteLength(value, "utf8") <= MAX_IMPORT_BYTES,
              "原始会话不能超过 32 MiB",
            ),
          source: z.enum(["claude-code", "codex", "cursor", "generic"]),
          title: text.max(200),
          visibility: z.enum(["team", "private"]).default("private"),
        })
        .parse(req.body);
      res.status(201).json(await service.import(req.ctx, input));
    }),
  );
  app.get(
    `${base}/sessions/:id`,
    wrap(async (req, res) => {
      const s = await service.session(req.ctx, req.params.id);
      delete s.raw_text;
      const runs = await db.query(
        "SELECT * FROM extraction_runs WHERE session_id=$1 ORDER BY created_at DESC",
        [s.id],
      );
      res.json({ ...s, runs });
    }),
  );
  app.get(
    `${base}/sessions/:id/raw`,
    wrap(async (req, res) => {
      const s = await service.session(req.ctx, req.params.id);
      res
        .type("text/plain")
        .setHeader(
          "Content-Disposition",
          'attachment; filename="session.jsonl"',
        );
      res.send(s.raw_text);
    }),
  );
  app.post(
    `${base}/sessions/:id/extract`,
    wrap(async (req, res) =>
      res.json(await service.extractSession(req.ctx, req.params.id)),
    ),
  );
  app.get(
    `${base}/candidates`,
    wrap(async (req, res) => res.json(await service.candidates(req.ctx))),
  );
  app.patch(
    `${base}/candidates/:id`,
    wrap(async (req, res) =>
      res.json(await service.editCandidate(req.ctx, req.params.id, req.body)),
    ),
  );
  app.post(
    `${base}/candidates/:id/review`,
    wrap(async (req, res) => {
      const input = z
        .object({
          action: z.enum(["approve", "reject"]),
          note: text.max(2000),
          replaceId: z.string().uuid().optional(),
          expiresAt: futureDate.optional(),
        })
        .parse(req.body);
      res.json(await service.review(req.ctx, req.params.id, input));
    }),
  );
  app.get(
    `${base}/knowledge`,
    wrap(async (req, res) => res.json(await service.knowledge(req.ctx))),
  );
  app.get(
    `${base}/knowledge/:id`,
    wrap(async (req, res) =>
      res.json(await service.knowledgeOne(req.ctx, req.params.id)),
    ),
  );
  app.get(
    `${base}/knowledge/:id/versions`,
    wrap(async (req, res) =>
      res.json(await service.versions(req.ctx, req.params.id)),
    ),
  );
  app.patch(
    `${base}/knowledge/:id`,
    wrap(async (req, res) => {
      const input = z
        .object({
          version: z.number().int().positive(),
          title: text.max(200),
          body: text.max(8000),
          rationale: z.string().max(4000),
          revisit_condition: z.string().max(2000),
          rejected_alternatives: z.string().max(2000),
          expiresAt: futureDate.nullable(),
          reason: text.max(2000),
        })
        .parse(req.body);
      res.json(await service.editKnowledge(req.ctx, req.params.id, input));
    }),
  );
  app.post(
    `${base}/knowledge/:id/expire`,
    wrap(async (req, res) =>
      res.json(
        await service.expire(
          req.ctx,
          req.params.id,
          z.number().int().positive().parse(req.body.version),
        ),
      ),
    ),
  );
  app.get(
    `${base}/conflicts`,
    wrap(async (req, res) => res.json(await service.conflicts(req.ctx))),
  );
  app.post(
    `${base}/search`,
    wrap(async (req, res) => {
      const input = z
        .object({
          query: text.max(500),
          limit: z.number().int().min(1).max(20).default(8),
        })
        .parse(req.body);
      res.json(
        await service.search(
          req.ctx,
          input.query,
          input.limit,
          req.user.kind === "api" ? "mcp/api" : "web",
        ),
      );
    }),
  );
  app.get(
    `${base}/logs`,
    wrap(async (req, res) => res.json(await service.logs(req.ctx))),
  );
  app.post(
    `${base}/logs/:id/feedback`,
    wrap(async (req, res) =>
      res.json(
        await service.feedback(
          req.ctx,
          req.params.id,
          z.union([z.literal(1), z.literal(-1)]).parse(req.body.value),
        ),
      ),
    ),
  );
  app.get(
    `${base}/members`,
    wrap(async (req, res) =>
      res.json(
        await db.query(
          "SELECT u.id,u.username,u.name,m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.project_id=$1 ORDER BY u.name",
          [req.ctx.projectId],
        ),
      ),
    ),
  );
  app.post(
    `${base}/members`,
    wrap(async (req, res) => {
      service.require(req.ctx, "admin");
      const input = z
        .object({
          username: text.regex(/^[a-zA-Z0-9_.-]+$/).max(80),
          name: text.max(100),
          password: z.string().min(12).max(200).optional(),
          role: z.enum(["admin", "reviewer", "member", "reader"]),
        })
        .parse(req.body);
      const result = await service.locked(req.ctx, async (tx) => {
        let [user] = await tx.query("SELECT id FROM users WHERE username=$1", [
          input.username,
        ]);
        if (!user) {
          assert(input.password, 400, "新成员需要至少 12 位初始密码");
          user = { id: id() };
          await tx.query(
            "INSERT INTO users(id,username,name,password_hash) VALUES($1,$2,$3,$4)",
            [user.id, input.username, input.name, passwordHash(input.password)],
          );
        }
        const existing = await tx.query(
          "SELECT role FROM memberships WHERE project_id=$1 AND user_id=$2",
          [req.ctx.projectId, user.id],
        );
        assert(!existing.length, 409, "成员已经在项目中，请使用角色管理");
        await tx.query(
          "INSERT INTO memberships(project_id,user_id,role) VALUES($1,$2,$3)",
          [req.ctx.projectId, user.id, input.role],
        );
        await service.audit(tx, req.ctx, "member.add", user.id);
        return { ok: true };
      });
      res.status(201).json(result);
    }),
  );
  app.patch(
    `${base}/members/:id`,
    wrap(async (req, res) => {
      service.require(req.ctx, "admin");
      const role = z
        .enum(["admin", "reviewer", "member", "reader"])
        .nullable()
        .parse(req.body.role);
      const result = await service.locked(req.ctx, async (tx) => {
        const [member] = await tx.query(
          "SELECT role FROM memberships WHERE project_id=$1 AND user_id=$2",
          [req.ctx.projectId, req.params.id],
        );
        assert(member, 404, "成员不存在");
        if (member.role === "admin" && role !== "admin") {
          const admins = await tx.query(
            "SELECT user_id FROM memberships WHERE project_id=$1 AND role='admin'",
            [req.ctx.projectId],
          );
          assert(admins.length > 1, 409, "项目必须保留至少一位管理员");
        }
        if (role)
          await tx.query(
            "UPDATE memberships SET role=$3 WHERE project_id=$1 AND user_id=$2",
            [req.ctx.projectId, req.params.id, role],
          );
        else
          await tx.query(
            "DELETE FROM memberships WHERE project_id=$1 AND user_id=$2",
            [req.ctx.projectId, req.params.id],
          );
        await service.audit(tx, req.ctx, "member.role", req.params.id);
        return { ok: true };
      });
      res.json(result);
    }),
  );
  app.use("/api", (_req, res) => res.status(404).json({ error: "接口不存在" }));
  app.use((error: any, _req: Request, res: Response, _next: NextFunction) => {
    const status =
      error instanceof AppError
        ? error.status
        : error instanceof ZodError
          ? 400
          : error.type === "entity.parse.failed"
            ? 400
            : error.type === "entity.too.large"
              ? 413
              : 500;
    const message =
      error instanceof AppError
        ? error.message
        : error instanceof ZodError
          ? error.issues
              .map((e) => `${e.path.join(".")}: ${e.message}`)
              .join("；")
          : status === 413
            ? "导入请求过大（JSON 传输上限 64 MiB）"
            : "操作失败，请检查输入或服务日志";
    if (status === 500) console.error("[request error]", error.message);
    res.status(status).json({ error: message });
  });
  return { app, service };
}
