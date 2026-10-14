# 兼容性说明

本文回答两个问题：**dsh-babel 能替你搬来什么**，以及**什么搬不动、为什么**。

## 总表

| 外部形态 | 覆盖 | 能做到什么 | 做不到什么 |
|---|---|---|---|
| MCP `.mcp.json`（stdio） | ✅ 高 | 发现、归一化、预检、连接、注册工具 | 依赖对方宿主变量的起不来 |
| MCP `.mcp.json`（http/sse） | ✅ 高 | 同上 | OAuth 流程无对应实现 |
| 斜杠命令（Claude `.md`） | ✅ 高 | 发现、解析 frontmatter、注册 | `allowed-tools` 仅作展示，不参与 DSH 授权 |
| 斜杠命令（Codex `.toml`） | ✅ 高 | 同上，含 `{{args}}` 参数替换 | — |
| 技能 `skills/*/SKILL.md` | ✅ 高 | 格式本就统一，可直接被 DSH 消费 | 本插件不重复实现（已有 skills-manager 等） |
| Hooks | ⚠️ 有损 | 仅 command handler、仅部分事件点 | `http` / `mcp_tool` / `prompt` / `agent` handler 跳过 |
| 子代理 `agents/*.md` | ⚠️ 降级 | 可降级为"技能 + 提示词模板" | DSH 无运行时注册子代理的接口 |
| 插件 UI / mods | ❌ 不支持 | — | 必须用 DSH client 插件重写，无法移植 |

## 明确的阻塞原因（预检会告诉你）

### 1. 依赖命令不存在

```
[command] command not on PATH: php
```

服务器声明用某个命令启动，但该命令不在 `PATH` 上。装它对应的运行时即可。

### 2. 守护进程没在跑

```
[daemon] docker installed but not running (no socket / probe failed)
```

命令存在（Docker 装了），但守护进程没起来。启动 Docker Desktop 即可。

### 3. 依赖对方宿主的运行时变量

```
[env] depends on CODEX_MCP_NODE_PATH (other-harness runtime), not available in DSH
```

这是**结构性不兼容**，不是配置问题。`CODEX_*` / `CLAUDE_*` 这些变量由对方宿主在自己进程里注入，DSH 进程里根本不存在。这类服务器**在 DSH 里永远起不来**，除非原作者改成不依赖它们。

### 4. 缺密钥

```
[secret] missing credential: TFE_TOKEN
```

把该环境变量设上，或（GitHub 家族）存进 macOS 钥匙串，即可自动升级为可用。

### 5. OAuth 无对应

```
oauth_resource present (https://mcp.figma.com/mcp) — DSH has no equivalent, dropped
```

对方支持一套 OAuth 资源声明流程，DSH 没有对应实现。**该服务器会以未授权状态注册**，需要令牌的调用会失败。

### 6. 平台专有变量

```
[env] platform-specific var USERPROFILE may not exist on darwin
```

明显是 Windows 专有的变量出现在 macOS 上，通常意味着该服务器只支持 Windows。

## 为什么"无缝兼容"做不到

需要说清楚：DSH 的抽象面与外部生态**不是一一对应的**。

- **技能 / 命令 / MCP 声明**是"同一件事的不同方言"，可以真正做成通用抽象。
- **Hooks** 是不同的事情：DSH 只有 7 个拦截点、且只支持 command handler；对方可能有 33 个事件、5 种 handler。这是**翻译 + 降级**，不是等价替换。
- **子代理**在 DSH 里是随 agent preset 走的提示词模板，**没有运行时注册接口**，因此只能降级。
- **插件 UI** 是对方渲染层的私有实现，只能重写。

所以本项目的定位是：**把可移植的部分做扎实，把不可移植的部分诚实标注**——而不是宣称"兼容绝大多数插件"。

## 实测样本

在一台同时装了 Claude Code 与 Codex 生态插件的 macOS 机器上（28 个 `.mcp.json`）：

| 指标 | 值 |
|---|---|
| 文件 / 服务器 | 28 / 28 |
| 方言分布 | bare 14 · wrapped 14 |
| 传输类型 | stdio 17 · streamable-http 11 |
| 可用 | 14 |
| 需密钥 | 5 |
| 不可用 | 9 |
| 解析失败 | 0 |

其中「可用」从最初的 10 提升到 14，是因为**密钥解析**把 GitHub token 家族从钥匙串里解析了出来——这正是"像原生工具一样免配置"的那部分体验。
