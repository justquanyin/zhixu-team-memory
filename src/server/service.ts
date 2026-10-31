import { randomUUID } from "node:crypto";
import type { DB } from "./db.js";
import type { Context, Source, Draft } from "../shared/types.js";
import { assert, hash, redact } from "./security.js";
import { parseSession } from "./adapters.js";
import {
  extract,
  embedding,
  terms,
  validateEvidence,
  draftSchema,
} from "./extraction.js";
export const id = () => randomUUID();
const visible = (alias: string) =>
  `${alias}.project_id=$1 AND (${alias}.visibility='team' OR ${alias}.owner_id=$2)`;
export class MemoryService {
  constructor(public db: DB) {}
  async context(userId: string, projectId: string): Promise<Context> {
    const [m] = await this.db.query(
      "SELECT role FROM memberships WHERE project_id=$1 AND user_id=$2",
      [projectId, userId],
    );
    assert(m, 403, "无此项目权限");
    return { userId, projectId, role: m.role };
  }
  require(ctx: Context, level: "write" | "review" | "admin") {
    assert(
      level === "admin"
        ? ctx.role === "admin"
        : level === "review"
          ? ["admin", "reviewer"].includes(ctx.role)
          : ctx.role !== "reader",
      403,
      "当前角色没有此操作权限",
    );
  }
  async audit(db: DB, ctx: Context, action: string, entity: string) {
    await db.query(
      "INSERT INTO audit_events(id,project_id,actor_id,action,entity_id) VALUES($1,$2,$3,$4,$5)",
      [id(), ctx.projectId, ctx.userId, action, entity],
    );
  }
  async locked<T>(ctx: Context, fn: (db: DB) => Promise<T>): Promise<T> {
    return this.db.tx(async (db) => {
      await db.query("SELECT id FROM projects WHERE id=$1 FOR UPDATE", [
        ctx.projectId,
      ]);
      return fn(db);
    });
  }
  async sessions(ctx: Context) {
    return this.db.query(
      `SELECT s.id,s.title,s.source,s.visibility,s.owner_id,s.created_at,s.raw_hash,jsonb_array_length(s.events) AS event_count,u.name AS owner_name,
      (SELECT count(*)::int FROM candidates c WHERE c.session_id=s.id) AS candidate_count,
      (SELECT status FROM extraction_runs r WHERE r.session_id=s.id ORDER BY created_at DESC LIMIT 1) AS extraction_status
      FROM sessions s JOIN users u ON u.id=s.owner_id WHERE ${visible("s")} ORDER BY s.created_at DESC`,
      [ctx.projectId, ctx.userId],
    );
  }
  async session(ctx: Context, sessionId: string, db = this.db) {
    const [s] = await db.query(
      `SELECT s.* FROM sessions s WHERE ${visible("s")} AND s.id=$3`,
      [ctx.projectId, ctx.userId, sessionId],
    );
    assert(s, 404, "会话不存在或不可见");
    return s;
  }
  async import(
    ctx: Context,
    input: {
      raw: string;
      source: Source;
      title: string;
      visibility: "team" | "private";
    },
  ) {
    this.require(ctx, "write");
    const events = parseSession(input.raw, input.source);
    const sid = id();
    const digest = hash(input.raw);
    const session = await this.locked(ctx, async (db) => {
      const rows = await db.query(
        "INSERT INTO sessions(id,project_id,owner_id,visibility,title,source,raw_text,raw_hash,events) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(project_id,owner_id,visibility,raw_hash) DO NOTHING RETURNING id",
        [
          sid,
          ctx.projectId,
          ctx.userId,
          input.visibility,
          redact(input.title),
          input.source,
          input.raw,
          digest,
          JSON.stringify(events),
        ],
      );
      if (!rows.length) {
        const [existing] = await db.query(
          "SELECT id FROM sessions WHERE project_id=$1 AND owner_id=$2 AND visibility=$3 AND raw_hash=$4",
          [ctx.projectId, ctx.userId, input.visibility, digest],
        );
        return { id: existing.id, duplicate: true };
      }
      await this.audit(db, ctx, "session.import", sid);
      return { id: sid, duplicate: false };
    });
    if (session.duplicate) return session;
    return { ...session, ...(await this.extractSession(ctx, session.id)) };
  }
  async extractSession(ctx: Context, sid: string) {
    this.require(ctx, "write");
    const s = await this.session(ctx, sid);
    let drafts: Draft[];
    const runId = id(),
      provider = process.env.EXTRACTOR === "llm" ? "llm" : "rules";
    try {
      drafts = await extract(s.events);
    } catch (e) {
      // Never persist provider responses or credentials in logs.
      await this.db.query(
        "INSERT INTO extraction_runs(id,session_id,provider,status,error) VALUES($1,$2,$3,$4,$5)",
        [
          runId,
          sid,
          provider,
          "failed",
          "提取失败；请检查模型配置、响应格式及证据引用，然后重试。",
        ],
      );
      return { extracted: 0, extraction_status: "failed" };
    }
    return this.locked(ctx, async (db) => {
      let count = 0;
      for (const draft of drafts) {
        validateEvidence(draft, s.events);
        const rows = await db.query(
          `INSERT INTO candidates(id,session_id,topic_key,title,body,kind,rationale,rejected_alternatives,revisit_condition,evidence,confidence)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(session_id,topic_key) DO NOTHING RETURNING id`,
          [
            id(),
            sid,
            draft.topic_key,
            draft.title,
            draft.body,
            draft.kind,
            draft.rationale,
            draft.rejected_alternatives,
            draft.revisit_condition,
            JSON.stringify(draft.evidence),
            draft.confidence,
          ],
        );
        if (rows.length) {
          count++;
          await this.detect(db, ctx, rows[0].id);
        }
      }
      await db.query(
        "INSERT INTO extraction_runs(id,session_id,provider,status) VALUES($1,$2,$3,$4)",
        [runId, sid, provider, "completed"],
      );
      await this.audit(db, ctx, "session.extract", sid);
      return { extracted: count, extraction_status: "completed" };
    });
  }
  async candidate(ctx: Context, cid: string, db = this.db) {
    const [c] = await db.query(
      `SELECT c.*,s.project_id,s.owner_id,s.visibility,s.title AS session_title,s.events FROM candidates c JOIN sessions s ON s.id=c.session_id WHERE ${visible("s")} AND c.id=$3`,
      [ctx.projectId, ctx.userId, cid],
    );
    assert(c, 404, "候选不存在或不可见");
    return c;
  }
  async candidates(ctx: Context) {
    return this.db.query(
      `SELECT c.*,s.title AS session_title,s.visibility,s.source,s.owner_id,
      (SELECT count(*)::int FROM conflicts f WHERE f.candidate_id=c.id AND f.status='open') AS conflict_count
      FROM candidates c JOIN sessions s ON s.id=c.session_id WHERE ${visible("s")} ORDER BY c.created_at DESC`,
      [ctx.projectId, ctx.userId],
    );
  }
  async detect(db: DB, ctx: Context, cid: string) {
    const c = await this.candidate(ctx, cid, db);
    const existing = await db.query(
      `SELECT * FROM knowledge WHERE project_id=$1 AND topic_key=$2 AND status='active' AND visibility=$3 AND (visibility='team' OR owner_id=$4)`,
      [ctx.projectId, c.topic_key, c.visibility, c.owner_id],
    );
    for (const k of existing) {
      await db.query(
        "INSERT INTO conflicts(id,candidate_id,knowledge_id,reason) VALUES($1,$2,$3,$4) ON CONFLICT(candidate_id,knowledge_id) DO UPDATE SET status='open',reason=excluded.reason",
        [
          id(),
          cid,
          k.id,
          k.body === c.body
            ? "相同主题、相同内容：重复证据，需人工决定"
            : "相同主题存在不同表述：需审核后明确替代",
        ],
      );
    }
    return existing;
  }
  async editCandidate(ctx: Context, cid: string, input: unknown) {
    this.require(ctx, "review");
    const draft = draftSchema.parse(input);
    return this.locked(ctx, async (db) => {
      const c = await this.candidate(ctx, cid, db);
      assert(c.status === "pending", 409, "候选已审核，不能修改");
      validateEvidence(draft, c.events);
      await db.query(
        "UPDATE candidates SET topic_key=$2,title=$3,body=$4,kind=$5,rationale=$6,rejected_alternatives=$7,revisit_condition=$8,evidence=$9,confidence=$10 WHERE id=$1",
        [
          cid,
          draft.topic_key,
          redact(draft.title),
          redact(draft.body),
          draft.kind,
          redact(draft.rationale),
          redact(draft.rejected_alternatives),
          redact(draft.revisit_condition),
          JSON.stringify(draft.evidence),
          draft.confidence,
        ],
      );
      await db.query(
        "UPDATE conflicts SET status='resolved',resolution='候选修订后重新检测',resolved_by=$2 WHERE candidate_id=$1",
        [cid, ctx.userId],
      );
      await this.detect(db, ctx, cid);
      await this.audit(db, ctx, "candidate.edit", cid);
      return this.candidate(ctx, cid, db);
    });
  }
  async review(
    ctx: Context,
    cid: string,
    input: {
      action: "approve" | "reject";
      note: string;
      replaceId?: string;
      expiresAt?: string;
    },
  ) {
    this.require(ctx, "review");
    return this.locked(ctx, async (db) => {
      const c = await this.candidate(ctx, cid, db);
      assert(c.status === "pending", 409, "此候选已经审核");
      if (input.action === "reject") {
        await db.query(
          "UPDATE candidates SET status='rejected',review_note=$2,reviewed_by=$3,reviewed_at=now() WHERE id=$1",
          [cid, redact(input.note), ctx.userId],
        );
        await db.query(
          "UPDATE conflicts SET status='resolved',resolution='候选已拒绝',resolved_by=$2 WHERE candidate_id=$1",
          [cid, ctx.userId],
        );
        await this.audit(db, ctx, "candidate.reject", cid);
        return { status: "rejected" };
      }
      const conflicts = await this.detect(db, ctx, cid);
      assert(
        conflicts.length === 0 || input.replaceId === conflicts[0].id,
        409,
        "存在同主题知识；请在冲突队列中明确选择替代，或拒绝重复候选",
      );
      assert(
        !input.replaceId || conflicts.some((k) => k.id === input.replaceId),
        409,
        "替代目标已发生变化，请刷新后重试",
      );
      if (input.replaceId)
        await db.query(
          "UPDATE knowledge SET status='superseded',updated_at=now() WHERE id=$1",
          [input.replaceId],
        );
      const kid = id();
      await db.query(
        `INSERT INTO knowledge(id,project_id,owner_id,visibility,topic_key,title,body,kind,rationale,rejected_alternatives,revisit_condition,source_session_id,candidate_id,evidence,expires_at,search_text,embedding)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,to_tsvector('simple',$16),$17::vector)`,
        [
          kid,
          ctx.projectId,
          c.owner_id,
          c.visibility,
          c.topic_key,
          c.title,
          c.body,
          c.kind,
          c.rationale,
          c.rejected_alternatives,
          c.revisit_condition,
          c.session_id,
          cid,
          JSON.stringify(c.evidence),
          input.expiresAt ?? null,
          terms(c.title + " " + c.body).join(" "),
          embedding(c.title + " " + c.body),
        ],
      );
      if (input.replaceId) {
        await db.query("UPDATE knowledge SET superseded_by=$2 WHERE id=$1", [
          input.replaceId,
          kid,
        ]);
        await this.snapshot(db, ctx, input.replaceId, "被新知识替代", true);
      }
      await this.snapshot(db, ctx, kid, input.note);
      await db.query(
        "UPDATE candidates SET status='approved',review_note=$2,reviewed_by=$3,reviewed_at=now() WHERE id=$1",
        [cid, redact(input.note), ctx.userId],
      );
      await db.query(
        "UPDATE conflicts SET status='resolved',resolution='已审核晋升并处理替代',resolved_by=$2 WHERE candidate_id=$1 OR knowledge_id=$3",
        [cid, ctx.userId, input.replaceId ?? ""],
      );
      await this.audit(db, ctx, "candidate.approve", kid);
      return { id: kid, status: "approved" };
    });
  }
  async knowledge(ctx: Context, includeInactive = true, db = this.db) {
    return db.query(
      `SELECT k.id,k.project_id,k.owner_id,k.visibility,k.topic_key,k.title,k.body,k.kind,k.rationale,k.rejected_alternatives,k.revisit_condition,k.source_session_id,k.candidate_id,k.evidence,k.version,k.status,k.superseded_by,k.expires_at,k.created_at,k.updated_at,
      (k.status='active' AND k.expires_at <= now()) AS is_due FROM knowledge k WHERE ${visible("k")} ${includeInactive ? "" : "AND k.status='active' AND (k.expires_at IS NULL OR k.expires_at>now())"} ORDER BY k.updated_at DESC`,
      [ctx.projectId, ctx.userId],
    );
  }
  async knowledgeOne(ctx: Context, kid: string, db = this.db) {
    const [k] = await db.query(
      `SELECT k.* FROM knowledge k WHERE ${visible("k")} AND k.id=$3`,
      [ctx.projectId, ctx.userId, kid],
    );
    assert(k, 404, "知识不存在或不可见");
    delete k.embedding;
    delete k.search_text;
    return k;
  }
  async snapshot(
    db: DB,
    ctx: Context,
    kid: string,
    reason: string,
    bump = false,
  ) {
    if (bump)
      await db.query(
        "UPDATE knowledge SET version=version+1,updated_at=now() WHERE id=$1",
        [kid],
      );
    const k = await this.knowledgeOne(ctx, kid, db);
    await db.query(
      "INSERT INTO knowledge_versions(id,knowledge_id,version,snapshot,actor_id,reason) VALUES($1,$2,$3,$4,$5,$6)",
      [id(), kid, k.version, JSON.stringify(k), ctx.userId, redact(reason)],
    );
  }
  async versions(ctx: Context, kid: string) {
    await this.knowledgeOne(ctx, kid);
    return this.db.query(
      "SELECT v.*,u.name AS actor_name FROM knowledge_versions v JOIN users u ON u.id=v.actor_id WHERE knowledge_id=$1 ORDER BY version DESC",
      [kid],
    );
  }
  async editKnowledge(
    ctx: Context,
    kid: string,
    input: {
      version: number;
      title: string;
      body: string;
      rationale: string;
      revisit_condition: string;
      rejected_alternatives: string;
      expiresAt: string | null;
      reason: string;
    },
  ) {
    this.require(ctx, "review");
    return this.locked(ctx, async (db) => {
      const k = await this.knowledgeOne(ctx, kid, db);
      assert(k.version === input.version, 409, "版本已更新，请刷新后重新编辑");
      assert(k.status === "active", 409, "只能编辑当前有效知识");
      await db.query(
        `UPDATE knowledge SET title=$2,body=$3,rationale=$4,revisit_condition=$5,rejected_alternatives=$6,expires_at=$7,search_text=to_tsvector('simple',$8),embedding=$9::vector,version=version+1,updated_at=now() WHERE id=$1`,
        [
          kid,
          redact(input.title),
          redact(input.body),
          redact(input.rationale),
          redact(input.revisit_condition),
          redact(input.rejected_alternatives),
          input.expiresAt,
          terms(redact(input.title + " " + input.body)).join(" "),
          embedding(redact(input.title + " " + input.body)),
        ],
      );
      await this.snapshot(db, ctx, kid, input.reason);
      await this.audit(db, ctx, "knowledge.edit", kid);
      return this.knowledgeOne(ctx, kid, db);
    });
  }
  async expire(ctx: Context, kid: string, version: number) {
    this.require(ctx, "review");
    return this.locked(ctx, async (db) => {
      const k = await this.knowledgeOne(ctx, kid, db);
      assert(
        k.version === version && k.status === "active",
        409,
        "状态或版本已变化",
      );
      await db.query("UPDATE knowledge SET status='expired' WHERE id=$1", [
        kid,
      ]);
      await this.snapshot(db, ctx, kid, "人工停用 / 过期治理", true);
      await this.audit(db, ctx, "knowledge.expire", kid);
      return { ok: true };
    });
  }
  async conflicts(ctx: Context) {
    return this.db.query(
      `SELECT f.*,c.title AS candidate_title,c.body AS candidate_body,c.topic_key,k.title AS knowledge_title,k.body AS knowledge_body,k.version AS knowledge_version
      FROM conflicts f JOIN candidates c ON c.id=f.candidate_id JOIN sessions s ON s.id=c.session_id JOIN knowledge k ON k.id=f.knowledge_id
      WHERE ${visible("s")} AND (k.visibility='team' OR k.owner_id=$2) AND f.status='open' AND c.status='pending' AND k.status='active' ORDER BY f.created_at DESC`,
      [ctx.projectId, ctx.userId],
    );
  }
  async search(ctx: Context, query: string, limit = 8, channel = "web") {
    const start = performance.now(),
      clean = redact(query),
      tokens = terms(clean),
      vector = embedding(clean);
    const q =
      tokens.map((x) => `'${x.replace(/'/g, "")}'`).join(" | ") ||
      "'__empty__'";
    const results = await this.db.query(
      `WITH eligible AS (
      SELECT k.id,k.title,k.body,k.topic_key,k.kind,k.version,k.source_session_id,k.evidence,k.visibility,k.expires_at,
      ts_rank_cd(k.search_text,to_tsquery('simple',$3)) AS lexical, 1-(k.embedding <=> $4::vector) AS similarity
      FROM knowledge k WHERE ${visible("k")} AND k.status='active' AND (k.expires_at IS NULL OR k.expires_at>now())
    ), lex AS (SELECT id,row_number() OVER(ORDER BY lexical DESC,id) AS rank FROM eligible WHERE lexical>0 ORDER BY lexical DESC,id LIMIT 50),
    vec AS (SELECT id,row_number() OVER(ORDER BY similarity DESC,id) AS rank FROM eligible WHERE similarity>0.15 ORDER BY similarity DESC,id LIMIT 50)
    SELECT e.*,COALESCE(1.0/(60+lex.rank),0)+COALESCE(1.0/(60+vec.rank),0) AS score,lex.rank AS lexical_rank,vec.rank AS vector_rank
    FROM eligible e LEFT JOIN lex USING(id) LEFT JOIN vec USING(id) WHERE lex.id IS NOT NULL OR vec.id IS NOT NULL ORDER BY score DESC,e.id LIMIT $5`,
      [ctx.projectId, ctx.userId, q, vector, limit],
    );
    const logId = id(),
      duration = Math.max(1, Math.round(performance.now() - start));
    await this.db.query(
      "INSERT INTO recall_logs(id,project_id,actor_id,query,channel,results,duration_ms) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        logId,
        ctx.projectId,
        ctx.userId,
        clean,
        channel,
        JSON.stringify(
          results.map((r) => ({
            id: r.id,
            version: r.version,
            score: Number(r.score),
          })),
        ),
        duration,
      ],
    );
    return {
      results,
      logId,
      durationMs: duration,
      mode: "FTS + pgvector（本地词法向量）· RRF",
      context: results
        .map(
          (r) =>
            `[知识 ${r.id}@v${r.version} / Session ${r.source_session_id}]\n${r.title}\n${r.body}`,
        )
        .join("\n\n"),
    };
  }
  async logs(ctx: Context) {
    // Private per caller. Administrators cannot read another user's private queries.
    return this.db.query(
      "SELECT * FROM recall_logs WHERE project_id=$1 AND actor_id=$2 ORDER BY created_at DESC LIMIT 200",
      [ctx.projectId, ctx.userId],
    );
  }
  async feedback(ctx: Context, logId: string, value: number) {
    const rows = await this.db.query(
      "UPDATE recall_logs SET feedback=$4 WHERE id=$1 AND project_id=$2 AND actor_id=$3 RETURNING id",
      [logId, ctx.projectId, ctx.userId, value],
    );
    assert(rows.length, 404, "召回记录不存在");
    return { ok: true };
  }
  async dashboard(ctx: Context) {
    const [sessions, candidates, knowledge, conflicts, logs] =
      await Promise.all([
        this.sessions(ctx),
        this.candidates(ctx),
        this.knowledge(ctx),
        this.conflicts(ctx),
        this.logs(ctx),
      ]);
    const active = knowledge.filter((k) => k.status === "active" && !k.is_due),
      pending = candidates.filter((c) => c.status === "pending");
    const rated = logs.filter((l) => l.feedback),
      positive = rated.filter((l) => l.feedback === 1);
    return {
      sessions: sessions.length,
      pending: pending.length,
      active: active.length,
      conflicts: conflicts.length,
      expiring: knowledge.filter(
        (k) =>
          k.status === "active" &&
          k.expires_at &&
          new Date(k.expires_at).getTime() < Date.now() + 7 * 86400000,
      ).length,
      recallCount: logs.length,
      hitRate: logs.length
        ? logs.filter((l) => l.results.length).length / logs.length
        : null,
      helpfulRate: rated.length ? positive.length / rated.length : null,
      ratedCount: rated.length,
      latencyMs: logs.length
        ? Math.round(
            logs.reduce((sum, l) => sum + l.duration_ms, 0) / logs.length,
          )
        : null,
      sources: ["claude-code", "codex", "cursor", "generic"].map((source) => ({
        source,
        count: sessions.filter((s) => s.source === source).length,
      })),
      recentSessions: sessions.slice(0, 5),
      recentKnowledge: active.slice(0, 4),
      extractor: process.env.EXTRACTOR === "llm" ? "模型提取" : "离线规则提取",
      searchMode: "本地词法向量 + FTS",
      scope: "召回指标仅当前成员最近 200 次请求",
    };
  }
}
