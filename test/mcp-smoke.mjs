/**
 * MCP registration smoke test — connect a real stdio server (playwright) and
 * register its tools against a mock ctx, exercising lib/register-mcp.mjs
 * end-to-end. Requires the local node_modules symlinks to DSH's packages.
 *
 *   node test/mcp-smoke.mjs
 */
import { registerMcpServer, publicToolName } from "../lib/register-mcp.mjs";
import { homedir } from "node:os";
import { join } from "node:path";

const playwrightCli = join(homedir(), ".dsh/mcp/playwright/node_modules/@playwright/mcp/cli.js");

const ir = {
  name: "playwright",
  transport: "stdio",
  command: "/opt/homebrew/bin/node",
  args: [playwrightCli, "--headless"],
  env: {},
  cwd: null,
  toolCallTimeoutMs: null,
};

// Mock ctx: tools.register collector + logger
const registered = [];
const ctx = {
  tools: { register: (d) => { registered.push(d); return () => registered.splice(registered.indexOf(d), 1); } },
  logger: { info: (m) => console.log("  [info]", m), warn: () => {}, error: () => {} },
};

let pass = 0, fail = 0;
function ok(cond, label) { if (cond) { pass++; } else { fail++; console.log(`  ✗ FAIL: ${label}`); } }

// publicToolName
ok(publicToolName("playwright", "browser_click") === "mcp__playwright__browser_click", "public tool name");
ok(publicToolName("a b", "c d") === "mcp__a_b__c_d", "invalid chars normalized");

// connect + register
console.log("连接 playwright stdio 服务器并注册工具…");
let result;
try {
  result = await registerMcpServer(ctx, ir);
} catch (e) {
  console.log("  连接/注册失败:", e.message);
  process.exit(1);
}

ok(result.toolCount > 0, `registered toolCount=${result.toolCount} > 0`);
ok(registered.length === result.toolCount, "registered === toolCount");
ok(registered[0].name.startsWith("mcp__playwright__"), "definition name uses mcp__playwright__ prefix");
ok(typeof registered[0].description === "string", "definition has description");
ok(typeof registered[0].execute === "function", "definition has execute function");
ok(registered[0].parameters !== undefined, "definition has parameters (inputSchema)");
console.log(`  注册了 ${result.toolCount} 个工具，示例: ${registered.slice(0, 4).map((d) => d.name).join(", ")}…`);

// dispose
result.dispose();
ok(registered.length === 0, "dispose unregisters tools + closes transport");

console.log(`\n通过 ${pass}  失败 ${fail}`);
if (fail > 0) process.exit(1);
