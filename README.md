<div align="center">

# dsh-babel

**让 DSH 直接使用其他 AI 编码工具生态里的 MCP 服务器、插件与斜杠命令。**

> 读它们已有的配置，而不是要求插件作者为 DSH 重新移植一遍。

[![简体中文](https://img.shields.io/badge/lang-%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87-red.svg)](README.md) [![English](https://img.shields.io/badge/lang-English-blue.svg)](README.en.md)

[![test](https://github.com/Oliveryfaso/dsh-babel/actions/workflows/test.yml/badge.svg)](https://github.com/Oliveryfaso/dsh-babel/actions/workflows/test.yml)
[![license](https://img.shields.io/badge/license-MIT-2EA44F?style=flat)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/Oliveryfaso/dsh-babel?style=flat&label=%E2%98%85)](https://github.com/Oliveryfaso/dsh-babel)
[![DSH plugin](https://img.shields.io/badge/DSH-plugin-0f766e.svg)](https://github.com/Oliveryfaso/dsh-babel)
[![dsh-plugin topic](https://img.shields.io/badge/topic-dsh--plugin-2563eb.svg)](https://github.com/topics/dsh-plugin)

</div>

> dsh-babel 是社区维护的 DeepSeek Harness（DSH）插件，并非 DeepSeek AI 官方产品。

## 它解决什么问题

插件作者要支持一个平台，就得为它单独写一份目录。一个典型的多平台插件会带六到八个这样的目录：

```
.claude-plugin  .codex-plugin  .cursor  .gemini-extension.json  ...
```

DSH 的那个格子通常是空的。dsh-babel 换个思路：**作者不用动，DSH 这边读他们已有的 `.mcp.json` / `commands/`**，把 N×M 的移植问题变成 N×1。

同时它做一件别家没做的事：**装之前就告诉你哪个能跑、哪个缺密钥、哪个根本跑不起来**——而不是装上去之后静默失败。

## 功能

- **发现**：扫描 Claude Code 与 Codex 插件目录下的 `.mcp.json`，以及两种斜杠命令文件（`.md` / `.toml`）；根目录可配置。
- **归一化**：把多种 `.mcp.json` 方言（带 `mcpServers` 包装的 / 裸顶层的 / Codex 专有键的）降成**一套中间表示**。
- **预检**：四类检查把"静默失败"变成"明确原因"——依赖命令是否在 `PATH`、守护进程是否在跑（如 Docker socket）、密钥是否可用、版本是否未固定。
- **兼容性报告**：把每个服务器归入「可用 / 需密钥 / 不可用」，每条都附具体原因。
- **命令注册**：把发现到的斜杠命令注册进 DSH，支持 `{{args}}` / `$ARGUMENTS` / `$1` 参数替换。
- **MCP 注册**：连上 stdio 或 streamable-http 服务器，用 DSH 自己的 `createMcpToolDefinition` 注册工具。
- **密钥解析**：`process.env` 优先，其次 macOS 钥匙串的**白名单**（仅 GitHub token 家族）——绝不无差别翻钥匙串。
- **展示元数据**：`locale/` 文案与图标，配置项由 schemastery schema 声明，设置界面可渲染。

## 安装

```bash
# 从 GitHub
plugin_manager install_bundle github:Oliveryfaso/dsh-babel
# 或本地目录
plugin_manager install_bundle /绝对/路径/dsh-babel
```

也可以在 DSH Desktop 里走 **设置 → 插件 → 添加插件**，填入仓库地址或本地路径。

安装后默认 **dry-run**：只在日志里打印兼容性报告，**不注册任何东西**。

## 配置

配置项由 schemastery schema 声明，因此会出现在 **设置 → 插件 → dsh-babel** 的配置界面里：

| 配置项 | 默认 | 说明 |
|---|---|---|
| `roots` | `[]` | 扫描根目录；字符串路径或 `{ source, path }`。留空时使用默认的 Claude / Codex 插件目录 |
| `dryRun` | `true` | 只报告，不注册。要真正注册必须先设为 `false` |
| `logReport` | `true` | 把兼容性报告打印到日志 |
| `registerCommands` | `false` | 注册发现到的斜杠命令（需 `dryRun: false`） |
| `registerMcp` | `false` | 注册预检通过（`severity: ok`）的 MCP 服务器（需 `dryRun: false`） |

开启真注册：

```yaml
config:
  dryRun: false
  registerCommands: true
  registerMcp: true
```

## 兼容矩阵（诚实版）

| 外部形态 | 覆盖 | 说明 |
|---|---|---|
| MCP `.mcp.json`（stdio） | ✅ 高 | 免密钥、依赖命令存在的，基本可用 |
| MCP `.mcp.json`（http/sse） | ✅ 高 | 依赖 bearer token 的会标「需密钥」 |
| MCP（依赖宿主运行时变量） | ⚠️ 有损 | `CODEX_*` / `CLAUDE_*` 等对方宿主注入的变量，DSH 没有，标为不可用 |
| MCP（OAuth） | ❌ 无对应 | `oauth_resource` 等 DSH 无等价物，丢弃并告知 |
| 技能 `skills/*/SKILL.md` | ✅ 高 | 格式统一（由 skills-manager 等已有实现覆盖） |
| 斜杠命令 `commands/*` | ✅ 已实现 | 发现 + 归一化 + 报告 + 注册 |
| Hooks | ⚠️ 有损 | DSH 仅 7 个点、仅 command handler |
| 子代理 `agents/*` | ⚠️ 降级 | DSH 无注册接口，只能降级为技能 |
| 插件 UI / mods | ❌ 不支持 | 必须用 DSH client 插件重写，无法移植 |

## 报告长什么样

在一台装了 Claude Code 与 Codex 插件的机器上，首次加载会打印：

```
=== dsh-babel 兼容性报告 ===
文件: 28   服务器: 28
方言: {"bare":14,"wrapped":14}
传输: {"stdio":17,"streamable-http":11}
结论: 可用 14  /  需密钥 5  /  不可用 9

✗ 不可用 (9):
  laravel-boost  [stdio]  BLOCKED
      - [command] command not on PATH: php
  terraform  [stdio]  BLOCKED
      - [daemon] docker installed but not running (no socket / probe failed)
      - [secret] missing credential: TFE_TOKEN
  codex_app  [stdio]  BLOCKED
      - [env] depends on CODEX_MCP_NODE_PATH (other-harness runtime), not available in DSH
```

这就是这个插件的第二个价值：**明确告诉你为什么跑不起来**，而不是让用户以为「DSH 很烂」。

## 目录结构

```
index.js              插件入口（apply + schemastery Config，Cordis 宿主插件形式）
cordis.patch.yml      bundle patch（插入 dsh-babel 一行）
locale/zh.json        卡片展示文案（标题 + 简介）
locale/en.json        same, in English
icon.svg              插件图标
lib/normalize.mjs     内核：方言 → IR
lib/discover.mjs      发现：遍历文件系统找声明
lib/preflight.mjs     预检：命令 / daemon / 密钥 / 版本
lib/secrets.mjs       密钥解析：env 为主 + 钥匙串白名单兜底
lib/commands.mjs      命令归一化：.md / .toml → 命令 IR
lib/register.mjs      命令注册：ctx.commands.register + 参数替换
lib/register-mcp.mjs  MCP 注册：连接 + createMcpToolDefinition + 工具注册
lib/report.mjs        报告：聚合 + 文本渲染
bin/dsh-babel.mjs     CLI runner（本地测试用）
test/                 单测 + 冒烟
docs/                 详细文档
CHANGELOG.md          版本变更记录
```

## 开发与测试

```bash
npm test                  # 全部单测（75 断言）
node test/mcp-smoke.mjs   # MCP 注册冒烟（需本地 symlink 到 DSH 包 + 真实服务器）
node bin/dsh-babel.mjs    # 直接跑一次报告
```

## 文档

- [功能详解](docs/FEATURES.md)
- [配置参考](docs/CONFIG.md)
- [兼容性说明](docs/COMPATIBILITY.md)
- [架构与中间表示](docs/ARCHITECTURE.md)
- [版本变更](CHANGELOG.md)

## 许可证

[MIT](LICENSE)
