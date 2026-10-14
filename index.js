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
import z from "@deepseek-ai/schemastery";

export const name = "dsh-babel";
export const inject = ["commands", "tools"];

/**
 * Config schema — declared with schemastery so `Config.listConfigs` reports it
 * and the Settings UI can render these options. A plain object would be
 * mistaken by cordis for a schema and fail activation, so this MUST stay a
 * schemastery schema (it exposes `~standard.validate`, which cordis calls).
 *
 *   roots            roots to scan; strings or { source, path } objects
 *   dryRun           report only, register nothing (default true)
 *   logReport        print the compatibility report to the log (default true)
 *   registerCommands register discovered slash commands (needs dryRun: false)
 *   registerMcp      register preflight-clean MCP servers (needs dryRun: false)
 */
export const Config = z.object({
  roots: z
    .array(z.union([z.string(), z.object({ source: z.string().default("generic"), path: z.string().required() })]))
    .default([]),
  dryRun: z.boolean().default(true),
  logReport: z.boolean().default(true),
  registerCommands: z.boolean().default(false),
  registerMcp: z.boolean().default(false),
});

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
    };
  }, "dsh-babel.discovery");
}
