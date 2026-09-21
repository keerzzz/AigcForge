import { expect, test } from "bun:test"
import path from "node:path"
import { Environment } from "../real/environment"

const runDir = path.resolve("/synthetic-e4-run")
// Synthetic sentinels only; do not inspect any real HOME, auth file or credential value.
const parent = {
  PATH: "/usr/bin:/bin",
  SystemRoot: "C:\\Windows",
  LANG: "C.UTF-8",
  HOME: "/real-home-not-read",
  USERPROFILE: "/real-home-not-read",
  XDG_CONFIG_HOME: "/real-config-not-read",
  XDG_DATA_HOME: "/real-data-not-read",
  XDG_CACHE_HOME: "/real-cache-not-read",
  XDG_STATE_HOME: "/real-state-not-read",
  XDG_RUNTIME_DIR: "/real-runtime-not-read",
  APPDATA: "/real-roaming-not-read",
  LOCALAPPDATA: "/real-local-not-read",
  TMPDIR: "/real-tmp-not-read",
}
const secrets = Object.fromEntries(
  [
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "AWS_PROFILE",
    "AWS_SHARED_CREDENTIALS_FILE",
    "AWS_CONTAINER_CREDENTIALS_FULL_URI",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "AZURE_CLIENT_SECRET",
    "SSH_AUTH_SOCK",
    "GITHUB_TOKEN",
    "NPM_TOKEN",
    "SENTRY_AUTH_TOKEN",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NODE_OPTIONS",
    "BUN_OPTIONS",
    "BASH_ENV",
    "ENV",
    "LD_PRELOAD",
    "AIGCFROGE_CONFIG",
    "AIGCFROGE_CONFIG_CONTENT",
    "AIGCFROGE_TEST_HOME",
    "AIGCFROGE_V2_RUNTIME",
    "AIGCFROGE_SERVER_PASSWORD",
    "GIT_CONFIG_COUNT",
    "GIT_CONFIG_KEY_0",
    "GIT_CONFIG_VALUE_0",
    "UNRECOGNIZED_FUTURE_CREDENTIAL",
  ].map((key) => [key, "synthetic-private-value"]),
)

test("all user-directory and temporary-file sources are run-local", () => {
  const env = Environment.create(runDir, parent)
  for (const key of [
    "HOME",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_CACHE_HOME",
    "XDG_STATE_HOME",
    "XDG_RUNTIME_DIR",
    "TMPDIR",
    "TMP",
    "TEMP",
  ]) {
    expect(env[key]?.startsWith(runDir + path.sep), key).toBe(true)
  }
  expect(env.PATH).toBe(parent.PATH)
  expect(env.SystemRoot).toBe(parent.SystemRoot)
  expect(env.LANG).toBe(parent.LANG)
})

test("child environment is an allowlist, not a product-prefix blacklist", () => {
  const env = Environment.create(runDir, { ...parent, ...secrets })
  for (const key of Object.keys(secrets)) expect(env[key], key).toBeUndefined()
  expect(env.GIT_CONFIG_NOSYSTEM).toBe("1")
  expect(env.GIT_CONFIG_GLOBAL).toStartWith(runDir + path.sep)
  expect(env.AWS_EC2_METADATA_DISABLED).toBe("true")
})

test("Playwright's parent-env merge cannot restore credentials or startup hooks", () => {
  const inherited = { ...parent, ...secrets }
  const merged: NodeJS.ProcessEnv = { ...inherited, ...Environment.webServer(runDir, inherited) }
  for (const key of Object.keys(secrets)) expect(merged[key], key).toBe("")
  expect(merged.HOME).toStartWith(runDir + path.sep)
  expect(merged.PATH).toBe(parent.PATH)
})

test("environment construction is pure and fresh across runs", () => {
  const inherited = { ...parent, ...secrets }
  const before = { ...inherited }
  const a = Environment.create(runDir, inherited)
  const b = Environment.create(runDir + "-next", inherited)
  expect(inherited).toEqual(before)
  expect(a.HOME).not.toBe(b.HOME)
  expect(() => Environment.create("relative-run", inherited)).toThrow()
})

test("backend startup and restart use an absolute entrypoint and the run workspace, not the repo cwd", () => {
  const entrypoint = path.resolve("/synthetic-repo/packages/aigcfroge/src/index.ts")
  const input = { runDir, entrypoint, port: 41002, v2Runtime: false }
  const backend = Environment.backend(input, { ...parent, ...secrets })
  expect(backend.cwd).toBe(path.join(runDir, "workspace"))
  expect(backend.args).toEqual([
    "--no-env-file",
    "run",
    "--conditions=browser",
    entrypoint,
    "serve",
    "--port",
    "41002",
    "--hostname",
    "127.0.0.1",
  ])
  expect(backend.env.AIGCFROGE_CONFIG_DIR).toBe(path.join(runDir, "config"))
  expect(backend.env.AIGCFROGE_DB).toBe(path.join(runDir, "e4.sqlite"))
  expect(backend.env.AIGCFROGE_DISABLE_PROJECT_CONFIG).toBe("true")
  expect(backend.env.AIGCFROGE_V2_RUNTIME).toBeUndefined()
  expect(backend.env.OPENAI_API_KEY).toBeUndefined()
  expect(Environment.backend(input, { ...parent, ...secrets })).toEqual(backend)
  expect(Environment.backend({ ...input, v2Runtime: true }, parent).env.AIGCFROGE_V2_RUNTIME).toBe("true")
  expect(() => Environment.backend({ ...input, entrypoint: "./src/index.ts" }, parent)).toThrow()
})
