/**
 * Secret resolver unit tests. Dependency-free; `node test/secrets.test.mjs`.
 * The keychain case is macOS-only and soft (skips cleanly elsewhere).
 */
import { substitute, resolveSecret, materializeServer } from "../lib/secrets.mjs";

let pass = 0, fail = 0;
function ok(cond, label) { if (cond) pass++; else { fail++; console.log(`  ✗ FAIL: ${label}`); } }

// --- substitute ---
ok(substitute("Bearer ${X}", new Map([["X", "abc"]])) === "Bearer abc", "substitute simple");
ok(substitute("${Y:-fallback}", new Map()) === "fallback", "substitute fallback");
ok(substitute("no refs", new Map()) === "no refs", "no refs untouched");

// --- resolveSecret: env source ---
process.env.DSH_BABEL_TEST_TOKEN = "testsecret";
const envRes = resolveSecret("DSH_BABEL_TEST_TOKEN");
ok(envRes !== null && envRes.value === "testsecret" && envRes.source === "env", "resolveSecret env source");
delete process.env.DSH_BABEL_TEST_TOKEN;

// --- resolveSecret: non-whitelisted, absent -> null ---
ok(resolveSecret("DEFINITELY_NOT_SET_ANYWHERE_XYZ") === null, "absent non-whitelisted -> null");

// --- resolveSecret: keychain (macOS only, real github.com entry) ---
if (process.platform === "darwin") {
  const gh = resolveSecret("GITHUB_TOKEN");
  ok(gh !== null && gh.source === "keychain" && gh.value.length > 0, "GitHub token resolvable from keychain (macOS)");
} else {
  console.log("  (非 macOS，跳过钥匙串用例)");
}

// --- materializeServer: substitute header from env ---
process.env.DSH_BABEL_TEST_TOKEN = "tok_123";
const ir = {
  name: "s", transport: "streamable-http", url: "https://mcp.example.com",
  headers: { Authorization: "Bearer ${DSH_BABEL_TEST_TOKEN}" },
  env: {}, args: [], unresolved: [{ kind: "header", header: "Authorization", envVar: "DSH_BABEL_TEST_TOKEN", fallback: null }],
};
const m = materializeServer(ir);
ok(m.headers.Authorization === "Bearer tok_123", "header substituted");
ok(m.resolvedSecrets.length === 1 && m.resolvedSecrets[0].source === "env", "resolved tracked");
ok(m.missingSecrets.length === 0, "nothing missing");
delete process.env.DSH_BABEL_TEST_TOKEN;

// --- materializeServer: unresolved stays, flagged missing ---
const ir2 = { name: "s2", headers: { Authorization: "Bearer ${NOPE_NOPE_NOPE}" }, env: {}, args: [], unresolved: [{ kind: "header", header: "Authorization", envVar: "NOPE_NOPE_NOPE", fallback: null }] };
const m2 = materializeServer(ir2);
ok(m2.missingSecrets.length === 1, "unresolved secret flagged missing");

console.log(`\n通过 ${pass}  失败 ${fail}`);
if (fail > 0) process.exit(1);
