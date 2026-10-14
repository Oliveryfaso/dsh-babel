/**
 * Registration layer unit tests — arg substitution + command registration
 * against a mock ctx. Dependency-free; `node test/register.test.mjs`.
 */
import { substituteArgs, makeCommandHandler, isRegistrable, registerCommands } from "../lib/register.mjs";

let pass = 0, fail = 0;
function ok(cond, label) { if (cond) pass++; else { fail++; console.log(`  ✗ FAIL: ${label}`); } }

// --- arg substitution ---
ok(substituteArgs("switch {{args}} mode", "ultra") === "switch ultra mode", "{{args}} substitution");
ok(substituteArgs("do $ARGUMENTS", "x y") === "do x y", "$ARGUMENTS substitution");
ok(substituteArgs("use $1", "z") === "use z", "$1 substitution");
ok(substituteArgs("no placeholder", "ignored") === "no placeholder", "no placeholder untouched");
ok(substituteArgs("switch {{args}}", "") === "switch ", "empty rawInput clears placeholder");

// --- handler ---
const h = makeCommandHandler({ prompt: "Review {{args}}" });
const out = h({ rawInput: "this PR" });
ok(out.kind === "success" && out.text === "Review this PR", "handler returns success with substituted text");

// --- registrability ---
ok(isRegistrable({ name: "ponytail", description: "d", prompt: "p" }), "registrable");
ok(!isRegistrable({ name: "_conventions", description: "d", prompt: "p" }), "invalid name not registrable");
ok(!isRegistrable({ name: "x", description: "", prompt: "p" }), "empty description not registrable");
ok(!isRegistrable({ name: "x", description: "d", prompt: "" }), "empty prompt not registrable");

// --- registerCommands with mock ctx ---
const registered = [];
const mockCtx = {
  commands: { register: (def) => { registered.push(def); return () => registered.splice(registered.indexOf(def), 1); } },
  logger: { warn: () => {}, info: () => {} },
};
const cmds = [
  { name: "ponytail", description: "switch mode", prompt: "switch {{args}}", arguments: "args" },
  { name: "code-review", description: "review", prompt: "review this", arguments: null },
  { name: "_conventions", description: "internal", prompt: "x" },       // invalid -> skip
  { name: "bad-desc", description: "", prompt: "x" },                    // empty desc -> skip
];
const r = registerCommands(mockCtx, cmds);
ok(r.names.length === 2, "2 commands registered");
ok(r.names.includes("ponytail") && r.names.includes("code-review"), "correct names");
ok(r.skipped.includes("_conventions") && r.skipped.includes("bad-desc"), "skipped invalid");
ok(registered.length === 2, "ctx.commands.register called twice");
ok(registered[0].name === "ponytail" && registered[0].description === "switch mode", "registered definition shape");
ok(registered[0].input.hint === "args", "input hint from arguments");
ok(typeof registered[0].handler === "function", "handler is a function");
ok(registered[0].handler({ rawInput: "lite" }).text === "switch lite", "registered handler works");

// dispose removes
r.dispose();
ok(registered.length === 0, "dispose unregisters all");

console.log(`\n通过 ${pass}  失败 ${fail}`);
if (fail > 0) process.exit(1);
