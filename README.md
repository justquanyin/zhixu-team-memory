# 知序 · Team Memory MVP

[![CI](https://github.com/justquanyin/zhixu-team-memory/actions/workflows/ci.yml/badge.svg)](https://github.com/justquanyin/zhixu-team-memory/actions/workflows/ci.yml)

一个可本地运行的中文团队 Coding Agent Session 记忆工作台。TypeScript + React + Express + PostgreSQL / PGlite + pgvector + FTS + MCP。

**已实现真实持久化和端到端操作**：原始 Session → 自动提取候选 → 人工审核 → 版本化团队知识 → 冲突/过期治理 → 权限过滤的混合召回 → 日志/反馈。无需 API 密钥即可演示。默认是离线规则提取与词法向量；不是已接入大模型的语义记忆服务。

![中文总览](docs/dashboard.png)

截图来自脱敏模拟演示；默认启动为空项目，不包含个人会话或预置知识。源码采用 [MIT 许可证](LICENSE)，第三方许可与自研边界见 [开源说明](docs/OPEN_SOURCE.md)。

## 1. 三分钟启动

需要 Node.js **22.12+**，建议使用维护中的 Node 22/24。首次安装需要访问 npm 公共仓库。

```bash
git clone https://github.com/justquanyin/zhixu-team-memory.git
cd zhixu-team-memory
npm ci --cache .runtime/npm-cache --registry=https://registry.npmjs.org
npm run build
npm start
```

打开 <http://127.0.0.1:4317>。macOS 也可双击 `start-local.command`。开发模式使用 `npm run dev`，前后端同端口，修改后自动刷新。

- 用户名：`admin`。
- 初始密码随机生成，保存于 `.runtime/admin-password.txt`，文件权限 0600。不是硬编码密码。
- 首次启动自动迁移，仅创建管理员和默认团队；Session、候选、知识、日志均为空。
- 数据默认保存在 `.runtime/database`，关闭后仍保留。**同一个 PGlite 数据目录只能启动一个进程。**
- 修改配置：复制 `.env.example` 为 `.env`。`ADMIN_PASSWORD` 仅在首次创建管理员时使用，不会重置已有账号。
- 默认 `SEED_DEMO=false`。仅在全新的临时数据库首次启动前，显式设置 `SEED_DEMO=true` 才会加载模拟演示数据；不会向已有实例补写。种子中的审核员/只读成员是角色示例，密码随机且不提供登录；需要可登录的测试账号时，由管理员在“成员与权限”新建。

```bash
npm test          # 内存 PostgreSQL + pgvector、HTTP、真实 MCP stdio 测试
npm run build    # TypeScript 检查 + 前端生产构建
npm audit        # 安装依赖的漏洞检查
```

## 2. 建议的演示路径

1. 全新实例的总览统计为零；可按以下步骤导入模拟文件体验，或使用显式开启演示数据的独立临时实例。
2. “导入 Session”上传 `fixtures/claude-code.jsonl`、`codex.jsonl`、`cursor.json` 或 `generic.json`。团队审核演示选择“团队共享”；默认“仅自己”。
3. Session 详情查看脱敏事件时间线、原始 SHA-256、提取运行记录；可下载原始证据或重试提取。
4. 在“记忆候选”修改标题、正文、稳定主题键、理由、否决选项、复核条件，填写审核说明并晋升。
5. 导入使用相同主题键但不同内容的 Session，审核时会出现冲突。在“冲突与过期”明确替代或拒绝候选；旧知识退出召回，历史仍保留。
6. 在“团队知识”打开详情，编辑保存为下一版本；展开版本历史。修改有效期可续期，治理队列可手动停用。
7. 在“召回调试台”搜索“支付回调 幂等”“权限过滤”，查看关键词排名、向量排名、RRF 分数、证据与 Agent 上下文，并提交有用/无用反馈。
8. 在“召回日志”查看当前成员的请求、命中知识版本、耗时和反馈；在“成员与权限”新增成员、调整角色、创建/撤销个人 MCP 令牌。

私有证据的候选和知识继承同一私有范围。管理员也不能越权读取其他人的私有会话。贡献者无法审核自己的私有候选；需要团队审核时，应在清理敏感信息后明确导入为团队共享会话。本版不提供修改原始归档可见范围的操作。

## 3. 导入协议和接入边界

所有内置样例都是模拟数据，普通文件导入不会扫描本机真实 Coding Agent 历史；显式批量导入见第 9 节。导入只解析文件，绝不执行其中的工具调用或指令。

| 来源 | 已实现输入 | 未实现 |
|---|---|---|
| Claude Code | JSONL `message.role` + `message.content`，文本与 tool_use 块 | 自动 hooks、目录监听、全版本兼容保证 |
| Codex | JSONL `response_item.payload`、`event_msg.payload`，input_text/output_text | 自动监听；不将会话元数据当知识 |
| Cursor | 消息 JSON 数组或 `{messages:[{role,content}]}` 导出 | 不读取私有 SQLite / VS Code workspaceStorage 数据库 |
| 通用 | JSON/JSONL 事件、`messages` / `events` / `conversation` 数组 | 二进制、图片、音频转录 |
| GitHub PR/Issue、ChatGPT、会议、IM | `SourceConnector` 类型契约，通用 JSON 可人工转换导入 | 无 OAuth/Webhook/实时同步；未声称已接通 |

最小输入：

```json
{"messages":[{"role":"assistant","content":"[决策:api.timeout] API 超时采用 30 秒；超过时限应终止请求。"}]}
```

稳定主题键 `api.timeout` 是冲突检测边界，团队应约定命名方式。普通会话没有标记也可导入：规则会识别“决定、采用、必须、根因”等中英文表达，生成候选；无匹配则生成零条候选。零条不是接口失败。每次最多 12 条候选、50,000 个原始事件、32 MiB 文本。

原始证据以请求提交的 UTF-8 字符串保存，保留首尾空白并计算 SHA-256；事件视图脱敏不会覆盖原文。浏览器文件输入按 UTF-8 解码，不适合二进制保真归档。规则脱敏不是 DLP，导入前仍应移除敏感数据。原始下载继承会话权限。

## 4. 切换到 PostgreSQL + pgvector

提供 `compose.yaml`，运行数据库；应用仍在本机 Node 进程运行。

```bash
export POSTGRES_PASSWORD="$(openssl rand -hex 24)"
docker compose up -d db
export DATABASE_URL="postgresql://memory:${POSTGRES_PASSWORD}@127.0.0.1:54329/memory"
npm run db:migrate
npm run db:seed
npm start
```

也可把 `DATABASE_URL` 写入本机 `.env`（不要提交）。初始化账号需要创建表和 vector 扩展的权限。连接已有 PostgreSQL 时，管理员可提前执行 `CREATE EXTENSION vector`。

```bash
npm run test:postgres
```

该测试使用 `TEST_DATABASE_URL` 或 `DATABASE_URL`，在唯一临时 schema 中运行并清理该 schema；没有地址会报错，不会静默降级。建议指向独立测试数据库。PGlite 与 **PostgreSQL 17 + pgvector 容器**均已在 GitHub Actions 验证通过；详见 [验证记录](docs/VALIDATION.md)。

两个后端使用同一迁移、参数化 SQL 和服务层。已有 PGlite 数据不会自动搬到外部 PostgreSQL，切换地址得到的是独立数据集。迁移由 `schema_migrations` 记录；启动单实例执行迁移，多实例部署应先独立执行迁移。

## 5. 可选模型提取

默认 `EXTRACTOR=rules`，不调用任何外部服务。需要模型时，设置：

```dotenv
EXTRACTOR=llm
LLM_BASE_URL=https://your-provider.example/v1
LLM_API_KEY=
LLM_MODEL=
```

这会将**规则脱敏后的事件文本**发送给指定 OpenAI-compatible Chat Completions 提供方，要求 JSON object 响应。实现了 45 秒超时、JSON/Zod 校验、精确证据引用验证和失败留档。模型不得自行晋升团队知识。

- 本版模型适配器有模拟响应测试，**未使用真实密钥连接外部模型验收**。
- 整批最多 12 条；输入上限 100,000 字符，超长上下文可能截断，失败时可重试。它不是大规模后台任务系统。
- 提取失败不会丢失 Session，详情中显示失败记录；已归档后可重新提取。
- 重提取以 Session + 主题键去重，不覆盖已审核候选。修订应走审核/版本流程。

检索向量仍是离线 256 维词法特征哈希，**不是神经语义 embedding**。中文双字切词 + PostgreSQL FTS 与 pgvector cosine 分别排名，RRF 融合；它能演示混合检索链路，对同义改写的效果有限。生产版可替换 embedding provider，但需保存模型标识、迁移维度并重建索引，不能直接混用旧向量。

## 6. MCP 接入 Coding Agent

在“成员与权限”创建个人 API 令牌，30 天过期，可随时撤销。先启动应用。MCP 服务采用官方 TypeScript SDK 的 **stdio** 传输；没有伪装成已实现的 HTTP MCP 端点。

将下面配置加入支持 stdio MCP 的 Agent。用真实绝对路径替换；不同客户端配置文件位置与注册命令由客户端决定。为避免工作目录依赖，建议直接用 Node 的 `--import` 指向项目内 tsx：

```json
{
  "mcpServers": {
    "team-memory": {
      "command": "node",
      "args": [
        "--import", "/ABS/team-memory/node_modules/tsx/dist/loader.mjs",
        "/ABS/team-memory/src/server/mcp.ts"
      ],
      "env": {
        "MEMORY_API_URL": "http://127.0.0.1:4317",
        "MEMORY_API_TOKEN": "<从后台创建的个人令牌>"
      }
    }
  }
}
```

也可在项目目录设置环境变量后 `npm run mcp`，但客户端应直接启动 `node`，避免 npm 标题污染 stdout。服务日志不写 MCP stdout。

| 工具 | 行为 |
|---|---|
| `list_projects` | 返回当前账号的项目与角色 |
| `recall(projectId, query, limit)` | 有效知识召回、证据、版本、上下文和日志 ID |
| `search_sessions(projectId, query)` | 授权会话标题过滤，最多 30 条 |
| `get_session(projectId, sessionId)` | 脱敏时间线与来源元数据，不返回 raw_text |
| `recall_feedback(projectId, logId, value)` | 当前身份的召回反馈，1 / -1 |

令牌不接受客户端指定 userId 或 role。项目成员变更即时作用于现有令牌。MCP 不提供审批或更改权限的工具。

## 7. 权限、数据保护与指标

| 能力 | 管理员 | 审核员 | 贡献者 | 只读成员 |
|---|---|---|---|---|
| 浏览本人私有 + 项目共享 / 召回 | ✓ | ✓ | ✓ | ✓ |
| 导入 / 提取 | ✓ | ✓ | ✓ | — |
| 审核 / 修改知识 / 停用 | ✓ | ✓ | — | — |
| 管理项目成员 | ✓ | — | — | — |
| 查看其他成员私有记录/日志 | — | — | — | — |

权限在服务端验证，检索 SQL 在排序前过滤 project、owner、visibility、status 和 expires_at。使用参数化 SQL；版本编辑校验版本号；审批事务锁项目行并以唯一索引防止重复有效主题。项目必须保留至少一个管理员。

登录使用 scrypt 密码哈希、随机会话 token 的 SHA-256、HttpOnly / SameSite=Strict Cookie；生产 HTTPS 时配置 `COOKIE_SECURE=true` 和正确 `APP_ORIGIN`。开发服务器禁止读取 `.runtime`、`.env`、私钥文件。默认仅绑定 127.0.0.1。

指标来自真实 `recall_logs`，仅统计当前成员最近 200 次请求：非空召回率、检索 SQL 平均耗时、有用反馈率及反馈样本量。**不等于准确率、回答质量、端到端模型耗时或全团队 BI。** 日志保存命中 ID 和版本，不复制私有正文。

## 8. 交付内容与后续边界

- [架构、实体与数据流](docs/ARCHITECTURE.md)
- [架构决策 ADR](docs/ADR.md)
- [许可证检查与复用边界](docs/OPEN_SOURCE.md)
- [验证记录](docs/VALIDATION.md)
- [API 速查](docs/API.md)
- `migrations/` 数据库迁移，`fixtures/` 脱敏样例，`tests/` 自动化测试，`.env.example` 配置模板。

这是单实例、本地优先的垂直切片。尚未提供 SSO、密码找回、MFA、数据库 RLS、对象存储 WORM、后台任务队列、语义矛盾识别、批量分页、高并发压测、自动同步、真实 Agent 客户端安装验收或生产运维保障。应用 DB 账号属于可信边界，拥有管理员权限的数据库操作者仍能修改触发器；“不可变”指应用 API + 数据库触发器约束，不宣称合规 WORM。

退出服务后可备份整个 `.runtime` 目录（包含敏感凭据与证据，应加密保护）。PostgreSQL 使用平台的 pg_dump / 备份能力。本版不提供数据删除 UI；数据保留策略及合规删除须在正式部署前设计。

## 9. 一次性导入本机 Codex 全部会话

已新增明确触发的本机批量导入命令（不是后台自动同步）：

```bash
# 先以离线规则模式启动服务
EXTRACTOR=rules npm start
# 在另一个终端进入同一项目目录
npm run import:codex
```

该命令只扫描本机 `~/.codex/sessions` 与 `~/.codex/archived_sessions` 的 JSONL，读取 `session_index.jsonl` 获取标题，不读取 Codex 登录凭据。`CODEX_IMPORT_ROOT` 可指定另一会话根目录。默认向本机服务的 `atlas` 项目导入，全部为 `private`，不会自动晋升。可用 `MEMORY_PROJECT_ID`、`MEMORY_USERNAME`、`MEMORY_PASSWORD` 指定已有项目/账户。

每次先保存不可变文件快照与 SHA-256，再通过鉴权 HTTP API 导入。运行中的会话只导入捕获时刻的完整 JSONL 行；后续内容需再次执行命令。相同快照幂等跳过，变化后的同一聊天会成为新的归档快照。收据在 `.runtime/imports/codex/<时间>/receipt.json`，记录源线程 ID、归档 ID、哈希、数量、失败原因。运行数据和凭据不进入发布 ZIP。

已支持单文件 32 MiB、50,000 原始事件，HTTP JSON envelope 上限 64 MiB。Codex 的 event_msg/response_item 镜像消息自动去重；系统说明和推理事件不展示或提取，仍保留在仅本人可见的原始归档中。规则提取跳过引用预览与代码块，区分用户约束、会话报告和待核验陈述。候选列表可按来源会话和关键字筛选，时间线默认只展示用户/助手对话。
