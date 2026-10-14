/**
 * MCP registration — connect a normalized server IR and register its tools.
 *
 * Reuses DSH's own `createMcpToolDefinition` (peer dep) so tool definitions
 * match the harness contract exactly, and the MCP SDK client for transport.
 *
 * Naming: `mcp__<server>__<tool>` (same public-name contract as dsh-mcp-client).
 * The 64-char cap + collision-hash is not yet reproduced here — flagged as a
 * TODO until the naming contract is exercised against a real collision.
 */

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { createMcpToolDefinition } from "@deepseek-ai/dsh-mcp-client";

const MAX_PUBLIC_NAME = 64;

/** Normalize a server+tool name to the DSH public-tool-name grammar. */
export function publicToolName(serverName, toolName) {
  const joined = `mcp__${serverName}__${toolName}`.replace(/[^A-Za-z0-9_-]/g, "_");
  // TODO: hash suffix on truncation/collision, matching dsh-mcp-client.
  return joined.slice(0, MAX_PUBLIC_NAME);
}

/** Connect a normalized server IR; returns { client, transport, close }. */
export async function connectMcpServer(ir) {
  let transport;
  if (ir.transport === "stdio") {
    transport = new StdioClientTransport({
      command: ir.command,
      args: ir.args ?? [],
      env: { ...process.env, ...(ir.env ?? {}) },
      cwd: ir.cwd || undefined,
    });
  } else if (ir.transport === "streamable-http") {
    transport = new StreamableHTTPClientTransport(new URL(ir.url), {
      requestInit: { headers: ir.headers ?? {} },
    });
  } else {
    throw new Error(`dsh-babel: unsupported transport "${ir.transport}"`);
  }
  const client = new Client({ name: "dsh-babel", version: "0.2.0" }, { capabilities: {} });
  await client.connect(transport);
  return { client, transport, close: () => transport.close() };
}

/** Build a `call` closure for one tool bound to the connected client. */
function makeCall(client, tool, toolCallTimeoutMs) {
  return (args, execution) =>
    client.callTool(
      { name: tool.name, arguments: args },
      {
        signal: execution?.signal,
        timeout: toolCallTimeoutMs ?? undefined,
        toolDefinition: tool,
      }
    );
}

/** Connect + register one server's tools; returns { toolCount, dispose }. */
export async function registerMcpServer(ctx, ir) {
  const { client, close } = await connectMcpServer(ir);
  try {
    const listed = await client.listTools(undefined, { cacheMode: "refresh" });
    const disposers = [];
    for (const tool of listed.tools) {
      const definition = createMcpToolDefinition(ctx, {
        name: publicToolName(ir.name, tool.name),
        rawName: tool.name,
        description: tool.description ?? "",
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema,
        call: makeCall(client, tool, ir.toolCallTimeoutMs),
      });
      disposers.push(ctx.tools.register(definition));
    }
    return {
      server: ir.name,
      toolCount: listed.tools.length,
      dispose: () => { for (const d of disposers) d(); close(); },
    };
  } catch (e) {
    close();
    throw e;
  }
}
