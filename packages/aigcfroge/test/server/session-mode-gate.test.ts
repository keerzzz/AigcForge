import { afterEach, describe, expect, test } from "bun:test"
import { Context, Schema } from "effect"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
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

describe("Session ProductMode Gate & Capability Isolation", () => {
  test("POST /session rejects mode=custom with 400 UnsupportedProductModeError", async () => {
    await using tmp = await tmpdir({ git: true })

    const response = await request("/session", tmp.path, {
      method: "POST",
      body: JSON.stringify({ mode: "custom" }),
    })

    expect(response.status).toBe(400)
    const err = Schema.decodeUnknownSync(
      Schema.Struct({
        _tag: Schema.optional(Schema.String),
        message: Schema.optional(Schema.String),
      }),
    )(await response.json())
    expect(err._tag).toBe("UnsupportedProductModeError")
  })

  test("POST /session accepts supported mode like chat", async () => {
    await using tmp = await tmpdir({ git: true })

    const response = await request("/session", tmp.path, {
      method: "POST",
      body: JSON.stringify({ mode: "chat" }),
    })

    expect(response.status).toBe(200)
    const session = Schema.decodeUnknownSync(
      Schema.Struct({
        id: Schema.String,
        mode: Schema.String,
      }),
    )(await response.json())
    expect(session.mode).toBe("chat")
    expect(session.id).toBeDefined()
  })
})
