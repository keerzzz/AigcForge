import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Context, Schema } from "effect"
import { CustomCompositionApiGroup } from "../../src/server/routes/instance/httpapi/groups/custom-composition"
import { Composition } from "@aigcfroge/schema/composition"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { Hash } from "@aigcfroge/core/util/hash"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"

const context = Context.makeUnsafe<unknown>(new Map())

function request(route: string, directory: string, init?: RequestInit) {
  const headers = new Headers(init?.headers)
  headers.set("x-aigcfroge-directory", encodeURIComponent(directory))
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

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

describe("custom composition HttpApi", () => {
  test("resolves composition plan via POST /custom-composition/plan", async () => {
    await using tmp = await tmpdir({ git: true })

    const agentDir = path.join(tmp.path, ".aigcfroge", "agents")
    await fs.mkdir(agentDir, { recursive: true })
    const agentRaw = `---\nkind: agent\nname: coder\ndescription: Coder agent\n---\nYou write code.\n`
    await fs.writeFile(path.join(agentDir, "coder.md"), agentRaw)
    const agentRev = Hash.sha256(Buffer.from(agentRaw))

    const promptDir = path.join(tmp.path, ".aigcfroge", "prompts")
    await fs.mkdir(promptDir, { recursive: true })
    const promptRaw = `---\nkind: prompt\nname: system-prompt\ndescription: System prompt\n---\nBe precise.\n`
    await fs.writeFile(path.join(promptDir, "system-prompt.md"), promptRaw)
    const promptRev = Hash.sha256(Buffer.from(promptRaw))

    const input = {
      source: "temporary",
      agents: [
        {
          kind: "agent",
          relativePath: "coder.md",
          revision: agentRev,
        },
      ],
      bindings: {
        "agents/coder": {
          prompts: [
            {
              kind: "prompt",
              relativePath: "system-prompt.md",
              revision: promptRev,
            },
          ],
          skills: [],
        },
      },
      presentation: "native",
      requestedCapabilities: ["workspace.read"],
    }

    const response = await request(CustomCompositionApiGroup.CustomCompositionPaths.plan, tmp.path, {
      method: "POST",
      body: JSON.stringify(input),
    })

    expect(response.status).toBe(200)
    const plan = Schema.decodeUnknownSync(Composition.Plan)(await response.json())
    expect(plan.version).toBe(1)
    expect(plan.valid).toBe(true)
    expect(plan.agent?.name).toBe("coder")
    expect(plan.instructions).toHaveLength(2)
    expect(plan.capabilities).toHaveLength(1)
    expect(plan.capabilities[0].status).toBe("denied")
  })

  test("checks health via GET /custom-composition/health", async () => {
    await using tmp = await tmpdir({ git: true })

    const agentDir = path.join(tmp.path, ".aigcfroge", "agents")
    await fs.mkdir(agentDir, { recursive: true })
    const agentRaw = `---\nkind: agent\nname: coder\ndescription: Coder agent\n---\nYou write code.\n`
    await fs.writeFile(path.join(agentDir, "coder.md"), agentRaw)
    const agentRev = Hash.sha256(Buffer.from(agentRaw))

    const profileDir = path.join(tmp.path, ".aigcfroge", "custom-profiles")
    await fs.mkdir(profileDir, { recursive: true })
    const profileYaml = `kind: custom-profile
name: Dev Profile
description: Developer profile
agents:
  - kind: agent
    relativePath: coder.md
    revision: ${agentRev}
bindings:
  agents/coder:
    prompts: []
    skills: []
presentation: native
requestedCapabilities: []
`
    await fs.writeFile(path.join(profileDir, "dev.yaml"), profileYaml)

    const response = await request(`${CustomCompositionApiGroup.CustomCompositionPaths.health}?path=dev.yaml`, tmp.path)

    expect(response.status).toBe(200)
    const health = Schema.decodeUnknownSync(Composition.Health)(await response.json())
    expect(health.status).toBe("healthy")
    expect(health.staleRevisions).toHaveLength(0)
  })

  test("finds referencing profiles via GET /custom-composition/references", async () => {
    await using tmp = await tmpdir({ git: true })

    const profileDir = path.join(tmp.path, ".aigcfroge", "custom-profiles")
    await fs.mkdir(profileDir, { recursive: true })
    const profileYaml = `kind: custom-profile
name: Coder Profile
description: Profile referencing coder
agents:
  - kind: agent
    relativePath: coder.md
    revision: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
bindings:
  agents/coder:
    prompts: []
    skills: []
presentation: native
requestedCapabilities: []
`
    await fs.writeFile(path.join(profileDir, "coder.yaml"), profileYaml)

    const response = await request(
      `${CustomCompositionApiGroup.CustomCompositionPaths.references}?kind=agent&path=coder.md`,
      tmp.path,
    )

    expect(response.status).toBe(200)
    const body = Schema.decodeUnknownSync(CustomCompositionApiGroup.ReferencesResponse)(await response.json())
    expect(body.profiles).toHaveLength(1)
    expect(String(body.profiles[0].name)).toBe("Coder Profile")
  })
})
