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
import { Database } from "bun:sqlite"
import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { isRecord } from "./manifest"

// This file lives at packages/app/e2e/real/ — four levels below the repo root.
const REPO_ROOT = path.resolve(import.meta.dir, "../../../..")
const APP_ROOT = path.join(REPO_ROOT, "packages/app")
const BACKEND_ROOT = path.join(REPO_ROOT, "packages/aigcfroge")

// Explicit V2-variant switch (default OFF). The default backend must never carry
// AIGCFROGE_V2_RUNTIME: the durable-admission path is opt-in, incomplete, and not
// the product default — a harness that silently enabled it would be asserting a
// non-product chain. Only this switch injects the flag, and only into the backend.
const v2Runtime = process.env.E4_V2_RUNTIME === "1"
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

const BACKEND_ARGS = [
  "run",
  "--conditions=browser",
  "./src/index.ts",
  "serve",
  "--port",
  String(backendPort),
  "--hostname",
  "127.0.0.1",
]

/** The only place AIGCFROGE_V2_RUNTIME can enter the backend: the explicit switch. */
const backendEnv = (): Record<string, string> => ({
  AIGCFROGE_DB: dbPath,
  AIGCFROGE_CONFIG_DIR: configDir,
  ...(v2Runtime ? { AIGCFROGE_V2_RUNTIME: "true" } : {}),
})

// Durable copy of this process's output. /tmp cleaners wiped the S2 round
// logs; the gate evidence must not depend on volatile tmp files.
const logPath = path.join(runDir, "orchestrator.log")
const log = (line: string) => {
  process.stdout.write(line)
  writeFileSync(logPath, line, { flag: "a" })
}

// ── deterministic provider ───────────────────────────────────────────────────

type ProviderFailureMode = "http-500" | "sse-cut" | "slow" | "duplicate"
type ProviderScenario = ProviderFailureMode | "healthy"
type ProviderRequest = {
  method: string
  path: string
  receivedAt: number
  scenario?: ProviderScenario
  responseStartedAt?: number
}

const providerRequests: ProviderRequest[] = []

/**
 * Armed transient failures for the provider failure/recovery cases (plan §12.4). Each armed
 * failure makes the next completion change *inside a real turn*. The four modes cover a
 * classifiable HTTP 5xx, an interrupted stream with no status, a delayed response, and a repeated
 * content delta. The spec arms them over HTTP rather than faking behavior in the test, and reads
 * attempt counts plus non-prompt timing metadata back from `/e4/provider-requests`.
 */
let providerFailures = 0
let providerFailureMode: ProviderFailureMode = "http-500"
const providerFailureModes: ReadonlyArray<ProviderFailureMode> = ["http-500", "sse-cut", "slow", "duplicate"]
const isProviderFailureMode = (value: string): value is ProviderFailureMode =>
  providerFailureModes.some((mode) => mode === value)
/** How long `mode=slow` withholds the response headers. Long enough to be a real stall, short
 * enough that no client-side timeout can be blamed for what the case observes. */
const providerSlowDelayMs = 5_000

function sseChunk(delta: Record<string, unknown>, finish?: string) {
  return `data: ${JSON.stringify({
    id: "chatcmpl-e4",
    object: "chat.completion.chunk",
    choices: [{ delta, ...(finish ? { finish_reason: finish } : {}) }],
  })}\n\n`
}

/**
 * The ordinary completion body, shared by the healthy path and by the modes that only change what
 * surrounds it (`slow` withholds it, `duplicate` repeats one delta). `repeat` exists so the
 * duplicated-delta case sends byte-identical chunks from one source rather than a hand-copied
 * line that could drift from the healthy one.
 */
function writeCompletion(response: ServerResponse, options: { repeat?: number } = {}) {
  response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" })
  response.write(sseChunk({ role: "assistant", content: "" }))
  response.write(
    Array.from({ length: options.repeat ?? 1 }, () => sseChunk({ content: "E4 deterministic response" })).join(""),
  )
  response.write(sseChunk({}, "stop"))
  response.write("data: [DONE]\n\n")
  response.end()
}

/**
 * Durable-admission evidence (plan §8.1): `session_input` has no HTTP surface,
 * and `bun:sqlite` only exists in this bun process — so the harness serves a
 * read-only view of the run's own DB. WAL mode allows a second reader while the
 * backend writes; nothing here touches production routes.
 */
function readAdmission(sessionID: string) {
  const db = new Database(dbPath, { readonly: true })
  try {
    // Deliberately excludes the `prompt` column: session_input rows carry the
    // user's full input, and this evidence surface must stay safe to paste into
    // reports. IDs, sequence numbers and timestamps are all a test needs.
    const columns = "id, session_id as sessionID, kind, delivery, admitted_seq, promoted_seq, time_created"
    if (!sessionID) {
      return db.query(`select ${columns} from session_input order by time_created desc limit 20`).all()
    }
    return db.query(`select ${columns} from session_input where session_id = ? order by admitted_seq`).all(sessionID)
  } finally {
    db.close()
  }
}

const provider: Server = createServer((request: IncomingMessage, response: ServerResponse) => {
  const record: ProviderRequest = { method: request.method ?? "?", path: request.url ?? "?", receivedAt: Date.now() }
  providerRequests.push(record)
  // Restart the real backend (S5 restart window). Answers 202 immediately and
  // restarts in the background: holding the HTTP response open for a cold start
  // trips the client's header timeout long before the backend is healthy. The
  // test polls /e4/backend-health for the real readiness signal instead.
  if (request.method === "POST" && record.path.startsWith("/e4/restart-backend")) {
    void (async () => {
      try {
        const previous = backendChild
        if (previous && previous.exitCode === null && previous.signalCode === null) {
          const stopped = new Promise<void>((resolve) => previous.once("exit", () => resolve()))
          previous.kill("SIGTERM")
          await Promise.race([stopped, new Promise((resolve) => setTimeout(resolve, 5_000))])
          if (previous.exitCode === null && previous.signalCode === null) previous.kill("SIGKILL")
        }
        backendChild = spawnChild("backend", process.execPath, BACKEND_ARGS, BACKEND_ROOT, backendEnv())
        const health = await waitForHealthy(backendUrl, 300_000)
        log(`[E4] backend restarted and healthy (version ${health.version})\n`)
      } catch (error) {
        log(`[E4] backend restart failed: ${error instanceof Error ? error.message : String(error)}\n`)
      }
    })()
    response.writeHead(202, { "content-type": "application/json" })
    response.end(JSON.stringify({ restarting: true }))
    return
  }
  // Readiness probe for the restart flow: a real request to the backend's own
  // health endpoint, never a sleep.
  if (request.method === "GET" && record.path.startsWith("/e4/backend-health")) {
    void (async () => {
      try {
        const probe = await fetch(`${backendUrl}/global/health`)
        const body: unknown = probe.ok ? await probe.json() : undefined
        response.writeHead(200, { "content-type": "application/json" })
        response.end(
          JSON.stringify({
            healthy: probe.ok,
            version: isRecordLocal(body) && typeof body.version === "string" ? body.version : undefined,
          }),
        )
      } catch {
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({ healthy: false }))
      }
    })()
    return
  }
  // Backend-visible provider dispatch evidence for the V2 gap spec: method+path
  // only, same redaction rule as the run log.
  if (request.method === "GET" && record.path.startsWith("/e4/provider-requests")) {
    response.writeHead(200, { "content-type": "application/json" })
    response.end(JSON.stringify({ requests: providerRequests }))
    return
  }
  if (request.method === "GET" && record.path.startsWith("/e4/admission")) {
    const sessionID = new URL(record.path, "http://127.0.0.1").searchParams.get("sessionID") ?? ""
    try {
      const rows = readAdmission(sessionID)
      response.writeHead(200, { "content-type": "application/json" })
      response.end(JSON.stringify({ sessionID, rows }))
    } catch (error) {
      response.writeHead(500, { "content-type": "application/json" })
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
    }
    return
  }
  // Arm (or disarm, with count=0) the next N completion requests to answer the armed failure.
  // A query parameter rather than a body, matching /e4/admission above and keeping this process
  // free of request-body parsing. `mode` selects the family: `http-500` is a status the client
  // can classify; `sse-cut` is a stream that starts correctly and then dies — the shape a proxy or
  // a crashed upstream produces, which reaches the client as a terminated stream rather than an
  // HTTP status; `slow` withholds the headers; `duplicate` repeats one content delta, which is the
  // downstream half of a proxy retry. An unknown mode is refused instead of silently defaulting.
  if (request.method === "POST" && record.path.startsWith("/e4/provider-failures")) {
    const query = new URL(record.path, "http://127.0.0.1").searchParams
    const mode = query.get("mode") ?? "http-500"
    if (!isProviderFailureMode(mode)) {
      response.writeHead(400, { "content-type": "application/json" })
      response.end(JSON.stringify({ error: `unknown provider failure mode: ${mode}` }))
      return
    }
    const parsed = Number.parseInt(query.get("count") ?? "0", 10)
    providerFailures = Number.isFinite(parsed) && parsed > 0 ? parsed : 0
    providerFailureMode = mode
    response.writeHead(200, { "content-type": "application/json" })
    response.end(JSON.stringify({ armed: providerFailures, mode: providerFailureMode }))
    return
  }
  if (request.method === "POST" && record.path.endsWith("/chat/completions")) {
    if (providerFailures > 0) {
      providerFailures -= 1
      record.scenario = providerFailureMode
      if (providerFailureMode === "sse-cut") {
        record.responseStartedAt = Date.now()
        response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" })
        response.write(sseChunk({ role: "assistant", content: "" }))
        response.write(sseChunk({ content: "E4 truncated" }))
        // No finish reason, no [DONE]: the response just ends. `destroy` rather than `end` so the
        // client sees a terminated stream instead of a well-formed empty completion.
        response.destroy()
        return
      }
      if (providerFailureMode === "slow") {
        setTimeout(() => {
          record.responseStartedAt = Date.now()
          writeCompletion(response)
        }, providerSlowDelayMs)
        return
      }
      if (providerFailureMode === "duplicate") {
        record.responseStartedAt = Date.now()
        writeCompletion(response, { repeat: 2 })
        return
      }
      record.responseStartedAt = Date.now()
      response.writeHead(500, { "content-type": "application/json" })
      response.end(JSON.stringify({ error: { type: "server_error", message: "E4 armed transient failure" } }))
      return
    }
    record.scenario = "healthy"
    record.responseStartedAt = Date.now()
    writeCompletion(response)
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
let backendChild: ChildProcess | undefined

/**
 * This process's group id. Playwright spawns the webServer with `shell: true`,
 * so the shell — not us — is the group leader, and manifest.pid alone cannot
 * address the group. /proc/self/stat field 5 is the pgrp on Linux; fall back to
 * our own pid when it is unavailable so teardown still has a target.
 */
const isRecordLocal = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null

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

/** Bound one readiness probe so a connection accepted during backend boot cannot hold the whole
 * run past the outer deadline. This is an external HTTP boundary, not a sleep-based readiness
 * substitute: success still comes only from the backend's own health response. */
async function fetchWithin(url: string, timeoutMs: number) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

/** Poll a health endpoint until it answers `ok` — the backend's own readiness signal. */
function waitForHealthy(url: string, timeoutMs: number): Promise<{ version: string }> {
  const deadline = Date.now() + timeoutMs
  const attempt = async (): Promise<{ version: string }> => {
    try {
      const response = await fetchWithin(`${url}/global/health`, 5_000)
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
      await fetchWithin(url, 5_000)
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
  backendChild = spawnChild("backend", process.execPath, BACKEND_ARGS, BACKEND_ROOT, backendEnv())
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
        v2Runtime,
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
