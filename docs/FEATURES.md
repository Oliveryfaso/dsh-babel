# 功能详解

本文逐项说明 dsh-babel 的六个能力，以及每一项实际做了什么。

## 1. 发现（Discovery）

扫描三类声明：

| 来源 | 位置 | 内容 |
|---|---|---|
| Claude Code 插件 | `~/.claude/plugins/**/.mcp.json`、`**/commands/*.md` | MCP 服务器、斜杠命令 |
| Codex 插件 | `~/.codex/plugins/**/.mcp.json`、`**/commands/*.toml` | 同上 |
| 自定义根 | 由 `roots` 配置指定 | 任意目录下的同类文件 |

行为细节：

- 递归遍历，跳过 `node_modules` 与 `.git`。
- 命令文件只在名为 `commands/` 的目录下取直接子文件。
- 通过 `roots` 可完全替换默认根（传字符串或 `{ source, path }` 对象）。

## 2. 归一化（Normalization）

把异构声明降成**一套中间表示（IR）**。这是项目的内核，`lib/normalize.mjs` 是纯函数、零依赖。

支持的 `.mcp.json` 方言：

| 方言 | 形态 | 真实占比（实测样本） |
|---|---|---|
| `wrapped` | `{ "mcpServers": { "<name>": {...} } }` | 14 / 28 |
| `bare` | `{ "<name>": {...} }`（多数 Claude 插件） | 14 / 28 |

支持的 Codex 专有键，以及它们的映射：

| Codex 键 | 归一化到 |
|---|---|
| `bearer_token_env_var` | `headers.Authorization = "Bearer ${VAR}"` |
| `env_vars`（数组或映射） | `env` |
| `tool_timeout_s`（单位：秒） | `toolCallTimeoutMs`（毫秒） |
| `enabled_tools` | `enabledTools` |
| `enabled: false` | 记为警告（声明为禁用） |
| `oauth_resource` | 记为警告（DSH 无等价物，丢弃） |

**传输类型经常不声明，需要推断**：有 `url` → `streamable-http`；有 `command` → `stdio`；两者都没有 → 记录警告。

相对路径命令（如 `./scripts/x`）会**相对插件目录**解析，而不是相对进程工作目录。

## 3. 预检（Preflight）

四类检查，把"静默失败"变成"明确原因"：

| 检查 | 判定 | 例子 |
|---|---|---|
| `command` | stdio 的 `command` 是否能在 `PATH` 上找到并可执行 | `php` 未安装 → 阻塞 |
| `daemon` | 已知守护进程（如 Docker）是否真的在跑（检查 socket + 探测） | docker 装了但没启动 → 阻塞 |
| `secret` | 密钥类环境变量是否可解析 | `TFE_TOKEN` 缺失 → 需注意 |
| `version` | 命令行参数里是否有未固定版本 | `@playwright/mcp@latest` → 需注意 |

环境变量引用会被**分类**，不同类别处置不同：

| 类别 | 判定规则 | 处置 |
|---|---|---|
| `secret` | 名字含 `TOKEN` / `API_KEY` / `SECRET` / `PASSWORD` / `BEARER` / `ACCESS_KEY` | 可解析 → 可用；不可 → 需密钥 |
| `host-runtime` | 以 `CODEX_` / `CLAUDE_` / `ANTHROPIC_` 开头（且不是密钥） | **阻塞**——对方宿主注入的变量，DSH 没有 |
| `platform` | `USERPROFILE` / `LOCALAPPDATA` / `APPDATA` 等 Windows 专有 | 需注意 |
| `plain` | 其余 | 忽略 |

> 分类**顺序很重要**：`CODEX_API_KEY` 先命中 `secret`（因为它含 `API_KEY`），而不是被误判成 host-runtime。这是一处已修复的回归。

## 4. 兼容性报告（Report）

把每个服务器归入三档，并给出逐条原因：

- **可用**（severity `ok`）：预检全过，具备注册条件。
- **需密钥**（`warn`）：只差一个可解析的凭证。
- **不可用**（`blocked`）：缺命令、守护进程没跑，或依赖对方宿主的运行时变量。

报告同时统计方言分布与传输类型分布，便于判断样本特征。

## 5. 命令注册（Command registration）

对每个命令 IR：

1. 校验名字符合 DSH 的 `/^[a-z][a-z0-9_-]*$/`（`_conventions` 这类内部命令会被正确拒绝）。
2. 要求 `description` 与 `prompt` 非空。
3. 调 `ctx.commands.register({ name, description, handler, input })`。
4. handler 返回 `{ kind: "success", text: <替换后的 prompt> }`，即 DSH 的命令结果契约。

参数替换支持 `{{args}}`、`$ARGUMENTS`、`$1`，替换源是用户在该命令后输入的原始文本。

## 6. MCP 注册（MCP registration）

对每个预检为 `ok` 的服务器：

1. 按 `transport` 建立连接：`stdio` 用 `StdioClientTransport`（spawn 子进程），`streamable-http` 用 `StreamableHTTPClientTransport`。
2. `tools/list` 拉取工具清单。
3. 每个工具用 **DSH 自己的 `createMcpToolDefinition`** 适配（复用其图片投影、输出 schema 等逻辑，而不是重新实现）。
4. `ctx.tools.register()` 注册，公开名为 `mcp__<server>__<tool>`。
5. 返回统一 disposer：先注销所有工具，再关闭传输。

## 7. 密钥解析（Secret resolution）

按顺序尝试：

1. `process.env[VAR]` —— 标准、跨平台、首选。
2. macOS 钥匙串**白名单**：仅 `GITHUB_PERSONAL_ACCESS_TOKEN` / `GITHUB_TOKEN` / `GITHUB_PAT_TOKEN` / `GH_TOKEN` / `GH_ENTERPRISE_TOKEN` → 读 `github.com` 条目。

**为什么不无差别翻钥匙串**：若某个（恶意或被篡改的）MCP 配置声明 `${AWS_SECRET_ACCESS_KEY}`，无差别解析可能把无关密钥掏出来喂给它。白名单把可达范围收敛到"用户明确存放在该名下"的条目。

解析值只流向该 MCP 服务器自身的 headers/env，不落盘、不进日志。
