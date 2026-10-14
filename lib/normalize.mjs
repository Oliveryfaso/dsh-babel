/**
 * MCP declaration normalizer — the interop kernel.
 *
 * Reads the `.mcp.json` dialects found in the wild and lowers them to a single
 * intermediate representation (IR). Dependency-free and read-only.
 *
 * Dialects observed on real machines:
 *   A. wrapped        { "mcpServers": { name: spec } }
 *   B. bare           { name: spec }                      (most Claude plugins)
 *   C. codex-flavored spec keys: bearer_token_env_var, oauth_resource,
 *                     env_vars, tool_timeout_s, enabled_tools, cwd, ...
 *   D. dsh-native     streamable-http | stdio, headers, env, toolCallTimeoutMs
 *
 * Transport is frequently OMITTED and is inferred: url => http, command => stdio.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const IR_VERSION = 1;

/** Intermediate-representation server shape. */
export function emptyIR() {
  return {
    name: null,
    transport: null,      // "streamable-http" | "stdio" | null
    url: null,            // http only
    headers: {},          // http only
    command: null,        // stdio only
    args: [],             // stdio only
    env: {},              // stdio only
    cwd: null,
    toolCallTimeoutMs: null,
    enabledTools: null,
    unresolved: [],       // secrets / env references the caller must resolve
    warnings: [],         // semantic losses + things DSH cannot express
  };
}

/** Extract every ${VAR} / ${VAR:-default} reference from a string. */
export function envRefs(value) {
  const out = [];
  const re = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g;
  let m;
  while ((m = re.exec(String(value))) !== null) out.push({ name: m[1], fallback: m[2] ?? null });
  return out;
}

/** Accept both the wrapped and the bare dialect; return { servers, dialect }. */
export function extractServers(doc) {
  if (doc && typeof doc === "object" && !Array.isArray(doc)) {
    const wrapped = doc.mcpServers ?? doc.servers;
    if (wrapped && typeof wrapped === "object" && !Array.isArray(wrapped)) {
      return { servers: wrapped, dialect: "wrapped" };
    }
    const looksLikeServer = (v) =>
      v && typeof v === "object" && !Array.isArray(v) && ("url" in v || "command" in v);
    const bare = {};
    for (const [k, v] of Object.entries(doc)) if (looksLikeServer(v)) bare[k] = v;
    if (Object.keys(bare).length > 0) return { servers: bare, dialect: "bare" };
  }
  return { servers: {}, dialect: "unknown" };
}

/**
 * Lower one raw server spec to the IR. Never throws; records warnings instead.
 * `provenance` carries { source, file } so reports can point at the origin.
 */
export function normalizeServer(name, spec, provenance = null) {
  const ir = emptyIR();
  ir.name = name;
  if (provenance) ir.provenance = provenance;

  if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
    ir.warnings.push("spec is not an object");
    return ir;
  }

  const declared = spec.type ?? spec.transport ?? null;
  const hasUrl = typeof spec.url === "string" && spec.url.length > 0;
  const hasCommand = typeof spec.command === "string" && spec.command.length > 0;

  // Transport: trust an explicit declaration, else infer, else complain.
  if (declared === "stdio") ir.transport = "stdio";
  else if (declared === "http" || declared === "streamable-http" || declared === "sse") ir.transport = "streamable-http";
  else if (hasUrl) ir.transport = "streamable-http";
  else if (hasCommand) ir.transport = "stdio";
  else ir.warnings.push("cannot infer transport (no url, no command)");

  if (declared && !["http", "sse", "streamable-http", "stdio"].includes(declared)) {
    ir.warnings.push(`unknown declared type "${declared}"`);
  }

  if (ir.transport === "streamable-http") {
    ir.url = hasUrl ? spec.url : null;
    if (!hasUrl) ir.warnings.push("http transport without url");
  } else if (ir.transport === "stdio") {
    ir.command = hasCommand ? spec.command : null;
    // A relative command (./scripts/x) is relative to the plugin dir, not the
    // harness process cwd. Resolve it up front so preflight checks the real file.
    if (ir.command && (ir.command.startsWith("./") || ir.command.startsWith("../"))) {
      const pluginDir = provenance?.file ? dirname(provenance.file) : null;
      if (pluginDir) ir.command = join(pluginDir, ir.command);
    }
    ir.args = Array.isArray(spec.args) ? [...spec.args] : [];
    if (!hasCommand) ir.warnings.push("stdio transport without command");
  }

  // headers: passthrough, then fold in the Codex bearer knob.
  if (spec.headers && typeof spec.headers === "object" && !Array.isArray(spec.headers)) {
    for (const [k, v] of Object.entries(spec.headers)) ir.headers[k] = v;
  }
  if (typeof spec.bearer_token_env_var === "string" && spec.bearer_token_env_var) {
    const v = spec.bearer_token_env_var;
    ir.headers["Authorization"] = `Bearer \${${v}}`;
    ir.unresolved.push({ kind: "header", header: "Authorization", envVar: v, fallback: null });
  }

  // env: Codex `env_vars` may be a list of names or a map.
  if (spec.env && typeof spec.env === "object" && !Array.isArray(spec.env)) {
    for (const [k, v] of Object.entries(spec.env)) ir.env[k] = v;
  }
  if (spec.env_vars) {
    if (Array.isArray(spec.env_vars)) {
      for (const n of spec.env_vars) if (typeof n === "string") ir.env[n] = `\${${n}}`;
    } else if (typeof spec.env_vars === "object" && !Array.isArray(spec.env_vars)) {
      for (const [k, v] of Object.entries(spec.env_vars)) ir.env[k] = v;
    }
  }
  ir.cwd = typeof spec.cwd === "string" && spec.cwd ? spec.cwd : null;

  // timeout: Codex uses seconds, DSH uses milliseconds.
  const secs = spec.tool_timeout_s ?? spec.toolTimeoutSec ?? null;
  if (typeof secs === "number" && secs > 0) ir.toolCallTimeoutMs = secs * 1000;

  if (Array.isArray(spec.enabled_tools)) ir.enabledTools = [...spec.enabled_tools];

  // Collect every secret/environment reference for the preflight + resolver.
  for (const [k, v] of Object.entries(ir.headers)) {
    for (const r of envRefs(v)) ir.unresolved.push({ kind: "header", header: k, envVar: r.name, fallback: r.fallback });
  }
  for (const [k, v] of Object.entries(ir.env)) {
    for (const r of envRefs(v)) ir.unresolved.push({ kind: "env", env: k, envVar: r.name, fallback: r.fallback });
  }
  if (typeof ir.url === "string") for (const r of envRefs(ir.url)) ir.unresolved.push({ kind: "url", envVar: r.name, fallback: r.fallback });
  for (const a of ir.args) for (const r of envRefs(a)) ir.unresolved.push({ kind: "arg", envVar: r.name, fallback: r.fallback });

  const seen = new Set();
  ir.unresolved = ir.unresolved.filter((u) => {
    const key = JSON.stringify(u);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (spec.oauth_resource) ir.warnings.push(`oauth_resource present (${spec.oauth_resource}) — DSH has no equivalent, dropped`);
  if (spec.enabled === false) ir.warnings.push("server declared disabled");
  return ir;
}

/** Read one .mcp.json file into IR servers, with provenance. */
export function normalizeFile(path, source = "generic") {
  let doc;
  try {
    doc = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    return { path, source, error: String(e.message ?? e), dialect: "unparseable", servers: [] };
  }
  const { servers, dialect } = extractServers(doc);
  return {
    path,
    source,
    dialect,
    servers: Object.entries(servers).map(([n, s]) => normalizeServer(n, s, { source, file: path })),
  };
}
