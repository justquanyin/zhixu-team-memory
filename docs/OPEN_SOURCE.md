# 开源复用、许可证与自研边界

核验日期：2026-10-31。检查了上游仓库 LICENSE 和 GitHub license API；`license-evidence.json` 保存仓库、SPDX、许可证文件 blob SHA 与来源链接。下表只声明当前检查结果，不把之前调研中的描述直接当作复用事实。

## 参考框架：没有复制或运行其源码

| 项目 | 核验许可证 | 本次借鉴 | 实际复用边界 |
|---|---|---|---|
| [Motif](https://github.com/motif-Labs/motif) | [Apache-2.0](https://github.com/motif-Labs/motif/blob/main/LICENSE) | Coding Agent Session 到团队记忆的整体产品形态 | 未安装、未 fork；没有复用 daemon / ask_session |
| [Memorix](https://github.com/AVIDS2/memorix) | [Apache-2.0](https://github.com/AVIDS2/memorix/blob/main/LICENSE) | 观察与长期治理记忆分离、人工晋升 | 未复制 observation / curated 实现；未使用其存储引擎 |
| [ReMe](https://github.com/agentscope-ai/ReMe) | [Apache-2.0](https://github.com/agentscope-ai/ReMe/blob/main/LICENSE) | 原始资源与稳定知识分层、派生索引可重建 | 未安装 Python 框架；规则/模型管线为自研 |
| [Graphiti](https://github.com/getzep/graphiti) | [Apache-2.0](https://github.com/getzep/graphiti/blob/main/LICENSE) | 有效期、事实替代、历史来源关系 | 未使用 Neo4j/FalkorDB、图遍历或其实体解析；不是 Graphiti 改造版 |
| [LangMem](https://github.com/langchain-ai/langmem) | [MIT](https://github.com/langchain-ai/langmem/blob/main/LICENSE) | 提取与长期存储分开、记忆加工为可替换组件 | 未安装 LangGraph/LangChain，没有声称直接复用其 consolidation |

本项目不是把上述任一系统换皮后的产品。选择轻量 TypeScript 服务层来实现团队权限、证据、人工审核、冲突与版本语义，使用成熟开源库承担数据库、Web 与协议层。

## 直接运行依赖：真实使用

版本见锁文件，下面对应交付时实际安装版本。

| 依赖 | 版本 | 许可证 | 使用位置 |
|---|---|---|---|
| React / React DOM | 19.3.1 | MIT | 真实交互中文管理 UI |
| Express | 5.3.0 | MIT | API、会话、静态资源服务 |
| cookie-parser | 1.4.7 | MIT | HttpOnly 登录 Cookie 解析 |
| Zod | 4.6.7 | MIT | HTTP 与模型响应输入验证 |
| pg | 8.23.1 | MIT | 外部 PostgreSQL 连接池与事务 |
| @electric-sql/pglite | 0.5.13 | Apache-2.0 | 嵌入式 PostgreSQL 持久化、SQL 与事务 |
| @electric-sql/pglite-pgvector | 0.0.14 | Apache-2.0（包装包） | PGlite pgvector 扩展，cosine 检索 |
| @modelcontextprotocol/sdk | 1.32.2 | MIT | MCP 服务端及集成测试客户端 |
| lucide-react | 1.65.0 | ISC | 管理后台图标 |

底层 [PostgreSQL](https://www.postgresql.org/about/licence/) 与 [pgvector](https://github.com/pgvector/pgvector/blob/master/LICENSE) 使用 PostgreSQL License；包装包许可证不替代底层许可证。开发依赖 TypeScript 为 Apache-2.0，Vite、Vitest、Supertest、tsx、Prettier 等为 MIT。`dependency-licenses.json` 从安装包与锁文件生成，列出直接/传递依赖的版本和许可证；可选平台包未安装时采用锁文件 license 字段。

重分发第三方二进制/前端 bundle 时，应保留适用的版权、许可证与 NOTICE。安装目录自带上游 LICENSE；本交付归档不包含 node_modules，而以锁文件重现安装。`THIRD_PARTY_NOTICES.txt` 汇总已安装依赖的许可证文本，供随前端构建产物一并保留。这个清单是工程记录，不声称完成针对未来用途的法律审查。

## 自研范围

本次独立编写：三个核心实体与迁移、数据库适配器、消息导入器、规则提取器、模型 JSON 适配/证据校验、词法向量、FTS/RRF SQL、状态机、版本快照、范围过滤、角色管理、登录/token、中文 UI、种子和测试。

没有内置或要求提交服务密钥。未实际接通：外部大模型、Agent 自动采集、GitHub、ChatGPT、会议/IM、对象存储。本项目自研源码以 [MIT 许可证](../LICENSE) 开源；第三方组件保留各自许可证，不因本项目许可证而改变。
