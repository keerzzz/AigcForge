/**
 * Typed access to the E4 runtime manifest and to backend JSON responses.
 * Every read narrows through guards — `JSON.parse`/`response.json()` return
 * `any`, and the lint gate re-enables `no-unsafe-type-assertion` on new lines.
 */
import { readFileSync } from "node:fs"

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function numberField(record: Record<string, unknown>, key: string, source: string): number {
  const value = record[key]
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${source}: field "${key}" is missing or not a number`)
  }
  return value
}

export function stringField(record: Record<string, unknown>, key: string, source: string): string {
  const value = record[key]
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${source}: field "${key}" is missing or not a string`)
  }
  return value
}

export interface E4Backend {
  backendVersion: string
  backendPort: number
  backendUrl: string
  configDir: string
  dbPath: string
  workspaceDir: string
}

export interface E4Manifest extends E4Backend {
  runDir: string
  providerBaseURL: string
  providerPort: number
  previewPort: number
  previewUrl: string
  v2Runtime: boolean
  customMode: boolean
  pid: number
  pgid?: number
  peer?: E4Backend
}

function readBackend(raw: unknown, source: string): E4Backend {
  if (!isRecord(raw)) throw new Error(`${source} is not an object`)
  return {
    backendVersion: stringField(raw, "backendVersion", source),
    backendPort: numberField(raw, "backendPort", source),
    backendUrl: stringField(raw, "backendUrl", source),
    configDir: stringField(raw, "configDir", source),
    dbPath: stringField(raw, "dbPath", source),
    workspaceDir: stringField(raw, "workspaceDir", source),
  }
}

/**
 * Read the orchestrator's runtime manifest. The orchestrator writes it only
 * after backend health and preview readiness, so its presence is the "run is
 * ready" signal for specs and for the teardown gate.
 */
export function readManifest(runDir: string): E4Manifest {
  const manifestPath = `${runDir}/manifest.json`
  const raw: unknown = JSON.parse(readFileSync(manifestPath, "utf8"))
  if (!isRecord(raw)) throw new Error(`E4 manifest at ${manifestPath} is not an object`)
  const source = `E4 manifest at ${manifestPath}`
  const pgid = raw.pgid === undefined ? undefined : numberField(raw, "pgid", source)
  return {
    ...readBackend(raw, source),
    ...(raw.peer === undefined ? {} : { peer: readBackend(raw.peer, `${source} peer`) }),
    runDir: stringField(raw, "runDir", source),
    providerBaseURL: stringField(raw, "providerBaseURL", source),
    providerPort: numberField(raw, "providerPort", source),
    previewPort: numberField(raw, "previewPort", source),
    previewUrl: stringField(raw, "previewUrl", source),
    v2Runtime: raw.v2Runtime === true,
    customMode: raw.customMode === true,
    pid: numberField(raw, "pid", source),
    pgid,
  }
}
