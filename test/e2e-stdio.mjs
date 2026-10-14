/**
 * End-to-end proof: take an IR server derived from an EXTERNAL .mcp.json and
 * actually connect to it with DSH's own MCP client, then list its tools.
 *
 * Uses only secret-free stdio samples (npx/docker/uvx based).
 */
import { Client } from "/Applications/DSH Desktop.app/Contents/Resources/app/node_modules/@modelcontextprotocol/client/dist/index.mjs";
import { StdioClientTransport } from "/Applications/DSH Desktop.app/Contents/Resources/app/node_modules/@modelcontextprotocol/client/dist/stdio.mjs";
import { normalizeFile } from "../lib/normalize.mjs";
import { homedir } from "node:os";
import { join } from "node:path";

// Real external files on this machine, chosen because they need no secrets.
const candidates = [
  ["claude/terraform", join(homedir(), ".claude/plugins/marketplaces/claude-plugins-official/external_plugins/terraform/.mcp.json")],
  ["claude/serena",    join(homedir(), ".claude/plugins/marketplaces/claude-plugins-official/external_plugins/serena/.mcp.json")],
  ["claude/playwright",join(homedir(), ".claude/plugins/marketplaces/claude-plugins-official/external_plugins/playwright/.mcp.json")],
];

for (const [label, file] of candidates) {
  const r = normalizeFile(file);
  const s = r.servers[0];
  if (!s) { console.log(`\n### ${label}: 无服务器条目`); continue; }
  console.log(`\n### ${label}  (dialect=${r.dialect})`);
  console.log(`    IR: transport=${s.transport} command=${s.command} args=${JSON.stringify(s.args).slice(0,90)}`);
  if (s.transport !== "stdio") { console.log("    跳过：非 stdio"); continue; }

  const rec = {};
  try {
    const t = new StdioClientTransport({ command: s.command, args: s.args, env: { PATH: process.env.PATH } });
    const c = new Client({ name: "interop-e2e", version: "1.0.0" }, { capabilities: {} });
    const t0 = Date.now();
    await c.connect(t);
    rec.connected = true;
    rec.server = c.getServerVersion()?.name ?? null;
    const l = await c.listTools(undefined, { cacheMode: "refresh" });
    rec.toolCount = l.tools.length;
    rec.ms = Date.now() - t0;
    rec.sample = l.tools.slice(0, 5).map((x) => x.name);
    await t.close();
  } catch (e) {
    rec.connected = false;
    rec.error = String(e?.message ?? e).split("\n").slice(0, 3).join(" | ").slice(0, 220);
  }
  console.log("    结果:", JSON.stringify(rec, null, 2).split("\n").join("\n    "));
}
