import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Context, Schema } from "effect"
import { CustomCompositionApiGroup } from "../../src/server/routes/instance/httpapi/groups/custom-composition"
import { Composition } from "@aigcfroge/schema/composition"
import { WorkflowAsset } from "@aigcfroge/schema/workflow-asset"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { Hash } from "@aigcfroge/core/util/hash"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"

const context = Context.makeUnsafe<unknown>(new Map())

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
  test("starts workflow session, queries workflow status, and executes workflow", async () => {
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
    const started = (await startRes.json()) as { session: { id: string }; snapshot: { version: number } }
    expect(started.snapshot.version).toBe(2)

    const sessionID = started.session.id

    // 5. Query workflow status before execution
    const workflowGetRes = await request(`/session/${sessionID}/workflow`, tmp.path)
    expect(workflowGetRes.status).toBe(200)
    const statusBefore = (await workflowGetRes.json()) as { run?: { status: string }; steps: unknown[] }
    expect(statusBefore.run).toBeFalsy()

    // 6. Execute workflow run
    const runRes = await request(`/session/${sessionID}/workflow/run`, tmp.path, {
      method: "POST",
    })
    expect(runRes.status).toBe(200)
    const runResult = (await runRes.json()) as { status: string }
    expect(runResult.status).toBe("completed")

    // 7. Query workflow status after execution
    const workflowPostRes = await request(`/session/${sessionID}/workflow`, tmp.path)
    expect(workflowPostRes.status).toBe(200)
    const statusAfter = (await workflowPostRes.json()) as { run?: { status: string }; steps: Array<{ status: string }> }
    expect(statusAfter.run?.status).toBe("completed")
    expect(statusAfter.steps).toHaveLength(1)
    expect(statusAfter.steps[0].status).toBe("completed")
  })
})
