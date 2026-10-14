<div align="center">

# dsh-babel

**Use MCP servers, plugins and slash commands from other AI coding harnesses inside the DeepSeek Harness.**

> By reading their existing configuration, instead of asking every plugin author to port to DSH.

[![简体中文](https://img.shields.io/badge/lang-%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87-red.svg)](README.md) [![English](https://img.shields.io/badge/lang-English-blue.svg)](README.en.md)

[![test](https://github.com/Oliveryfaso/dsh-babel/actions/workflows/test.yml/badge.svg)](https://github.com/Oliveryfaso/dsh-babel/actions/workflows/test.yml)
[![license](https://img.shields.io/badge/license-MIT-2EA44F?style=flat)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/Oliveryfaso/dsh-babel?style=flat&label=%E2%98%85)](https://github.com/Oliveryfaso/dsh-babel)
[![DSH plugin](https://img.shields.io/badge/DSH-plugin-0f766e.svg)](https://github.com/Oliveryfaso/dsh-babel)
[![dsh-plugin topic](https://img.shields.io/badge/topic-dsh--plugin-2563eb.svg)](https://github.com/topics/dsh-plugin)

</div>

> dsh-babel is a community-maintained DeepSeek Harness (DSH) plugin. It is not an official DeepSeek AI product.

## The problem it solves

Supporting a platform means writing a directory for it. A typical multi-harness plugin ships six to eight of them:

```
.claude-plugin  .codex-plugin  .cursor  .gemini-extension.json  ...
```

DSH's slot is usually empty. dsh-babel inverts the direction: **their authors change nothing; DSH reads the `.mcp.json` and `commands/` they already ship.** That turns an N×M porting problem into N×1.

It also does something nobody else does: **it tells you before you install which servers can run, which need a key, and which cannot run at all** — instead of failing silently afterwards.

## Features

- **Discovery** of `.mcp.json` under Claude Code and Codex plugin roots, plus both slash-command formats (`.md` / `.toml`). Roots are configurable.
- **Normalization** of the `.mcp.json` dialects found in the wild (wrapped `mcpServers`, bare top-level, Codex-specific keys) into **one intermediate representation**.
- **Preflight** — four checks that turn silent failures into named reasons: command availability on `PATH`, daemon health (e.g. the Docker socket), credential availability, and unpinned-version drift.
- **Compatibility report** grouping every server as available / needs-a-key / cannot-run, each with its concrete reason.
- **Command registration** into DSH with `{{args}}` / `$ARGUMENTS` / `$1` substitution.
- **MCP registration** over stdio or streamable-http, using DSH's own `createMcpToolDefinition`.
- **Secret resolution**: `process.env` first, then a curated macOS keychain **whitelist** (the GitHub token family only) — never a blanket keychain sweep.
- **Display metadata**: `locale/` text and an icon; config options are declared as a schemastery schema so Settings can render them.

## Install

```bash
# from GitHub
plugin_manager install_bundle github:Oliveryfaso/dsh-babel
# or from a local directory
plugin_manager install_bundle /absolute/path/dsh-babel
```

You can also use **Settings → Plugins → Add plugin** in DSH Desktop and paste the repository URL or local path.

It installs in **dry-run**: the compatibility report is printed to the log and **nothing is registered**.

## Configuration

Options are declared as a schemastery schema, so they appear under **Settings → Plugins → dsh-babel**:

| Option | Default | Meaning |
|---|---|---|
| `roots` | `[]` | Roots to scan; string paths or `{ source, path }`. Defaults to the Claude / Codex plugin directories when empty |
| `dryRun` | `true` | Report only. Must be `false` before anything can be registered |
| `logReport` | `true` | Print the compatibility report to the log |
| `registerCommands` | `false` | Register discovered slash commands (requires `dryRun: false`) |
| `registerMcp` | `false` | Register preflight-clean (`severity: ok`) MCP servers (requires `dryRun: false`) |

Enabling real registration:

```yaml
config:
  dryRun: false
  registerCommands: true
  registerMcp: true
```

## Compatibility matrix (the honest one)

| External form | Coverage | Notes |
|---|---|---|
| MCP `.mcp.json` (stdio) | ✅ High | Keyless servers whose command exists usually work |
| MCP `.mcp.json` (http/sse) | ✅ High | Bearer-token servers are reported as needing a key |
| MCP depending on host-runtime vars | ⚠️ Lossy | `CODEX_*` / `CLAUDE_*` injected by the other harness do not exist in DSH — reported as unavailable |
| MCP with OAuth | ❌ No equivalent | `oauth_resource` has no DSH counterpart; dropped and reported |
| Skills `skills/*/SKILL.md` | ✅ High | A shared format (already covered by skills-manager and similar) |
| Slash commands `commands/*` | ✅ Implemented | Discovery + normalization + report + registration |
| Hooks | ⚠️ Lossy | DSH exposes 7 points, command handlers only |
| Subagents `agents/*` | ⚠️ Degraded | DSH has no registration seam; can only be lowered to skills |
| Plugin UI / mods | ❌ Unsupported | Must be rewritten as a DSH client plugin |

## What the report looks like

On a machine with Claude Code and Codex plugins installed, first load prints:

```
=== dsh-babel compatibility report ===
files: 28   servers: 28
conclusion: available 14  /  needs-key 5  /  unavailable 9

x unavailable (9):
  laravel-boost  [stdio]  BLOCKED
      - [command] command not on PATH: php
  terraform  [stdio]  BLOCKED
      - [daemon] docker installed but not running (no socket / probe failed)
      - [secret] missing credential: TFE_TOKEN
  codex_app  [stdio]  BLOCKED
      - [env] depends on CODEX_MCP_NODE_PATH (other-harness runtime), not available in DSH
```

That is the plugin's second value: **it tells you why something will not run**, instead of leaving you to conclude that "DSH is broken".

## Layout

```
index.js              plugin entry (apply + schemastery Config, Cordis host-plugin form)
cordis.patch.yml      bundle patch (inserts the dsh-babel row)
locale/               card display text (title + description)
icon.svg              plugin icon
lib/normalize.mjs     kernel: dialects -> IR
lib/discover.mjs      discovery: walk the filesystem for declarations
lib/preflight.mjs     preflight: command / daemon / credential / version
lib/secrets.mjs       secret resolution: env first, whitelisted keychain fallback
lib/commands.mjs      command normalization: .md / .toml -> command IR
lib/register.mjs      command registration: ctx.commands.register + arg substitution
lib/register-mcp.mjs  MCP registration: connect + createMcpToolDefinition + register
lib/report.mjs        report: aggregate + render
bin/dsh-babel.mjs     CLI runner (for local testing)
test/                 unit tests + smoke tests
docs/                 detailed documentation
CHANGELOG.md          release history
```

## Development

```bash
npm test                  # all unit tests (75 assertions)
node test/mcp-smoke.mjs   # MCP registration smoke test (needs local symlinks + a real server)
node bin/dsh-babel.mjs    # run the report once
```

## Documentation

- [Features](docs/FEATURES.md)
- [Configuration](docs/CONFIG.md)
- [Compatibility](docs/COMPATIBILITY.md)
- [Architecture and the IR](docs/ARCHITECTURE.md)
- [Changelog](CHANGELOG.md)

## License

[MIT](LICENSE)
