// The public SDK used by plugins must execute the current server contract.
import { afterEach, describe, expect, test } from "bun:test"
import { createAigcfrogeClient } from "@aigcfroge/sdk"
import { Server } from "../../src/server/server"
import { tmpdir, disposeAllInstances } from "../fixture/fixture"
import { resetDatabase } from "../fixture/db"

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

function client(directory: string) {
  return createAigcfrogeClient({
    baseUrl: "http://test",
    directory,
    fetch: (request: Request) => Server.Default().app.fetch(request),
  })
}

describe("public SDK runtime smoke", () => {
  test("creates a session and reads its canonical Task contract", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const sdk = client(tmp.path)
    const session = await sdk.session.create({ title: "SDK contract" }, { throwOnError: true })
    expect((await sdk.session.get({ sessionID: session.data.id }, { throwOnError: true })).data.id).toBe(
      session.data.id,
    )
    expect((await sdk.session.task.get({ sessionID: session.data.id }, { throwOnError: true })).data).toEqual([])
    expect(Reflect.has(sdk.session, "todo")).toBe(false)
    expect(Reflect.has(sdk, "question")).toBe(false)
  })

  test("session.list reaches the server and returns 200", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const sdk = client(tmp.path)
    const result = await sdk.session.list()
    expect(result.error).toBeUndefined()
    expect(Array.isArray(result.data)).toBe(true)
  })

  test("path.get reaches the server and returns 200", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const sdk = client(tmp.path)
    const result = await sdk.path.get()
    expect(result.error).toBeUndefined()
    expect(result.data).toBeDefined()
  })

  test("config.get reaches the server and returns 200", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const sdk = client(tmp.path)
    const result = await sdk.config.get()
    expect(result.error).toBeUndefined()
    expect(result.data).toBeDefined()
  })

  test("session 404: result-tuple path returns the error body", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const sdk = client(tmp.path)
    const result = await sdk.session.get({ sessionID: "ses_no_such" })
    expect(result.error).toBeDefined()
    // wire body for 404 is NamedError-shaped
    expect(result.error).toMatchObject({ name: "NotFoundError" })
  })
})
