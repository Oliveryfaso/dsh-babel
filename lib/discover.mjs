/**
 * Discovery — walk a filesystem tree and collect the external-declaration
 * files that the kernel understands. Read-only.
 *
 * Sources (provenance tags):
 *   claude   ~/.claude/plugins — plugin.json + .mcp.json, marketplaces
 *   codex    ~/.codex/plugins  — plugin.json + .mcp.json (openai-curated etc.)
 *   generic  any project .mcp.json under a user-supplied root
 */

import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { homedir } from "node:os";

const SKIP_DIRS = new Set(["node_modules", ".git", ".DS_Store"]);

/** Recursively collect paths matching `names` under `root`. */
export function walk(root, names, out = []) {
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = join(root, e.name);
    if (e.isDirectory()) walk(p, names, out);
    else if (names.includes(e.name)) out.push(p);
  }
  return out;
}

/** Default roots for the ecosystems DSH interop understands. */
export function defaultRoots() {
  const home = homedir();
  return [
    { source: "claude", path: join(home, ".claude", "plugins") },
    { source: "codex", path: join(home, ".codex", "plugins") },
  ];
}

/** Normalise a user-supplied root list into { source, path } pairs. */
export function resolveRoots(config) {
  const list = Array.isArray(config?.roots) && config.roots.length > 0 ? config.roots : null;
  if (!list) return defaultRoots();
  const out = [];
  for (const entry of list) {
    if (typeof entry === "string") out.push({ source: "generic", path: entry });
    else if (entry && typeof entry === "object" && typeof entry.path === "string") {
      out.push({ source: entry.source ?? "generic", path: entry.path });
    }
  }
  return out.length > 0 ? out : defaultRoots();
}

/** Read a plugin.json if present, returning { name, version } or null. */
export function readPluginManifest(dir) {
  const p = join(dir, "plugin.json");
  try {
    const d = JSON.parse(readFileSync(p, "utf8"));
    return { name: typeof d.name === "string" ? d.name : basename(dir), version: d.version ?? null };
  } catch {
    return null;
  }
}

/**
 * Discover every .mcp.json (and the plugin.json that owns it) under the given
 * roots. Returns [{ source, path, plugin }].
 */
export function discoverMCP(roots) {
  const found = [];
  for (const root of roots) {
    for (const file of walk(root.path, [".mcp.json"])) {
      const pluginDir = dirname(file);
      found.push({ source: root.source, path: file, plugin: readPluginManifest(pluginDir) });
    }
  }
  return found;
}

/** Discover plugin manifests (plugin.json) only — for future skills/commands adapters. */
export function discoverPlugins(roots) {
  const found = [];
  for (const root of roots) {
    for (const file of walk(root.path, ["plugin.json"])) {
      const manifest = readPluginManifest(dirname(file));
      if (manifest) found.push({ source: root.source, path: file, plugin: manifest });
    }
  }
  return found;
}

/** Recursively collect command files: *.md/*.toml directly under a `commands/` dir. */
export function walkCommands(root, out = []) {
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = join(root, e.name);
    if (e.isDirectory()) {
      if (e.name === "commands") {
        // collect direct children only (command files, not nested dirs)
        let files;
        try { files = readdirSync(p, { withFileTypes: true }); } catch { continue; }
        for (const f of files) {
          if (f.isFile() && (f.name.endsWith(".md") || f.name.endsWith(".toml"))) out.push(join(p, f.name));
        }
      } else {
        walkCommands(p, out);
      }
    }
  }
  return out;
}

/** Discover command files under the given roots. */
export function discoverCommands(roots) {
  const found = [];
  for (const root of roots) {
    for (const file of walkCommands(root.path)) {
      found.push({ source: root.source, path: file });
    }
  }
  return found;
}
