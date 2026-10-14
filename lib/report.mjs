/**
 * Report — turn discovery + preflight into a readable compatibility report.
 *
 * Two outputs:
 *   summarize(files, verdicts)  -> machine-readable object
 *   renderText(report)          -> human-readable text for logs / CLI
 */

import { preflightServer } from "./preflight.mjs";

/** Aggregate a list of normalized files + preflight verdicts into a report. */
export function summarize(normalizedFiles) {
  const servers = [];
  const bySeverity = { ok: 0, warn: 0, blocked: 0 };
  const byTransport = {};
  const byDialect = {};
  let total = 0;

  for (const f of normalizedFiles) {
    byDialect[f.dialect] = (byDialect[f.dialect] ?? 0) + 1;
    if (f.error) continue;
    for (const s of f.servers) {
      total++;
      byTransport[s.transport ?? "unknown"] = (byTransport[s.transport ?? "unknown"] ?? 0) + 1;
      servers.push(s);
    }
  }

  // preflight verdicts
  const verdicts = [];
  for (const s of servers) {
    const v = preflightServer(s);
    bySeverity[v.severity]++;
    verdicts.push(v);
  }

  return {
    irVersion: 1,
    files: normalizedFiles.length,
    total,
    byDialect,
    byTransport,
    bySeverity,
    servers: verdicts,
  };
}

/** Render a text report for humans. */
export function renderText(report) {
  const L = [];
  L.push("=== dsh-babel 兼容性报告 ===");
  L.push(`文件: ${report.files}   服务器: ${report.total}`);
  L.push(`方言: ${JSON.stringify(report.byDialect)}`);
  L.push(`传输: ${JSON.stringify(report.byTransport)}`);
  L.push(`结论: 可用 ${report.bySeverity.ok}  /  需密钥 ${report.bySeverity.warn}  /  不可用 ${report.bySeverity.blocked}`);
  L.push("");
  const grouped = { blocked: [], warn: [], ok: [] };
  for (const v of report.servers) grouped[v.severity].push(v);
  const renderOne = (v) => {
    L.push(`  ${v.name}  [${v.transport ?? "?"}]  ${v.severity.toUpperCase()}`);
    for (const i of v.issues) L.push(`      - [${i.check}] ${i.detail}`);
  };
  for (const key of ["blocked", "warn", "ok"]) {
    if (grouped[key].length === 0) continue;
    const label = { blocked: "✗ 不可用", warn: "⚠ 需注意", ok: "✓ 可用" }[key];
    L.push(`\n${label} (${grouped[key].length}):`);
    for (const v of grouped[key]) renderOne(v);
  }
  return L.join("\n");
}
