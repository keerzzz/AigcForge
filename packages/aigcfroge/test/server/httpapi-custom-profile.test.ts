import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Context, Schema } from "effect"
import { CustomProfile as SchemaCustomProfile } from "@aigcfroge/schema/custom-profile"
import { CustomProfileApiGroup } from "../../src/server/routes/instance/httpapi/groups/custom-profile"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { Hash } from "@aigcfroge/core/util/hash"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"

const context = Context.makeUnsafe<unknown>(new Map())

function request(route: string, directory: string, init?: RequestInit) {
  const headers = new Headers(init?.headers)
  headers.set("x-aigcfroge-directory", encodeURIComponent(directory))
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

const sampleProfileYaml = `kind: custom-profile
name: Dev Profile
description: Developer profile
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

describe("custom profile HttpApi", () => {
  test("lists custom profiles in the request instance", async () => {
    await using tmp = await tmpdir({ git: true })

    const response = await request(CustomProfileApiGroup.CustomProfilePaths.list, tmp.path)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ assets: [], invalid: [] })
  })

  test("list response separates valid profiles and invalid entries", async () => {
    await using tmp = await tmpdir({ git: true })
    const profilesDir = path.join(tmp.path, ".aigcfroge", "custom-profiles")
    await fs.mkdir(profilesDir, { recursive: true })
    await fs.writeFile(path.join(profilesDir, "dev.yaml"), sampleProfileYaml)
    await fs.writeFile(path.join(profilesDir, "corrupt.yaml"), "invalid: yaml: :")

    const response = await request(CustomProfileApiGroup.CustomProfilePaths.list, tmp.path)

    expect(response.status).toBe(200)
    const body = Schema.decodeUnknownSync(CustomProfileApiGroup.ListResponse)(await response.json())
    expect(body.assets).toHaveLength(1)
    expect(String(body.assets[0].name)).toBe("Dev Profile")
    expect(body.invalid).toHaveLength(1)
    expect(body.invalid[0].errorTag).toBe("parse_error")
  })

  test("gets profile content by relative path", async () => {
    await using tmp = await tmpdir({ git: true })
    const profilesDir = path.join(tmp.path, ".aigcfroge", "custom-profiles")
    await fs.mkdir(profilesDir, { recursive: true })
    await fs.writeFile(path.join(profilesDir, "dev.yaml"), sampleProfileYaml)

    const response = await request(`${CustomProfileApiGroup.CustomProfilePaths.content}?path=dev.yaml`, tmp.path)
    expect(response.status).toBe(200)
    const body = Schema.decodeUnknownSync(SchemaCustomProfile.Info)(await response.json())
    expect(String(body.name)).toBe("Dev Profile")
    expect(body.profile.agents).toHaveLength(1)
  })

  test("deletes profile and returns DeleteResult with referencing profiles", async () => {
    await using tmp = await tmpdir({ git: true })
    const profilesDir = path.join(tmp.path, ".aigcfroge", "custom-profiles")
    await fs.mkdir(profilesDir, { recursive: true })
    await fs.writeFile(path.join(profilesDir, "to-delete.yaml"), sampleProfileYaml)

    // Calculate revision
    const rev = Hash.sha256(Buffer.from(sampleProfileYaml))

    const sessionRes = await request("/session", tmp.path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "chat" }),
    })
    const session = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }))(await sessionRes.json())

    const response = await request(`/session/${session.id}/custom-profile/delete`, tmp.path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        relativePath: "to-delete.yaml",
        baseRevision: rev,
      }),
    })

    expect(response.status).toBe(200)
    const body = Schema.decodeUnknownSync(SchemaCustomProfile.DeleteResult)(await response.json())
    expect(body.relativePath).toBe("to-delete.yaml")
    expect(body.referencingProfiles).toHaveLength(0)
  })
})
