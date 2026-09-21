/** One isolation boundary for the E4 launcher, backend (including restart), build and preview. */
import { mkdirSync } from "node:fs"
import path from "node:path"

export function create(runDir: string, parent: NodeJS.ProcessEnv): Record<string, string> {
  const dirs = directories(runDir)
  // Do not inherit provider credentials, proxies, startup hooks, Git overrides or product flags.
  const allowed = [
    "PATH",
    "Path",
    "PATHEXT",
    "SystemRoot",
    "SYSTEMROOT",
    "WINDIR",
    "COMSPEC",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "TZ",
    "TERM",
    "COLORTERM",
    "CI",
    "NO_COLOR",
    "FORCE_COLOR",
  ]
  return {
    ...Object.fromEntries(allowed.flatMap((key) => (parent[key] === undefined ? [] : [[key, parent[key]]]))),
    HOME: dirs.home,
    USERPROFILE: dirs.home,
    APPDATA: dirs.config,
    LOCALAPPDATA: dirs.data,
    XDG_CONFIG_HOME: dirs.config,
    XDG_CONFIG_DIRS: dirs.config,
    XDG_DATA_HOME: dirs.data,
    XDG_DATA_DIRS: dirs.data,
    XDG_CACHE_HOME: dirs.cache,
    XDG_STATE_HOME: dirs.state,
    XDG_RUNTIME_DIR: dirs.runtime,
    TMPDIR: dirs.tmp,
    TMP: dirs.tmp,
    TEMP: dirs.tmp,
    GIT_CONFIG_GLOBAL: path.join(dirs.home, ".gitconfig"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TEMPLATE_DIR: dirs.gitTemplate,
    npm_config_userconfig: path.join(dirs.home, ".npmrc"),
    npm_config_globalconfig: path.join(dirs.home, ".npmrc"),
    npm_config_cache: path.join(dirs.cache, "npm"),
    BUN_INSTALL_CACHE_DIR: path.join(dirs.cache, "bun"),
    // No fallback to cloud instance credentials if a provider SDK probes the default chain.
    AWS_EC2_METADATA_DISABLED: "true",
  }
}

export function backend(
  input: { runDir: string; entrypoint: string; port: number; v2Runtime: boolean },
  parent: NodeJS.ProcessEnv,
): { args: string[]; cwd: string; env: Record<string, string> } {
  if (!path.isAbsolute(input.entrypoint)) throw new Error("E4 backend entrypoint must be absolute")
  return {
    args: [
      "--no-env-file",
      "run",
      "--conditions=browser",
      input.entrypoint,
      "serve",
      "--port",
      String(input.port),
      "--hostname",
      "127.0.0.1",
    ],
    // WorkspaceRouting.defaultDirectory falls back to cwd. Never make the repo the default
    // instance, even with ConfigPaths' project-config scan disabled as a second guard.
    cwd: path.join(input.runDir, "workspace"),
    env: {
      ...create(input.runDir, parent),
      AIGCFROGE_DB: path.join(input.runDir, "e4.sqlite"),
      AIGCFROGE_CONFIG_DIR: path.join(input.runDir, "config"),
      AIGCFROGE_DISABLE_PROJECT_CONFIG: "true",
      AIGCFROGE_DISABLE_AUTOUPDATE: "true",
      AIGCFROGE_DISABLE_MODELS_FETCH: "true",
      ...(input.v2Runtime ? { AIGCFROGE_V2_RUNTIME: "true" } : {}),
    },
  }
}

export function webServer(runDir: string, parent: NodeJS.ProcessEnv) {
  // Playwright merges webServer.env over process.env and types values as string, not undefined.
  // Blank every unapproved key BEFORE its shell/Bun starts; create() then omits them entirely
  // from all application children. Passing only create() here would silently restore secrets.
  return {
    ...Object.fromEntries(Object.keys(parent).map((key) => [key, ""])),
    ...create(runDir, parent),
  }
}

export function prepare(runDir: string) {
  Object.values(directories(runDir)).forEach((dir) => mkdirSync(dir, { recursive: true, mode: 0o700 }))
}

function directories(runDir: string) {
  if (!path.isAbsolute(runDir)) throw new Error("E4_RUN_DIR must be absolute")
  return {
    home: path.join(runDir, "home"),
    config: path.join(runDir, "xdg", "config"),
    data: path.join(runDir, "xdg", "data"),
    cache: path.join(runDir, "xdg", "cache"),
    state: path.join(runDir, "xdg", "state"),
    runtime: path.join(runDir, "xdg", "runtime"),
    tmp: path.join(runDir, "tmp"),
    gitTemplate: path.join(runDir, "git-template"),
  }
}

export * as Environment from "./environment"
