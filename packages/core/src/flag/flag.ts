import { Config } from "effect"

export function truthy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "true" || value === "1"
}

const copy = process.env["OMNIXA_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"]
const fff = process.env["OMNIXA_DISABLE_FFF"]

function enabledByExperimental(key: string) {
  return process.env[key] === undefined ? truthy("OMNIXA_EXPERIMENTAL") : truthy(key)
}

export const Flag = {
  OTEL_EXPORTER_OTLP_ENDPOINT: process.env["OTEL_EXPORTER_OTLP_ENDPOINT"],
  OTEL_EXPORTER_OTLP_HEADERS: process.env["OTEL_EXPORTER_OTLP_HEADERS"],

  OMNIXA_AUTO_HEAP_SNAPSHOT: truthy("OMNIXA_AUTO_HEAP_SNAPSHOT"),
  OMNIXA_GIT_BASH_PATH: process.env["OMNIXA_GIT_BASH_PATH"],
  OMNIXA_CONFIG: process.env["OMNIXA_CONFIG"],
  OMNIXA_CONFIG_CONTENT: process.env["OMNIXA_CONFIG_CONTENT"],
  OMNIXA_DISABLE_AUTOUPDATE: truthy("OMNIXA_DISABLE_AUTOUPDATE"),
  OMNIXA_ALWAYS_NOTIFY_UPDATE: truthy("OMNIXA_ALWAYS_NOTIFY_UPDATE"),
  OMNIXA_DISABLE_PRUNE: truthy("OMNIXA_DISABLE_PRUNE"),
  OMNIXA_DISABLE_TERMINAL_TITLE: truthy("OMNIXA_DISABLE_TERMINAL_TITLE"),
  OMNIXA_SHOW_TTFD: truthy("OMNIXA_SHOW_TTFD"),
  OMNIXA_DISABLE_AUTOCOMPACT: truthy("OMNIXA_DISABLE_AUTOCOMPACT"),
  OMNIXA_DISABLE_MODELS_FETCH: truthy("OMNIXA_DISABLE_MODELS_FETCH"),
  OMNIXA_DISABLE_MOUSE: truthy("OMNIXA_DISABLE_MOUSE"),
  OMNIXA_FAKE_VCS: process.env["OMNIXA_FAKE_VCS"],
  OMNIXA_SERVER_PASSWORD: process.env["OMNIXA_SERVER_PASSWORD"],
  OMNIXA_SERVER_USERNAME: process.env["OMNIXA_SERVER_USERNAME"],
  OMNIXA_DISABLE_FFF: fff === undefined ? process.platform === "win32" : truthy("OMNIXA_DISABLE_FFF"),

  // Experimental
  OMNIXA_EXPERIMENTAL_FILEWATCHER: Config.Boolean("OMNIXA_EXPERIMENTAL_FILEWATCHER").pipe(Config.withDefault(false)),
  OMNIXA_EXPERIMENTAL_DISABLE_FILEWATCHER: Config.Boolean("OMNIXA_EXPERIMENTAL_DISABLE_FILEWATCHER").pipe(
    Config.withDefault(false),
  ),
  OMNIXA_EXPERIMENTAL_DISABLE_COPY_ON_SELECT:
    copy === undefined ? process.platform === "win32" : truthy("OMNIXA_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"),
  OMNIXA_MODELS_URL: process.env["OMNIXA_MODELS_URL"],
  OMNIXA_MODELS_PATH: process.env["OMNIXA_MODELS_PATH"],
  OMNIXA_DB: process.env["OMNIXA_DB"],

  OMNIXA_WORKSPACE_ID: process.env["OMNIXA_WORKSPACE_ID"],
  OMNIXA_EXPERIMENTAL_WORKSPACES: enabledByExperimental("OMNIXA_EXPERIMENTAL_WORKSPACES"),

  // Evaluated at access time (not module load) because tests, the CLI, and
  // external tooling set these env vars at runtime.
  get OMNIXA_DISABLE_PROJECT_CONFIG() {
    return truthy("OMNIXA_DISABLE_PROJECT_CONFIG")
  },
  get OMNIXA_EXPERIMENTAL_REFERENCES() {
    return enabledByExperimental("OMNIXA_EXPERIMENTAL_REFERENCES")
  },
  get OMNIXA_EXPERIMENTAL_PERSISTENT_DELEGATIONS() {
    return (
      process.env["OMNIXA_EXPERIMENTAL_PERSISTENT_DELEGATIONS"] === undefined ||
      truthy("OMNIXA_EXPERIMENTAL_PERSISTENT_DELEGATIONS")
    )
  },
  get OMNIXA_EXPERIMENTAL_DELEGATION_RECOVERY() {
    return truthy("OMNIXA_EXPERIMENTAL_DELEGATION_RECOVERY")
  },
  get OMNIXA_EXPERIMENTAL_CHAT_ASSET() {
    if (process.env["OMNIXA_EXPERIMENTAL_CHAT_ASSET"] !== undefined) return truthy("OMNIXA_EXPERIMENTAL_CHAT_ASSET")
    if (process.env["OMNIXA_EXPERIMENTAL_CHAT_PROMPT_ASSET"] !== undefined)
      return truthy("OMNIXA_EXPERIMENTAL_CHAT_PROMPT_ASSET")
    return true
  },
  get OMNIXA_TUI_CONFIG() {
    return process.env["OMNIXA_TUI_CONFIG"]
  },
  get OMNIXA_CONFIG_DIR() {
    return process.env["OMNIXA_CONFIG_DIR"]
  },
  get OMNIXA_PURE() {
    return truthy("OMNIXA_PURE")
  },
  get OMNIXA_CUSTOM_MODE() {
    return truthy("OMNIXA_CUSTOM_MODE")
  },
  get OMNIXA_PERMISSION() {
    return process.env["OMNIXA_PERMISSION"]
  },
  get OMNIXA_PLUGIN_META_FILE() {
    return process.env["OMNIXA_PLUGIN_META_FILE"]
  },
  get OMNIXA_CLIENT() {
    return process.env["OMNIXA_CLIENT"] ?? "cli"
  },

  // Feature flags for meta-agent VS Code alignment phases
  get OMNIXA_ENABLE_AGENT_FILE() {
    return truthy("OMNIXA_ENABLE_AGENT_FILE")
  },
  get OMNIXA_ENABLE_HANDOFF() {
    return truthy("OMNIXA_ENABLE_HANDOFF")
  },
  get OMNIXA_ENABLE_HOT_RELOAD() {
    return truthy("OMNIXA_ENABLE_HOT_RELOAD")
  },
}
