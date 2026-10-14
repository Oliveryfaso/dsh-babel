/**
 * Command normalizer unit tests. Dependency-free; `node test/commands.test.mjs`.
 */
import { parseFrontmatter, parseToml, detectArguments, COMMAND_NAME, normalizeClaudeCommand, normalizeCodexCommand } from "../lib/commands.mjs";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let pass = 0, fail = 0;
function ok(cond, label) { if (cond) pass++; else { fail++; console.log(`  ✗ FAIL: ${label}`); } }

// --- YAML frontmatter (Claude .md) ---
const claudeDoc = `---
description: Code review a pull request
allowed-tools: Read, Edit, Bash(gh pr view:*)
disable-model-invocation: false
---
Provide a code review for the given pull request.`;
const fm = parseFrontmatter(claudeDoc);
ok(fm.frontmatter.description === "Code review a pull request", "claude description");
ok(fm.frontmatter["allowed-tools"] === "Read, Edit, Bash(gh pr view:*)", "claude allowed-tools raw");
ok(fm.body === "Provide a code review for the given pull request.", "claude body");
ok(fm.frontmatter["disable-model-invocation"] === "false", "claude disable-model-invocation");

// --- flat TOML (Codex .toml) ---
const toml = parseToml('description = "Quick reference"\nprompt = "Switch {{args}} mode"');
ok(toml.description === "Quick reference", "toml description");
ok(toml.prompt === "Switch {{args}} mode", "toml prompt");

// --- argument detection ---
ok(detectArguments("switch {{args}} mode") === "args", "{{args}} detected");
ok(detectArguments("do $ARGUMENTS") === "$ARGUMENTS", "$ARGUMENTS detected");
ok(detectArguments("no args here") === null, "no args");

// --- name validation (DSH grammar) ---
ok(COMMAND_NAME.test("ponytail"), "ponytail valid");
ok(COMMAND_NAME.test("code-review"), "code-review valid");
ok(COMMAND_NAME.test("clean_gone"), "underscore valid per DSH grammar");
ok(!COMMAND_NAME.test("_conventions"), "_conventions invalid (must start with a-z)");
ok(!COMMAND_NAME.test("CodeReview"), "uppercase invalid");

// --- full normalization (round-trip through temp files) ---
const dir = mkdtempSync(join(tmpdir(), "dsh-babel-cmd-"));
const mdPath = join(dir, "code-review.md");
writeFileSync(mdPath, claudeDoc);
const claude = normalizeClaudeCommand(mdPath, "claude");
ok(claude.name === "code-review", "claude name from filename");
ok(claude.allowedTools.length === 3, "claude allowedTools split");
ok(claude.description !== null, "claude has description");

const tomlPath = join(dir, "ponytail.toml");
writeFileSync(tomlPath, 'description = "Switch ponytail intensity"\nprompt = "Switch to ponytail {{args}} mode."');
const codex = normalizeCodexCommand(tomlPath, "codex");
ok(codex.name === "ponytail", "codex name from filename");
ok(codex.arguments === "args", "codex arguments detected");
ok(codex.warnings.length === 0, "codex no warnings");

const badToml = join(dir, "_conventions.toml");
writeFileSync(badToml, 'prompt = "internal"');
const bad = normalizeCodexCommand(badToml, "codex");
ok(bad.warnings.some((w) => w.includes("DSH-valid")), "_conventions flagged invalid");

rmSync(dir, { recursive: true, force: true });

console.log(`\n通过 ${pass}  失败 ${fail}`);
if (fail > 0) process.exit(1);
