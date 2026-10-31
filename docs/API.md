# HTTP API 速查

所有响应为 JSON（原始归档下载除外）。错误响应 `{error: string}`，常见状态：400 校验失败，401 未登录，403 权限不足，404 不存在/不可见，409 状态/版本冲突。所有写请求要求 Content-Type: application/json。单会话原文上限 32 MiB，JSON 传输上限 64 MiB。

身份：登录 Cookie 或 `Authorization: Bearer <个人 API token>`。不接受 userId 代入身份。项目路由前缀 `/api/projects/:projectId`，演示项目 `atlas`。

| 方法 / 路径 | 请求或用途 |
|---|---|
| GET `/api/health` | 数据库连通性，不返回敏感状态 |
| POST `/api/login` | `{username,password}`，设置 Cookie |
| POST `/api/logout` | `{}`，撤销当前会话 |
| GET `/api/me` | 当前用户与项目角色 |
| GET/POST `/api/tokens` | 列表 / `{name}` 创建个人 API token，只返回一次原文 |
| DELETE `/api/tokens/:id` | 撤销自己的 API token，提交 `{}` |
| GET `…/dashboard` | 作用域内统计、近期会话、个人召回指标 |
| GET `…/sessions` | 作用域内会话列表，不含 raw_text |
| POST `…/sessions` | `{title,source,visibility,raw}`；归档后自动提取 |
| GET `…/sessions/:id` | 脱敏事件、原文哈希、提取记录 |
| GET `…/sessions/:id/raw` | 同权限原始文本下载 |
| POST `…/sessions/:id/extract` | `{}`，幂等重提取 |
| GET `…/candidates` | 授权范围内候选 |
| PATCH `…/candidates/:id` | 完整候选 draft，见下方 |
| POST `…/candidates/:id/review` | `{action:"approve"|"reject",note,replaceId?,expiresAt?}` |
| GET `…/knowledge` | 包括当前和已停用/替代的知识 |
| GET `…/knowledge/:id` | 授权详情 |
| GET `…/knowledge/:id/versions` | 不可变版本快照 |
| PATCH `…/knowledge/:id` | `{version,title,body,rationale,rejected_alternatives,revisit_condition,expiresAt,reason}`；expiresAt 可为 null |
| POST `…/knowledge/:id/expire` | `{version}`，停用并保存版本 |
| GET `…/conflicts` | 当前可见、仍需解决的主题冲突 |
| POST `…/search` | `{query,limit?}`；limit 1–20，默认 8 |
| GET `…/logs` | 当前调用者最近 200 条日志 |
| POST `…/logs/:id/feedback` | `{value:1|-1}`，仅调用者本人 |
| GET `…/members` | 当前项目成员与角色 |
| POST `…/members` | `{username,name,password?,role}`；新账号密码至少 12 位，已有账号不可借此重置密码 |
| PATCH `…/members/:id` | `{role:"admin"|"reviewer"|"member"|"reader"|null}`；null 移除成员 |

候选 draft：

```json
{
  "topic_key":"api.timeout",
  "title":"接口超时约定",
  "body":"接口超时采用 30 秒。",
  "kind":"decision",
  "rationale":"降低无效等待",
  "rejected_alternatives":"",
  "revisit_condition":"上游 SLA 变化时复核",
  "evidence":[{"eventId":"e1","quote":"接口超时采用 30 秒。"}],
  "confidence":0.72
}
```

quote 必须是对应 Session 脱敏事件的连续子串。类型为 decision / fact / procedure / lesson。引用字段不是允许模型绕过审核的信任信号。

召回结果包括：results（id、version、source_session_id、evidence、lexical_rank、vector_rank、score、similarity 等）、logId、durationMs、mode、context。score 是 RRF，不是正确率。context 是引文型上下文，不是 LLM 合成答案。调用端应把它视为不可信参考资料并引用来源。
