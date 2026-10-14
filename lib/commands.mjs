/**
 * Command normalizer — parse slash-command files from other harnesses into a
 * common command IR. Zero-dependency, flat-line parsers only (the command
 * files observed in the wild are flat: `key: value` / `key = "value"`).
 *
 * Formats:
 *   A. Claude Code  `.claude/commands/<name>.md` or plugin `commands/*.md`
 *        — YAML frontmatter (description, allowed-tools, disable-model-invocation)
 *          + markdown body = prompt
 *   B. Codex        `commands/<name>.toml`
 *        — flat TOML (description = "...", prompt = "...")
 */

import { readFileSync } from "node:fs";
import { basename } from "node:path";

/** DSH command-name grammar (dsh-commands): /^[a-z][a-z0-9_-]*$/. */
export const COMMAND_NAME = /^[a-z][a-z0-9_-]*$/;

/** Empty command IR. */
export function emptyCommand() {
  return {
    name: null,
    description: null,
    prompt: null,
    arguments: null,       // detected argument placeholder ("args", "$1", …)
    allowedTools: null,    // list of tool names (Claude only)
    disableModelInvocation: null,
    source: null,
    file: null,
    warnings: [],
  };
}

/** Extract flat `key: value` YAML frontmatter; returns a string map. */
export function parseFrontmatter(text) {
  const m = /^---\s*\n([\s\S]*?)\n---\s*\n?/.exec(text);
  if (!m) return { frontmatter: {}, body: text.trim() };
  const map = {};
  for (const line of m[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key && value) map[key] = value.replace(/^["']|["']$/g, "");
  }
  return { frontmatter: map, body: text.slice(m[0].length).trim() };
}

/** Parse flat `key = "value"` TOML; returns a string map (best-effort). */
export function parseToml(text) {
  const map = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, "\n").replace(/\\\\/g, "\\");
    }
    if (key) map[key] = value;
  }
  return map;
}

/** Detect an argument placeholder, returning its token or null. */
export function detectArguments(prompt) {
  const m = /\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}|\$ARGUMENTS|\$1\b/.exec(prompt ?? "");
  return m ? (m[1] ?? m[0]) : null;
}

/** Normalize a Claude Code `.md` command file. */
export function normalizeClaudeCommand(file, source = "claude") {
  const ir = emptyCommand();
  ir.file = file;
  ir.source = source;
  const raw = readFileSync(file, "utf8");
  const { frontmatter, body } = parseFrontmatter(raw);
  ir.name = basename(file).replace(/\.md$/, "");
  ir.description = frontmatter.description ?? null;
  ir.prompt = body || null;
  if (frontmatter["allowed-tools"]) {
    ir.allowedTools = frontmatter["allowed-tools"]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (frontmatter["disable-model-invocation"] === "true") ir.disableModelInvocation = true;
  else if (frontmatter["disable-model-invocation"] === "false") ir.disableModelInvocation = false;

  if (!COMMAND_NAME.test(ir.name)) ir.warnings.push(`command name "${ir.name}" is not DSH-valid (must match /^[a-z][a-z0-9_-]*$/)`);
  if (!ir.description) ir.warnings.push("missing description");
  if (!ir.prompt) ir.warnings.push("empty prompt body");
  ir.arguments = detectArguments(ir.prompt);
  return ir;
}

/** Normalize a Codex `.toml` command file. */
export function normalizeCodexCommand(file, source = "codex") {
  const ir = emptyCommand();
  ir.file = file;
  ir.source = source;
  const map = parseToml(readFileSync(file, "utf8"));
  ir.name = basename(file).replace(/\.toml$/, "");
  ir.description = map.description ?? null;
  ir.prompt = map.prompt ?? null;

  if (!COMMAND_NAME.test(ir.name)) ir.warnings.push(`command name "${ir.name}" is not DSH-valid (must match /^[a-z][a-z0-9_-]*$/)`);
  if (!ir.description) ir.warnings.push("missing description");
  if (!ir.prompt) ir.warnings.push("missing prompt");
  ir.arguments = detectArguments(ir.prompt);
  return ir;
}

/** Normalize any command file, dispatching on extension. */
export function normalizeCommand(file, source = "generic") {
  try {
    if (file.endsWith(".md")) return normalizeClaudeCommand(file, source);
    if (file.endsWith(".toml")) return normalizeCodexCommand(file, source);
    return { ...emptyCommand(), file, source, warnings: ["unsupported extension"] };
  } catch (e) {
    return { ...emptyCommand(), file, source, warnings: [`parse error: ${e.message ?? e}`] };
  }
}
