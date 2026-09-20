/**
 * E4 global teardown.
 *
 * ORDERING FACT (playwright@1.59.1 runner/tasks.js:106 + runDeferCleanup): the
 * `globalTeardown` hook runs BEFORE the webServer plugin's teardown, so the
 * orchestrator is still alive when this function starts. This teardown
 * therefore OWNS stopping it: SIGTERM the orchestrator's process group (it is
 * the group leader; backend and preview inherited the group), wait for the
 * orchestrator's report and for every port to fall, SIGKILL as a last resort,
 * then enforce the §5.3 gate: no leaked ports, no surviving process group, no
 * workspace residue. On failure the run dir is preserved out of /tmp.
 */
import { connect } from "node:net"
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { isRecord, readManifest } from "./manifest"
import { Environment } from "./environment"

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function portInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(port, "127.0.0.1")
    socket.once("connect", () => {
      socket.destroy()
      resolve(true)
    })
    socket.once("error", () => {
      socket.destroy()
      resolve(false)
    })
  })
}

/**
 * Resolve the pgid to signal. Playwright launches the webServer with
 * `shell: true`, so the shell is the group leader and the group id differs from
 * the orchestrator's pid; the orchestrator records the real pgid in its
 * manifest, and `ps` is the fallback if that field is missing.
 */
function resolvePgid(runDir: string, pid: number, recorded: number | undefined): number {
  if (recorded && recorded > 0) return recorded
  const result = spawnSync("ps", ["-o", "pgid=", "-p", String(pid)], {
    encoding: "utf8",
    env: Environment.create(runDir, process.env),
  })
  const pgid = Number(result.stdout.trim())
  return Number.isFinite(pgid) && pgid > 0 ? pgid : pid
}

function processGroupAlive(pgid: number): boolean {
  try {
    process.kill(-pgid, 0)
    return true
  } catch {
    return false
  }
}

/** Read the orchestrator's own teardown report, tolerating an absent or partial file. */
function readReport(reportPath: string): { clean: boolean; leakedPorts: Array<string>; reason: string } | undefined {
  if (!existsSync(reportPath)) return undefined
  const raw: unknown = JSON.parse(readFileSync(reportPath, "utf8"))
  if (!isRecord(raw)) return undefined
  const leakedPorts = Array.isArray(raw.leakedPorts)
    ? raw.leakedPorts.filter((entry): entry is string => typeof entry === "string")
    : []
  return {
    clean: raw.clean === true,
    leakedPorts,
    reason: typeof raw.reason === "string" ? raw.reason : "unknown",
  }
}

export default async function globalTeardown() {
  const runDir = process.env.E4_RUN_DIR ?? ""
  const manifestPath = path.join(runDir, "manifest.json")
  if (!runDir || !existsSync(manifestPath)) {
    throw new Error(`E4 run dir has no manifest — the orchestrator never became ready (${runDir})`)
  }
  const manifest = readManifest(runDir)
  const pgid = resolvePgid(runDir, manifest.pid, manifest.pgid)

  const signalGroup = (signal: NodeJS.Signals) => {
    try {
      process.kill(-pgid, signal)
    } catch {
      // already gone — that is the desired end state
    }
  }
  signalGroup("SIGTERM")

  const reportPath = path.join(runDir, "teardown-report.json")
  // Wait for the real end state — ports released AND the whole process group
  // gone (the shell leader lingers until the orchestrator exits). SIGKILL the
  // group if the graceful path has not finished within the grace window.
  const deadline = Date.now() + 20_000
  let leakedPorts: Array<string> = []
  let groupAlive = true
  let forcedKill = false
  for (;;) {
    leakedPorts = []
    for (const [name, port] of [
      ["provider", manifest.providerPort],
      ["backend", manifest.backendPort],
      ["preview", manifest.previewPort],
    ] as const) {
      if (await portInUse(port)) leakedPorts.push(`${name}:${port}`)
    }
    groupAlive = processGroupAlive(pgid)
    if (leakedPorts.length === 0 && !groupAlive) break
    if (Date.now() > deadline) {
      if (forcedKill) break
      forcedKill = true
      signalGroup("SIGKILL")
      await sleep(3_000)
      continue
    }
    await sleep(500)
  }

  const report = readReport(reportPath)

  // Workspace residue: the backend may create its own `.aigcfroge` state dir in
  // the project; anything else in the temp workspace is unexpected.
  const allowed = new Set([".git", ".aigcfroge"])
  const residue = existsSync(manifest.workspaceDir)
    ? readdirSync(manifest.workspaceDir).filter((entry) => !allowed.has(entry))
    : []

  const problems: Array<string> = []
  if (leakedPorts.length > 0) problems.push(`ports still listening: ${leakedPorts.join(", ")}`)
  if (groupAlive) problems.push(`process group ${pgid} still alive`)
  if (residue.length > 0) problems.push(`workspace residue: ${residue.join(", ")}`)
  if (report && !report.clean && report.leakedPorts.length > 0) {
    problems.push(`orchestrator reported leaked ports: ${report.leakedPorts.join(", ")}`)
  }

  // The gate records its own verdict next to the orchestrator's report so the
  // evidence survives even when the orchestrator was killed before reporting.
  const gateEvidence = {
    at: new Date().toISOString(),
    pgid,
    leakedPorts,
    groupAlive,
    residue,
    forcedKill,
    orchestratorReport: report ?? null,
    passed: problems.length === 0,
  }
  writeFileSync(path.join(runDir, "teardown-gate.json"), JSON.stringify(gateEvidence, null, 2))

  if (problems.length > 0) {
    const preserved = path.join(path.dirname(runDir), `e4-teardown-failure-${Date.now()}`)
    cpSync(runDir, preserved, { recursive: true })
    throw new Error(`E4 teardown gate failed: ${problems.join("; ")} (run dir preserved at ${preserved})`)
  }

  const evidence = report
    ? `report clean (${report.reason})`
    : "report absent (orchestrator killed before writing); port/process/workspace probes are the gate"
  process.stdout.write(
    `[E4] teardown gate passed: ports free, process group gone, workspace clean, backend ${manifest.backendVersion}, ${evidence}${forcedKill ? ", forced SIGKILL after grace" : ""}\n`,
  )
}
