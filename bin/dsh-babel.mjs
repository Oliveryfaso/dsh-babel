#!/usr/bin/env node
/**
 * CLI runner — run the pipeline against the local machine for testing and for
 * the eventual `install_bundle` verification step.
 *
 *   node bin/dsh-babel.mjs              # default roots (claude + codex)
 *   node bin/dsh-babel.mjs --roots /a /b
 *   node bin/dsh-babel.mjs --json
 */

import { run } from "../index.js";

const args = process.argv.slice(2);
const json = args.includes("--json");
const rootIdx = args.indexOf("--roots");
const roots = rootIdx >= 0 ? args.slice(rootIdx + 1).filter((a) => !a.startsWith("--")) : [];

const result = run({ roots, dryRun: true, logReport: false });
if (json) {
  console.log(JSON.stringify(result.report, null, 2));
} else {
  console.log(result.text);
}
