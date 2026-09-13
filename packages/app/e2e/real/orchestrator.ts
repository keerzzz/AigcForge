/**
 * E4 process orchestrator — the webServer command for the real Playwright
 * project. It owns, for exactly one run:
 *
 *   1. the deterministic provider (in-process loopback server speaking the
 *      OpenAI-compatible /chat/completions SSE protocol),
 *   2. the real backend (`aigcfroge serve` with a temp SQLite DB, temp config
 *      dir carrying the loopback provider, temp workspace),
 *   3. the production app preview (`vite build` then `vite preview`).
 *
 * Playwright starts this process and SIGTERMs it on exit; the signal handler
 * stops backend and preview, closes the provider, probes every E4 port free,
 * and writes a teardown report that `global-teardown.ts` enforces. On startup
 * failure the whole run dir (logs, manifest, DB) is preserved for post-mortem.
 *
 * No sleep-based readiness: the backend is polled through its real
 * `GET /global/health` endpoint, the preview through any HTTP response. The
 * provider records request method+path only — never prompt bodies.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { isRecord } from "./manifest"

// This file lives at packages/app/e2e/real/ — four levels below the repo root.
const REPO_ROOT = path.resolve(import.meta.dir, "../../../..")
const APP_ROOT = path.join(REPO_ROOT, "packages/app")
const BACKEND_ROOT = path.join(REPO_ROOT, "packages/aigcfroge")

const providerPort = Number(process.env.E4_PROVIDER_PORT)
const backendPort = Number(process.env.E4_BACKEND_PORT)
const previewPort = Number(process.env.E4_PREVIEW_PORT)
const runDir = process.env.E4_RUN_DIR ?? ""
if (!Number.isFinite(providerPort)) throw new Error("E4_PROVIDER_PORT is missing or not a number")
if (!Number.isFinite(backendPort)) throw new Error("E4_BACKEND_PORT is missing or not a number")
if (!Number.isFinite(previewPort)) throw new Error("E4_PREVIEW_PORT is missing or not a number")
if (!runDir) throw new Error("E4_RUN_DIR is missing")
for (const [name, dir] of [
  ["REPO_ROOT", REPO_ROOT],
  ["APP_ROOT", APP_ROOT],
  ["BACKEND_ROOT", BACKEND_ROOT],
] as const) {
  if (!existsSync(dir)) throw new Error(`${name} does not exist: ${dir}`)
}

const configDir = path.join(runDir, "config")
const dbPath = path.join(runDir, "e4.sqlite")
const workspaceDir = path.join(runDir, "workspace")
const backendUrl = `http://127.0.0.1:${backendPort}`
const previewUrl = `http://127.0.0.1:${previewPort}`

for (const dir of [configDir, workspaceDir]) mkdirSync(dir, { recursive: true })

// Durable copy of this process's output. /tmp cleaners wiped the S2 round
// logs; the gate evidence must not depend on volatile tmp files.
const logPath = path.join(runDir, "orchestrator.log")
const log = (line: string) => {
  log(line)
  writeFileSync(logPath, line, { flag: "a" })
}

// ── deterministic provider ───────────────────────────────────────────────────

const providerRequests: Array<{ method: string; path: string }> = []

function sseChunk(delta: Record<string, unknown>, finish?: string) {
  return `data: ${JSON.stringify({
    id: "chatcmpl-e4",
    object: "chat.completion.chunk",
    choices: [{ delta, ...(finish ? { finish_reason: finish } : {}) }],
  })}\n\n`
}

const provider: Server = createServer((request: IncomingMessage, response: ServerResponse) => {
  const record = { method: request.method ?? "?", path: request.url ?? "?" }
  providerRequests.push(record)
  if (request.method === "POST" && record.path.endsWith("/chat/completions")) {
    response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" })
    response.write(sseChunk({ role: "assistant", content: "" }))
    response.write(sseChunk({ content: "E4 deterministic response" }))
    response.write(sseChunk({}, "stop"))
    response.write("data: [DONE]\n\n")
    response.end()
    return
  }
  response.writeHead(404, { "content-type": "application/json" })
  response.end(JSON.stringify({ error: `E4 provider has no handler for ${record.method} ${record.path}` }))
})

function startProvider(): Promise<void> {
  return new Promise((resolve, reject) => {
    provider.once("error", reject)
    provider.listen(providerPort, "127.0.0.1", () => resolve())
  })
}

// ── child process helpers ────────────────────────────────────────────────────

const children: Array<ChildProcess> = []

/**
 * This process's group id. Playwright spawns the webServer with `shell: true`,
 * so the shell — not us — is the group leader, and manifest.pid alone cannot
 * address the group. /proc/self/stat field 5 is the pgrp on Linux; fall back to
 * our own pid when it is unavailable so teardown still has a target.
 */
function currentPgid(): number {
  try {
    const stat = readFileSync("/proc/self/stat", "utf8")
    const afterComm = stat.slice(stat.lastIndexOf(")") + 2).split(" ")
    const pgid = Number(afterComm[2])
    return Number.isFinite(pgid) && pgid > 0 ? pgid : process.pid
  } catch {
    return process.pid
  }
}

function spawnChild(name: string, command: string, args: Array<string>, cwd: string, extraEnv: Record<string, string>) {
  const child = spawn(command, args, {
    cwd,
    env: {
      // Strip inherited AIGCFROGE_* so the user's local server configuration
      // can never leak into the isolated E4 run.
      ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("AIGCFROGE_"))),
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  })
  children.push(child)
  const logChild = (level: string, line: string) => log(`[E4:${name}] ${level}: ${line}\n`)
  child.stdout?.on("data", (chunk: Buffer) => logChild("out", chunk.toString().trimEnd()))
  child.stderr?.on("data", (chunk: Buffer) => logChild("err", chunk.toString().trimEnd()))
  child.on("exit", (code) => logChild("exit", `code=${code ?? "signal"}`))
  return child
}

/** Poll a health endpoint until it answers `ok` — the backend's own readiness signal. */
function waitForHealthy(url: string, timeoutMs: number): Promise<{ version: string }> {
  const deadline = Date.now() + timeoutMs
  const attempt = async (): Promise<{ version: string }> => {
    try {
      const response = await fetch(`${url}/global/health`)
      if (response.ok) {
        const body: unknown = await response.json()
        if (isRecord(body) && typeof body.version === "string") return { version: body.version }
      }
      log(`[E4:health] attempt status=${response.status}\n`)
    } catch (error) {
      const cause = error instanceof Error ? error.cause : undefined
      log(
        `[E4:health] attempt failed: ${error instanceof Error ? error.message : String(error)} cause=${cause instanceof Error ? cause.message : String(cause)}\n`,
      )
    }
    if (Date.now() > deadline) throw new Error(`health never became ok within ${timeoutMs}ms at ${url}`)
    await new Promise((resolve) => setTimeout(resolve, 1000))
    return attempt()
  }
  return attempt()
}

/** Poll any HTTP response — the preview serving static files has no /global/health. */
async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  const attempt = async (): Promise<void> => {
    try {
      await fetch(url)
      return
    } catch {
      // not ready yet — retry until the deadline
    }
    if (Date.now() > deadline) throw new Error(`no HTTP response within ${timeoutMs}ms at ${url}`)
    await new Promise((resolve) => setTimeout(resolve, 250))
    return attempt()
  }
  return attempt()
}

function waitForExit(child: ChildProcess, label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${label} exited with code ${code}`))))
    child.on("error", reject)
  })
}

function stopChild(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve()
      return
    }
    child.once("exit", () => resolve())
    child.kill("SIGTERM")
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
    }, 2000).unref()
  })
}

// ── teardown ─────────────────────────────────────────────────────────────────

async function teardown(reason: string) {
  // Write the report BEFORE cleanup: even a SIGKILL mid-teardown leaves
  // evidence, and global-teardown.ts re-probes the ports itself.
  const reportPath = path.join(runDir, "teardown-report.json")
  const write = (leakedPorts: Array<string>, clean: boolean) =>
    writeFileSync(
      reportPath,
      JSON.stringify(
        { reason, leakedPorts, providerRequestCount: providerRequests.length, clean, providerRequests },
        null,
        2,
      ),
    )
  write([], false)
  log(`[E4] teardown: ${reason}\n`)
  for (const child of children) await stopChild(child)
  provider.close()

  const { portInUse } = await import("./ports")
  const leaked: Array<string> = []
  for (const [name, port] of [
    ["provider", providerPort],
    ["backend", backendPort],
    ["preview", previewPort],
  ] as const) {
    if (await portInUse(port)) leaked.push(`${name}:${port}`)
  }
  write(leaked, leaked.length === 0)
  log(`[E4] teardown report: leaked=${JSON.stringify(leaked)} providerRequests=${providerRequests.length}\n`)
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  process.on("SIGTERM", () => {
    // Safety net: teardown normally finishes in a few seconds, but a child that
    // ignores SIGTERM or a stuck close must not keep this process alive — the
    // teardown gate's SIGKILL backstop would then be the only exit.
    const forceExit = setTimeout(() => process.exit(0), 8_000)
    forceExit.unref()
    void teardown("SIGTERM").then(() => process.exit(0))
  })
  process.on("SIGINT", () => {
    const forceExit = setTimeout(() => process.exit(0), 8_000)
    forceExit.unref()
    void teardown("SIGINT").then(() => process.exit(0))
  })

  // 1. seed the temp config dir: one loopback provider with model defaults
  //    pointing at it (ConfigV1 shape — packages/core/src/v1/config/provider.ts).
  const providerBaseURL = `http://127.0.0.1:${providerPort}/v1`
  writeFileSync(
    path.join(configDir, "aigcfroge.json"),
    JSON.stringify(
      {
        model: "e4-real/e4-deterministic",
        small_model: "e4-real/e4-deterministic",
        provider: {
          "e4-real": {
            npm: "@ai-sdk/openai-compatible",
            name: "E4 Deterministic Provider",
            options: { baseURL: providerBaseURL, apiKey: "e4-loopback-only" },
            models: {
              "e4-deterministic": {
                name: "E4 Deterministic",
                tool_call: true,
                limit: { context: 200_000, output: 8_192 },
              },
            },
          },
        },
      },
      null,
      2,
    ),
  )

  // 2. git-init the temp workspace so the backend sees a real project directory.
  spawnSync("git", ["init", "-q", workspaceDir])

  // 3. deterministic provider on loopback.
  await startProvider()
  log(`[E4] provider listening on ${providerBaseURL}\n`)

  // 4. real backend; readiness is its own /global/health.
  spawnChild(
    "backend",
    process.execPath,
    [
      "run",
      "--conditions=browser",
      "./src/index.ts",
      "serve",
      "--port",
      String(backendPort),
      "--hostname",
      "127.0.0.1",
    ],
    BACKEND_ROOT,
    { AIGCFROGE_DB: dbPath, AIGCFROGE_CONFIG_DIR: configDir },
  )
  const health = await waitForHealthy(backendUrl, 600_000)
  log(`[E4] backend healthy at ${backendUrl} (version ${health.version})\n`)

  // 5. production build, then preview. The app resolves the backend through the
  //    seeded localStorage registry, so the build carries no port.
  const build = spawnChild("build", process.execPath, ["run", "build"], APP_ROOT, {})
  await waitForExit(build, "vite build")
  spawnChild(
    "preview",
    process.execPath,
    ["run", "serve", "--port", String(previewPort), "--strictPort", "--host", "127.0.0.1"],
    APP_ROOT,
    {},
  )
  await waitForHttp(previewUrl, 60_000)
  log(`[E4] preview serving at ${previewUrl}\n`)

  // 6. runtime manifest for the specs and global teardown, then stay alive —
  //    Playwright owns this process's lifetime.
  writeFileSync(
    path.join(runDir, "manifest.json"),
    JSON.stringify(
      {
        runDir,
        backendVersion: health.version,
        providerBaseURL,
        providerPort,
        backendPort,
        previewPort,
        backendUrl,
        previewUrl,
        configDir,
        dbPath,
        workspaceDir,
        pid: process.pid,
        pgid: currentPgid(),
      },
      null,
      2,
    ),
  )
  // Keepalive: once main() completes the loop goes idle (only the provider's
  // listening socket remains), and Bun defers signal callbacks on a fully idle
  // loop — measured ~35s, longer than the teardown poll. A 1s wake-up keeps
  // SIGTERM delivery prompt so the teardown report lands inside the grace
  // window.
  setInterval(() => {}, 1_000)
}

function fail(error: unknown) {
  log(`[E4] FATAL: ${error instanceof Error ? error.message : String(error)}\n`)
  // Never leave spawned processes behind — stop them before preserving the
  // run dir for post-mortem.
  void teardown("fatal").then(() => {
    cpSync(runDir, path.join(APP_ROOT, "e2e/real/test-results", `e4-failed-${Date.now()}`), { recursive: true })
    process.exit(1)
  })
}

main().catch(fail)
