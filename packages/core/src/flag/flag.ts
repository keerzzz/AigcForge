import { Config } from "effect"

export function truthy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "true" || value === "1"
}

const copy = process.env["AIGCFROGE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"]
const fff = process.env["AIGCFROGE_DISABLE_FFF"]

function enabledByExperimental(key: string) {
  return process.env[key] === undefined ? truthy("AIGCFROGE_EXPERIMENTAL") : truthy(key)
}

export const Flag = {
  OTEL_EXPORTER_OTLP_ENDPOINT: process.env["OTEL_EXPORTER_OTLP_ENDPOINT"],
  OTEL_EXPORTER_OTLP_HEADERS: process.env["OTEL_EXPORTER_OTLP_HEADERS"],

  AIGCFROGE_AUTO_HEAP_SNAPSHOT: truthy("AIGCFROGE_AUTO_HEAP_SNAPSHOT"),
  AIGCFROGE_GIT_BASH_PATH: process.env["AIGCFROGE_GIT_BASH_PATH"],
  AIGCFROGE_CONFIG: process.env["AIGCFROGE_CONFIG"],
  AIGCFROGE_CONFIG_CONTENT: process.env["AIGCFROGE_CONFIG_CONTENT"],
  AIGCFROGE_DISABLE_AUTOUPDATE: truthy("AIGCFROGE_DISABLE_AUTOUPDATE"),
  AIGCFROGE_ALWAYS_NOTIFY_UPDATE: truthy("AIGCFROGE_ALWAYS_NOTIFY_UPDATE"),
  AIGCFROGE_DISABLE_PRUNE: truthy("AIGCFROGE_DISABLE_PRUNE"),
  AIGCFROGE_DISABLE_TERMINAL_TITLE: truthy("AIGCFROGE_DISABLE_TERMINAL_TITLE"),
  AIGCFROGE_SHOW_TTFD: truthy("AIGCFROGE_SHOW_TTFD"),
  AIGCFROGE_DISABLE_AUTOCOMPACT: truthy("AIGCFROGE_DISABLE_AUTOCOMPACT"),
  AIGCFROGE_DISABLE_MODELS_FETCH: truthy("AIGCFROGE_DISABLE_MODELS_FETCH"),
  AIGCFROGE_DISABLE_MOUSE: truthy("AIGCFROGE_DISABLE_MOUSE"),
  AIGCFROGE_FAKE_VCS: process.env["AIGCFROGE_FAKE_VCS"],
  AIGCFROGE_SERVER_PASSWORD: process.env["AIGCFROGE_SERVER_PASSWORD"],
  AIGCFROGE_SERVER_USERNAME: process.env["AIGCFROGE_SERVER_USERNAME"],
  AIGCFROGE_DISABLE_FFF: fff === undefined ? process.platform === "win32" : truthy("AIGCFROGE_DISABLE_FFF"),

  // Experimental
  AIGCFROGE_EXPERIMENTAL_FILEWATCHER: Config.boolean("AIGCFROGE_EXPERIMENTAL_FILEWATCHER").pipe(
    Config.withDefault(false),
  ),
  AIGCFROGE_EXPERIMENTAL_DISABLE_FILEWATCHER: Config.boolean("AIGCFROGE_EXPERIMENTAL_DISABLE_FILEWATCHER").pipe(
    Config.withDefault(false),
  ),
  AIGCFROGE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT:
    copy === undefined ? process.platform === "win32" : truthy("AIGCFROGE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"),
  AIGCFROGE_MODELS_URL: process.env["AIGCFROGE_MODELS_URL"],
  AIGCFROGE_MODELS_PATH: process.env["AIGCFROGE_MODELS_PATH"],
  AIGCFROGE_DB: process.env["AIGCFROGE_DB"],

  AIGCFROGE_WORKSPACE_ID: process.env["AIGCFROGE_WORKSPACE_ID"],
  AIGCFROGE_EXPERIMENTAL_WORKSPACES: enabledByExperimental("AIGCFROGE_EXPERIMENTAL_WORKSPACES"),

  // Evaluated at access time (not module load) because tests, the CLI, and
  // external tooling set these env vars at runtime.
  get AIGCFROGE_DISABLE_PROJECT_CONFIG() {
    return truthy("AIGCFROGE_DISABLE_PROJECT_CONFIG")
  },
  get AIGCFROGE_EXPERIMENTAL_REFERENCES() {
    return enabledByExperimental("AIGCFROGE_EXPERIMENTAL_REFERENCES")
  },
  get AIGCFROGE_EXPERIMENTAL_CHAT_ASSET() {
    if (process.env["AIGCFROGE_EXPERIMENTAL_CHAT_ASSET"] !== undefined) return truthy("AIGCFROGE_EXPERIMENTAL_CHAT_ASSET")
    if (process.env["AIGCFROGE_EXPERIMENTAL_CHAT_PROMPT_ASSET"] !== undefined) return truthy("AIGCFROGE_EXPERIMENTAL_CHAT_PROMPT_ASSET")
    return true
  },
  get AIGCFROGE_TUI_CONFIG() {
    return process.env["AIGCFROGE_TUI_CONFIG"]
  },
  get AIGCFROGE_CONFIG_DIR() {
    return process.env["AIGCFROGE_CONFIG_DIR"]
  },
  get AIGCFROGE_PURE() {
    return truthy("AIGCFROGE_PURE")
  },
  get AIGCFROGE_CUSTOM_MODE() {
    return truthy("AIGCFROGE_CUSTOM_MODE")
  },
  get AIGCFROGE_PERMISSION() {
    return process.env["AIGCFROGE_PERMISSION"]
  },
  get AIGCFROGE_PLUGIN_META_FILE() {
    return process.env["AIGCFROGE_PLUGIN_META_FILE"]
  },
  get AIGCFROGE_CLIENT() {
    return process.env["AIGCFROGE_CLIENT"] ?? "cli"
  },

  // Feature flags for meta-agent VS Code alignment phases
  get AIGCFROGE_ENABLE_AGENT_FILE() {
    return truthy("AIGCFROGE_ENABLE_AGENT_FILE")
  },
  get AIGCFROGE_ENABLE_HANDOFF() {
    return truthy("AIGCFROGE_ENABLE_HANDOFF")
  },
  get AIGCFROGE_ENABLE_HOT_RELOAD() {
    return truthy("AIGCFROGE_ENABLE_HOT_RELOAD")
  },
}
