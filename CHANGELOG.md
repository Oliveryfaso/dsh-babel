# Changelog

All notable changes to this project are documented here.
This project adheres to [Semantic Versioning](https://semver.org/).

## [1.0.0] — 2026-10-14

First stable release. Verified loading and running inside a real DeepSeek Harness.

### Added
- **Discovery** of external-harness declarations: `.mcp.json` under Claude Code and
  Codex plugin roots (plus any user-supplied root), and slash-command files
  (`commands/*.md`, `commands/*.toml`).
- **Normalization** to one intermediate representation, covering both `.mcp.json`
  dialects (wrapped `mcpServers` and bare top-level), the Codex-specific spec keys
  (`bearer_token_env_var`, `env_vars`, `tool_timeout_s`, `enabled_tools`), and both
  command formats (Claude YAML frontmatter + body, Codex flat TOML).
- **Preflight** with four checks that turn silent failures into named reasons:
  command availability on `PATH`, daemon health (Docker socket), credential
  availability, and unpinned-version drift.
- **Compatibility report** grouping every server into available / needs-a-key /
  cannot-run, each with its concrete reason.
- **Command registration** (`ctx.commands.register`) with `{{args}}` /
  `$ARGUMENTS` / `$1` substitution.
- **MCP registration** (`ctx.tools.register` + DSH's own `createMcpToolDefinition`),
  connecting either stdio or streamable-http servers.
- **Secret resolution**: `process.env` first, then a curated macOS keychain
  whitelist for the GitHub token family — never a blanket keychain sweep.
- Display metadata (`locale/zh.json`, `locale/en.json`), an icon, and a
  schemastery `Config` schema so the Settings UI can render the options.

### Notes
- Registration is opt-in: `dryRun: true` remains the default, and nothing is
  registered unless `dryRun: false` is set together with `registerCommands`
  and/or `registerMcp`.
- Only preflight-clean (`severity: ok`) MCP servers are candidates for
  registration; everything else stays report-only.
