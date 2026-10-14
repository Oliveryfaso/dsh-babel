/**
 * dsh-babel — Host-only bundle entry.
 *
 * Discovers external-harness plugin declarations (Claude Code, Codex, and
 * project .mcp.json) and lowers them to one intermediate representation, then
 * preflights them against the DSH environment and reports exactly what can
 * run, what needs a credential, and what cannot run at all.
 *
 * v0.1 ships dry-run reporting first; tool/skill registration follows once the
 * kernel + preflight contract is proven in the wild.
 */

import { discoverMCP, resolveRoots } from "./lib/discover.mjs";
import { normalizeFile } from "./lib/normalize.mjs";
import { summarize, renderText } from "./lib/report.mjs";

export const name = "dsh-babel";
export const inject = [];

/** Config schema — kept simple and self-describing for Config.listConfigs. */
export const Config = {
  roots: {
    type: "array",
    items: { oneOf: [{ type: "string" }, { type: "object", properties: { source: { type: "string" }, path: { type: "string" } }, required: ["path"] }] },
    default: [],
  },
  dryRun: { type: "boolean", default: true },
  logReport: { type: "boolean", default: true },
};

/** Core pipeline shared by the plugin and the CLI runner. */
export function run(config = {}) {
  const roots = resolveRoots(config);
  const files = discoverMCP(roots).map((f) => normalizeFile(f.path, f.source));
  const report = summarize(files);
  return { roots, report, text: renderText(report) };
}

export function apply(ctx, config = {}) {
  const dryRun = config.dryRun !== false;
  const logReport = config.logReport !== false;

  ctx.effect(() => {
    const result = run(config);
    // Publish the report for inspection (`cordis_inspect_query`) without
    // registering any runtime resources in dry-run mode.
    ctx.root.dshBabel = { ...result, dryRun, generatedAt: new Date().toISOString() };
    if (logReport) ctx.logger?.info?.("dsh-babel:\n" + result.text);
    if (dryRun) ctx.logger?.info?.("dsh-babel: dryRun=true — discovered and preflighted only; nothing registered");
    return () => {
      if (ctx.root.dshBabel) delete ctx.root.dshBabel;
    };
  }, "dsh-babel.discovery");
}
