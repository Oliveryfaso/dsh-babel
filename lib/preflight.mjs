/**
 * Preflight — four checks that decide whether an IR server can actually run
 * in the DSH environment. This is where "it silently fails" becomes "here is
 * exactly why".
 *
 * Checks:
 *   1. command availability  — stdio command resolves on PATH
 *   2. daemon health          — docker etc. is installed AND running
 *   3. secret availability    — ${VAR} credential refs resolve in the env
 *   4. version drift          — `@latest` / unpinned command args
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir, platform } from "node:os";

const PATH = process.env.PATH ?? "/usr/bin:/bin:/usr/sbin:/sbin";

/** Check whether `cmd` resolves to an executable on PATH. */
export function commandAvailable(cmd) {
  if (!cmd || cmd.includes("/")) {
    // absolute or relative path — just stat it
    return existsSync(cmd);
  }
  for (const dir of PATH.split(":")) {
    const p = join(dir, cmd);
    try {
      const st = spawnSync("test", ["-x", p], { timeout: 2000 });
      if (st.status === 0) return true;
    } catch {
      /* keep scanning */
    }
  }
  return false;
}

/** Known daemon probes: name -> list of socket paths + a fallback `info` argv. */
const DAEMONS = {
  docker: {
    sockets: ["/var/run/docker.sock", join(homedir(), ".docker", "run", "docker.sock")],
    probe: ["docker", "info"],
  },
};

/** Return { running, detail } for a daemon command, or null if not a known daemon. */
export function daemonStatus(command) {
  const name = command?.split("/").pop();
  const spec = DAEMONS[name];
  if (!spec) return null; // not a known daemon — nothing to probe
  if (spec.sockets.some((s) => existsSync(s))) return { running: true, detail: `${name} socket present` };
  // socket missing — double-check with a bounded probe
  const r = spawnSync(spec.probe[0], spec.probe.slice(1), { timeout: 4000, encoding: "utf8" });
  if (r.status === 0) return { running: true, detail: `${name} responded to probe` };
  return { running: false, detail: `${name} installed but not running (no socket / probe failed)` };
}

/** Classify an environment reference into: secret | host-runtime | platform | plain. */
export function classifyEnvRef(name) {
  // Order matters: a credential is a credential first, even when prefixed by
  // a harness name (e.g. CODEX_API_KEY, ANTHROPIC_API_KEY). Those can still be
  // supplied in DSH, so they must NOT be reported as un-resolvable host vars.
  const secrets = /(TOKEN|API_KEY|SECRET|PASSWORD|PASSPHRASE|PRIVATE_KEY|ACCESS_KEY|BEARER)/i;
  const windowsOnly = /^(USERPROFILE|LOCALAPPDATA|APPDATA|WINDIR|PROGRAMFILES)$/i;
  const hostRuntime = /^(CODEX_|CLAUDE_|ANTHROPIC_)/i;

  if (windowsOnly.test(name)) return "platform";
  if (secrets.test(name)) return "secret";
  if (hostRuntime.test(name)) return "host-runtime";
  return "plain";
}

/** Preflight a single normalized server. Returns a verdict object. */
export function preflightServer(ir) {
  const issues = [];
  let severity = "ok"; // ok | warn | blocked

  // 1. command availability
  if (ir.transport === "stdio") {
    if (!ir.command) {
      issues.push({ check: "command", level: "blocked", detail: "no command" });
    } else if (!commandAvailable(ir.command)) {
      issues.push({ check: "command", level: "blocked", detail: `command not on PATH: ${ir.command}` });
      severity = "blocked";
    }
  }

  // 2. daemon health
  if (ir.transport === "stdio" && ir.command) {
    const d = daemonStatus(ir.command);
    if (d && !d.running) {
      issues.push({ check: "daemon", level: "blocked", detail: d.detail });
      severity = "blocked";
    }
  }

  // 3. secret / env classification
  for (const u of ir.unresolved ?? []) {
    const cls = classifyEnvRef(u.envVar);
    if (cls === "secret") {
      if (process.env[u.envVar]) {
        issues.push({ check: "secret", level: "ok", detail: `${u.envVar} is set` });
      } else {
        issues.push({ check: "secret", level: "warn", detail: `missing credential: ${u.envVar}` });
        if (severity === "ok") severity = "warn";
      }
    } else if (cls === "host-runtime") {
      issues.push({ check: "env", level: "blocked", detail: `depends on ${u.envVar} (other-harness runtime), not available in DSH` });
      severity = "blocked";
    } else if (cls === "platform") {
      issues.push({ check: "env", level: "warn", detail: `platform-specific var ${u.envVar} may not exist on ${platform()}` });
      if (severity === "ok") severity = "warn";
    }
  }

  // 4. version drift
  if (ir.transport === "stdio") {
    for (const a of ir.args ?? []) {
      if (typeof a === "string" && /@latest\b|:\s*latest\b|^latest$/i.test(a)) {
        issues.push({ check: "version", level: "warn", detail: `unpinned version in args: ${a}` });
        if (severity === "ok") severity = "warn";
      }
    }
  }

  return { name: ir.name, transport: ir.transport, severity, issues };
}

/** Preflight a list of normalized servers; returns a list of verdicts. */
export function preflightAll(servers) {
  return servers.map(preflightServer);
}
