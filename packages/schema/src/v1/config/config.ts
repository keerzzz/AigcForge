export * as ConfigV1 from "./config.js"

import { Schema } from "effect"
import { optional, NonNegativeInt, PositiveInt } from "../../schema.js"
import { ConfigPolicy } from "../../config/policy.js"
import { ConfigReference } from "../../config/reference.js"
import { ConfigAgentV1 } from "./agent.js"
import { ConfigAttachmentV1 } from "./attachment.js"
import { ConfigCommandV1 } from "./command.js"
import { ConfigFormatterV1 } from "./formatter.js"
import { ConfigLayoutV1 } from "./layout.js"
import { ConfigLSPV1 } from "./lsp.js"
import { ConfigMCPV1 } from "./mcp.js"
import { ConfigCliAgent } from "./cli-agent.js"
import { ConfigPermissionV1 } from "./permission.js"
import { ConfigPluginV1 } from "./plugin.js"
import { ConfigProviderV1 } from "./provider.js"
import { ConfigServerV1 } from "./server.js"
import { ConfigSkillsV1 } from "./skills.js"

export type Layout = ConfigLayoutV1.Layout

export const WellKnown = Schema.Struct({
  config: optional(Schema.Json),
  remote_config: optional(Schema.Json),
})

const LogLevelRef = Schema.Literals(["DEBUG", "INFO", "WARN", "ERROR"]).annotate({
  identifier: "LogLevel",
  description: "Log level",
})

export const Info = Schema.Struct({
  $schema: optional(Schema.String).annotate({
    description: "JSON schema reference for configuration validation",
  }),
  shell: optional(Schema.String).annotate({ description: "Default shell to use for terminal and bash tool" }),
  logLevel: optional(LogLevelRef).annotate({ description: "Log level" }),
  server: optional(ConfigServerV1.Server).annotate({
    description: "Server configuration for aigcfroge serve and web commands",
  }),
  command: optional(Schema.Record(Schema.String, ConfigCommandV1.Info)).annotate({
    description: "Command configuration, see https://aigcfroge.ai/docs/commands",
  }),
  skills: optional(ConfigSkillsV1.Info).annotate({ description: "Additional skill folder paths" }),
  references: optional(ConfigReference.Info).annotate({
    description: "Named git or local directory references",
  }),
  reference: optional(ConfigReference.Info).annotate({
    description: "@deprecated Use 'references' field instead. Named git or local directory references",
  }),
  watcher: optional(Schema.Struct({ ignore: optional(Schema.Array(Schema.String)) })),
  snapshot: optional(Schema.Boolean).annotate({
    description:
      "Enable or disable snapshot tracking. When false, filesystem snapshots are not recorded and undoing or reverting will not undo/redo file changes. Defaults to true.",
  }),
  plugin: optional(Schema.Array(ConfigPluginV1.Spec)),
  share: optional(Schema.Literals(["manual", "auto", "disabled"])).annotate({
    description:
      "Control sharing behavior:'manual' allows manual sharing via commands, 'auto' enables automatic sharing, 'disabled' disables all sharing",
  }),
  autoshare: optional(Schema.Boolean).annotate({
    description: "@deprecated Use 'share' field instead. Share newly created sessions automatically",
  }),
  autoupdate: optional(Schema.Union([Schema.Boolean, Schema.Literal("notify")])).annotate({
    description:
      "Automatically update to the latest version. Set to true to auto-update, false to disable, or 'notify' to show update notifications",
  }),
  disabled_providers: optional(Schema.Array(Schema.String)).annotate({
    description: "Disable providers that are loaded automatically",
  }),
  enabled_providers: optional(Schema.Array(Schema.String)).annotate({
    description: "When set, ONLY these providers will be enabled. All other providers will be ignored",
  }),
  model: optional(Schema.String).annotate({
    description: "Model to use in the format of provider/model, eg anthropic/claude-2",
  }),
  small_model: optional(Schema.String).annotate({
    description: "Small model to use for tasks like title generation in the format of provider/model",
  }),
  default_agent: optional(Schema.String).annotate({
    description:
      "Default agent to use when none is specified. Must be a primary agent. Falls back to 'build' if not set or if the specified agent is invalid.",
  }),
  username: optional(Schema.String).annotate({
    description: "Custom username to display in conversations instead of system username",
  }),
  mode: optional(
    Schema.StructWithRest(Schema.Struct({ build: optional(ConfigAgentV1.Info), plan: optional(ConfigAgentV1.Info) }), [
      Schema.Record(Schema.String, ConfigAgentV1.Info),
    ]),
  ).annotate({ description: "@deprecated Use `agent` field instead." }),
  agent: optional(
    Schema.StructWithRest(
      Schema.Struct({
        plan: optional(ConfigAgentV1.Info),
        build: optional(ConfigAgentV1.Info),
        general: optional(ConfigAgentV1.Info),
        explore: optional(ConfigAgentV1.Info),
        title: optional(ConfigAgentV1.Info),
        summary: optional(ConfigAgentV1.Info),
        compaction: optional(ConfigAgentV1.Info),
      }),
      [Schema.Record(Schema.String, ConfigAgentV1.Info)],
    ),
  ).annotate({ description: "Agent configuration, see https://aigcfroge.ai/docs/agents" }),
  provider: optional(Schema.Record(Schema.String, ConfigProviderV1.Info)).annotate({
    description: "Custom provider configurations and model overrides",
  }),
  mcp: optional(
    Schema.Record(Schema.String, Schema.Union([ConfigMCPV1.Info, Schema.Struct({ enabled: Schema.Boolean })])),
  ).annotate({ description: "MCP (Model Context Protocol) server configurations" }),
  cli_agents: optional(Schema.Record(Schema.String, ConfigCliAgent.Info)).annotate({
    description: "Named external CLI agent definitions (passthrough to V2)",
  }),
  formatter: optional(ConfigFormatterV1.Info).annotate({
    description:
      "Enable or configure formatters. Omit or set to false to disable, true to enable built-ins, or an object to enable built-ins with overrides.",
  }),
  lsp: optional(ConfigLSPV1.Info).annotate({
    description:
      "Enable or configure LSP servers. Omit or set to false to disable, true to enable built-ins, or an object to enable built-ins with overrides.",
  }),
  instructions: optional(Schema.Array(Schema.String)).annotate({
    description: "Additional instruction files or patterns to include",
  }),
  layout: optional(ConfigLayoutV1.Layout).annotate({ description: "@deprecated Always uses stretch layout." }),
  permission: optional(ConfigPermissionV1.Info),
  tools: optional(Schema.Record(Schema.String, Schema.Boolean)),
  attachment: optional(ConfigAttachmentV1.Info).annotate({
    description: "Attachment processing configuration, including image size limits and resizing behavior",
  }),
  enterprise: optional(Schema.Struct({ url: optional(Schema.String).annotate({ description: "Enterprise URL" }) })),
  tool_output: optional(
    Schema.Struct({
      max_lines: optional(PositiveInt).annotate({
        description: "Maximum lines of tool output before it is truncated and saved to disk (default: 2000)",
      }),
      max_bytes: optional(PositiveInt).annotate({
        description: "Maximum bytes of tool output before it is truncated and saved to disk (default: 51200)",
      }),
    }),
  ).annotate({
    description:
      "Thresholds for truncating tool output. When output exceeds either limit, the full text is written to the truncation directory and a preview is returned.",
  }),
  compaction: optional(
    Schema.Struct({
      auto: optional(Schema.Boolean).annotate({
        description: "Enable automatic compaction when context is full (default: true)",
      }),
      prune: optional(Schema.Boolean).annotate({
        description: "Enable pruning of old tool outputs (default: false)",
      }),
      tail_turns: optional(NonNegativeInt).annotate({
        description:
          "Number of recent user turns, including their following assistant/tool responses, to keep verbatim during compaction (default: 2)",
      }),
      preserve_recent_tokens: optional(NonNegativeInt).annotate({
        description: "Maximum number of tokens from recent turns to preserve verbatim after compaction",
      }),
      reserved: optional(NonNegativeInt).annotate({
        description: "Token buffer for compaction. Leaves enough window to avoid overflow during compaction.",
      }),
    }),
  ),
  experimental: optional(
    Schema.Struct({
      disable_paste_summary: optional(Schema.Boolean),
      batch_tool: optional(Schema.Boolean).annotate({ description: "Enable the batch tool" }),
      openTelemetry: optional(Schema.Boolean).annotate({
        description: "Enable OpenTelemetry spans for AI SDK calls (using the 'experimental_telemetry' flag)",
      }),
      primary_tools: optional(Schema.Array(Schema.String)).annotate({
        description: "Tools that should only be available to primary agents.",
      }),
      continue_loop_on_deny: optional(Schema.Boolean).annotate({
        description: "Continue the agent loop when a tool call is denied",
      }),
      mcp_timeout: optional(PositiveInt).annotate({
        description: "Timeout in milliseconds for model context protocol (MCP) requests",
      }),
      policies: optional(Schema.Array(ConfigPolicy.Info)).annotate({
        description: "Policy statements applied to supported resources, such as provider access",
      }),
    }),
  ),
  subagent_attended_default: optional(Schema.Boolean).annotate({
    description:
      "Default attended mode for subagent task delegation. true=user responds to permission prompts, false=asks auto-denied.",
  }),
}).annotate({ identifier: "Config" })

export type Info = Schema.Schema.Type<typeof Info>
