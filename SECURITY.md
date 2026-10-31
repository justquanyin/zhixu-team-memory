# 安全说明

本项目是 MVP，默认仅监听本机 `127.0.0.1`。目前未实现 SSO、MFA、密码找回或完整生产加固。部署边界与已知限制见 README。

请勿在公开 Issue 中粘贴真实会话、凭据或可直接利用的漏洞细节。仓库已启用 GitHub 私密漏洞报告，请通过 [Security → Report a vulnerability](https://github.com/justquanyin/zhixu-team-memory/security/advisories/new) 提交。

`.env`、`.runtime`、数据库、导入快照和个人令牌不得提交。运行时生成的管理员密码仅供本地使用；不要复用到其他服务。规则脱敏不是完整 DLP，导入前应自行移除敏感信息。
