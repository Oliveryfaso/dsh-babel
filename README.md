# dsh-babel

让 DeepSeek Harness (DSH) 直接使用其他 AI 编码工具生态里已有的 MCP 服务器、插件与技能——**读它们已有的配置，而不是要求插件作者为 DSH 重新移植一遍。**

```
npx 类 stdio 服务器   ✓ 能发现、能预检、能报告
http/sse 服务器       ✓ 能发现、能预检、能报告
依赖对方宿主的服务器   ✗ 明确告知为什么装不了
```

## 它解决什么问题

插件作者要支持一个平台，就得为它单独写一份目录。一个典型的多平台插件会带 6–8 个这样的目录：

```
.claude-plugin  .codex-plugin  .cursor  .gemini-extension.json  ...
```

DSH 的那个格子通常空着。dsh-babel 换个思路：**作者不用动，DSH 这边读他们已有的 `.mcp.json` / `plugin.json`**，把 N×M 的移植问题变成 N×1。

同时它做一件更重要的、别家没做的事：**装之前就告诉你哪个能跑、哪个缺密钥、哪个根本跑不起来**——而不是装上去之后静默失败，让你以为"DSH 很烂"。

## 现状（v0.1）

本阶段只做 **dry-run 兼容性报告**，不注册任何工具：

1. 发现：扫描 Claude Code 插件（`~/.claude/plugins`）与 Codex 插件（`~/.codex/plugins`）里的 `.mcp.json`（也接受任意自定根目录）。
2. 归一化：把 4 种方言（wrapped / bare / codex 专有键 / dsh 原生）降成统一中间表示。
3. 预检：对每个服务器检查四件事——
   - 依赖命令在不在 PATH（`php`、`bun`、`docker`…）
   - 守护进程有没有真在跑（Docker socket）
   - 密钥类环境变量有没有设置（`GITHUB_TOKEN`、`TFE_TOKEN`…）
   - 版本漂移（`@latest` / 未固定版本）
4. 报告：输出"可用 / 需密钥 / 不可用"三档，每一档都说清原因。

## 快速开始

```bash
# 依赖零（纯 Node，无第三方包）
node bin/dsh-babel.mjs              # 默认扫描 claude + codex 插件
node bin/dsh-babel.mjs --json       # 机器可读输出
node bin/dsh-babel.mjs --roots ~/.claude/plugins ~/.codex/plugins
```

## 兼容矩阵（诚实版）

| 外部形态 | 覆盖 | 说明 |
|---|---|---|
| MCP `.mcp.json`（stdio） | ✅ 高 | 免密钥、依赖命令存在的，基本可用 |
| MCP `.mcp.json`（http/sse） | ✅ 高 | 依赖 bearer token 的会标"需密钥" |
| MCP（依赖宿主运行时变量） | ⚠️ 有损 | `CODEX_*` / `CLAUDE_*` 等对方宿主注入的变量，DSH 没有，标为不可用 |
| MCP（OAuth） | ❌ 无对应 | `oauth_resource` 等 DSH 无等价物，丢弃并告知 |
| 技能 `skills/*/SKILL.md` | ✅ 高 | 格式统一（由 skills-manager 等已有实现覆盖） |
| 斜杠命令 `commands/*` | ⚠️ 已发现/已解析 | 发现+归一化+报告已完成（`.md` 与 `.toml`）；注册 handler 待实现 |
| Hooks | ⚠️ 有损 | DSH 仅 7 个点、仅 command handler |
| 子代理 `agents/*` | ⚠️ 降级 | DSH 无注册接口，只能降级为技能 |
| 插件 UI / mods | ❌ 不支持 | 必须用 DSH client 插件重写，无法移植 |

## 中间表示（IR）

所有方言都降成一个形状：

```js
{
  name, transport: "stdio" | "streamable-http",
  url | command + args, headers, env, cwd,
  toolCallTimeoutMs, enabledTools,
  unresolved: [{ kind, envVar, fallback }],   // 待解析的 ${VAR}
  warnings: [ ... ]                            // 语义损失
}
```

`lib/normalize.mjs` 是这个项目的内核：零依赖、纯函数、可单测。

## 目录结构

```
index.js              插件入口（apply + Config，Cordis 宿主插件形式）
cordis.patch.yml      bundle patch（插入 dsh-babel 一行）
lib/normalize.mjs     内核：方言 → IR
lib/discover.mjs      发现：遍历文件系统找声明
lib/preflight.mjs     预检：命令 / daemon / 密钥 / 版本
lib/commands.mjs      命令归一化：.md / .toml → 命令 IR
lib/register.mjs      命令注册：ctx.commands.register + 参数替换
lib/register-mcp.mjs  MCP 注册：连接 + createMcpToolDefinition + 工具注册
lib/report.mjs        报告：聚合 + 文本渲染
bin/dsh-babel.mjs   CLI runner（本地测试用）
test/                 内核单测
```

## 测试

```bash
node test/normalize.test.mjs      # 内核单测（25 断言）
node test/commands.test.mjs      # 命令归一化单测（21 断言）
node test/register.test.mjs      # 命令注册单测（19 断言）
node test/mcp-smoke.mjs          # MCP 注册冒烟测试（需先搭本地 symlink 到 DSH 包）
```

## 安装（发布后）

```bash
# 从 npm
plugin_manager install_bundle @dsh-babel/dsh-babel
# 或从 GitHub
plugin_manager install_bundle github:yourname/dsh-babel
```

安装后默认 dry-run：在日志里打印兼容性报告，不注册任何东西。要启用注册，把配置设为 `dryRun: false` 再开 `registerCommands` / `registerMcp`（后者只注册预检通过、severity=ok 的服务器）。

## 路线图

- [x] MCP 发现 + 归一化 + 预检 + dry-run 报告
- [x] 命令发现 + 归一化 + 报告（`.md` 与 `.toml`）
- [x] 命令注册（`ctx.commands.register` + 参数替换，冒烟验证）
- [x] 免密钥 stdio 服务器的真注册（`createMcpToolDefinition`，真实服务器冒烟验证）
- [ ] 密钥解析（凭证分类 + 按需从环境注入，不透传全部 64 个变量）
- [ ] 技能/子代理适配器（复用/扩展 skills-manager）

## 授权

MIT
