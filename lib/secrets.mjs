/**
 * Secret resolver — turn `${VAR}` placeholder references into values.
 *
 * Sources, in priority order:
 *   1. process.env[VAR]           — standard, cross-platform, primary
 *   2. macOS keychain, WHITELISTED — only a curated mapping (GitHub family),
 *      so a random/malicious server config can never reach into other keychain
 *      entries. Everything else stays env-only and is reported as missing.
 *
 * Never logged; a resolved value only ever flows into the MCP server's own
 * headers/env at registration time.
 */

import { execFileSync } from "node:child_process";
import { platform } from "node:os";

/** Curated env-var -> keychain-service mapping. Never expand this casually. */
const KEYCHAIN_WHITELIST = [
  { match: /^(GITHUB_PERSONAL_ACCESS_TOKEN|GITHUB_TOKEN|GITHUB_PAT_TOKEN|GH_TOKEN|GH_ENTERPRISE_TOKEN)$/i, service: "github.com" },
];

/** Read a keychain internet-password, or null when absent/not-macOS. */
function readKeychain(service) {
  if (platform() !== "darwin") return null;
  try {
    const v = execFileSync("/usr/bin/security", ["find-internet-password", "-s", service, "-w"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

/** Resolve one environment reference name to { value, source } or null. */
export function resolveSecret(name) {
  if (process.env[name]) return { value: process.env[name], source: "env" };
  for (const entry of KEYCHAIN_WHITELIST) {
    if (entry.match.test(name)) {
      const value = readKeychain(entry.service);
      if (value) return { value, source: "keychain" };
    }
  }
  return null;
}

/** Substitute `${VAR}` / `${VAR:-default}` references in a string. */
export function substitute(value, resolvedMap) {
  return String(value ?? "").replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g, (m, name, fallback) => {
    return resolvedMap.has(name) ? resolvedMap.get(name) : (fallback ?? "");
  });
}

/**
 * Materialize a server IR: resolve its secret references and substitute them
 * into headers/env/url/args. Returns a new IR plus { resolved, missing }.
 * Unresolved references are left as-is so a re-preflight can still flag them.
 */
export function materializeServer(ir) {
  const resolvedMap = new Map();
  const resolved = [];
  const missing = [];
  for (const u of ir.unresolved ?? []) {
    const r = resolveSecret(u.envVar);
    if (r) { resolvedMap.set(u.envVar, r.value); resolved.push({ ...u, source: r.source }); }
    else missing.push(u);
  }

  const headers = {};
  for (const [k, v] of Object.entries(ir.headers ?? {})) headers[k] = substitute(v, resolvedMap);
  const env = {};
  for (const [k, v] of Object.entries(ir.env ?? {})) env[k] = substitute(v, resolvedMap);
  const url = ir.url ? substitute(ir.url, resolvedMap) : ir.url;
  const args = (ir.args ?? []).map((a) => substitute(a, resolvedMap));

  return { ...ir, headers, env, url, args, resolvedSecrets: resolved, missingSecrets: missing };
}
