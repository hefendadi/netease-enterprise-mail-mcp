# NetEase Enterprise Mail MCP

[中文](#中文说明) · [English](#english)

## 中文说明

用于网易企业邮箱的非官方 MCP（Model Context Protocol）Server，基于 [TimeCyber/email-mcp](https://github.com/TimeCyber/email-mcp) 改造，采用 MIT 许可。本项目与网易没有官方关联。

V1.2.0 提供默认只读的邮件访问，适用于 WorkBuddy 及其他支持本地 stdio MCP 的客户端。不保证兼容所有网易邮箱服务配置；其他邮箱提供商的配置沿用上游，不代表本项目已验证其兼容性。

> **首次使用？从 [Quick Start 快速开始](QUICKSTART.md#中文快速开始) 入门。** 获取授权码、安装依赖、亲自填写 `.env`，然后复制中文 Prompt，让有本地操作权限的 Agent 帮你注册 MCP。提供 macOS、Linux 和 Windows 步骤。

### 功能和工具

| 默认可用工具 | 实际能力 |
| --- | --- |
| `search_emails` | 用 IMAP 检索邮件标题，可按发件人、时间范围、文件夹过滤；按日期倒序返回，并报告完整性状态 |
| `get_email_content` | 读取纯文本正文及编号附件清单，不返回原始 HTML 或附件二进制内容 |
| `get_email_attachment` | 下载指定编号附件到本地目录，返回路径、大小、类型、SHA256 等元数据 |
| `get_recent_emails` | 获取近期邮件列表；此继承工具的扫描策略不同于 `search_emails`，不保证完整扫描 |
| `list_folders` | 列出文件夹及服务器提供的邮件计数 |
| `list_supported_providers` | 列出代码中已有的提供商配置，不构成兼容性承诺 |
| `test_email_connection` | 验证服务器连接，默认同时验证 SMTP 与 IMAP，不发送邮件；仅检查 IMAP 时传 `testType: "imap"` |

默认不公布、且调用时拦截 `send_email`、`setup_email_account`、`configure_email_server`。已有开关 `ENABLE_WRITE_TOOLS=true` 会启用这三个工具。保持默认只读时不要启用它；本项目不是永久禁写的沙箱。

邮件读取以只读方式打开 IMAP 文件夹，不主动修改已读标记。附件下载会写入本地文件，邮件正文和元数据也会交给 MCP 客户端及其模型；请按客户端的数据处理规则授权。

### 安装

需要 **Node.js ≥20.19.0** 和 npm。20.19.0 是当前锁定依赖的最低 Node 版本要求。下载、安装、授权码说明及本地凭据填写见 [Quick Start](QUICKSTART.md#中文快速开始)。其中所有账号、凭据、UID 和本机路径示例均为虚构占位符。

macOS/Linux 的 `bash install.sh` 只检查运行环境、安装锁定依赖、在不存在时创建 `.env` 模板，不填写真实凭据，不自动注册客户端，不连接邮箱。Windows PowerShell 的等价安装步骤见 Quick Start。

### MCP 客户端配置

推荐复制 [中文 Agent 注册 Prompt](QUICKSTART.md#中文-agent-注册-prompt)，由 Agent 检查实际客户端、路径、权限和配置格式。手动配置时，在支持本地 stdio 的客户端中添加类似以下条目；入口、配置文件位置及是否需要重启，以客户端自身说明为准。

```json
{
  "mcpServers": {
    "netease-enterprise-mail": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/netease-enterprise-mail-mcp/index.js"],
      "env": {
        "EMAIL_TYPE": "netease-enterprise"
      }
    }
  }
}
```

将两个路径替换为本机的绝对路径。Windows 可使用 `C:/path/to/node.exe` 和 `C:/path/to/netease-enterprise-mail-mcp/index.js`。

服务明确读取 **index.js 同目录的 `.env`**，与客户端启动工作目录无关。进程环境变量优先于 `.env`，因此客户端若存在旧账号配置，应由用户自行核对。代码也接受客户端 `env` 中的凭据，这可能在客户端配置文件中明文保存凭据；Quick Start 使用本地 `.env`，注册 Prompt 不读取或复制凭据到客户端配置。

不要把账号或授权码写进源码、示例或提交记录。配置和客户端日志可能包含邮箱信息，分享前需自行脱敏。

### 配置项

| 环境变量 | 用途 |
| --- | --- |
| `EMAIL_USER` | 完整邮箱地址 |
| `EMAIL_PASSWORD` | 客户端授权码或管理员指定的 IMAP 凭据 |
| `EMAIL_TYPE` | 网易企业邮箱必须显式填 `netease-enterprise` |
| `EMAIL_IMAP_HOST` / `EMAIL_IMAP_PORT` | 可选覆盖内置 IMAP 地址和端口；指定 host 时请同时明确 port |
| `EMAIL_SMTP_HOST` / `EMAIL_SMTP_PORT` | 可选覆盖 SMTP 地址和端口；仅连接检查或启用发信时需要 |
| `EMAIL_ATTACHMENT_DIR` | 指定本地附件目录，建议使用当前用户独占的绝对路径 |

内置网易企业邮箱 IMAP 配置是 `imaphz.qiye.163.com:993`，SMTP 是 `smtphz.qiye.163.com:465`；这是代码中的预设，不保证适合所有租户。默认启用 IMAP TLS 和证书校验。已有 `EMAIL_IMAP_SECURE=false` 和 `IMAP_TLS_REJECT_UNAUTHORIZED=false` 可以降低保护，应保持未设置。更多边界见 [SECURITY.md](SECURITY.md)。

### 通用使用示例

以下均为虚构演示，不代表真实邮件：

1. 「找最近 7 天标题包含『项目更新』的邮件」。
2. 用结果中的文件夹和 UID 读取正文。
3. 从附件清单选取编号，再下载附件。

```json
{"tool": "search_emails", "arguments": {"query": "项目更新", "days": 7, "limit": 5, "folder": "INBOX"}}
```

```json
{"tool": "get_email_content", "arguments": {"uid": "12345", "folder": "INBOX", "maxChars": 12000}}
```

```json
{"tool": "get_email_attachment", "arguments": {"uid": "12345", "folder": "INBOX", "attachmentIndex": 1}}
```

这些 JSON 是工具调用示意，不是可直接运行的 shell 命令。实际操作必须使用检索返回的 UID 和文件夹；如有 UIDVALIDITY，可作为字符串通过 `uidValidity` 传给附件工具校验。

| 工具参数 | 默认值与限制 |
| --- | --- |
| `search_emails.query` / `from` | 空字符串；标题关键词 / 发件人关键词，忽略大小写 |
| `search_emails.days` | 7；0 表示不限时间 |
| `search_emails.folder` | `INBOX`；空字符串或 `ALL` 表示搜索全部文件夹 |
| `search_emails.limit` | 20；控制最终显示数量，不缩小检索范围 |
| `get_email_content.uid` | 必填字符串；来自检索结果 |
| `get_email_content.folder` | `INBOX`；非收件箱邮件必须指定原文件夹 |
| `get_email_content.maxChars` | 12000；有效值限制为 200～200000，非正数或非有限值回退默认；总响应另有 120000 字符截断 |
| `get_email_attachment.uid` / `folder` | UID 必填字符串；文件夹默认 `INBOX` |
| `get_email_attachment.attachmentIndex` | 1；从 1 开始的整数 |
| `get_email_attachment.uidValidity` | 可选字符串；服务器返回有效 UIDVALIDITY 时进行匹配校验 |
| `get_recent_emails.days` / `limit` | 3 / 20 |
| `test_email_connection.testType` | `both`；可选 `imap`、`smtp`、`both` |

### 附件、限制与测试

显式指定 `EMAIL_ATTACHMENT_DIR` 时，该目录必须通过安全检查且可写，否则返回错误，不静默回退。未指定时，依次尝试用户目录下 `.workbuddy-mcp-attachments`、工作目录下 `.mcp-attachments`、系统临时目录下 `workbuddy-mcp-attachments`，只使用通过检查的候选；以实际返回路径为准。附件不自动清理、不打开、不执行、不解压，返回路径只适用于服务所在文件系统。

附件与 `.sha256` 文件均以 `O_EXCL | O_NOFOLLOW` 排他创建，权限设为 `0600`；两者写入、同步和关闭完成后才报告成功。同名文件或旁文件冲突时分配新编号，不覆盖既有文件。目标目录设为 `0700`，目录链禁止符号链接，并验证所有权及父目录写权限。失败时仅清理本次创建且身份仍一致的文件，清理失败会明确报错。安全写入需要 POSIX 所有权和相应文件系统 API，Windows 等无法提供这些检查的环境会拒绝附件保存。详见 SECURITY.md。

其他限制：标题检索不支持正文、附件名或附件内容全文搜索；单文件夹最多扫描 1000 封邮件头，超过上限报告部分结果。整封邮件大小预检上限 20 MiB，单附件保存上限 10 MiB。正文和附件获取都使用整封邮件 MIME 解析，不能把正文读取理解为完全不下载附件。企业认证策略及服务器异常可能影响结果；搜索只有在请求范围扫描完成时才报告完整，读取错误、中断及 30 秒无响应会报告失败或部分。

```bash
npm test
npm run test:offline
npm run test:regression
```

`npm test` 是现有 MCP 分发测试，用 stub 隔离邮箱，只验证路由及部分返回值与只读拦截。`test:offline` 补充所有工具的分发、默认/启用写工具列表、启动和 stdio 握手检查，使用虚构配置并阻断网络。`test:regression` 使用临时私有目录、虚构 MIME 和针对性的 IMAP 事件 stub，覆盖附件排他写入/失败清理，以及搜索异常/超时状态；同名并发场景使用独立子进程。旧 Mock IMAP 测试未包含在本导出中；夹具文件本身不是测试覆盖。以上通过不代表真实 IMAP、搜索完整性、MIME 或附件全流程已通过自动化测试。本轮不复测真实邮箱。

### 上游来源与许可证

基于 [TimeCyber/email-mcp](https://github.com/TimeCyber/email-mcp)，采用 [MIT 许可证](LICENSE)，保留上游版权。第三方版权及许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)；部署、安全及版本记录见 [DEPLOYMENT.md](DEPLOYMENT.md)、[SECURITY.md](SECURITY.md) 和 [CHANGELOG.md](CHANGELOG.md)。目前未指定维护者身份或漏洞响应 SLA。

## English

An **unofficial** NetEase Enterprise Mail MCP server derived from [TimeCyber/email-mcp](https://github.com/TimeCyber/email-mcp), licensed under MIT. It is not affiliated with NetEase and does not guarantee compatibility with every NetEase mail service configuration.

V1.2.0 supports IMAP subject search, plain-text message reading, numbered attachment metadata and local attachment downloads. WorkBuddy and other clients supporting local stdio MCP can use it. Provider presets inherited from upstream are not a compatibility certification. Search does not match message bodies, attachment names or attachment contents.

> **New here? Open the [English Quick Start](QUICKSTART.md#english-quick-start).** Get an authorization code, install dependencies, fill in your local `.env` yourself, then copy the English prompt for an agent with local access to register the MCP server. Includes macOS, Linux and Windows instructions.

### Setup

Requires Node.js **20.19.0 or later** and npm. Follow the [English Quick Start](QUICKSTART.md#english-quick-start) for downloads, platform-specific commands, IMAP permissions and local credential entry. All example accounts, credentials, UIDs and local paths are fictional placeholders. The macOS/Linux installer installs locked dependencies and creates a missing template; it does not register a client or contact a mailbox. Equivalent PowerShell steps are provided for Windows.

Use the [English agent registration prompt](QUICKSTART.md#english-agent-registration-prompt), or its manual stdio configuration example. The server loads `.env` beside `index.js`; existing process environment variables take precedence. Client configuration can also supply credentials, but may store them in plaintext. The Quick Start prompt does not read or copy credentials into client settings. Never put credentials in source, examples or commits; redact account details from configuration and logs before sharing.

Detailed environment variables and tool schemas are in the tables above; the English Quick Start provides independent setup and verification prompts.

### Behavior and limits

- Seven tools are available by default: search, content, attachment, recent messages, folders, provider presets and connection checks. Connection checks default to both SMTP and IMAP and do not send messages.
- Three inherited write/configuration tools are hidden and blocked by default. `ENABLE_WRITE_TOOLS=true` enables them. Read-only operation still permits local attachment writes and exposes message content to the client/model.
- Search defaults to 7 days, INBOX and 20 displayed results. Each folder scans at most 1000 headers. Content defaults to 12000 characters, clamps valid values to 200–200000, and has an additional overall response cap. Mail size preflight is 20 MiB; each saved attachment is limited to 10 MiB.
- An explicit `EMAIL_ATTACHMENT_DIR` fails closed if unsafe or unwritable. When unset, validated user, working and temporary directories are tried in order. Always use the returned path. Files are not automatically deleted, opened, executed or extracted.
- Attachment/checksum pairs use exclusive, non-following creation with `0600` permissions and private `0700` directories. Symlink components and untrusted parent paths are rejected. Errors never report success; cleanup checks created inode identity. Secure saves require POSIX ownership and supported filesystem flags; unsupported platforms fail closed. Search errors, interruptions and 30 seconds without activity yield failed/partial status. See [SECURITY.md](SECURITY.md) for trust boundaries.
- TLS and certificate verification are enabled for the default NetEase IMAP preset. Existing environment switches can disable protection; keep those switches unset.

`npm test` runs the existing stub-based dispatch checks; `npm run test:offline` checks additional dispatch and stdio startup behavior without network access. `npm run test:regression` verifies the two repaired blockers using isolated files, concurrent child processes and targeted event stubs. Passing these tests does not establish real-server IMAP/MIME compatibility or complete mail end-to-end correctness. Excluded legacy Mock tests are not counted as passed.

### Upstream and license

Derived from [TimeCyber/email-mcp](https://github.com/TimeCyber/email-mcp). See [DEPLOYMENT.md](DEPLOYMENT.md), [SECURITY.md](SECURITY.md), [CHANGELOG.md](CHANGELOG.md) and [third-party notices](THIRD_PARTY_NOTICES.md). The upstream copyright remains in the [MIT license](LICENSE); no maintainer identity or vulnerability response SLA is asserted.
