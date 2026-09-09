import { describe, expect, test } from "bun:test"
import { OpenApi } from "effect/unstable/httpapi"
import { Api } from "@aigcfroge/server/api"
import { DelegationApiGroup } from "../../src/server/routes/instance/httpapi/groups/delegation"

type Operation = { operationId?: string }
type Spec = { paths: Record<string, Record<string, Operation>> }
const expected = [
  "list",
  "create",
  "get",
  "addParticipant",
  "listTurns",
  "appendTurn",
  "retry",
  "reconcile",
  "retractRejection",
  "steer",
  "interrupt",
  "complete",
  "close",
  "archive",
  "unarchive",
  "fork",
  "delete",
]

function identifiers(spec: Spec) {
  return Object.values(spec.paths).flatMap((path) => Object.values(path).flatMap((op) => op.operationId ?? []))
}

describe("delegation HTTP contracts", () => {
  test("canonical and legacy surfaces expose identifiers without a delivery query", () => {
    const canonical = OpenApi.fromApi(Api) as Spec
    const legacy = OpenApi.fromApi(DelegationApiGroup.DelegationApi) as Spec
    for (const operation of expected) {
      expect(identifiers(canonical)).toContain(`v2.delegation.${operation}`)
      expect(identifiers(legacy)).toContain(`legacy.delegation.${operation}`)
    }
    expect(
      [...Object.keys(canonical.paths), ...Object.keys(legacy.paths)].some(
        (path) => /deliver(y|ies)/i.test(path) && /delegation/.test(path),
      ),
    ).toBe(false)
  })

  test("both create handlers authorize the parent Location before durable creation", () => {
    const canonical = Bun.file(new URL("../../../server/src/handlers/delegation.ts", import.meta.url)).text()
    const legacy = Bun.file(
      new URL("../../src/server/routes/instance/httpapi/handlers/delegation.ts", import.meta.url),
    ).text()
    return Promise.all([canonical, legacy]).then(([canonicalSource, legacySource]) => {
      expect(canonicalSource).toMatch(
        /requireParentOwned\(ctx\.payload\.parentSessionID\)[\s\S]*?service\.create\(ctx\.payload\)/,
      )
      expect(legacySource).toMatch(
        /requireParentOwned\(ctx\.payload\.parentSessionID\)[\s\S]*?service\.create\(ctx\.payload\)/,
      )
    })
  })

  test("canonical and legacy list routes coexist", () => {
    expect((OpenApi.fromApi(Api) as Spec).paths["/api/delegation"]?.get).toBeDefined()
    expect((OpenApi.fromApi(DelegationApiGroup.DelegationApi) as Spec).paths["/delegation"]?.get).toBeDefined()
  })
})
