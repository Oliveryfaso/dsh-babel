# 架构与中间表示

## 设计约束

1. **零运行时第三方依赖**（仅 `@modelcontextprotocol/client` 一个直接依赖，且用于真连服务器）。
2. **内核纯函数化**：解析与判定不碰 I/O 之外的状态，可单测。
3. **诚实的降级**：做不到的能力明确报告，不假装支持。

## 分层

```
index.js               插件入口：apply(ctx, config) + schemastery Config
   │
   ├── lib/discover.mjs      文件系统 → 候选文件列表（带 source 溯源）
   ├── lib/normalize.mjs     .mcp.json 方言 → 服务器 IR
   ├── lib/commands.mjs      命令文件 → 命令 IR
   ├── lib/preflight.mjs     IR → 判定（ok / warn / blocked）+ 逐条原因
   ├── lib/secrets.mjs       ${VAR} 引用 → 值（env → 钥匙串白名单）
   ├── lib/report.mjs        IR + 判定 → 报告（对象 + 文本）
   ├── lib/register.mjs      命令 IR → ctx.commands.register
   └── lib/register-mcp.mjs  MCP IR → 连接 + ctx.tools.register
```

`index.js` 的 `run(config)` 是插件与 CLI 共用的流水线：

```
resolveRoots → discoverMCP → normalizeFile → summarize ─┐
             → discoverCommands → normalizeCommand → summarizeCommands ─┤
                                                                        └→ renderText
```

## 服务器中间表示（IR）

```js
{
  name: "playwright",
  transport: "stdio" | "streamable-http" | null,
  url: null,                 // http 专用
  headers: {},               // http 专用
  command: "/opt/homebrew/bin/node",   // stdio 专用（相对路径已按插件目录解析）
  args: ["...", "--headless"],
  env: {},
  cwd: null,
  toolCallTimeoutMs: null,
  enabledTools: null,
  unresolved: [{ kind, envVar, fallback }],  // 待解析的 ${VAR} 引用
  warnings: [],                              // 语义损失与 DSH 无法表达之处
  provenance: { source, file },              // 溯源
}
```

## 命令中间表示（IR）

```js
{
  name: "ponytail",
  description: "Switch ponytail intensity level",
  prompt: "Switch to ponytail {{args}} mode. ...",
  arguments: "args",          // 探测到的占位符
  allowedTools: ["Read", "Edit"],   // Claude 专有
  disableModelInvocation: false,
  source: "claude" | "codex",
  file: "...",
  warnings: [],
}
```

## 为什么先归一化再判定

把"解析"与"判定"分开有两个好处：

1. **判定逻辑与来源无关**。一个 Docker 服务器无论来自 Claude 还是 Codex 插件，守护进程检查都是同一段代码。
2. **可测**。IR 是普通对象，可以构造任意边界样本，不必在磁盘上摆真实插件。

## 与 DSH 的契合点

- 插件形式：`export function apply(ctx, config)` + 可选 `inject` / `Config`（见 `references/host-plugin.md` 的宿主插件契约）。
- 资源注册一律在 `ctx.effect` 内，或返回统一 disposer，保证卸载时无残留。
- MCP 工具定义**复用 DSH 自己的 `createMcpToolDefinition`**（`@deepseek-ai/dsh-mcp-client` 导出），而不是重新实现一份——这样图片投影、输出 schema、参数校验的行为与 DSH 原生 MCP 客户端完全一致。
- 命令结果遵循 DSH 契约：`{ kind: "success", text }` 或 `{ kind: "error", text }`。handler 收到 `{ commandId, agent, rawInput, attachments, signal }`。

## 已知短板

- **工具名归一化未复刻 DSH 的碰撞哈希**。`dsh-mcp-client` 在名超 64 字符或含非法字符时会追加 12 位 SHA-256 后缀以避免两只不同工具塌缩到同一公开名；本插件目前只做字符替换与截断。已记为 TODO。
- **stdio 子进程继承完整 `process.env`**。DSH 原生客户端会做凭证剥离（`scrubbedParentEnv`）。本插件尚未接入该剥离，属于安全上的待改进项。
- **子代理无法注册**。DSH 没有运行时注册子代理的接口，只能降级成技能。
