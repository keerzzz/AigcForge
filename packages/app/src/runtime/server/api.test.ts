import { expect, test } from "bun:test"
import { ProductMode } from "@aigcfroge/schema/product-mode"
import { authFromToken, authTokenFromCredentials, createApiForServer } from "./api"

test.each([
  [btoa("aigcfroge:secret"), { password: "secret" }],
  [btoa("legacy:secret:with:colons"), { password: "secret:with:colons" }],
  [btoa(":secret"), { password: "secret" }],
  ["not base64", undefined],
  [btoa("missing-separator"), undefined],
])("authFromToken(%p) extracts only the password", (token, expected) => {
  expect(authFromToken(token)).toEqual(expected)
})

test("authTokenFromCredentials ignores usernames in legacy saved credentials", () => {
  const credentials = { username: "legacy", password: "secret" }
  expect(authTokenFromCredentials(credentials)).toBe(btoa("aigcfroge:secret"))
})

test.each([undefined, "secret"])(
  "App event connections declare Custom approval capability with password %p",
  async (password) => {
    const requests: Request[] = []

    const api = createApiForServer({
      server: { url: "http://localhost:4096", password },
      fetch: Object.assign(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          requests.push(new Request(input, init))

          return new Response('data: {"id":"evt_connection","created":1,"type":"server.connected","data":{}}\n\n', {
            headers: { "content-type": "text/event-stream" },
          })
        },
        { preconnect: () => {} },
      ),
    })

    const stream = api.event.subscribe()[Symbol.asyncIterator]()
    await stream.next()
    await stream.return?.()
    expect(requests).toHaveLength(1)
    expect(new URL(requests[0].url).pathname).toBe("/api/event")
    expect(requests[0].headers.get(ProductMode.CAPABILITIES_HEADER)).toBe(ProductMode.CAPABILITY_CUSTOM_V1)
    expect(requests[0].headers.get("Authorization")).toBe(password ? `Basic ${btoa("aigcfroge:secret")}` : null)
  },
)
