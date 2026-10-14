# 配置参考

配置项以 **schemastery schema** 声明（见 `index.js` 的 `Config` 导出），因此：

- DSH 的 `Config.listConfigs` 能报告它；
- **设置 → 插件 → dsh-babel** 能渲染成可编辑的配置界面；
- 激活前 cordis 会调用 `Config['~standard'].validate(config)` 做校验并补默认值。

> ⚠️ `Config` **必须**保持为 schemastery schema。早期版本曾把它写成普通对象，结果被 cordis 误当成 schema，导致激活时报 `Cannot read properties of undefined (reading 'validate')`。不要改回普通对象。

## 配置项

### `roots`

- 类型：`array< string | { source: string, path: string } >`
- 默认：`[]`

要扫描的根目录。留空时使用默认根：

| 默认根 | `source` 标记 |
|---|---|
| `~/.claude/plugins` | `claude` |
| `~/.codex/plugins` | `codex` |

自定义示例：

```yaml
config:
  roots:
    - /Users/me/work/acme-plugins          # 字符串：source 记为 generic
    - source: claude                        # 对象：显式指定 source
      path: /Users/me/other-claude-plugins
```

### `dryRun`

- 类型：`boolean`
- 默认：`true`

`true` 时**只发现、只预检、只报告**，不注册任何东西。

任何注册动作都要求 `dryRun: false`——这是刻意的安全默认值：装上一个陌生插件时，先看到报告再决定是否打开注册。

### `logReport`

- 类型：`boolean`
- 默认：`true`

是否把兼容性报告打印到 DSH 日志。关掉它可以减少日志噪音，但报告仍可通过 CLI runner 查看。

### `registerCommands`

- 类型：`boolean`
- 默认：`false`

注册发现到的斜杠命令。**需要 `dryRun: false`。**

只注册同时满足以下条件的命令：

- 名字匹配 `/^[a-z][a-z0-9_-]*$/`
- `description` 非空
- `prompt` 非空

被跳过的命令会记录在日志里（例如 Codex 的内部命令 `_conventions` 因下划线前缀不合法而被拒绝）。

### `registerMcp`

- 类型：`boolean`
- 默认：`false`

注册预检结果 `severity: ok` 的 MCP 服务器。**需要 `dryRun: false`。**

注册前会先做**密钥解析**（env → 钥匙串白名单），再**重新预检**一次；只有仍然 `ok` 的才会连。因此一个"只差 GitHub token"的服务器，在你已把 token 存进钥匙串的情况下会被自动升级为可用。

`warn`（还缺密钥）与 `blocked`（缺命令 / 守护进程没跑 / 依赖对方宿主变量）的一律**不注册**，只保留在报告里。

## 完整示例

```yaml
# cordis.patch.yml
- insert:
    - id: dsh-babel
      name: 'dsh-babel'
      config:
        roots: []
        dryRun: false
        logReport: true
        registerCommands: true
        registerMcp: true
```

## 常见问题

**装完什么都没发生？**
默认 `dryRun: true`，这是预期行为——去日志看兼容性报告。

**改了配置不生效？**
已安装插件的 JS 模块不会热刷新。配置变更会走 HMR，但如果改动涉及插件代码（而非配置），需要重启 DSH。

**`registerMcp` 开了但只注册了少数几个？**
预期行为：只有 `severity: ok` 的才注册。其余的看报告里的具体原因——通常是要么缺密钥，要么依赖 `CODEX_*` / `CLAUDE_*` 这类 DSH 不存在的变量。
