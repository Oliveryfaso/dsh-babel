/**
 * Registration layer — turn the IR into live DSH resources.
 *
 * Command contract (dsh-commands, verified against 0.2.0-rc.2):
 *   ctx.commands.register({
 *     name,                       // /^[a-z][a-z0-9_-]*$/
 *     description,                // non-empty string
 *     handler: (invocation) => CommandResult | Promise<CommandResult>,
 *     input?: { hint, attachments? }
 *   })
 *   invocation = { commandId, agent, rawInput, attachments, signal }
 *   CommandResult = { kind: "success", text? } | { kind: "error", text }
 *
 * Imported commands are prompts: the handler returns the prompt with argument
 * placeholders substituted by the user's raw input.
 */

import { COMMAND_NAME } from "./commands.mjs";

/** Substitute {{args}} / $ARGUMENTS / $1 with the command's raw input. */
export function substituteArgs(prompt, rawInput) {
  const value = (rawInput ?? "").trim();
  return (prompt ?? "")
    .replace(/\{\{\s*[a-zA-Z0-9_-]+\s*\}\}/g, value)
    .replace(/\$ARGUMENTS\b/g, value)
    .replace(/\$1\b/g, value);
}

/** Build a DSH command handler from a normalized command IR. */
export function makeCommandHandler(ir) {
  return (invocation) => {
    const text = substituteArgs(ir.prompt, invocation?.rawInput);
    return { kind: "success", text };
  };
}

/** Whether a command IR is registrable (valid name + description + prompt). */
export function isRegistrable(c) {
  return c && COMMAND_NAME.test(c.name ?? "") && typeof c.description === "string" && c.description.trim().length > 0 && typeof c.prompt === "string" && c.prompt.trim().length > 0;
}

/**
 * Register every registrable command; returns { names, dispose }.
 * The caller must invoke `dispose` on teardown (each register returns a disposer).
 */
export function registerCommands(ctx, commands) {
  const disposers = [];
  const names = [];
  const skipped = [];
  for (const c of commands) {
    if (!isRegistrable(c)) {
      skipped.push(c?.name ?? "(unnamed)");
      continue;
    }
    const definition = { name: c.name, description: c.description, handler: makeCommandHandler(c) };
    if (c.arguments) definition.input = { hint: c.arguments };
    disposers.push(ctx.commands.register(definition));
    names.push(c.name);
  }
  return { names, skipped, dispose: () => { for (const d of disposers) d(); } };
}
