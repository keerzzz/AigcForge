import { describe, expect, test } from "bun:test"
import { authFromToken, authTokenFromCredentials, createSdkForServer } from "./server"

describe("authFromToken", () => {
  test("decodes basic auth credentials from auth_token", () => {
    expect(authFromToken(btoa("kit:secret"))).toEqual({ username: "kit", password: "secret" })
  })

  test("defaults blank username to aigcfroge", () => {
    expect(authFromToken(btoa(":secret"))).toEqual({ username: "aigcfroge", password: "secret" })
  })

  test("ignores malformed tokens", () => {
    expect(authFromToken("not base64")).toBeUndefined()
    expect(authFromToken(btoa("missing-separator"))).toBeUndefined()
  })
})

describe("authTokenFromCredentials", () => {
  test("encodes credentials with the default username", () => {
    expect(authTokenFromCredentials({ password: "secret" })).toBe(btoa("aigcfroge:secret"))
  })
})

describe("createSdkForServer", () => {
  test("preserves tuple headers while adding auth and directory routing", async () => {
    let request: Request | undefined
    const fetch = Object.assign(
      async (input: Parameters<typeof globalThis.fetch>[0]) => {
        request = input instanceof Request ? input : new Request(input)
        return new Response("[]", { headers: { "content-type": "application/json" } })
      },
      { preconnect: globalThis.fetch.preconnect },
    )
    const client = createSdkForServer({
      server: { url: "http://localhost:4096", username: "kit", password: "secret" },
      directory: "/tmp/project",
      headers: [["x-custom", "value"]],
      fetch,
    })

    await client.app.agents()

    expect(request?.headers.get("x-custom")).toBe("value")
    expect(request?.headers.get("x-aigcfroge-capabilities")).toBe("product-mode-custom-v1")
    expect(request?.headers.get("authorization")).toBe(`Basic ${btoa("kit:secret")}`)
    expect(new URL(request?.url ?? "http://localhost").searchParams.get("directory")).toBe("/tmp/project")
  })
})
