import { afterEach, beforeEach, describe, expect, test } from "bun:test"
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

let savedCustomMode: string | undefined

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

  test("start maps a composition resolve failure to a typed 422 CompositionResolveError", async () => {
    await using tmp = await tmpdir({ git: true })

    const response = await request(CustomCompositionApiGroup.CustomCompositionPaths.start, tmp.path, {
      method: "POST",
      headers: {
        "x-aigcfroge-capabilities": "product-mode-custom-v1",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        composition: {
          source: "temporary",
          agents: [{ kind: "agent", relativePath: "missing.md", revision: Hash.sha256(Buffer.from("missing")) }],
          bindings: {},
          presentation: "native",
          requestedCapabilities: [],
        },
      }),
    })

    // S7 parity: canonical /api/session/custom maps resolve failures to a
    // typed 422 CompositionResolveError; the legacy surface must do the same
    // instead of folding it into a generic 400.
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ _tag: "CompositionResolveError" })
  })

  test("start maps a session-id conflict to a typed 409 ConflictError", async () => {
    await using tmp = await tmpdir({ git: true })

    const agentDir = path.join(tmp.path, ".aigcfroge", "agents")
    await fs.mkdir(agentDir, { recursive: true })
    const agentRaw = `---\nkind: agent\nname: coder\ndescription: Coder agent\n---\nYou write code.\n`
    await fs.writeFile(path.join(agentDir, "coder.md"), agentRaw)
    const agentRev = Hash.sha256(Buffer.from(agentRaw))

    // Reserve the id with a NON-custom session: createCustom rejects an
    // existing non-custom session with PromptConflictError.
    const chat = await request("/api/session", tmp.path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "ses_parity", mode: "chat", location: { directory: tmp.path } }),
    })
    expect(chat.status).toBe(200)

    const start = await request(CustomCompositionApiGroup.CustomCompositionPaths.start, tmp.path, {
      method: "POST",
      headers: {
        "x-aigcfroge-capabilities": "product-mode-custom-v1",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        sessionID: "ses_parity",
        composition: {
          source: "temporary",
          agents: [{ kind: "agent", relativePath: "coder.md", revision: agentRev }],
          bindings: {},
          presentation: "native",
          requestedCapabilities: [],
        },
      }),
    })

    // S7 parity: canonical /api/session/custom maps prompt/session conflicts
    // to a typed 409 ConflictError, not a generic 400.
    expect(start.status).toBe(409)
    expect(await start.json()).toMatchObject({ _tag: "ConflictError", resource: "ses_parity" })
  })
})
