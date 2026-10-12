# Quick Start｜网易企业邮箱 MCP 快速开始

[中文](#中文快速开始) · [English](#english-quick-start)

## 中文快速开始

**获取客户端授权码 → 下载并安装 → 亲自填写 `.env` → 复制 Prompt 注册 MCP → 自行测试 IMAP 和邮件标题检索。**

本项目是非网易官方产品。指南适用于 WorkBuddy 或其他支持**本地 stdio MCP** 的客户端。Agent 能否操作本机文件或修改客户端设置，取决于客户端、运行模式和权限；并非所有 Agent 都能修改自己的 MCP 配置。

所有示例账号、凭据、UID 和本机路径均为虚构占位符。仓库链接、服务预设和工具名称是实际项目资料。

### 第 1 步：开启 IMAP，获取客户端授权码

先区分三件事：

| 项目 | 用途 |
| --- | --- |
| 网页版登录密码 | 用来登录企业邮箱网页，不要把它填作本指南的客户端授权码 |
| 第三方客户端授权码 / 授权密码 | 为第三方客户端生成的凭据，由你亲自填入本地 `.env` 的 `EMAIL_PASSWORD` |
| IMAP 协议访问权限 | 允许第三方客户端通过 IMAP 访问邮箱；有授权码不代表 IMAP 已启用 |

1. 登录企业提供的网易企业邮箱网页版，或使用[网易企业邮箱登录页](https://mail.qiye.163.com/static/login/)，确认当前登录的是准备使用的账号。
2. 在设置中寻找「客户端授权码」「客户端授权密码」或「客户端设置」。**不要求所有租户都有同一菜单路径**；不要照搬个人 163 邮箱的设置。
3. 确认该账号允许第三方客户端访问，并开启 IMAP。若看不到入口、无法开启，或被企业管理员禁用，联系邮箱管理员确认权限及实际 IMAP 地址、端口。
4. 按实际页面生成客户端授权码，可使用虚构名称 `Mail MCP` 作为标识。按提示完成确认/保存后再使用；部分租户需要手机验证或管理员授权。
5. 安全保管授权码，稍后亲自填入本地 `.env`。**不要在 AI 对话中提供授权码或网页登录密码。**

[第三方授权码界面参考](https://email.mq163.net/help/836.html)展示了不同版本的界面及确认流程，不能代表所有企业租户。企业的权限及认证策略以管理员说明为准。

### 第 2 步：下载项目并安装依赖

**没有 Node.js 经验也可以使用官方安装程序。** 打开 [Node.js 官方下载页](https://nodejs.org/en/download)，选择当前 LTS 版本及本机操作系统，按官方方式安装 Node.js 和 npm。项目最低要求是 **Node.js 20.19.0**。安装后重新打开终端或 PowerShell。

**下载方式任选其一：**

- 无需 Git：打开[项目仓库](https://github.com/hefendadi/netease-enterprise-mail-mcp)，点击 **Code → Download ZIP**，解压到你自己的本地目录。ZIP 解压目录通常名为 `netease-enterprise-mail-mcp-main`。
- 已安装 Git：运行下面两行，下载后进入项目目录。

```bash
git clone https://github.com/hefendadi/netease-enterprise-mail-mcp.git
cd netease-enterprise-mail-mcp
```

以下命令都在**包含 `index.js`、`package.json` 和 `install.sh` 的项目目录**执行。ZIP 用户先在该目录打开终端/PowerShell，或输入 `cd ` 后将目录拖入终端并回车。

#### macOS / Linux

打开终端，依次运行：

```bash
node --version
npm --version
bash install.sh
```

脚本检查 Node 和 npm、运行 `npm ci --no-audit --no-fund` 安装锁定依赖，并仅在 `.env` 不存在时从模板创建私有文件。已有 `.env` 会保留。它不会填写凭据、注册客户端或连接邮箱。

#### Windows PowerShell

不需要安装 Bash。在项目目录打开 PowerShell，依次运行：

```powershell
node --version
npm.cmd --version
npm.cmd ci --no-audit --no-fund
if (-not (Test-Path -LiteralPath '.env')) {
    Copy-Item -LiteralPath '.env.example' -Destination '.env'
}
```

这是与安装脚本相同的依赖安装及模板保留流程；使用 `npm.cmd` 可避免 PowerShell 阻止 `npm.ps1`。通过文件属性中的「安全」设置适当的 Windows ACL，将 `.env` 的访问限制为你本人及必要的系统管理主体；不要放在共享目录。Windows 附件保存限制见[安全提醒与限制](#安全提醒与限制)。

如果 `node` 或 npm 无法找到，先完成官方安装并重新打开终端；如果版本不足，升级到满足要求的 LTS 版本。依赖安装失败时先解决终端错误，再继续。

### 第 3 步：亲自填写本地 `.env`

编辑的是 **`index.js` 同目录的 `.env`**，不是 `.env.example`，也不是聊天输入框。macOS/Linux 可在项目目录运行：

```bash
nano .env
```

Windows 可在项目目录运行：

```powershell
notepad.exe .env
```

将模板中的三项替换为你自己的值：

```dotenv
EMAIL_USER=reader@example.com
EMAIL_PASSWORD="replace-with-your-own-client-authorization-code"
EMAIL_TYPE=netease-enterprise
```

- `EMAIL_USER`：你自己的完整企业邮箱地址。
- `EMAIL_PASSWORD`：第 1 步生成的客户端授权码，不是网页登录密码。
- `EMAIL_TYPE`：保持 `netease-enterprise`。

上述示例不能登录真实邮箱。`nano` 中按 `Ctrl + O`、回车保存，再按 `Ctrl + X` 退出；记事本中保存为 `.env`，不要另存为 `.env.txt`。macOS/Linux 保存后运行：

```bash
chmod 600 .env
```

代码中的企业邮箱预设是 `imaphz.qiye.163.com:993`，启用 TLS 和证书验证，**不保证适用于所有租户**。管理员提供其他服务器时，按 [README 配置项](README.md#配置项)设置 `EMAIL_IMAP_HOST` 和 `EMAIL_IMAP_PORT`。不要关闭 TLS 或证书验证来绕过错误。

进程环境变量优先于 `.env`。如果客户端已有 `EMAIL_USER` 或 `EMAIL_PASSWORD` 设置，请自行核对是否覆盖新配置；不要让 Agent 展示这些值。

### 第 4 步：让 Agent 注册 MCP

前提：第 2、3 步已完成，且凭据已经**由你亲自**填入 `.env`。把以下整段 Prompt 发给当前 Agent，里面不需要填写授权码。具备本地权限时，Agent 会负责查找 Node、项目路径和实际配置入口。

如果当前客户端或模式不能访问本机、不能修改自身 MCP 设置，或只支持远程 MCP，应报告阻塞并给出手动方案。Prompt 本身不能赋予文件权限或客户端能力。

#### 中文 Agent 注册 Prompt

```text
请将本机已安装的 NetEase Enterprise Mail MCP 注册到当前使用的 MCP 客户端。

项目仓库：https://github.com/hefendadi/netease-enterprise-mail-mcp
项目已经安装，.env 已由我亲自填写。本次仅授权本地 MCP 注册和工具发现验证；不要重新下载项目、修改源码、安装依赖或修改 .env。

1. 识别本机操作系统、实际 MCP 客户端及运行模式、可用的本地文件权限。如果无法确认客户端，先询问我，不要把当前 Agent 名称当成客户端配置依据，也不要假定 Agent 能修改自身配置。
2. 从当前工作目录或我指定的目录定位项目，核对 package.json 的 name 为 netease-enterprise-mail-mcp，确认 index.js 存在。找不到时只问我项目目录，不进行全盘搜索。检查 Node.js >=20.19.0，取得 Node 可执行文件和 index.js 的绝对路径，路径有空格时也要使用客户端格式正确编码。
3. 确认客户端支持本地 stdio MCP。根据实际设置入口、已有配置或当前客户端官方文档识别配置格式和作用域，不猜配置文件路径，不把其他客户端的 JSON 格式直接套用。如果客户端或运行模式不支持修改自身 MCP 设置，转为手动方案。
4. 只检查 .env 文件是否存在，不打开、读取或修改它。不得读取、展示、复制、记录或上传其中的授权码；不得要求我在聊天中提供邮箱密码或授权码。正常启动服务时，由服务自行加载本地 .env，Agent 不检查其内容。
5. 检查客户端实际生效的 MCP 配置，保留其他服务和原有设置；在本地处理配置时不要打印完整配置、环境变量或秘密值。相同项目路径已有服务时复用其名称，避免同一作用域或跨作用域重复注册。默认服务名为 netease-enterprise-mail；若该名称已属于其他项目，先询问我，不覆盖。
6. 如需修改现有配置，先创建本地备份并限制备份访问权限；确认写入权限和备份成功后再最小化修改。新配置文件原先不存在时注明这一点。没有权限或无法备份现有配置时，不修改；按客户端权限流程请求必要批准或提供手动方案。不绕过权限限制，不上传备份。
7. 服务使用本地 stdio：command 为 Node 绝对路径，args 包含 index.js 绝对路径；新增的 env 仅设置 EMAIL_TYPE=netease-enterprise。不得把 EMAIL_USER、EMAIL_PASSWORD 或任何邮箱密码/授权码从 .env 复制到聊天、日志或其他配置文件。不启用 ENABLE_WRITE_TOOLS，不降低 TLS 保护。若复用服务中已有账号/凭据环境变量可能覆盖 .env，只提示我自行处理，不展示、复制或自动修改这些值。
8. 校验实际配置格式、可执行路径及其他服务是否保留。按客户端支持的方式重新加载 MCP；如果需要我手动重启客户端，明确说明并等待我完成。只检查工具发现/工具列表，不调用 test_email_connection、search_emails、get_email_content、get_email_attachment 或其他邮箱工具，不连接真实邮箱，不读取邮件，不下载附件。
9. 只有在当前客户端实际发现 search_emails、get_email_content、get_email_attachment 和 test_email_connection 后，才能报告 REGISTER_STATUS=PASS。配置写入、单独启动服务器或看到日志都不等于客户端工具可见。默认应有七个工具；另外三个是 get_recent_emails、list_folders、list_supported_providers。不要调用它们来验证。

如无法访问本机文件、不能确定配置格式、不能修改客户端设置、缺少权限、需要重启或无法验证工具可见，报告 REGISTER_STATUS=BLOCKED。说明已确认的配置状态和阻塞原因，并提供符合已知客户端格式的手动配置片段及下一步；未知路径使用明确占位符，不编造路径或成功结果。

最后只报告：REGISTER_STATUS（PASS/BLOCKED）、配置状态、服务名称、实际发现的工具，以及我还需完成的操作。不展示凭据。邮箱连接测试和邮件检索留给我在注册后另行发起。
```

#### 备选：手动注册

如果 Agent 不能自动注册，可在客户端的 MCP / 自定义连接器入口添加本地 **stdio** 服务，或按该客户端文档编辑实际配置文件。修改现有配置前先备份，保留其他服务；不要用下面的完整示例覆盖整个文件。

在项目目录查询路径：

```bash
# macOS / Linux
node -p 'process.execPath'
pwd -P
```

```powershell
# Windows PowerShell
node -p 'process.execPath'
(Get-Location).Path
```

第一行给出 Node 可执行文件绝对路径，第二行给出项目目录。下面的 JSON 是常见格式示意；部分客户端只接受单个服务对象，或要求显式指定 stdio 类型。以实际客户端格式为准。

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

将 `command` 替换为第一行结果，`args[0]` 替换为项目目录加 `/index.js`。Windows 可使用虚构示例 `C:/path/to/node.exe` 和 `C:/path/to/netease-enterprise-mail-mcp/index.js` 的形式，并替换为本机路径；JSON 中使用 `/`，或将反斜杠写成 `\\`。不要添加邮箱地址或授权码。

保存后按客户端提示重新加载或重启，确认上述工具可见。只支持远程 MCP 的客户端不能直接使用此本地 stdio 配置；请选择支持本地 stdio 的客户端。

### 第 5 步：自行测试连接和标题检索

注册 Prompt **不会测试真实邮箱**。确认你允许客户端及其模型处理邮箱元数据后，另行发送以下 Prompt：

```text
请调用网易企业邮箱 MCP 的 test_email_connection，参数为 {"testType":"imap"}。只测试 IMAP，不测试 SMTP、不发送邮件，也不读取邮件或下载附件。只报告成功/失败及不含凭据的错误摘要，不输出原始日志或环境变量。
```

成功后再发送：

```text
请调用网易企业邮箱 MCP 的 search_emails，参数为 {"query":"","days":7,"limit":5,"folder":"INBOX"}。只展示返回的日期、发件人、主题及结果完整性状态，不调用正文或附件工具。不要自行扩大日期范围或搜索其他文件夹。
```

返回邮件列表意味着连接与邮件头检索链路已通；空结果不证明邮箱没有邮件，尤其在结果标记不完整时。零结果时先核对日期范围和文件夹，再决定是否扩大检索。正文读取和附件保存不是首次安装验证的必需步骤，需要你另行发起。

### 常见问题

| 现象 | 优先检查 |
| --- | --- |
| 认证失败 | 完整邮箱地址、客户端授权码是否确认生效/过期、IMAP 和第三方客户端权限；不要改用网页登录密码 |
| 超时 / 拒绝连接 | 企业 IMAP/IP 限制、租户服务器、TLS 和端口；联系管理员，不关闭证书验证 |
| 看不到工具 / REGISTER_STATUS=BLOCKED | Node 版本和绝对路径、实际配置格式及作用域、客户端权限、是否需重新加载或重启 |
| `.env` 修改后仍用旧账号 | 用户自行检查进程/客户端环境变量覆盖，并重新加载服务 |
| 搜索无结果 | 近期邮件、日期范围和目标文件夹；`days=0` 表示不限日期，结果不完整时不能断定没有邮件 |
| 附件无法保存 | 检查权限和工具错误；Windows 等不能提供所需 POSIX 安全检查的环境会拒绝保存 |

### 安全提醒与限制

- `.env` 含真实凭据，仅保存在本地私有位置，不上传 GitHub、不提交 Issue、不粘贴到 AI 对话。备份及客户端配置也可能含敏感信息，应限制访问，分享前脱敏。
- 默认隐藏并拦截发信和邮箱配置修改工具。保持 `ENABLE_WRITE_TOOLS` 未设置；设置为 `true` 会启用这些工具。不要设置 `EMAIL_IMAP_SECURE=false` 或 `IMAP_TLS_REJECT_UNAUTHORIZED=false`。
- 邮件元数据和正文会交给 MCP 客户端及其模型；邮件内容是不可信外部输入。请按企业及客户端的数据规则授权。IMAP 读取使用只读文件夹，不主动修改已读标记。
- 附件保存在服务所在机器的受控目录，不自动清理、打开、执行或解压。安全保存需要可信 POSIX 所有权和文件系统 API；Windows 等不满足条件的平台会拒绝保存。Windows 安装步骤不构成附件支持承诺。
- 搜索针对标题，不支持正文或附件全文搜索。单文件夹最多扫描 1000 封邮件头，截断或错误会报告失败/部分结果。正文获取使用整封 MIME 解析，网络层可能下载附件；整封邮件大小预检 20 MiB，单附件保存上限 10 MiB。
- 本文提供安装与验证方法，未据此连接真实邮箱或完成实际客户端验收。详细配置、工具参数、边界和离线测试说明见 [README](README.md)、[SECURITY](SECURITY.md) 和 [DEPLOYMENT](DEPLOYMENT.md)。上游来源和版权见 [README](README.md#上游来源与许可证)、[LICENSE](LICENSE) 和 [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES.md)。

---

## English Quick Start

**Get a client authorization code → download and install → fill in `.env` yourself → copy the registration prompt → explicitly test IMAP and subject search.**

This is an unofficial NetEase project. Use WorkBuddy or another client supporting **local stdio MCP**. Local file access and permission to change client settings depend on the client and agent mode. Not every agent can edit its own MCP configuration.

All example accounts, credentials, UIDs and local paths are fictional placeholders. Repository links, server presets and tool names refer to the actual project.

### Step 1: Enable IMAP and obtain a client authorization code

| Item | Purpose |
| --- | --- |
| Web login password | Signs in to WebMail; do not use it as the client authorization code in this guide |
| Third-party client authorization code / password | A credential generated for a client; enter it yourself as `EMAIL_PASSWORD` in your local `.env` |
| IMAP access permission | Allows IMAP access; having a code does not mean IMAP is enabled |

1. Sign in through your organization's NetEase Enterprise WebMail portal or the [NetEase Enterprise Mail login page](https://mail.qiye.163.com/static/login/). Confirm the intended account is signed in.
2. Look in settings for **Client Authorization Code**, **Client Authorization Password**, or **Client Settings**. Menu paths vary by tenant and version; do not apply personal 163 mailbox instructions automatically.
3. Confirm third-party client access is allowed and enable IMAP. If the option is missing, unavailable or disabled by policy, contact your mail administrator for access and your tenant's IMAP host and port.
4. Generate a client authorization code following the actual page. A fictional label such as `Mail MCP` can identify it. Complete confirmation/save before use; mobile verification or administrator approval may be required.
5. Store the code securely for local entry in Step 3. **Never provide the code or your web login password in an AI conversation.**

This [third-party authorization-code interface reference](https://email.mq163.net/help/836.html) illustrates different versions and confirmation steps. It does not establish a universal tenant interface; your administrator's access and authentication policy applies.

### Step 2: Download the project and install dependencies

No Node.js development experience is required. Visit the [official Node.js download page](https://nodejs.org/en/download) and install the current LTS release and npm for your operating system using the official instructions. The project requires **Node.js ≥20.19.0**. Open a new terminal or PowerShell window afterward.

Choose a download method:

- Without Git: open the [repository](https://github.com/hefendadi/netease-enterprise-mail-mcp), select **Code → Download ZIP**, and extract it locally. The extracted folder is usually called `netease-enterprise-mail-mcp-main`.
- With Git installed: download and enter the project using these commands.

```bash
git clone https://github.com/hefendadi/netease-enterprise-mail-mcp.git
cd netease-enterprise-mail-mcp
```

Run subsequent commands in the **project folder containing `index.js`, `package.json` and `install.sh`**. ZIP users can open a terminal/PowerShell there, or type `cd `, drag the folder into the terminal and press Enter.

#### macOS / Linux installation

```bash
node --version
npm --version
bash install.sh
```

The script checks Node and npm, runs `npm ci --no-audit --no-fund` to install locked dependencies, and creates a private `.env` from the template only if missing. An existing `.env` is preserved. It does not enter credentials, register a client or connect to a mailbox.

#### Windows PowerShell installation

No Bash installation is needed. Open PowerShell in the project folder and run:

```powershell
node --version
npm.cmd --version
npm.cmd ci --no-audit --no-fund
if (-not (Test-Path -LiteralPath '.env')) {
    Copy-Item -LiteralPath '.env.example' -Destination '.env'
}
```

This uses the same dependency installation and template-preservation flow as the script. `npm.cmd` avoids PowerShell blocking `npm.ps1`. Use the file's **Properties → Security** settings to restrict `.env` access with an appropriate Windows ACL to yourself and necessary system administrators; avoid shared folders. See [Safety and limits](#safety-and-limits) for Windows attachment restrictions.

If Node or npm is unavailable, finish the official installation and open a new terminal. Upgrade an insufficient version to a supported LTS release. Resolve installation errors before proceeding.

### Step 3: Fill in the local `.env` yourself

Edit **`.env` beside `index.js`**, not `.env.example` or a chat input. In the project folder:

```bash
# macOS / Linux
nano .env
```

```powershell
# Windows
notepad.exe .env
```

Replace these three template values with your own:

```dotenv
EMAIL_USER=reader@example.com
EMAIL_PASSWORD="replace-with-your-own-client-authorization-code"
EMAIL_TYPE=netease-enterprise
```

- `EMAIL_USER`: your full enterprise email address.
- `EMAIL_PASSWORD`: the client authorization code from Step 1, not the web login password.
- `EMAIL_TYPE`: keep `netease-enterprise`.

The example cannot log in to a real mailbox. In `nano`, press `Ctrl + O`, Enter, then `Ctrl + X`. In Notepad, save as `.env`, not `.env.txt`. After saving on macOS/Linux:

```bash
chmod 600 .env
```

The code's preset is `imaphz.qiye.163.com:993` with TLS and certificate verification. **It is not guaranteed to match every tenant.** If your administrator provides another server, set `EMAIL_IMAP_HOST` and `EMAIL_IMAP_PORT` using the [README configuration table](README.md#配置项). Do not disable TLS or certificate verification to bypass errors.

Process environment variables override `.env`. If the client already supplies `EMAIL_USER` or `EMAIL_PASSWORD`, check these overrides yourself; do not ask an agent to display them.

### Step 4: Ask your agent to register MCP

Complete Steps 2 and 3 first, entering credentials **yourself**. Copy the entire English prompt below. It contains no authorization code. An agent with local permissions will locate Node, the project and the actual configuration entry point.

If the current client/mode cannot access local files, cannot edit its own MCP settings, or supports only remote MCP, the agent must report the limitation and provide a manual alternative. A prompt cannot grant file permissions or client capabilities.

#### English agent registration prompt

```text
Please register the locally installed NetEase Enterprise Mail MCP with the MCP client I am currently using.

Repository: https://github.com/hefendadi/netease-enterprise-mail-mcp
The project is already installed, and I filled in .env myself. This request authorizes only local MCP registration and tool-discovery validation. Do not download the project again, modify source code, install dependencies or change .env.

1. Identify the local operating system, actual MCP client and running mode, and available local file permissions. If the client is uncertain, ask me first. Do not infer configuration from the agent's name or assume the agent can edit its own settings.
2. Locate the project from the current working directory or a directory I specify. Check that package.json has name netease-enterprise-mail-mcp and index.js exists. If not found, ask only for the project directory; do not search the entire filesystem. Verify Node.js >=20.19.0 and obtain absolute paths to the Node executable and index.js. Encode paths containing spaces correctly for the client's format.
3. Confirm support for local stdio MCP. Use the actual settings entry point, existing configuration or current official client documentation to identify the format and scope. Do not guess a configuration path or apply another client's JSON format blindly. If the client or mode cannot edit its own MCP settings, use the manual alternative.
4. Check only whether .env exists; do not open, read or modify it. Never read, display, copy, log or upload its authorization code, or ask me to provide an email password or code in chat. When the server starts normally, let the server load its own local .env; the agent must not inspect its contents.
5. Inspect the client's effective MCP configuration while preserving other servers and settings. Process it locally without printing full configuration, environment variables or secret values. Reuse the existing server name if the same project path is already registered, avoiding duplicates within or across scopes. The default name is netease-enterprise-mail; if it belongs to a different project, ask me before making changes and do not overwrite it.
6. Before changing existing configuration, create a local backup and restrict its access permissions. Make only a minimal change after confirming write permission and backup success. If creating a previously nonexistent configuration file, state that it did not exist. Without permission or a successful backup of existing configuration, do not modify it; request any necessary approval through the client's permission flow or provide a manual alternative. Do not bypass permissions or upload backups.
7. Use local stdio: command is the absolute Node path, and args contains the absolute index.js path. Newly added env contains only EMAIL_TYPE=netease-enterprise. Never copy EMAIL_USER, EMAIL_PASSWORD or any email password/code from .env into chat, logs or another configuration file. Do not enable ENABLE_WRITE_TOOLS or weaken TLS protection. If a reused server already has account/credential environment overrides, ask me to resolve them myself; do not display, copy or automatically change those values.
8. Validate the actual configuration format, executable paths and preservation of other servers. Reload MCP using supported client mechanisms. If I must restart the client manually, tell me clearly and wait for completion. Check only tool discovery/tool lists. Do not call test_email_connection, search_emails, get_email_content, get_email_attachment or any other mailbox tool. Do not connect to a real mailbox, read mail or download attachments.
9. Report REGISTER_STATUS=PASS only after the current client actually discovers search_emails, get_email_content, get_email_attachment and test_email_connection. A configuration write, standalone server launch or log message does not establish tool visibility in the client. Seven tools are expected by default; the other three are get_recent_emails, list_folders and list_supported_providers. Do not invoke them for validation.

If local files are inaccessible, configuration format is uncertain, client settings cannot be edited, permissions are missing, a restart is pending or tool visibility cannot be verified, report REGISTER_STATUS=BLOCKED. State the confirmed configuration status and reason, and provide a manual configuration snippet in the known client format with next steps. Use explicit placeholders for unknown paths; do not invent paths or claim success.

Finally report only: REGISTER_STATUS (PASS/BLOCKED), configuration status, server name, actually discovered tools and remaining user actions. Do not expose credentials. Leave connection testing and email search for a separate request from me after registration.
```

#### Alternative: Manual registration

Use the client's MCP/custom connector settings to add a **local stdio** server, or edit its actual configuration according to its documentation. Back up existing configuration and preserve other servers. Do not replace the entire file with the example below.

Find paths from the project folder:

```bash
# macOS / Linux
node -p 'process.execPath'
pwd -P
```

```powershell
# Windows PowerShell
node -p 'process.execPath'
(Get-Location).Path
```

The first line returns the absolute Node executable path; the second returns the project directory. This JSON illustrates a common format. Some clients need only the individual server object or an explicit stdio type. Use the actual client's supported format.

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

Replace `command` with the first result and `args[0]` with the project directory plus `/index.js`. For Windows, replace fictional paths such as `C:/path/to/node.exe` and `C:/path/to/netease-enterprise-mail-mcp/index.js` with your own paths. Use `/` or escape backslashes as `\\` in JSON. Do not add an email address or authorization code.

Save, reload or restart as directed by the client, and confirm the tools above are visible. A remote-only MCP client cannot use this local stdio configuration directly; choose a client supporting local stdio.

### Step 5: Explicitly test IMAP and subject search

The registration prompt **does not test a real mailbox**. After confirming that your client and its model may process mail metadata, separately send:

```text
Call the NetEase Enterprise Mail MCP test_email_connection tool with {"testType":"imap"}. Test only IMAP, not SMTP. Do not send email, read messages or download attachments. Report only success/failure and a credential-free error summary; do not print raw logs or environment variables.
```

After success, send:

```text
Call the NetEase Enterprise Mail MCP search_emails tool with {"query":"","days":7,"limit":5,"folder":"INBOX"}. Show only the returned date, sender, subject and result completeness status. Do not call content or attachment tools, expand the date range or search other folders automatically.
```

A returned mail list verifies the connection and header-search path. Empty results do not prove the mailbox has no mail, especially if marked incomplete. Check dates and folder before deciding to expand a search. Reading bodies or saving attachments is optional and requires a separate request.

### Troubleshooting

| Symptom | Check first |
| --- | --- |
| Authentication failure | Full address, confirmed/unexpired client code, IMAP and third-party access permissions; do not substitute the web login password |
| Timeout / refused connection | Enterprise IMAP/IP policy, tenant host, TLS and port; contact the administrator instead of disabling certificate verification |
| Missing tools / REGISTER_STATUS=BLOCKED | Node version and absolute paths, actual configuration format/scope, client permissions and reload/restart requirements |
| Old account after editing `.env` | Check process/client environment overrides yourself and reload the server |
| No search results | Recent mail, dates and target folder; `days=0` removes the date restriction; incomplete results do not establish no matching mail |
| Attachment save failure | Permissions and tool error; Windows and other environments lacking the required POSIX security checks reject saves |

### Safety and limits

- Keep credential-bearing `.env` files private and local. Never upload them to GitHub, Issues or AI chat. Backups and client settings may also contain sensitive data; restrict access and redact before sharing.
- Sending and mailbox configuration tools are hidden and blocked by default. Keep `ENABLE_WRITE_TOOLS` unset; `true` enables them. Do not set `EMAIL_IMAP_SECURE=false` or `IMAP_TLS_REJECT_UNAUTHORIZED=false`.
- Mail metadata and bodies are passed to the client/model, and mail is untrusted external input. Follow enterprise and client data rules. IMAP folders are opened read-only without intentionally changing read flags.
- Attachments remain in controlled directories on the server's machine. They are not automatically cleaned up, opened, executed or extracted. Secure saves require trusted POSIX ownership and filesystem APIs; Windows and other unsupported environments reject saves. Windows installation instructions do not establish attachment support.
- Search matches subjects, not message or attachment contents. Each folder scans at most 1000 headers; truncation/errors yield failed or partial results. Body retrieval parses the entire MIME message and may download attachments at the network layer. Mail size preflight is 20 MiB; each saved attachment is limited to 10 MiB.
- This guide describes installation and verification; it does not establish live-mailbox testing or actual client acceptance. See [README](README.md), [SECURITY](SECURITY.md) and [DEPLOYMENT](DEPLOYMENT.md) for configuration, schemas, boundaries and offline test descriptions. See [upstream and license](README.md#upstream-and-license), [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES.md) for attribution.
