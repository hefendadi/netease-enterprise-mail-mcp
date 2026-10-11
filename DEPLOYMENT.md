# 本地部署 / Local deployment

本服务是非官方、默认只读的网易企业邮箱 stdio MCP Server。安装和通用客户端配置见 [README.md](README.md)。

## 部署步骤

1. 在运行 MCP 的机器上安装 Node.js ≥20.19.0 和 npm。
2. 在项目目录执行 `npm ci`；复制 `.env.example` 为 `.env`，仅填入使用者自己的邮箱和管理员认可的授权凭据。
3. 限制 `.env` 的访问权限；POSIX 系统可使用 `chmod 600 .env`，Windows 应使用合适的 ACL。
4. 在 WorkBuddy 或兼容客户端中配置 Node 和 `index.js` 的绝对路径。服务读取 `index.js` 同目录的 `.env`，进程环境变量优先。
5. 保持 `ENABLE_WRITE_TOOLS` 未设置，核对客户端显示的七个默认工具；需要连接验证时，可调用 `test_email_connection` 并指定 `testType: "imap"`。这一步会连接所配置的邮箱，必须由实际部署者授权。

`bash install.sh` 仅适用于有 Bash 的环境，不修改 WorkBuddy 或其他客户端配置。不要将项目 ZIP 连同 `.env`、日志或下载附件一起分发。

## 网络与凭据

网易企业邮箱预设为 IMAP `imaphz.qiye.163.com:993`、SMTP `smtphz.qiye.163.com:465`，实际租户可能不同。只读检索、正文和附件工具使用 IMAP；连接测试默认 `both`，会同时验证 SMTP 和 IMAP。已有近期邮件工具也保留了上游的 POP3 选择/回退代码，不应视为已经验证所有服务器配置。

企业 IMAP 开通、授权码、二次验证、访问限制和客户端启用方式以管理员和客户端说明为准。本项目不承诺提供集中凭据托管、部门分发或统一审计。

## 本地附件

建议显式指定 `EMAIL_ATTACHMENT_DIR` 为当前用户独占且不经过符号链接的绝对路径；不安全或不可写时直接报错。未指定时才依次尝试安全的用户目录、工作目录和系统临时目录，实际位置在工具响应中回显。文件由部署者自行清理；远端/容器中的路径不会自动映射到客户端机器。

目标目录验证所有权后设为 `0700`；附件和校验文件采用排他创建并设为 `0600`，冲突时换名，既有文件不覆盖。安全保存要求 POSIX 所有权和 `O_NOFOLLOW` / `O_DIRECTORY` 支持，Windows 等不支持的环境会明确拒绝保存。可信路径、失败清理及验证边界见 [SECURITY.md](SECURITY.md)。

## 验证边界

本开源整理不连接真实邮箱。自动化测试覆盖分发、默认权限、启动、MCP 握手及两个阻断项的离线回归，不代表邮件业务全流程验收。源码导出缺少旧 Mock IMAP 测试，不能将它们计为通过。管理员后续需独立验证自身配置和客户端数据处理规则。

## English deployment notes

Install Node.js ≥20.19.0, run `npm ci`, copy `.env.example` to `.env`, and supply your own authorized credentials. Configure absolute Node and entrypoint paths in a stdio MCP client. The installer does not edit client configuration. No centralized credential hosting, organization-wide distribution or audit service is supplied.

Keep write tools disabled. A connection check is a live network action performed only by an authorized deployer; use `testType: "imap"` when SMTP is unnecessary. Downloads remain on the server filesystem and require manual cleanup. The repaired attachment/search blockers have targeted offline regression tests. Attachment saves require trusted POSIX directory ownership and non-following/exclusive filesystem APIs; unsupported platforms fail closed. Real-server compatibility remains outside this verification. See SECURITY.md.
