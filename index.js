/**
 * dsh-babel — Host-only bundle entry.
 *
 * Discovers external-harness plugin declarations (Claude Code, Codex, and
 * project .mcp.json) and lowers them to one intermediate representation, then
 * preflights them against the DSH environment and reports exactly what can
 * run, what needs a credential, and what cannot run at all.
 *
 * Registration is opt-in and gated behind `dryRun: false`:
 *   - `registerCommands: true`  -> registers valid slash commands
 *   - `registerMcp: true`       -> registers preflight-clean (ok) MCP servers
 */

import { discoverMCP, discoverCommands, resolveRoots } from "./lib/discover.mjs";
import { normalizeFile } from "./lib/normalize.mjs";
import { normalizeCommand } from "./lib/commands.mjs";
import { summarize, summarizeCommands, renderText } from "./lib/report.mjs";
import { registerCommands } from "./lib/register.mjs";
import { registerMcpServer } from "./lib/register-mcp.mjs";
import { preflightServer } from "./lib/preflight.mjs";
import { materializeServer } from "./lib/secrets.mjs";

export const name = "dsh-babel";
export const inject = ["commands", "tools"];

/** Config schema — kept simple and self-describing for Config.listConfigs. */
export const Config = {
  roots: {
    type: "array",
    items: { oneOf: [{ type: "string" }, { type: "object", properties: { source: { type: "string" }, path: { type: "string" } }, required: ["path"] }] },
    default: [],
  },
  dryRun: { type: "boolean", default: true },
  logReport: { type: "boolean", default: true },
  registerCommands: { type: "boolean", default: false },
  registerMcp: { type: "boolean", default: false },
};

/** Core pipeline shared by the plugin and the CLI runner. */
export function run(config = {}) {
  const roots = resolveRoots(config);
  const files = discoverMCP(roots).map((f) => normalizeFile(f.path, f.source));
  const report = summarize(files);
  const commands = discoverCommands(roots).map((f) => normalizeCommand(f.path, f.source));
  const commandSummary = summarizeCommands(commands);
  const servers = files.flatMap((f) => (f.error ? [] : f.servers)).map((ir) => ({ ir, verdict: preflightServer(ir) }));
  return { roots, report, commandSummary, servers, text: renderText(report, commandSummary) };
}

export async function apply(ctx, config = {}) {
  const dryRun = config.dryRun !== false;
  const logReport = config.logReport !== false;
  const registerCmd = config.registerCommands === true && !dryRun;
  const registerMcp = config.registerMcp === true && !dryRun;

  const result = run(config);
  ctx.root.dshBabel = { ...result, dryRun, generatedAt: new Date().toISOString() };
  if (logReport) ctx.logger?.info?.("dsh-babel:\n" + result.text);

  // Async MCP registration runs before the lifecycle effect so failures are
  // contained per server and the disposers are available for cleanup.
  const mcpRegistrations = [];
  if (registerMcp) {
    for (const { ir } of result.servers) {
      // Resolve secrets (env, then whitelisted keychain) before deciding.
      const materialized = materializeServer(ir);
      const verdict = preflightServer(materialized);
      if (verdict.severity !== "ok") continue;
      try {
        const r = await registerMcpServer(ctx, materialized);
        mcpRegistrations.push(r);
        const note = materialized.resolvedSecrets.length
          ? ` (resolved: ${materialized.resolvedSecrets.map((s) => s.envVar).join(", ")})`
          : "";
        ctx.logger?.info?.(`dsh-babel: MCP ${ir.name} registered (${r.toolCount} tools)${note}`);
      } catch (e) {
        ctx.logger?.warn?.(`dsh-babel: MCP ${ir.name} failed: ${e.message ?? e}`);
      }
    }
  }

  ctx.effect(() => {
    let disposeCommands = () => {};
    if (registerCmd) {
      const r = registerCommands(ctx, result.commandSummary.commands);
      disposeCommands = r.dispose;
      ctx.logger?.info?.(`dsh-babel: registered ${r.names.length} commands${r.skipped.length ? ` (skipped ${r.skipped.length}: ${r.skipped.join(", ")})` : ""}`);
    }
    if (dryRun) {
      ctx.logger?.info?.("dsh-babel: dryRun=true — discovered and preflighted only; nothing registered");
    }

    return () => {
      disposeCommands();
      for (const m of mcpRegistrations) m.dispose();
      if (ctx.root.dshBabel) delete ctx.root.dshBabel;
    };
  }, "dsh-babel.discovery");
}
