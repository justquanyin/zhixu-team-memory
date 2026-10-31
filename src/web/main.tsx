import { MAX_IMPORT_BYTES } from "../shared/limits";
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  CheckCheck,
  ChevronRight,
  Clock3,
  Code2,
  Database,
  Download,
  FileText,
  GitBranch,
  Layers3,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Terminal,
  ThumbsDown,
  ThumbsUp,
  TriangleAlert,
  Upload,
  Users,
  X,
} from "lucide-react";
import "./styles.css";
type Row = Record<string, any>;
const labels: Row = {
  active: "有效",
  superseded: "已替代",
  expired: "已过期",
  pending: "待审核",
  approved: "已晋升",
  rejected: "已拒绝",
  decision: "设计决策",
  fact: "项目事实",
  lesson: "经验教训",
  procedure: "流程规范",
  team: "团队共享",
  private: "仅自己",
  admin: "管理员",
  reviewer: "审核员",
  member: "贡献者",
  reader: "只读成员",
  completed: "提取完成",
  failed: "提取失败",
};
const sourceLabel: Row = {
  "claude-code": "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
  generic: "通用导入",
};
const date = (value: any) =>
  value
    ? new Date(value).toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
const pct = (n: number | null) =>
  n === null ? "—" : `${Math.round(n * 100)}%`;
async function api(path: string, method = "GET", body?: any) {
  const r = await fetch("/api" + path, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error);
  return data;
}
function Badge({ value }: { value: string }) {
  return (
    <span className={`badge ${value}`}>
      {labels[value] || sourceLabel[value] || value}
    </span>
  );
}
function Empty({ text = "这里还没有记录" }: { text?: string }) {
  return (
    <div className="empty">
      <Layers3 size={32} />
      <strong>{text}</strong>
      <span>导入会话、审核候选，让团队经验有迹可循。</span>
    </div>
  );
}
function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`modal ${wide ? "wide" : ""}`}
      >
        <header>
          <h2>{title}</h2>
          <button className="icon" onClick={onClose} aria-label="关闭">
            <X size={20} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function App() {
  const [me, setMe] = useState<Row | null>(null),
    [initial, setInitial] = useState(true),
    [project, setProject] = useState("atlas"),
    [page, setPage] = useState("overview"),
    [revision, setRevision] = useState(0),
    [toast, setToast] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [modal, setModal] = useState<React.ReactNode>(null),
    [focusSession, setFocusSession] = useState<string | null>(null);
  const [login, setLogin] = useState({ username: "admin", password: "" });
  async function loadMe() {
    const m = await api("/me");
    setMe(m);
    if (!m.projects.some((p: Row) => p.id === project))
      setProject(m.projects[0]?.id || "");
    return m;
  }
  useEffect(() => {
    loadMe()
      .catch(() => {})
      .finally(() => setInitial(false));
  }, []);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(""), 4500);
      return () => clearTimeout(t);
    }
  }, [toast]);
  async function action(fn: () => Promise<any>, message = "操作已完成") {
    setBusy(true);
    setError("");
    try {
      const r = await fn();
      setRevision((n) => n + 1);
      if (message) setToast(message);
      return r;
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      setBusy(false);
    }
  }
  const run = (fn: () => Promise<any>, message?: string) => {
    void action(fn, message).catch(() => {});
  };
  const base = `/projects/${project}`;
  const current = me?.projects.find((p: Row) => p.id === project);
  const canReview = ["admin", "reviewer"].includes(current?.role),
    canWrite = current?.role !== "reader";
  const openSession = (sid: string) => {
    setFocusSession(sid);
    setPage("sessions");
  };
  const props = {
    base,
    revision,
    run,
    action,
    canReview,
    canWrite,
    busy,
    setModal,
    openSession,
    setPage,
  };
  const nav = [
    ["overview", "总览仪表盘", LayoutDashboard],
    ["sessions", "Session 会话", Terminal],
    ["candidates", "记忆候选", Sparkles],
    ["knowledge", "团队知识", BookOpen],
    ["governance", "冲突与过期", GitBranch],
    ["search", "召回调试台", Search],
    ["logs", "召回日志", Activity],
    ["members", "成员与权限", Users],
  ] as const;
  if (initial) return <div className="loading-screen">正在连接记忆空间…</div>;
  if (!me)
    return (
      <div className="login">
        <div className="login-story">
          <div className="brand-mark">
            <Layers3 />
          </div>
          <p className="eyebrow">TEAM MEMORY / 知序</p>
          <h1>
            让每一次探索，
            <br />
            成为团队的下一步。
          </h1>
          <p>
            从 Coding Agent 会话到可信知识。
            <br />
            保留证据、共同审核、在需要时召回。
          </p>
          <div className="login-flow">
            SESSION <ArrowRight /> CANDIDATE <ArrowRight /> KNOWLEDGE
          </div>
          <small>本地部署 · 证据可溯 · 权限隔离</small>
        </div>
        <form
          className="login-form"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              await api("/login", "POST", login);
              await loadMe();
            }, "登录成功");
          }}
        >
          <span className="eyebrow">欢迎回来</span>
          <h2>进入团队记忆空间</h2>
          <p className="muted">使用项目成员账号登录</p>
          <Field label="用户名">
            <input
              autoComplete="username"
              value={login.username}
              onChange={(e) => setLogin({ ...login, username: e.target.value })}
            />
          </Field>
          <Field label="密码">
            <input
              type="password"
              autoComplete="current-password"
              required
              value={login.password}
              onChange={(e) => setLogin({ ...login, password: e.target.value })}
            />
          </Field>
          {error && <div className="error">{error}</div>}
          <button className="primary" disabled={busy}>
            登录工作台 <ArrowRight size={17} />
          </button>
          <div className="hint">
            首次启动：用户名为 admin。随机初始密码位于项目的{" "}
            <code>.runtime/admin-password.txt</code>，也可通过 ADMIN_PASSWORD
            设置。
          </div>
        </form>
      </div>
    );
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Layers3 size={24} />
          </div>
          <div>
            <strong>知序</strong>
            <span>TEAM MEMORY</span>
          </div>
          <span className="mvp">MVP</span>
        </div>
        <div className="workspace">
          <span>当前项目空间</span>
          <select
            aria-label="切换项目"
            value={project}
            onChange={(e) => {
              setProject(e.target.value);
              setFocusSession(null);
              setModal(null);
            }}
          >
            {me.projects.map((p: Row) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <small>
            <i /> {labels[current?.role]} · 独立权限范围
          </small>
        </div>
        <div className="nav-label">工作空间</div>
        <nav>
          {nav.map(([key, title, Icon], i) => (
            <React.Fragment key={key}>
              {i === 5 && <div className="nav-label separated">检索与管理</div>}
              <button
                className={page === key ? "selected" : ""}
                onClick={() => {
                  setPage(key);
                  setFocusSession(null);
                  setError("");
                }}
              >
                <Icon size={19} />
                {title}
                {key === "candidates" && <span className="nav-dot" />}
              </button>
            </React.Fragment>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-status">
            <span className="pulse" /> 本地记忆服务已连接
          </div>
          <div className="profile">
            <div className="avatar">{me.user.name.slice(0, 1)}</div>
            <div>
              <strong>{me.user.name}</strong>
              <span>{me.user.username}</span>
            </div>
            <button
              className="icon"
              title="退出登录"
              onClick={() =>
                run(async () => {
                  await api("/logout", "POST", {});
                  setMe(null);
                  setLogin({ ...login, password: "" });
                }, "已退出")
              }
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div>
            工作空间 <ChevronRight size={14} />{" "}
            <strong>{nav.find((x) => x[0] === page)?.[1]}</strong>
          </div>
          <div className="top-actions">
            <span>
              <LockKeyhole size={14} /> 项目权限已启用
            </span>
            <button
              className="icon"
              aria-label="刷新数据"
              onClick={() => setRevision((n) => n + 1)}
            >
              <RefreshCw size={17} />
            </button>
          </div>
        </header>
        <div className="page">
          <div className="page-heading">
            <div>
              <p className="eyebrow">
                {page === "overview"
                  ? "FROM SESSIONS TO SHARED KNOWLEDGE"
                  : "TEAM MEMORY WORKSPACE"}
              </p>
              <h1>{nav.find((x) => x[0] === page)?.[1]}</h1>
              <p>
                {
                  (
                    {
                      overview: "把分散的探索，沉淀为团队可以信赖的知识。",
                      sessions: "完整保留每一次探索，让结论始终有据可查。",
                      candidates:
                        "机器提出候选，由人决定哪些值得成为团队共识。",
                      knowledge:
                        "经过审核的工程知识，带着来源、版本与适用边界。",
                      governance: "发现分歧，明确替代，让知识始终保持有效。",
                      search: "用真实问题验证召回结果，查看排序依据与证据。",
                      logs: "追踪每次召回的知识版本，收集反馈，观察效果。",
                      members: "管理项目成员、角色与 Coding Agent 访问令牌。",
                    } as Row
                  )[page]
                }
              </p>
            </div>
            {canWrite && page !== "members" && (
              <button
                className="primary"
                onClick={() => setModal(<ImportDialog {...props} />)}
              >
                <Plus size={18} /> 导入 Session
              </button>
            )}
          </div>
          {error && (
            <div className="error global-error" role="alert">
              {error}
              <button onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {!project ? (
            <Empty text="当前账号尚未加入项目" />
          ) : page === "overview" ? (
            <Overview {...props} />
          ) : page === "sessions" ? (
            <Sessions
              {...props}
              focusSession={focusSession}
              clearFocus={() => setFocusSession(null)}
            />
          ) : page === "candidates" ? (
            <Candidates {...props} />
          ) : page === "knowledge" ? (
            <Knowledge {...props} />
          ) : page === "governance" ? (
            <Governance {...props} />
          ) : page === "search" ? (
            <SearchPage {...props} />
          ) : page === "logs" ? (
            <Logs {...props} />
          ) : (
            <Members
              {...props}
              userId={me.user.id}
              isAdmin={current?.role === "admin"}
              refreshMe={loadMe}
            />
          )}
        </div>
        <footer className="page-footer">
          <span>知序 · Team Memory</span>
          <span>证据归档 → 候选提取 → 人工审核 → 可信召回</span>
        </footer>
      </main>
      {modal}
      {toast && (
        <div className="toast" role="status">
          <CheckCheck size={18} />
          {toast}
        </div>
      )}
      {busy && <div className="busy-line" />}
    </div>
  );
}
type Props = {
  base: string;
  revision: number;
  run: (fn: () => Promise<any>, message?: string) => void;
  action: (fn: () => Promise<any>, message?: string) => Promise<any>;
  canReview: boolean;
  canWrite: boolean;
  busy: boolean;
  setModal: (node: React.ReactNode) => void;
  openSession: (id: string) => void;
  setPage: (page: string) => void;
};
function useData<T = any>(path: string, revision: number) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    setData(null);
    setError("");
    api(path)
      .then((r) => {
        if (alive) setData(r);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [path, revision]);
  return { data, error };
}
function Loading({ error }: { error?: string }) {
  return error ? (
    <div className="error">{error}</div>
  ) : (
    <div className="loading">正在读取项目数据…</div>
  );
}
function Overview(p: Props) {
  const { data: d, error } = useData(p.base + "/dashboard", p.revision);
  if (!d) return <Loading error={error} />;
  return (
    <>
      <div className="hero">
        <div>
          <span className="hero-tag">
            <Sparkles size={13} /> 团队记忆持续生长
          </span>
          <h2>经验不止于一次对话。</h2>
          <p>从原始证据出发，让每一条共识都经得起追问。</p>
          <div className="hero-pills">
            <span>
              <ShieldCheck size={14} /> 人工审核晋升
            </span>
            <span>
              <GitBranch size={14} /> 版本完整可溯
            </span>
            <span>
              <LockKeyhole size={14} /> 按权限召回
            </span>
          </div>
        </div>
        <div className="memory-orbit">
          <div className="orbit-one" />
          <div className="orbit-two" />
          <span className="orbit-node n1">
            <Terminal />
          </span>
          <span className="orbit-node n2">
            <BookOpen />
          </span>
          <span className="orbit-node n3">
            <GitBranch />
          </span>
          <div className="orbit-core">
            <Layers3 size={40} />
          </div>
        </div>
      </div>
      <div className="stat-grid">
        {[
          [
            d.sessions,
            "已归档 Session",
            "原始证据完整保留",
            Terminal,
            "sessions",
          ],
          [d.pending, "待审核候选", "等待团队确认", Sparkles, "candidates"],
          [d.active, "有效团队知识", "当前可参与召回", BookOpen, "knowledge"],
          [
            d.conflicts + d.expiring,
            "待治理事项",
            `${d.conflicts} 项冲突 · ${d.expiring} 项临期`,
            GitBranch,
            "governance",
          ],
        ].map(([n, title, desc, Icon, page]: any) => (
          <button
            className="stat-card"
            key={title}
            onClick={() => p.setPage(page)}
          >
            <div>
              <span>{title}</span>
              <Icon size={19} />
            </div>
            <strong>
              {n}
              <small>条</small>
            </strong>
            <p>
              {desc}
              <ArrowUpRight size={15} />
            </p>
          </button>
        ))}
      </div>
      <div className="section-bar">
        <h2>记忆的生命周期</h2>
        <span>从探索到共识，每一步都有迹可循</span>
      </div>
      <div className="pipeline">
        {[
          [Terminal, "01", "会话归档", "保留原始记录与哈希"],
          [Sparkles, "02", "候选提取", d.extractor],
          [ShieldCheck, "03", "审核晋升", "冲突检测 · 人工确认"],
          [Search, "04", "知识召回", "混合检索 · MCP 访问"],
        ].map(([Icon, n, title, desc]: any, i) => (
          <React.Fragment key={n}>
            <div>
              <span className="step-icon">
                <Icon size={22} />
              </span>
              <section>
                <small>STEP {n}</small>
                <h3>{title}</h3>
                <p>{desc}</p>
              </section>
            </div>
            {i < 3 && <ChevronRight className="step-arrow" size={18} />}
          </React.Fragment>
        ))}
      </div>
      <div className="two-col">
        <section className="panel">
          <div className="panel-head">
            <h2>最近的 Session</h2>
            <button className="link" onClick={() => p.setPage("sessions")}>
              查看全部 <ArrowRight size={14} />
            </button>
          </div>
          {d.recentSessions.map((s: Row) => (
            <button
              className="session-row"
              key={s.id}
              onClick={() => p.openSession(s.id)}
            >
              <div className={`source-icon ${s.source}`}>
                {s.source === "codex" ? (
                  <Code2 size={20} />
                ) : (
                  <Terminal size={20} />
                )}
              </div>
              <div>
                <strong>{s.title}</strong>
                <p>
                  {sourceLabel[s.source]} · {s.event_count} 个事件 ·{" "}
                  {date(s.created_at)}
                </p>
              </div>
              <ChevronRight size={17} />
            </button>
          ))}
          {!d.recentSessions.length && <Empty />}
        </section>
        <section className="panel">
          <div className="panel-head">
            <h2>召回健康度</h2>
            <span className="badge team">我的召回</span>
          </div>
          <div className="health">
            <div>
              <strong>{pct(d.hitRate)}</strong>
              <span>非空召回率</span>
            </div>
            <div>
              <strong>{pct(d.helpfulRate)}</strong>
              <span>有用反馈率</span>
            </div>
          </div>
          <div className="metric-lines">
            <div>
              <span>召回请求</span>
              <strong>{d.recallCount} 次</strong>
            </div>
            <div>
              <span>平均检索耗时</span>
              <strong>{d.latencyMs ?? "—"} ms</strong>
            </div>
            <div>
              <span>已反馈样本</span>
              <strong>{d.ratedCount} 次</strong>
            </div>
          </div>
          <p className="panel-note">{d.scope}。非空召回不等于答案正确率。</p>
          <button
            className="secondary full"
            onClick={() => p.setPage("search")}
          >
            打开召回调试台 <ArrowUpRight size={16} />
          </button>
        </section>
      </div>
      <section className="panel sources">
        <div>
          <h2>会话接入</h2>
          <p>文件导入已就绪 · 自动采集暂未接通</p>
        </div>
        {d.sources.map((s: Row) => (
          <div key={s.source}>
            <span className="source-dot" />
            <strong>{sourceLabel[s.source]}</strong>
            <small>{s.count} 个 Session</small>
          </div>
        ))}
      </section>
    </>
  );
}
function ImportDialog(p: Props) {
  const [form, setForm] = useState({
      title: "",
      source: "generic",
      visibility: "private",
      raw: "",
    }),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <Modal title="导入 Session" onClose={() => p.setModal(null)} wide>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            const r = await p.action(
              () => api(p.base + "/sessions", "POST", form),
              "会话已归档",
            );
            if (r.extraction_status === "failed") {
              setError(
                "会话已安全归档，但提取失败。可关闭窗口后在详情页重试。",
              );
              return;
            }
            p.setModal(null);
            p.openSession(r.id);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="notice">
          <ShieldCheck size={18} />
          <span>
            原文按字节不可变归档；时间线和候选会做规则脱敏。请先移除敏感内容。默认仅自己可见，导入后不可更改归档范围。
          </span>
        </div>
        <div className="form-grid">
          <Field label="会话标题">
            <input
              required
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="例如：支付服务 · 幂等方案讨论"
            />
          </Field>
          <Field label="数据来源">
            <select
              value={form.source}
              onChange={(e) => setForm({ ...form, source: e.target.value })}
            >
              {Object.entries(sourceLabel).map(([k, v]) => (
                <option key={k} value={k}>
                  {v as string}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="可见范围">
          <select
            value={form.visibility}
            onChange={(e) => setForm({ ...form, visibility: e.target.value })}
          >
            <option value="private">仅自己 · 候选和知识继承私有范围</option>
            <option value="team">团队共享 · 本项目所有成员可见</option>
          </select>
        </Field>
        <label className="file-drop">
          <Upload size={24} />
          <strong>选择 JSON / JSONL 文件</strong>
          <span>Claude Code、Codex 导出片段 / Cursor 消息导出 / 通用格式</span>
          <input
            aria-label="选择会话文件"
            type="file"
            accept=".json,.jsonl,.txt"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) {
                if (f.size > MAX_IMPORT_BYTES) {
                  setError("文件不能超过 32 MiB");
                  return;
                }
                setForm({
                  ...form,
                  raw: await f.text(),
                  title: form.title || f.name,
                });
              }
            }}
          />
        </label>
        <Field label="或粘贴会话内容">
          <textarea
            className="code"
            required
            rows={7}
            value={form.raw}
            onChange={(e) => setForm({ ...form, raw: e.target.value })}
            placeholder={
              '{"messages":[{"role":"assistant","content":"[决策:api.timeout] API 超时设为 30 秒。"}]}'
            }
          />
        </Field>
        <p className="hint">
          离线模式识别“决定 / 采用 / 必须”等句子，以及 [决策:稳定主题键]
          标记；无匹配时候选数为零。Cursor 私有数据库不在本版支持范围。
        </p>
        {error && <div className="error">{error}</div>}
        <div className="modal-actions">
          <button
            type="button"
            className="secondary"
            onClick={() => p.setModal(null)}
          >
            取消
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "正在归档与提取…" : "归档并自动提取"}
            <ArrowRight size={16} />
          </button>
        </div>
      </form>
    </Modal>
  );
}
function Sessions(
  p: Props & { focusSession: string | null; clearFocus: () => void },
) {
  const { data: rows, error } = useData<Row[]>(
      p.base + "/sessions",
      p.revision,
    ),
    [q, setQ] = useState(""),
    [source, setSource] = useState("all");
  if (p.focusSession) return <SessionDetail {...p} sid={p.focusSession} />;
  if (!rows) return <Loading error={error} />;
  const filtered = rows.filter(
    (s) =>
      (source === "all" || s.source === source) &&
      s.title.toLowerCase().includes(q.toLowerCase()),
  );
  return (
    <section className="panel">
      <div className="toolbar">
        <div className="input-icon">
          <Search size={17} />
          <input
            aria-label="搜索会话"
            placeholder="搜索会话标题…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <select
          aria-label="来源筛选"
          value={source}
          onChange={(e) => setSource(e.target.value)}
        >
          <option value="all">所有来源</option>
          {Object.entries(sourceLabel).map(([k, v]) => (
            <option key={k} value={k}>
              {v as string}
            </option>
          ))}
        </select>
        <span className="count">{filtered.length} 个会话</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>会话 / 原始证据</th>
              <th>来源</th>
              <th>可见范围</th>
              <th>事件 / 候选</th>
              <th>归档时间</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => (
              <tr key={s.id} onClick={() => p.openSession(s.id)}>
                <td>
                  <button className="title-link">{s.title}</button>
                  <small>SHA-256 {s.raw_hash.slice(0, 14)}…</small>
                </td>
                <td>
                  <Badge value={s.source} />
                </td>
                <td>
                  <Badge value={s.visibility} />
                </td>
                <td>
                  {s.event_count} / {s.candidate_count}
                  <small>{labels[s.extraction_status] || "尚未提取"}</small>
                </td>
                <td>{date(s.created_at)}</td>
                <td>
                  <ChevronRight size={17} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!filtered.length && <Empty text="没有匹配的会话" />}
    </section>
  );
}
function SessionDetail(p: Props & { sid: string; clearFocus: () => void }) {
  const [showTools, setShowTools] = useState(false);
  const { data: s, error } = useData(p.base + "/sessions/" + p.sid, p.revision);
  if (!s) return <Loading error={error} />;
  return (
    <>
      <button className="link back" onClick={p.clearFocus}>
        ← 返回会话列表
      </button>
      <section className="panel detail-header">
        <div>
          <Badge value={s.source} /> <Badge value={s.visibility} />
          <h2>{s.title}</h2>
          <p>
            归档于 {date(s.created_at)} · {s.events.length} 个结构化事件
          </p>
          <code>SHA-256 · {s.raw_hash}</code>
        </div>
        <div className="vertical-actions">
          <a
            className="secondary"
            href={"/api" + p.base + "/sessions/" + s.id + "/raw"}
          >
            <Download size={15} /> 下载原始证据
          </a>
          {p.canWrite && (
            <button
              className="secondary"
              disabled={p.busy}
              onClick={() =>
                p.run(async () => {
                  const r = await api(
                    p.base + "/sessions/" + s.id + "/extract",
                    "POST",
                    {},
                  );
                  if (r.extraction_status === "failed")
                    throw new Error("会话已保留，提取失败，请检查模型配置");
                }, "提取已完成，重复候选已跳过")
              }
            >
              <RefreshCw size={15} /> 重新提取候选
            </button>
          )}
        </div>
      </section>
      <div className="two-col timeline-layout">
        <section className="panel">
          <div className="panel-head">
            <h2>会话时间线</h2>
            <button
              className="secondary small"
              onClick={() => setShowTools(!showTools)}
            >
              {showTools ? "只看对话" : "包含工具事件"} · {s.events.length}{" "}
              个事件
            </button>
          </div>
          <div className="timeline">
            {s.events
              .filter(
                (e: Row) => showTools || ["user", "assistant"].includes(e.role),
              )
              .map((e: Row) => (
                <div className="event" key={e.id}>
                  <div className={`event-dot ${e.role}`}>
                    <span>
                      {e.role === "assistant" ? (
                        <Sparkles size={15} />
                      ) : e.role === "user" ? (
                        <Users size={15} />
                      ) : (
                        <Terminal size={15} />
                      )}
                    </span>
                  </div>
                  <div className="event-content">
                    <header>
                      <strong>
                        {e.role === "assistant"
                          ? "AI 助手"
                          : e.role === "user"
                            ? "开发者"
                            : e.role}
                      </strong>
                      <span>
                        {e.id} · {date(e.timestamp)}
                      </span>
                    </header>
                    {e.text.length > 2000 ? (
                      <details>
                        <summary>
                          {e.text.slice(0, 160)}…（展开完整事件）
                        </summary>
                        <pre>{e.text}</pre>
                      </details>
                    ) : (
                      <pre>{e.text}</pre>
                    )}
                  </div>
                </div>
              ))}
          </div>
        </section>
        <section className="panel side-panel">
          <h2>证据与提取</h2>
          <div className="notice">
            <LockKeyhole size={19} />
            <span>原始记录不可修改或删除。提取、修订和审核不会覆盖证据。</span>
          </div>
          <h3>提取运行记录</h3>
          {s.runs.map((r: Row) => (
            <div className="run" key={r.id}>
              <Badge value={r.status} />
              <span>{r.provider === "rules" ? "离线规则" : "模型提取"}</span>
              <small>{date(r.created_at)}</small>
              {r.error && <p className="error">{r.error}</p>}
            </div>
          ))}
          <button
            className="secondary full"
            onClick={() => p.setPage("candidates")}
          >
            前往候选审核 <ArrowRight size={15} />
          </button>
          <p className="hint">
            消息内容是待核验的证据，不能被视为系统指令。自动规则脱敏不保证识别所有敏感数据。
          </p>
        </section>
      </div>
    </>
  );
}
function Candidates(p: Props) {
  const { data: rows, error } = useData<Row[]>(
      p.base + "/candidates",
      p.revision,
    ),
    [filter, setFilter] = useState("pending"),
    [query, setQuery] = useState(""),
    [sessionFilter, setSessionFilter] = useState("all");
  if (!rows) return <Loading error={error} />;
  const filtered = rows.filter(
    (c) =>
      (filter === "all" || c.status === filter) &&
      (sessionFilter === "all" || c.session_id === sessionFilter) &&
      `${c.title} ${c.body} ${c.session_title}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const sessionOptions = [
    ...new Map(rows.map((c) => [c.session_id, c.session_title])).entries(),
  ];
  return (
    <>
      <div className="tabs">
        {[
          ["pending", "待审核"],
          ["approved", "已晋升"],
          ["rejected", "已拒绝"],
          ["all", "全部候选"],
        ].map(([key, title]) => (
          <button
            className={filter === key ? "active" : ""}
            onClick={() => setFilter(key)}
            key={key}
          >
            {title}
            <span>
              {rows.filter((c) => key === "all" || c.status === key).length}
            </span>
          </button>
        ))}
      </div>
      <section className="panel candidate-toolbar">
        <div className="toolbar">
          <div className="input-icon">
            <Search size={17} />
            <input
              aria-label="搜索候选"
              placeholder="搜索候选内容或来源会话，例如缓存 TTL…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <select
            aria-label="候选来源会话"
            value={sessionFilter}
            onChange={(e) => setSessionFilter(e.target.value)}
          >
            <option value="all">全部来源会话</option>
            {sessionOptions.map(([id, title]) => (
              <option key={id} value={id}>
                {title}
              </option>
            ))}
          </select>
          <span className="count">{filtered.length} 条候选</span>
        </div>
      </section>
      <div className="candidate-grid">
        {filtered.map((c) => (
          <section className="panel candidate-card" key={c.id}>
            <div className="card-tags">
              <Badge value={c.kind} />
              <Badge value={c.visibility} />
              {c.conflict_count > 0 && (
                <span className="badge conflict">
                  <TriangleAlert size={12} /> 存在冲突
                </span>
              )}
            </div>
            <h2>{c.title}</h2>
            <code className="topic">{c.topic_key}</code>
            <p className="body-text">{c.body}</p>
            <div className="evidence">
              <span>
                <FileText size={14} /> 来源证据 · {c.evidence[0]?.eventId}
              </span>
              <blockquote>{c.evidence[0]?.quote}</blockquote>
              <button
                className="link"
                onClick={() => p.openSession(c.session_id)}
              >
                {c.session_title}
                <ArrowUpRight size={13} />
              </button>
            </div>
            <div className="candidate-footer">
              <span className="muted">
                提取置信度 {Math.round(c.confidence * 100)}%
                <small>仅供参考，非事实准确率</small>
              </span>
              {c.status === "pending" && p.canReview ? (
                <button
                  className="primary small"
                  onClick={() =>
                    p.setModal(<ReviewDialog {...p} candidate={c} />)
                  }
                >
                  审核候选 <ArrowRight size={14} />
                </button>
              ) : (
                <Badge value={c.status} />
              )}
            </div>
          </section>
        ))}
      </div>
      {!filtered.length && (
        <section className="panel">
          <Empty text="当前队列已清空" />
        </section>
      )}
    </>
  );
}
function ReviewDialog(p: Props & { candidate: Row; replaceId?: string }) {
  const [c, setC] = useState(p.candidate),
    [note, setNote] = useState(""),
    [expires, setExpires] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(action: "approve" | "reject") {
    setError("");
    if (!note.trim()) {
      setError("请填写审核说明");
      return;
    }
    setBusy(true);
    try {
      await p.action(
        async () => {
          if (action === "approve")
            await api(p.base + "/candidates/" + c.id, "PATCH", c);
          return api(p.base + "/candidates/" + c.id + "/review", "POST", {
            action,
            note,
            ...(p.replaceId ? { replaceId: p.replaceId } : {}),
            ...(expires ? { expiresAt: new Date(expires).toISOString() } : {}),
          });
        },
        action === "approve" ? "候选已晋升为知识" : "候选已拒绝",
      );
      p.setModal(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={p.replaceId ? "审核并替代旧知识" : "审核记忆候选"}
      onClose={() => p.setModal(null)}
      wide
    >
      <div className="notice">
        <ShieldCheck size={18} />
        <span>
          请核对原始证据。拒绝的方案应保留在“被否决选项”，避免被误判为团队决策。
        </span>
      </div>
      <div className="form-grid">
        <Field label="稳定主题键">
          <input
            value={c.topic_key}
            onChange={(e) => setC({ ...c, topic_key: e.target.value })}
          />
        </Field>
        <Field label="类型">
          <select
            value={c.kind}
            onChange={(e) => setC({ ...c, kind: e.target.value })}
          >
            {["decision", "fact", "lesson", "procedure"].map((k) => (
              <option key={k} value={k}>
                {labels[k]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="标题">
        <input
          value={c.title}
          onChange={(e) => setC({ ...c, title: e.target.value })}
        />
      </Field>
      <Field label="知识正文">
        <textarea
          rows={4}
          value={c.body}
          onChange={(e) => setC({ ...c, body: e.target.value })}
        />
      </Field>
      <Field label="决策理由">
        <textarea
          rows={2}
          value={c.rationale}
          onChange={(e) => setC({ ...c, rationale: e.target.value })}
        />
      </Field>
      <div className="form-grid">
        <Field label="被否决选项">
          <textarea
            rows={2}
            value={c.rejected_alternatives}
            onChange={(e) =>
              setC({ ...c, rejected_alternatives: e.target.value })
            }
          />
        </Field>
        <Field label="重新评估条件">
          <textarea
            rows={2}
            value={c.revisit_condition}
            onChange={(e) => setC({ ...c, revisit_condition: e.target.value })}
          />
        </Field>
      </div>
      <div className="evidence">
        {c.evidence.map((e: Row, i: number) => (
          <blockquote key={i}>
            {e.eventId} · {e.quote}
          </blockquote>
        ))}
      </div>
      <div className="form-grid">
        <Field label="审核说明（必填）">
          <input
            required
            placeholder="已核对来源，适用于…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
        <Field label="失效时间（可选）">
          <input
            type="datetime-local"
            value={expires}
            onChange={(e) => setExpires(e.target.value)}
          />
        </Field>
      </div>
      {!p.replaceId && c.conflict_count > 0 && (
        <div className="warning">
          该主题已存在知识。请在“冲突与过期”页面对比后明确替代，或拒绝重复候选。
        </div>
      )}
      {error && <div className="error">{error}</div>}
      <div className="modal-actions">
        <button
          className="danger secondary"
          disabled={busy}
          onClick={() => submit("reject")}
        >
          拒绝候选
        </button>
        <button
          className="primary"
          disabled={busy}
          onClick={() => submit("approve")}
        >
          <Check size={17} />
          {p.replaceId ? "确认替代并晋升" : "确认晋升"}
        </button>
      </div>
    </Modal>
  );
}
function Knowledge(p: Props) {
  const { data: rows, error } = useData<Row[]>(
      p.base + "/knowledge",
      p.revision,
    ),
    [q, setQ] = useState(""),
    [filter, setFilter] = useState("active");
  if (!rows) return <Loading error={error} />;
  const filtered = rows.filter(
    (k) =>
      (filter === "all" || k.status === filter) &&
      `${k.title} ${k.topic_key} ${k.body}`
        .toLowerCase()
        .includes(q.toLowerCase()),
  );
  return (
    <section className="panel">
      <div className="toolbar">
        <div className="input-icon">
          <Search size={17} />
          <input
            aria-label="搜索知识"
            placeholder="搜索标题、主题或正文…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <select
          aria-label="知识状态"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="active">当前有效 / 待复核</option>
          <option value="superseded">已替代</option>
          <option value="expired">已过期</option>
          <option value="all">全部版本状态</option>
        </select>
        <span className="count">{filtered.length} 条知识</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>知识 / 主题</th>
              <th>类型</th>
              <th>状态</th>
              <th>版本</th>
              <th>有效期</th>
              <th>更新于</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((k) => (
              <tr
                key={k.id}
                onClick={() => p.setModal(<KnowledgeDialog {...p} item={k} />)}
              >
                <td>
                  <button className="title-link">{k.title}</button>
                  <small>
                    {k.topic_key} · {labels[k.visibility]}
                  </small>
                </td>
                <td>
                  <Badge value={k.kind} />
                </td>
                <td>
                  <Badge value={k.is_due ? "expired" : k.status} />
                </td>
                <td>
                  <span className="version">v{k.version}</span>
                </td>
                <td>{date(k.expires_at)}</td>
                <td>{date(k.updated_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!filtered.length && <Empty />}
    </section>
  );
}
function KnowledgeDialog(p: Props & { item: Row }) {
  const [k, setK] = useState(p.item),
    [editing, setEditing] = useState(false),
    [reason, setReason] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const { data: versions } = useData<Row[]>(
    p.base + "/knowledge/" + k.id + "/versions",
    k.version,
  );
  return (
    <Modal title="知识详情与版本" onClose={() => p.setModal(null)} wide>
      <div className="card-tags">
        <Badge value={k.kind} />
        <Badge value={k.status} />
        <Badge value={k.visibility} />
        <span className="version">v{k.version}</span>
      </div>
      <code className="topic">{k.topic_key}</code>
      {editing ? (
        <>
          <Field label="标题">
            <input
              value={k.title}
              onChange={(e) => setK({ ...k, title: e.target.value })}
            />
          </Field>
          <Field label="正文">
            <textarea
              rows={5}
              value={k.body}
              onChange={(e) => setK({ ...k, body: e.target.value })}
            />
          </Field>
          <Field label="决策理由">
            <textarea
              value={k.rationale}
              onChange={(e) => setK({ ...k, rationale: e.target.value })}
            />
          </Field>
          <Field label="被否决选项">
            <textarea
              value={k.rejected_alternatives}
              onChange={(e) =>
                setK({ ...k, rejected_alternatives: e.target.value })
              }
            />
          </Field>
          <Field label="重新评估条件">
            <textarea
              value={k.revisit_condition}
              onChange={(e) =>
                setK({ ...k, revisit_condition: e.target.value })
              }
            />
          </Field>
          <Field label="失效时间（清空则长期有效）">
            <input
              type="datetime-local"
              value={
                k.expires_at
                  ? new Date(
                      new Date(k.expires_at).getTime() -
                        new Date().getTimezoneOffset() * 60000,
                    )
                      .toISOString()
                      .slice(0, 16)
                  : ""
              }
              onChange={(e) =>
                setK({
                  ...k,
                  expires_at: e.target.value
                    ? new Date(e.target.value).toISOString()
                    : null,
                })
              }
            />
          </Field>
          <Field label="变更原因">
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="说明为什么需要更新此知识"
            />
          </Field>
        </>
      ) : (
        <>
          <h2 className="knowledge-title">{k.title}</h2>
          <p className="knowledge-body">{k.body}</p>
          <dl className="facts">
            <dt>决策理由</dt>
            <dd>{k.rationale || "—"}</dd>
            <dt>被否决选项</dt>
            <dd>{k.rejected_alternatives || "无"}</dd>
            <dt>重新评估条件</dt>
            <dd>{k.revisit_condition || "—"}</dd>
            <dt>失效时间</dt>
            <dd>{date(k.expires_at)}</dd>
          </dl>
          <div className="evidence">
            <span>原始证据</span>
            {k.evidence.map((e: Row, i: number) => (
              <blockquote key={i}>
                {e.eventId} · {e.quote}
              </blockquote>
            ))}
            <button
              className="link"
              onClick={() => {
                p.setModal(null);
                p.openSession(k.source_session_id);
              }}
            >
              打开来源 Session <ArrowUpRight size={14} />
            </button>
          </div>
          <h3 className="subheading">版本历史 · 不可变快照</h3>
          <div className="versions">
            {versions?.map((v) => (
              <details key={v.id}>
                <summary>
                  <span className="version">v{v.version}</span>
                  <strong>{v.reason}</strong>
                  <span>
                    {v.actor_name} · {date(v.created_at)}
                  </span>
                </summary>
                <p>{v.snapshot.body}</p>
                <small>
                  状态：{labels[v.snapshot.status]} · 标题：{v.snapshot.title}
                </small>
                <p>
                  理由：{v.snapshot.rationale || "—"}
                  <br />
                  否决：{v.snapshot.rejected_alternatives || "—"}
                  <br />
                  复核：{v.snapshot.revisit_condition || "—"}
                  <br />
                  有效期：{date(v.snapshot.expires_at)}
                </p>
              </details>
            ))}
          </div>
        </>
      )}
      {error && <div className="error">{error}</div>}
      <div className="modal-actions">
        <button className="secondary" onClick={() => p.setModal(null)}>
          关闭
        </button>
        {p.canReview &&
          k.status === "active" &&
          (editing ? (
            <button
              className="primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  const r = await p.action(
                    () =>
                      api(p.base + "/knowledge/" + k.id, "PATCH", {
                        ...k,
                        expiresAt: k.expires_at,
                        reason,
                      }),
                    "新版本已保存",
                  );
                  setK(r);
                  setEditing(false);
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              保存为 v{k.version + 1}
            </button>
          ) : (
            <button className="primary" onClick={() => setEditing(true)}>
              编辑并生成新版本
            </button>
          ))}
      </div>
    </Modal>
  );
}
function Governance(p: Props) {
  const { data: conflicts, error } = useData<Row[]>(
      p.base + "/conflicts",
      p.revision,
    ),
    { data: knowledge } = useData<Row[]>(p.base + "/knowledge", p.revision),
    { data: candidates } = useData<Row[]>(p.base + "/candidates", p.revision);
  if (!conflicts || !knowledge || !candidates) return <Loading error={error} />;
  const due = knowledge.filter(
    (k) =>
      k.status === "active" &&
      k.expires_at &&
      new Date(k.expires_at).getTime() < Date.now() + 7 * 86400000,
  );
  return (
    <>
      <div className="section-bar">
        <h2>
          <GitBranch size={20} /> 待处理冲突{" "}
          <span className="number-badge">{conflicts.length}</span>
        </h2>
        <span>同项目、同可见范围、同主题键检测</span>
      </div>
      {conflicts.map((c) => (
        <section className="panel conflict-card" key={c.id}>
          <div className="panel-head">
            <div>
              <Badge value="decision" /> <code>{c.topic_key}</code>
            </div>
            <span className="badge conflict">{c.reason}</span>
          </div>
          <div className="compare">
            <div>
              <span className="eyebrow">当前知识 · V{c.knowledge_version}</span>
              <h3>{c.knowledge_title}</h3>
              <p>{c.knowledge_body}</p>
            </div>
            <ArrowRight size={22} />
            <div>
              <span className="eyebrow">新候选 · 等待确认</span>
              <h3>{c.candidate_title}</h3>
              <p>{c.candidate_body}</p>
            </div>
          </div>
          <div className="conflict-actions">
            <span>
              <ShieldCheck size={15} /> 替代后旧知识保留，但不再参与召回
            </span>
            {p.canReview && (
              <button
                className="primary small"
                onClick={() =>
                  p.setModal(
                    <ReviewDialog
                      {...p}
                      candidate={candidates.find(
                        (x) => x.id === c.candidate_id,
                      )!}
                      replaceId={c.knowledge_id}
                    />,
                  )
                }
              >
                对比审核 / 明确替代 <ArrowRight size={15} />
              </button>
            )}
          </div>
        </section>
      ))}
      {!conflicts.length && (
        <section className="panel">
          <Empty text="没有未解决的冲突" />
        </section>
      )}
      <div className="section-bar">
        <h2>
          <Clock3 size={20} /> 过期与临期队列{" "}
          <span className="number-badge">{due.length}</span>
        </h2>
        <span>已到期知识自动排除召回 · 提前 7 天提醒</span>
      </div>
      <section className="panel">
        {due.map((k) => (
          <div className="expiry-row" key={k.id}>
            <div className="expiry-icon">
              <Clock3 size={21} />
            </div>
            <div>
              <strong>{k.title}</strong>
              <p>
                {k.topic_key} · {date(k.expires_at)} 到期 ·{" "}
                {k.is_due ? "已排除召回" : "即将到期"}
              </p>
            </div>
            <button
              className="secondary small"
              onClick={() => p.setModal(<KnowledgeDialog {...p} item={k} />)}
            >
              查看 / 续期
            </button>
            {p.canReview && (
              <button
                className="secondary small danger"
                disabled={p.busy}
                onClick={() =>
                  p.setModal(
                    <Confirm
                      title="停用这条知识？"
                      text="该知识将退出召回，历史版本和证据仍然保留。"
                      onClose={() => p.setModal(null)}
                      onConfirm={async () => {
                        await p.action(
                          () =>
                            api(
                              p.base + "/knowledge/" + k.id + "/expire",
                              "POST",
                              { version: k.version },
                            ),
                          "知识已停用",
                        );
                        p.setModal(null);
                      }}
                    />,
                  )
                }
              >
                停用
              </button>
            )}
          </div>
        ))}
        {!due.length && <Empty text="没有临期知识" />}
      </section>
      <p className="hint">
        MVP
        使用稳定主题键检测冲突；不同主题键下的语义矛盾尚不会自动发现。可在候选审核时修正主题键，再重新检测。
      </p>
    </>
  );
}
function Confirm({
  title,
  text,
  onConfirm,
  onClose,
}: {
  title: string;
  text: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <Modal title={title} onClose={onClose}>
      <p>{text}</p>
      {error && <div className="error">{error}</div>}
      <div className="modal-actions">
        <button className="secondary" onClick={onClose}>
          取消
        </button>
        <button
          className="primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          确认
        </button>
      </div>
    </Modal>
  );
}
function SearchPage(p: Props) {
  const [q, setQ] = useState(""),
    [result, setResult] = useState<Row | null>(null),
    [limit, setLimit] = useState(8),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [vote, setVote] = useState(0);
  useEffect(() => {
    setResult(null);
  }, [p.base]);
  async function search(query = q) {
    if (!query.trim()) return;
    setBusy(true);
    setError("");
    setVote(0);
    try {
      setResult(await api(p.base + "/search", "POST", { query, limit }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <section className="panel search-console">
        <div className="search-label">
          <Search size={21} />
          <h2>团队知识召回</h2>
          <span className="badge team">仅已审核 · 当前有效 · 权限范围内</span>
        </div>
        <form
          className="search-form"
          onSubmit={(e) => {
            e.preventDefault();
            void search();
          }}
        >
          <input
            aria-label="召回问题"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="例如：支付回调如何避免重复处理？"
            required
            maxLength={500}
          />
          <select
            aria-label="召回条数"
            value={limit}
            onChange={(e) => setLimit(+e.target.value)}
          >
            <option value={5}>Top 5</option>
            <option value={8}>Top 8</option>
            <option value={15}>Top 15</option>
          </select>
          <button className="primary" disabled={busy}>
            <Search size={17} />
            {busy ? "检索中…" : "开始召回"}
          </button>
        </form>
        <div className="suggestions">
          <span>试试这些问题</span>
          {["支付回调 幂等", "权限过滤", "缓存 TTL", "React 状态管理"].map(
            (t) => (
              <button
                key={t}
                onClick={() => {
                  setQ(t);
                  void search(t);
                }}
              >
                {t}
                <ArrowUpRight size={12} />
              </button>
            ),
          )}
        </div>
        <div className="search-method">
          <span>FTS 中文双字 / 英文词项</span>
          <Plus size={13} />
          <span>pgvector 本地词法向量</span>
          <ArrowRight size={14} />
          <span>RRF 排序融合</span>
          <small>离线模式不使用语义模型</small>
        </div>
      </section>
      {error && <div className="error">{error}</div>}
      {result ? (
        <>
          <div className="section-bar">
            <h2>
              召回结果{" "}
              <span className="number-badge">{result.results.length}</span>
            </h2>
            <span>检索耗时 {result.durationMs} ms · 每条结果包含来源版本</span>
          </div>
          <div className="search-layout">
            <div>
              {result.results.map((r: Row, i: number) => (
                <section className="panel result" key={r.id}>
                  <header>
                    <span className="result-number">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <div>
                      <h2>{r.title}</h2>
                      <code>{r.topic_key}</code>
                    </div>
                    <span className="version">v{r.version}</span>
                  </header>
                  <p>{r.body}</p>
                  <div className="result-scores">
                    <span>
                      RRF <strong>{Number(r.score).toFixed(4)}</strong>
                    </span>
                    <span>
                      关键词排名 <strong>{r.lexical_rank || "—"}</strong>
                    </span>
                    <span>
                      向量排名 <strong>{r.vector_rank || "—"}</strong>
                    </span>
                    <span>
                      相似度 <strong>{Number(r.similarity).toFixed(3)}</strong>
                    </span>
                  </div>
                  <div className="result-bottom">
                    <Badge value={r.kind} />
                    <button
                      className="link"
                      onClick={() => p.openSession(r.source_session_id)}
                    >
                      查看原始证据 <ArrowUpRight size={14} />
                    </button>
                  </div>
                </section>
              ))}
              {!result.results.length && (
                <section className="panel">
                  <Empty text="没有找到有效且可见的相关知识" />
                </section>
              )}
            </div>
            <aside className="panel context-panel">
              <h2>Agent 上下文预览</h2>
              <p>可用于 MCP 调用的知识内容，附带稳定 ID、版本和来源。</p>
              <pre>{result.context || "（无可用上下文）"}</pre>
              <button
                className="secondary full"
                onClick={() =>
                  p.run(
                    () => navigator.clipboard.writeText(result.context),
                    "已复制上下文",
                  )
                }
              >
                复制召回上下文
              </button>
              <div className="feedback">
                <strong>这次召回有帮助吗？</strong>
                <div>
                  <button
                    className={vote === 1 ? "selected secondary" : "secondary"}
                    onClick={() =>
                      p.run(async () => {
                        await api(
                          p.base + "/logs/" + result.logId + "/feedback",
                          "POST",
                          { value: 1 },
                        );
                        setVote(1);
                      }, "反馈已记录")
                    }
                  >
                    <ThumbsUp size={16} /> 有用
                  </button>
                  <button
                    className={vote === -1 ? "selected secondary" : "secondary"}
                    onClick={() =>
                      p.run(async () => {
                        await api(
                          p.base + "/logs/" + result.logId + "/feedback",
                          "POST",
                          { value: -1 },
                        );
                        setVote(-1);
                      }, "反馈已记录")
                    }
                  >
                    <ThumbsDown size={16} /> 无用
                  </button>
                </div>
              </div>
            </aside>
          </div>
        </>
      ) : (
        <div className="search-empty">
          <div>
            <Search size={35} />
          </div>
          <h2>让团队经验回答下一个问题</h2>
          <p>
            输入工程问题，检查召回结果及其证据。
            <br />
            未审核、已过期、被替代的知识不会进入结果。
          </p>
        </div>
      )}
    </>
  );
}
function Logs(p: Props) {
  const { data: logs, error } = useData<Row[]>(p.base + "/logs", p.revision);
  if (!logs) return <Loading error={error} />;
  const rated = logs.filter((l) => l.feedback),
    hits = logs.filter((l) => l.results.length);
  return (
    <>
      <div className="notice">
        <LockKeyhole size={18} />
        <span>
          只展示当前成员在本项目最近 200
          次召回。管理员也无法查看其他成员的私有查询。指标用于演示观察，不代表离线准确率评测。
        </span>
      </div>
      <div className="stat-grid compact">
        {[
          [logs.length, "召回请求"],
          [logs.length ? pct(hits.length / logs.length) : "—", "非空召回率"],
          [
            rated.length
              ? pct(rated.filter((l) => l.feedback === 1).length / rated.length)
              : "—",
            "有用反馈率",
          ],
          [rated.length, "反馈样本数"],
        ].map(([n, label]) => (
          <div className="stat-card" key={label}>
            <span>{label}</span>
            <strong>{n}</strong>
          </div>
        ))}
      </div>
      <section className="panel">
        <div className="panel-head">
          <h2>召回记录</h2>
          <span>同一条记录的反馈可更新</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>问题</th>
                <th>入口</th>
                <th>命中版本</th>
                <th>耗时</th>
                <th>时间</th>
                <th>反馈</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id}>
                  <td>
                    <strong>{l.query}</strong>
                    <small>{l.id.slice(0, 12)}</small>
                  </td>
                  <td>
                    <Badge value={l.channel} />
                  </td>
                  <td>
                    <details>
                      <summary>{l.results.length} 条知识</summary>
                      {l.results.map((r: Row) => (
                        <small className="code" key={r.id}>
                          {r.id.slice(0, 8)} @v{r.version} ·{" "}
                          {Number(r.score).toFixed(4)}
                        </small>
                      ))}
                    </details>
                  </td>
                  <td>{l.duration_ms} ms</td>
                  <td>{date(l.created_at)}</td>
                  <td>
                    <div className="votes">
                      <button
                        aria-label="标记有用"
                        className={l.feedback === 1 ? "selected icon" : "icon"}
                        onClick={() =>
                          p.run(
                            () =>
                              api(
                                p.base + "/logs/" + l.id + "/feedback",
                                "POST",
                                { value: 1 },
                              ),
                            "反馈已记录",
                          )
                        }
                      >
                        <ThumbsUp size={16} />
                      </button>
                      <button
                        aria-label="标记无用"
                        className={l.feedback === -1 ? "selected icon" : "icon"}
                        onClick={() =>
                          p.run(
                            () =>
                              api(
                                p.base + "/logs/" + l.id + "/feedback",
                                "POST",
                                { value: -1 },
                              ),
                            "反馈已记录",
                          )
                        }
                      >
                        <ThumbsDown size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!logs.length && <Empty />}
      </section>
    </>
  );
}
function Members(
  p: Props & {
    userId: string;
    isAdmin: boolean;
    refreshMe: () => Promise<any>;
  },
) {
  const { data: members, error } = useData<Row[]>(
      p.base + "/members",
      p.revision,
    ),
    { data: tokens } = useData<Row[]>("/tokens", p.revision),
    [tokenName, setTokenName] = useState("Coding Agent"),
    [createdToken, setCreatedToken] = useState("");
  if (!members || !tokens) return <Loading error={error} />;
  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h2>
            项目成员 <span className="number-badge">{members.length}</span>
          </h2>
          {p.isAdmin && (
            <button
              className="primary small"
              onClick={() => p.setModal(<AddMember {...p} />)}
            >
              <Plus size={16} /> 添加成员
            </button>
          )}
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>成员</th>
                <th>用户名</th>
                <th>项目角色</th>
                <th>管理</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id}>
                  <td>
                    <div className="member-name">
                      <span className="avatar">{m.name.slice(0, 1)}</span>
                      <strong>
                        {m.name}
                        {m.id === p.userId && <small>当前账号</small>}
                      </strong>
                    </div>
                  </td>
                  <td>{m.username}</td>
                  <td>
                    {p.isAdmin ? (
                      <select
                        aria-label={`修改 ${m.username} 角色`}
                        value={m.role}
                        onChange={(e) =>
                          p.run(async () => {
                            await api(p.base + "/members/" + m.id, "PATCH", {
                              role: e.target.value,
                            });
                            await p.refreshMe();
                          }, "权限已更新")
                        }
                        disabled={p.busy}
                      >
                        {["admin", "reviewer", "member", "reader"].map((r) => (
                          <option value={r} key={r}>
                            {labels[r]}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <Badge value={m.role} />
                    )}
                  </td>
                  <td>
                    {p.isAdmin && (
                      <button
                        className="link danger"
                        onClick={() =>
                          p.setModal(
                            <Confirm
                              title="移除此项目成员？"
                              text="该成员将立即失去此项目的访问权限，包括现有 API 令牌。归档记录仍保留。"
                              onClose={() => p.setModal(null)}
                              onConfirm={async () => {
                                await p.action(
                                  () =>
                                    api(p.base + "/members/" + m.id, "PATCH", {
                                      role: null,
                                    }),
                                  "成员已移除",
                                );
                                await p.refreshMe();
                                p.setModal(null);
                              }}
                            />,
                          )
                        }
                      >
                        移除
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="role-guide">
          <span>
            <strong>管理员</strong> 成员管理、审核与治理
          </span>
          <span>
            <strong>审核员</strong> 审核、编辑、停用知识
          </span>
          <span>
            <strong>贡献者</strong> 导入与提取会话
          </span>
          <span>
            <strong>只读成员</strong> 浏览与召回
          </span>
        </div>
      </section>
      <div className="two-col">
        <section className="panel token-panel">
          <h2>个人 API / MCP 令牌</h2>
          <p className="muted">
            令牌继承当前账号的实时项目权限，有效期 30 天。原文只显示一次。
          </p>
          <form
            className="token-form"
            onSubmit={(e) => {
              e.preventDefault();
              p.run(async () => {
                const t = await api("/tokens", "POST", { name: tokenName });
                setCreatedToken(t.token);
              }, "令牌已创建，请妥善保存");
            }}
          >
            <input
              aria-label="令牌名称"
              value={tokenName}
              onChange={(e) => setTokenName(e.target.value)}
              required
            />
            <button className="primary" disabled={p.busy}>
              创建令牌
            </button>
          </form>
          {createdToken && (
            <div className="token-created">
              <code>{createdToken}</code>
              <button
                className="link"
                onClick={() =>
                  p.run(
                    () => navigator.clipboard.writeText(createdToken),
                    "令牌已复制",
                  )
                }
              >
                复制
              </button>
              <button className="link" onClick={() => setCreatedToken("")}>
                隐藏
              </button>
            </div>
          )}
          {tokens.map((t) => (
            <div className="token-row" key={t.id}>
              <div>
                <strong>{t.name}</strong>
                <small>{date(t.expires_at)} 到期</small>
              </div>
              <button
                className="link danger"
                onClick={() =>
                  p.run(
                    () => api("/tokens/" + t.id, "DELETE", {}),
                    "令牌已撤销",
                  )
                }
              >
                撤销
              </button>
            </div>
          ))}
        </section>
        <section className="panel mcp-panel">
          <div className="panel-head">
            <h2>
              <Terminal size={20} /> MCP 接入
            </h2>
            <span className="badge team">stdio · 已实现</span>
          </div>
          <p>先启动本地服务，再由 Coding Agent 启动 MCP 进程。</p>
          <pre>{`{
  "mcpServers": {
    "team-memory": {
      "command": "node",
      "args": [
        "--import", "/绝对路径/team-memory/node_modules/tsx/dist/loader.mjs",
        "/绝对路径/team-memory/src/server/mcp.ts"
      ],
      "env": {
        "MEMORY_API_URL": "http://127.0.0.1:4317",
        "MEMORY_API_TOKEN": "<个人令牌>"
      }
    }
  }
}`}</pre>
          <p className="hint">
            工具：list_projects、recall、search_sessions、get_session、recall_feedback。README
            提供不依赖工作目录的配置方式。
          </p>
        </section>
      </div>
    </>
  );
}
function AddMember(p: Props) {
  const [form, setForm] = useState({
      username: "",
      name: "",
      password: "",
      role: "member",
    }),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <Modal title="添加项目成员" onClose={() => p.setModal(null)}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await p.action(
              () =>
                api(p.base + "/members", "POST", {
                  ...form,
                  password: form.password || undefined,
                }),
              "成员已加入",
            );
            p.setModal(null);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="用户名">
          <input
            required
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
          />
        </Field>
        <Field label="显示名称">
          <input
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </Field>
        <Field label="新账号初始密码（至少 12 位）；已有账号留空">
          <input
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
        </Field>
        <Field label="项目角色">
          <select
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })}
          >
            {["admin", "reviewer", "member", "reader"].map((r) => (
              <option key={r} value={r}>
                {labels[r]}
              </option>
            ))}
          </select>
        </Field>
        {error && <div className="error">{error}</div>}
        <div className="modal-actions">
          <button
            type="button"
            className="secondary"
            onClick={() => p.setModal(null)}
          >
            取消
          </button>
          <button className="primary" disabled={busy}>
            添加成员
          </button>
        </div>
      </form>
    </Modal>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
