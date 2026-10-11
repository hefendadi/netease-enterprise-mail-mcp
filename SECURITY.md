# Security policy / 安全边界

## 默认权限和数据流

- 默认隐藏并拦截发信和运行时账号/服务器配置工具；`ENABLE_WRITE_TOOLS=true` 会启用这些既有能力。没有永久禁写保证。
- IMAP 读取以只读方式打开文件夹，依赖的 imap 默认使用 BODY.PEEK，不主动设置邮件已读标记。
- 默认网易企业邮箱配置启用 TLS 与证书验证。`EMAIL_IMAP_SECURE=false`、`IMAP_TLS_REJECT_UNAUTHORIZED=false` 可以关闭相应保护；不要使用它们绕过证书问题。
- 凭据可来自项目 `.env` 或进程环境，不写入源代码；它们不因此变成加密存储。限制本地访问并避免在日志、客户端配置截图或 Issue 中泄露。
- 邮件正文、元数据、文件路径会传给 MCP 客户端/模型。邮箱内容是外部不可信输入，可能包含诱导模型执行其他操作的文字；调用方必须按自己的权限与数据处理规则使用它。
- 附件保存在 MCP 服务所在机器，不执行、不解压、不自动删除。返回路径不意味着客户端或其他机器可以访问该文件。

## 附件安全写入

目标目录和全部父路径通过 lstat 验证，禁止符号链接或非目录组件。父目录只能属于当前用户或 root，且不允许组/其他用户写入；root 所有且带 sticky 位的临时父目录可接受，其下私有目录必须属于当前用户。目标目录设为 `0700`，保存前及保存后重新验证目录身份和权限。

附件及 `.sha256` 旁文件均通过 `O_CREAT | O_EXCL | O_NOFOLLOW` 原子排他创建，再以文件描述符写入，设为 `0600`。先取得两个新文件，再写入、同步和关闭，全部成功后才返回成功。同名或旁文件冲突时尝试编号名（最多 1000 个候选），不覆盖、不修改原有文件。原子创建不等于两文件跨崩溃事务；进程被强制终止时可能留下未完成文件。

失败清理检查目录以及新建文件的设备号、inode 和类型，只删除本次创建且身份仍一致的文件。被替换的文件、原有文件及符号链接不删除；无法安全清理会明确报错，不返回保存成功。

显式 `EMAIL_ATTACHMENT_DIR` 不安全或不可写时失败，不隐式转向其他目录。未指定时，仍依次尝试通过验证的默认候选目录。应使用不含符号链接的绝对路径；在有系统路径别名的平台上，应指定实际路径。

此保护依赖 POSIX 所有权、模式权限、可靠的排他创建和非跟随打开语义。Node 没有可移植的 openat/ACL API，保存路径的可信条件用于排除不可信用户替换父目录；不提供对 root、恶意同 UID 进程或能操纵服务进程的用户的隔离。Windows 等无法验证这些条件的平台会拒绝附件保存，不降级为较弱保护。网络/特殊文件系统的语义需部署者另行确认。

## 搜索完整性

邮件头扫描必须确认每个候选 UID、消息属性、消息结束及所有流结束；只有扫描范围完成且没有截断/错误时才报告完整。fetch、stream、message、ALL 搜索错误和连接中断均进入失败/部分状态；30 秒无响应会终止当前扫描。文件夹发现同样检测错误、中断和超时。

已经完整读到的命中可保留在部分结果中。SINCE 失败后的已有 ALL 回退策略仍保留，但即使回退成功也明确报告不完整；单文件夹 1000 封上限及显示截断仍报告部分。真正完成的空候选范围或零匹配搜索才可报告完整空结果。

`npm run test:regression` 和兼容入口 `npm run check:known-issues` 现在验证修复后的行为；不再以成功复现漏洞作为通过依据。

## 大小及环境限制

整封邮件 20 MiB 是基于服务器报告大小的预检，单附件 10 MiB 是解析后的保存限制，不是全流程流式内存限额。MIME 解析可能将整封邮件与附件读入内存。附件保存仅在能够验证上述 POSIX 安全条件的平台启用。

本轮没有连接真实邮箱。离线分发、协议及针对性回归检查不构成 IMAP、MIME、附件和服务器兼容性的完整自动化验收；未包含的旧 Mock 测试不计为通过。

## 漏洞反馈

目前没有指定维护者邮箱、私密漏洞渠道或响应 SLA。仓库建立后，可在 Issue 提交不含敏感信息的问题摘要及受影响版本；不要公开真实邮箱、授权码、邮件正文或附件。需要敏感复现材料时，应先与维护者确认私密渠道。如果仓库日后启用 GitHub 私密漏洞报告，可使用该入口，但本文件不声称它已经启用。

## English

Write/configuration tools are hidden and blocked by default, but the existing opt-in switch enables them. IMAP reads use read-only boxes and BODY.PEEK. Local configuration files and client environment settings may contain plaintext credentials. Message contents and metadata are exposed to the MCP client/model and are untrusted input.

Default NetEase IMAP uses TLS and certificate verification; existing environment switches can disable them. Downloads remain local and are not executed or extracted.

The two reproduced blockers are repaired: attachment/checksum pairs use exclusive, non-following creation, descriptor writes, enforced permissions and identity-checked cleanup. Trusted directory ownership and permissions exclude untrusted parent replacement; symlink components are rejected. Explicit unsafe directory settings fail without fallback. This requires POSIX filesystem semantics and does not isolate malicious same-UID users or root; unsupported platforms refuse saves. A forced process termination can leave incomplete files, since this is not a cross-file crash transaction.

Header reads wait for attributes, message termination and completed streams. Search/discovery errors, interruptions, missing results and 30 seconds without activity produce failed/partial status, retaining only completed hits. A SINCE error remains incomplete even if the existing ALL fallback succeeds. Targeted offline regressions cover these fixes; real-server compatibility and complete MIME/IMAP UAT remain unverified.

No private reporting channel, maintainer address or response SLA is currently configured. Once a repository exists, report only a nonsensitive summary and version through Issues; arrange a private channel before sending credentials, message contents or attachments. Do not assume GitHub private vulnerability reporting is enabled.
