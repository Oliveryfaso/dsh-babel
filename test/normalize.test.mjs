/**
 * Kernel unit tests — normalize dialects + preflight classification.
 * Dependency-free; run with `node test/normalize.test.mjs`.
 */
import { normalizeServer, extractServers, envRefs } from "../lib/normalize.mjs";
import { classifyEnvRef, preflightServer } from "../lib/preflight.mjs";

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; }
  else { fail++; console.log(`  ✗ FAIL: ${label}`); }
}

// --- dialect extraction ---
const wrapped = extractServers({ mcpServers: { a: { command: "x" } } });
ok(wrapped.dialect === "wrapped", "wrapped dialect");
ok(wrapped.servers.a.command === "x", "wrapped server extracted");

const bare = extractServers({ a: { command: "x" }, b: { url: "https://e" } });
ok(bare.dialect === "bare", "bare dialect");
ok(Object.keys(bare.servers).length === 2, "bare servers extracted");

const unknown = extractServers({ foo: "bar" });
ok(unknown.dialect === "unknown", "non-mcp json -> unknown");

// --- transport inference ---
ok(normalizeServer("s1", { command: "npx", args: ["-y", "x"] }).transport === "stdio", "command -> stdio");
ok(normalizeServer("s2", { url: "https://mcp.example.com" }).transport === "streamable-http", "url -> http");
ok(normalizeServer("s3", { type: "sse", url: "https://x" }).transport === "streamable-http", "sse -> http");
ok(normalizeServer("s4", {}).warnings.length > 0, "no transport -> warning");

// --- codex flavour ---
const codex = normalizeServer("cx", { command: "node", args: ["s.js"], bearer_token_env_var: "GH_TOKEN", tool_timeout_s: 30, env_vars: ["A", "B"], enabled_tools: ["t1"] });
ok(codex.headers.Authorization === "Bearer ${GH_TOKEN}", "bearer_token_env_var -> Authorization header");
ok(codex.toolCallTimeoutMs === 30000, "tool_timeout_s -> ms");
ok(codex.env.A === "${A}" && codex.env.B === "${B}", "env_vars list -> env map");
ok(codex.enabledTools.length === 1, "enabled_tools carried");

// --- env refs ---
ok(envRefs("Bearer ${X}").length === 1 && envRefs("Bearer ${X}")[0].name === "X", "envRefs single");
ok(envRefs("${Y:-default}")[0].fallback === "default", "envRefs fallback");
ok(envRefs("no vars").length === 0, "envRefs none");

// --- classification order (the regression we fixed) ---
ok(classifyEnvRef("CODEX_API_KEY") === "secret", "CODEX_API_KEY is a secret, not host-runtime");
ok(classifyEnvRef("CODEX_HOME") === "host-runtime", "CODEX_HOME is host-runtime");
ok(classifyEnvRef("GITHUB_TOKEN") === "secret", "GITHUB_TOKEN is a secret");
ok(classifyEnvRef("USERPROFILE") === "platform", "USERPROFILE is platform");
ok(classifyEnvRef("PATH") === "plain", "PATH is plain");

// --- preflight verdicts ---
const okServer = normalizeServer("ok", { command: "node", args: ["-e", "1"] });
const okV = preflightServer(okServer);
ok(okV.severity === "ok", "node command available -> ok");

const missingCmd = normalizeServer("bad", { command: "definitely-not-a-real-cmd-xyz" });
ok(preflightServer(missingCmd).severity === "blocked", "missing command -> blocked");

const missingSecret = normalizeServer("sec", { command: "node", args: ["-e", "1"], env: { X: "${NONEXISTENT_TOKEN}" } });
ok(preflightServer(missingSecret).severity === "warn", "missing secret -> warn");

const drift = normalizeServer("drift", { command: "npx", args: ["@playwright/mcp@latest"] });
ok(preflightServer(drift).severity === "warn", "@latest version drift -> warn");

console.log(`\n通过 ${pass}  失败 ${fail}`);
if (fail > 0) process.exit(1);
