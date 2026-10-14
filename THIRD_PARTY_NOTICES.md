# Third-Party Notices

dsh-babel itself is licensed under the MIT License (see [LICENSE](LICENSE)).

It depends on the following third-party packages. They are not vendored into this
repository; they are installed by the profile's package manager at install time.

## Runtime dependency

| Package | Version | License | Purpose |
|---|---|---|---|
| [`@modelcontextprotocol/client`](https://github.com/modelcontextprotocol/typescript-sdk) | 2.0.0 | MIT | MCP client and stdio / streamable-http transports |

## Peer dependencies (provided by the DeepSeek Harness installation)

These are not bundled with dsh-babel. The DSH runtime supplies them; dsh-babel
declares them as peers so the harness and the plugin agree on one instance.

| Package | Version | License | Purpose |
|---|---|---|---|
| [`@deepseek-ai/dsh-mcp-client`](https://github.com/deepseek-ai/deepseek-harness) | 0.2.0-rc.2 | MIT | Exports `createMcpToolDefinition`, reused so adapted tools behave exactly like DSH's native MCP client |
| [`@deepseek-ai/schemastery`](https://github.com/deepseek-ai/deepseek-harness) | ~3.18.4 | MIT | Declares the plugin's `Config` schema |
| [`@deepseek-ai/cordis`](https://github.com/deepseek-ai/deepseek-harness) | >=4.0.1 <5.0.0 | MIT | Plugin/context runtime |

## Design note

dsh-babel reads other harnesses' configuration files (`.mcp.json`, `commands/*.md`,
`commands/*.toml`) at runtime. It does **not** copy, vendor, or redistribute those
projects' code: it only parses their declarative configuration and translates it
into DSH-native registrations. No third-party plugin code is included in this
repository.
