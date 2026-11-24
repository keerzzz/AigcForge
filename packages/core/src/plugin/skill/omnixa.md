# Omnixa

Use this guide as the starting point for work involving Omnixa itself. It covers
the core concepts needed to configure and customize Omnixa, extend it with
plugins, and build integrations with the Omnixa SDK, clients, and HTTP API.

The authoritative source of truth for this build is the repository itself
(<https://github.com/keerzzz/AigcForge>), especially `CLAUDE.md`, `AGENTS.md`,
`ARCHITECTURE.md`, `DESIGN.md`, `docs/testing.md`, and `specs/v2/README.md`.
Do not fetch unhosted `omnixa.ai` documentation URLs; inspect the in-repo V2
specifications, schemas, and running server `/openapi.json` instead.

## Version policy

Always answer for Omnixa V2 unless the user explicitly asks about V1 or legacy
behavior. Do not guess V2 field names or shapes; verify them against
`packages/schema` and `specs/v2/`. If documentation is missing or ambiguous,
state the uncertainty or ask for clarification.

## CLI

CLI and TUI preferences are separate from Omnixa's server and project
configuration. They live in `~/.config/omnixa/cli.json`, or
`$XDG_CONFIG_HOME/omnixa/cli.json` when `XDG_CONFIG_HOME` is set. There is no
project-local CLI configuration. Set `OMNIXA_CLI_CONFIG_CONTENT` to merge
inline JSON over the global settings. Most preferences can also be changed from
the TUI by pressing `Ctrl+P` and selecting **Open settings**.

### Keybinds

Configure keybindings under `keybinds` in `cli.json`. The leader key is the
`keybinds.leader` entry; leader timing is configured separately under
`leader.timeout`. Bindings can use a string, an array of strings, or an object
when event behavior such as `preventDefault` is required. Disable a binding
with `"none"` or `false`.

## Omnixa configuration

Omnixa's server and project configuration uses JSON or JSONC.

Global configuration lives at `~/.config/omnixa/omnixa.json(c)` and applies to
every project for that user. Project configuration can live in any directory as
`omnixa.json(c)` or `.omnixa/omnixa.json(c)`, including nested packages in a
monorepo.

During ordinary project discovery, Omnixa searches the current Location
directory and every ancestor through the filesystem root, including directories
above the detected project or repository root. It merges direct
`omnixa.json(c)` files from the farthest ancestor to the current directory, then
does the same for `.omnixa/omnixa.json(c)` files. Every discovered `.omnixa`
config overrides every discovered direct config. Global filesystem configuration
has lower precedence than these discovered documents.

Common configuration fields include `model`, `default_agent`, `permissions`,
`agents`, `commands`, `plugins`, `providers`, `mcp`, `skills`, `instructions`,
`references`, `formatter`, and `lsp`.

This configuration is distinct from `cli.json`. Preserve unrelated settings when
editing an existing file.

## MCP servers

Configure MCP servers under `mcp.servers`. Prefer the CLI because it preserves
unrelated configuration. Use `--global` when the user asks to set up a service
for themselves without limiting it to the current project; omit it when they
explicitly want project-local configuration.

```sh
omnixa mcp add <name> --global --url <remote-url>
omnixa mcp list
```

Remote servers use OAuth by default. If `mcp list` reports that a server needs
authentication, tell the user to run `/mcps`, select the server, and sign in.
Do not run `omnixa mcp auth` through the shell tool: it starts an interactive
flow whose authorization link can be hidden in background process output. Use
the user-facing MCP interface instead.

Report the server as configured but awaiting sign-in until its connection status
confirms it is connected.

OAuth credentials are stored outside the Omnixa configuration. Do not ask for or
store an API key when the server supports OAuth. Use header-based credentials
only when OAuth is unavailable or the user explicitly requires them, and use an
environment substitution such as `{env:MCP_API_KEY}` instead of writing a secret
into configuration.

## Plugins

Plugins can register hooks, transforms, tools, providers, and TUI extensions.
Check `packages/plugin` and `specs/v2/` for the current V2 plugin entrypoints
and RPC contracts.

## Service

Omnixa uses a client-server architecture. Interfaces such as the TUI and Desktop
connect to a background Omnixa service, which owns sessions, configuration,
plugins, permissions, and tool execution.

Omnixa normally discovers or starts the shared background service automatically.
If the service is stuck or unhealthy, restart it:

```sh
omnixa service restart
```

Check its status after restarting:

```sh
omnixa service status
```

## API

Omnixa exposes an HTTP API from its server. The API is described by an OpenAPI
document available from the running server at `/openapi.json` and checked into
the repository at `packages/protocol/openapi.json`.

Use Omnixa's built-in `api` command for local requests. It uses the same
discovery and authentication flow as the TUI and may start the background
service when no compatible healthy service is available. It accepts either an
HTTP method and path or an OpenAPI operation ID.

Call an endpoint with an HTTP method and path:

```sh
omnixa api get /api/info
```

Pass a request body with `--data` or `-d`, and additional headers with
`--header` or `-H`:

```sh
omnixa api post /api/example --data '{"key":"value"}'
omnixa api get /api/example --header 'X-Example:value'
```

Request bodies default to `Content-Type: application/json`. When Omnixa is
connected to an explicit server instead of its managed background service, use
the same configured server and authentication context rather than constructing
an unauthenticated request separately.

## Client

`@omnixa/client` is the generated TypeScript client for the Omnixa HTTP API.
Its methods and types come from `packages/protocol/openapi.json`. The default
entrypoint exposes Promise-based resource clients and async iterables for
streaming endpoints. The `@omnixa/client/effect` entrypoint exposes typed
Effects, Streams, and decoded Omnixa schema values, and its `Service` API can
discover, start, stop, and authenticate with the local background service from a
Node application.

## SDK

Use `@omnixa/client` for HTTP integrations and `@omnixa/client/effect` for typed
Effect consumers. For embedded runtime work, inspect the existing Core service
graph composition in `packages/core/src/effect/app-node-builder.ts` and the
node contracts in `packages/util/src/effect/layer-node.ts`. Verify the selected
services' dependencies and lifecycle before composing an application.

## Troubleshooting

Omnixa runs a client and a background server. Start by determining whether a
problem belongs to the client, the shared server, or one project.

- Check the service with `omnixa service status` and verify the API with
  `omnixa api get /api/info`.
- Compare with `omnixa --standalone`, which runs the TUI with a private server,
  to isolate shared-service issues.
- Inspect `~/.local/share/omnixa/log/omnixa.log`. Filter `role=cli` for client
  startup and `role=server` for sessions, providers, plugins, permissions, and
  tools.
- Run one reproduction with `OMNIXA_LOG_LEVEL=DEBUG` when normal logs are not
  sufficient.
- Do not delete or edit the database, service registration, or service config
  while diagnosing a problem. Back up persistent data before inspecting it with
  external tools.
- Redact API keys, authorization headers, prompts, file contents, and other
  sensitive data before sharing diagnostics.
