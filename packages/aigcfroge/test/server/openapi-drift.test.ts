import { existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import { openapi } from "../../src/server/server"

/**
 * The OpenAPI contract gate (S6 CI wiring).
 *
 * Two failures this catches that nothing else did:
 *  1. an endpoint declared without `OpenApi.annotations({ identifier })` — the
 *     generated SDK then flattens the method onto the parent client and it is
 *     simply `undefined` at runtime, with no other gate reporting it;
 *  2. silent drift between the checked-in snapshot and the live spec, which is how
 *     a response shape changes without anyone reviewing the contract diff.
 *
 * Update the snapshot deliberately: `UPDATE_OPENAPI_SNAPSHOT=1 bun test ./test/server/openapi-drift.test.ts`
 */
const SNAPSHOT_PATH = path.join(import.meta.dir, "openapi.snapshot.json")
const UPDATE = process.env.UPDATE_OPENAPI_SNAPSHOT === "1"

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options"])

function operations(spec: unknown): Array<{ name: string; operationId?: unknown }> {
  const found: Array<{ name: string; operationId?: unknown }> = []
  if (!isRecord(spec)) return found
  if (!isRecord(spec.paths)) return found
  for (const [route, item] of Object.entries(spec.paths)) {
    if (!isRecord(item)) continue
    for (const [method, operation] of Object.entries(item)) {
      if (!HTTP_METHODS.has(method)) continue
      if (!isRecord(operation)) continue
      found.push({ name: `${method.toUpperCase()} ${route}`, operationId: operation.operationId })
    }
  }
  return found
}

describe("OpenAPI contract", () => {
  test("every operation carries an identifier", async () => {
    const spec = await openapi()
    const all = operations(spec)
    expect(all.length).toBeGreaterThan(0)

    const missing = all
      .filter((entry) => typeof entry.operationId !== "string" || entry.operationId.length === 0)
      .map((entry) => entry.name)

    // A missing identifier is invisible everywhere else: the route answers, the
    // exerciser passes, and the SDK method is `undefined` only at call time.
    expect(missing, "operations without an OpenApi identifier").toEqual([])
  })

  test("matches the checked-in snapshot", async () => {
    const serialized = `${JSON.stringify(await openapi(), null, 2)}\n`

    if (UPDATE || !existsSync(SNAPSHOT_PATH)) {
      writeFileSync(SNAPSHOT_PATH, serialized)
      return
    }

    expect(readFileSync(SNAPSHOT_PATH, "utf8"), "live OpenAPI vs checked-in snapshot").toBe(serialized)
  })
})
