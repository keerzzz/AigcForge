import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Context, Schema } from "effect"
import { OpenApi } from "effect/unstable/httpapi"
import { Composition } from "@aigcfroge/schema/composition"
import { WorkflowAsset } from "@aigcfroge/schema/workflow-asset"
// `server` must be imported before `api`: both sit on the same module cycle as
// `@aigcfroge/core/plugin`, and only the server entry initialises the Location
// layers in an order that does not trip `Cannot access 'locationLayer'`.
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { AigcfrogeHttpApi } from "../../src/server/routes/instance/httpapi/api"
import { Hash } from "@aigcfroge/core/util/hash"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"

const context = Context.makeUnsafe<unknown>(new Map())
const StartResponseJson = Schema.toCodecJson(Composition.StartResponse)
const WorkflowStatusResponseJson = Schema.toCodecJson(WorkflowAsset.WorkflowStatusResponse)

let savedCustomMode: string | undefined

function request(route: string, directory: string, init?: RequestInit) {
  const headers = new Headers(init?.headers)
  headers.set("x-aigcfroge-directory", encodeURIComponent(directory))
  headers.set("x-aigcfroge-capabilities", "product-mode-custom-v1")
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json")
  }
  return HttpApiApp.webHandler().handler(
    new Request(`http://localhost${route}`, {
      ...init,
      headers,
    }),
    context,
  )
}

beforeEach(() => {
  savedCustomMode = process.env["AIGCFROGE_CUSTOM_MODE"]
  process.env["AIGCFROGE_CUSTOM_MODE"] = "true"
})

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
  if (savedCustomMode === undefined) delete process.env["AIGCFROGE_CUSTOM_MODE"]
  else process.env["AIGCFROGE_CUSTOM_MODE"] = savedCustomMode
})

describe("custom workflow HttpApi", () => {
  test("admits workflow asynchronously and rejects a stale snapshot digest", async () => {
    await using tmp = await tmpdir({ git: true })

    // 1. Create agent asset
    const agentDir = path.join(tmp.path, ".aigcfroge", "agents")
    await fs.mkdir(agentDir, { recursive: true })
    const agentRaw = `---\nkind: agent\nname: coder\ndescription: Coder agent\n---\nYou write code.\n`
    await fs.writeFile(path.join(agentDir, "coder.md"), agentRaw)
    const agentRev = Hash.sha256(Buffer.from(agentRaw))

    // 2. Create workflow asset
    const workflowDir = path.join(tmp.path, ".aigcfroge", "workflows")
    await fs.mkdir(workflowDir, { recursive: true })
    const workflowRaw = `kind: workflow\nname: test-flow\ndescription: Test flow\nversion: "1.0.0"\ntriggers: []\nsteps:\n  - id: step_1\n    name: Step 1\n    agent: coder\n    next: END\n`
    await fs.writeFile(path.join(workflowDir, "test-flow.yaml"), workflowRaw)
    const workflowRev = Hash.sha256(Buffer.from(workflowRaw))

    // 3. Plan composition
    const planInput = {
      source: "temporary",
      agents: [
        {
          kind: "agent",
          relativePath: "coder.md",
          revision: agentRev,
        },
      ],
      workflow: {
        kind: "workflow",
        relativePath: "test-flow.yaml",
        revision: workflowRev,
      },
      bindings: {},
      presentation: "native",
      requestedCapabilities: [],
    }

    const planRes = await request("/custom-composition/plan", tmp.path, {
      method: "POST",
      body: JSON.stringify(planInput),
    })
    expect(planRes.status).toBe(200)
    const plan = await planRes.json()
    expect(plan.version).toBe(2)
    expect(plan.agents).toHaveLength(1)
    expect(plan.workflow).toBeDefined()

    // 4. Start custom session
    const startRes = await request("/custom-composition/start", tmp.path, {
      method: "POST",
      body: JSON.stringify({
        composition: planInput,
        expectedPlanDigest: plan.digest,
      }),
    })
    expect(startRes.status).toBe(200)
    const started = Schema.decodeUnknownSync(StartResponseJson)(await startRes.json())
    expect(started.snapshot.version).toBe(2)

    const sessionID = started.session.id

    // 5. Query workflow status before execution
    const workflowGetRes = await request(`/session/${sessionID}/workflow`, tmp.path)
    expect(workflowGetRes.status).toBe(200)
    const statusBefore = Schema.decodeUnknownSync(WorkflowStatusResponseJson)(await workflowGetRes.json())
    expect(statusBefore.run).toBeFalsy()

    // 6. Admit workflow ownership without waiting for child/provider execution.
    const runRes = await request(`/session/${sessionID}/workflow/run`, tmp.path, {
      method: "POST",
      body: JSON.stringify({
        requestID: "workflow-http-admission-1",
        expectedSnapshotDigest: started.snapshot.digest,
      }),
    })
    expect(runRes.status, await runRes.clone().text()).toBe(202)
    const admitted = Schema.decodeUnknownSync(WorkflowStatusResponseJson)(await runRes.json())
    expect(admitted.run?.snapshotDigest).toBe(started.snapshot.digest)
    expect(admitted.steps).toHaveLength(1)

    const conflictRes = await request(`/session/${sessionID}/workflow/run`, tmp.path, {
      method: "POST",
      body: JSON.stringify({
        requestID: "workflow-http-admission-2",
        expectedSnapshotDigest: "0".repeat(64),
      }),
    })
    expect(conflictRes.status).toBe(409)
    expect(await conflictRes.json()).toMatchObject({
      _tag: "ConflictError",
      resource: sessionID,
    })

    // 7. Query the authoritative durable state after admission.
    const workflowPostRes = await request(`/session/${sessionID}/workflow`, tmp.path)
    expect(workflowPostRes.status).toBe(200)
    const statusAfter = Schema.decodeUnknownSync(WorkflowStatusResponseJson)(await workflowPostRes.json())
    expect(statusAfter.run?.id).toBe(admitted.run?.id)
    expect(statusAfter.steps).toHaveLength(1)
  })
})

describe("custom workflow OpenAPI operation identity", () => {
  // The generated JavaScript SDK derives its client namespace from operationId:
  // `session.workflow.cancelRun` becomes `client.session.workflow.cancelRun()`.
  // An endpoint without an explicit identifier falls back to its bare endpoint
  // name and lands flat on the parent `Session` class, which silently breaks
  // every consumer that reaches for `client.session.workflow.*`.
  const spec = OpenApi.fromApi(AigcfrogeHttpApi) as {
    paths: Record<string, Record<string, { operationId?: string } | undefined>>
  }

  const expected = [
    ["get", "/session/{sessionID}/workflow", "session.workflow.get"],
    ["post", "/session/{sessionID}/workflow/run", "session.workflow.run"],
    ["post", "/session/{sessionID}/workflow/{runID}/cancel", "session.workflow.cancelRun"],
    ["post", "/session/{sessionID}/workflow/{runID}/step/{stepRunID}/cancel", "session.workflow.cancelStep"],
    ["post", "/session/{sessionID}/workflow/{runID}/step/{stepRunID}/retry", "session.workflow.retryStep"],
  ] as const

  for (const [method, route, operationId] of expected) {
    test(`${method.toUpperCase()} ${route} keeps the session.workflow SDK namespace`, () => {
      expect(spec.paths[route]?.[method]?.operationId).toBe(operationId)
    })
  }
})
