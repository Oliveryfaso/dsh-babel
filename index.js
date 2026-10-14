/**
 * dsh-babel — Host-only bundle entry.
 *
 * Discovers external-harness plugin declarations (Claude Code, Codex, and
 * project .mcp.json) and lowers them to one intermediate representation, then
 * preflights them against the DSH environment and reports exactly what can
 * run, what needs a credential, and what cannot run at all.
 *
 * v0.2 adds command registration behind `registerCommands: true` (dryRun=false).
 * MCP registration follows once the dependency surface is verified at install.
 */

import { discoverMCP, discoverCommands, resolveRoots } from "./lib/discover.mjs";
import { normalizeFile } from "./lib/normalize.mjs";
import { normalizeCommand } from "./lib/commands.mjs";
import { summarize, summarizeCommands, renderText } from "./lib/report.mjs";
import { registerCommands } from "./lib/register.mjs";

export const name = "dsh-babel";
export const inject = ["commands"];

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
};

/** Core pipeline shared by the plugin and the CLI runner. */
export function run(config = {}) {
  const roots = resolveRoots(config);
  const files = discoverMCP(roots).map((f) => normalizeFile(f.path, f.source));
  const report = summarize(files);
  const commands = discoverCommands(roots).map((f) => normalizeCommand(f.path, f.source));
  const commandSummary = summarizeCommands(commands);
  return { roots, report, commandSummary, text: renderText(report, commandSummary) };
}

export function apply(ctx, config = {}) {
  const dryRun = config.dryRun !== false;
  const logReport = config.logReport !== false;

  ctx.effect(() => {
    const result = run(config);
    // Publish the report for inspection (`cordis_inspect_query`).
    ctx.root.dshBabel = { ...result, dryRun, generatedAt: new Date().toISOString() };
    if (logReport) ctx.logger?.info?.("dsh-babel:\n" + result.text);

    let disposeCommands = () => {};
    const registerCmd = config.registerCommands === true && !dryRun;
    if (registerCmd) {
      const r = registerCommands(ctx, result.commandSummary.commands);
      disposeCommands = r.dispose;
      ctx.logger?.info?.(`dsh-babel: registered ${r.names.length} commands${r.skipped.length ? ` (skipped ${r.skipped.length}: ${r.skipped.join(", ")})` : ""}`);
    } else if (dryRun) {
      ctx.logger?.info?.("dsh-babel: dryRun=true — discovered and preflighted only; nothing registered");
    }

    return () => {
      disposeCommands();
      if (ctx.root.dshBabel) delete ctx.root.dshBabel;
    };
  }, "dsh-babel.discovery");
}
