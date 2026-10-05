import { createHash } from "node:crypto"
import { afterEach, describe, expect } from "bun:test"
import { Flag } from "@aigcfroge/core/flag/flag"
import { ConfigProvider, Effect, Layer } from "effect"
import {
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
  HttpRouter,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http"
import { FSUtil } from "@aigcfroge/core/fs-util"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { ServerAuth } from "../../src/server/auth"
import { authorizationRouterMiddleware } from "../../src/server/routes/instance/httpapi/middleware/authorization"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { serveEmbeddedUIEffect, serveUIEffect, UI_UPSTREAM } from "../../src/server/shared/ui"
import { testEffect } from "../lib/effect"

const testStateLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const original = {
      AIGCFROGE_SERVER_PASSWORD: Flag.AIGCFROGE_SERVER_PASSWORD,
      AIGCFROGE_SERVER_USERNAME: Flag.AIGCFROGE_SERVER_USERNAME,
      envPassword: process.env.AIGCFROGE_SERVER_PASSWORD,
      envUsername: process.env.AIGCFROGE_SERVER_USERNAME,
    }

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        Flag.AIGCFROGE_SERVER_PASSWORD = original.AIGCFROGE_SERVER_PASSWORD
        Flag.AIGCFROGE_SERVER_USERNAME = original.AIGCFROGE_SERVER_USERNAME
        restoreEnv("AIGCFROGE_SERVER_PASSWORD", original.envPassword)
        restoreEnv("AIGCFROGE_SERVER_USERNAME", original.envUsername)
      }),
    )
  }),
)

const it = testEffect(Layer.mergeAll(testStateLayer, FSUtil.defaultLayer, RuntimeFlags.layer()))

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key]
    return
  }
  process.env[key] = value
}

// app() builds a second composition root (own memoMap) so the ConfigProvider
// override applies. Its scope must be closed, or its TaskDriver registration leaks
// and wins `installations.at(-1)` for the rest of the process.
const pendingDisposals: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(pendingDisposals.splice(0).map((dispose) => dispose()))
})

function app(input?: { password?: string; username?: string }) {
  const web = HttpRouter.toWebHandler(
    HttpApiApp.routes.pipe(
      Layer.provide(
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({
            AIGCFROGE_SERVER_PASSWORD: input?.password,
            AIGCFROGE_SERVER_USERNAME: input?.username,
          }),
        ),
      ),
    ),
    { disableLogger: true },
  )
  pendingDisposals.push(web.dispose)
  return {
    request(input: string | URL | Request, init?: RequestInit) {
      return Effect.promise(() =>
        Promise.resolve(
          web.handler(
            input instanceof Request ? input : new Request(new URL(input, "http://localhost"), init),
            HttpApiApp.context,
          ),
        ),
      )
    },
  }
}

function uiApp(input?: {
  password?: string
  username?: string
  client?: Layer.Layer<HttpClient.HttpClient>
  disableEmbeddedWebUi?: boolean
}) {
  const web = HttpRouter.toWebHandler(
    HttpRouter.use((router) =>
      Effect.gen(function* () {
        const fs = yield* FSUtil.Service
        const client = yield* HttpClient.HttpClient
        const flags = yield* RuntimeFlags.Service
        yield* router.add("*", "/*", (request) =>
          serveUIEffect(request, { fs, client, disableEmbeddedWebUi: flags.disableEmbeddedWebUi }),
        )
      }),
    ).pipe(
      Layer.provide(authorizationRouterMiddleware.layer.pipe(Layer.provide(ServerAuth.Config.defaultLayer))),
      Layer.provide([
        FSUtil.defaultLayer,
        input?.client ?? httpClient(new Response("ui")),
        RuntimeFlags.layer({ disableEmbeddedWebUi: input?.disableEmbeddedWebUi ?? false }),
        HttpServer.layerServices,
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({
            AIGCFROGE_SERVER_PASSWORD: input?.password,
            AIGCFROGE_SERVER_USERNAME: input?.username,
          }),
        ),
      ]),
    ),
    { disableLogger: true },
  )
  pendingDisposals.push(web.dispose)
  return {
    request(input: string | URL | Request, init?: RequestInit) {
      return Effect.promise(() =>
        Promise.resolve(
          web.handler(
            input instanceof Request ? input : new Request(new URL(input, "http://localhost"), init),
            HttpApiApp.context,
          ),
        ),
      )
    },
  }
}

function routeOrderingApp() {
  let proxiedUrl: string | undefined
  const web = HttpRouter.toWebHandler(
    HttpRouter.use((router) =>
      Effect.gen(function* () {
        const fs = yield* FSUtil.Service
        const client = yield* HttpClient.HttpClient
        const flags = yield* RuntimeFlags.Service
        yield* router.add("GET", "/session/:sessionID", () =>
          Effect.succeed(HttpServerResponse.jsonUnsafe({ error: "Not Found" }, { status: 404 })),
        )
        yield* router.add("*", "/*", (request) =>
          serveUIEffect(request, { fs, client, disableEmbeddedWebUi: flags.disableEmbeddedWebUi }),
        )
      }),
    ).pipe(
      Layer.provide([
        FSUtil.defaultLayer,
        RuntimeFlags.layer({ disableEmbeddedWebUi: true }),
        httpClient(new Response("ui"), (request) => {
          proxiedUrl = request.url
        }),
        HttpServer.layerServices,
      ]),
    ),
    { disableLogger: true },
  )
  pendingDisposals.push(web.dispose)
  return {
    proxiedUrl: () => proxiedUrl,
    request(input: string | URL | Request, init?: RequestInit) {
      return Effect.promise(() =>
        Promise.resolve(
          web.handler(
            input instanceof Request ? input : new Request(new URL(input, "http://localhost"), init),
            HttpApiApp.context,
          ),
        ),
      )
    },
  }
}

function httpClient(response: Response, onRequest?: (request: HttpClientRequest.HttpClientRequest) => void) {
  return Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) => {
      onRequest?.(request)
      return Effect.succeed(HttpClientResponse.fromWeb(request, response))
    }),
  )
}

/** An upstream that cannot be reached, exactly as `FetchHttpClient` reports it. */
function unreachableUpstream() {
  return Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.fail(
        new HttpClientError.HttpClientError({
          reason: new HttpClientError.TransportError({ request, cause: new Error("offline") }),
        }),
      ),
    ),
  )
}

function responseText(response: Response) {
  return Effect.promise(() => response.text())
}

describe("HttpApi UI fallback", () => {
  it.live("serves the web UI through the HTTP API app", () =>
    Effect.gen(function* () {
      let proxiedUrl: string | undefined

      const response = yield* uiApp({
        disableEmbeddedWebUi: true,
        client: httpClient(
          new Response("<html>aigcfroge</html>", { headers: { "content-type": "text/html" } }),
          (request) => {
            proxiedUrl = request.url
          },
        ),
      }).request("/")

      expect(response.status).toBe(200)
      expect(response.headers.get("content-type")).toContain("text/html")
      expect(yield* responseText(response)).toBe("<html>aigcfroge</html>")
      expect(proxiedUrl).toBe("https://app.aigcfroge.ai/")
    }),
  )

  it.live("strips upstream transfer encoding headers from proxied assets", () =>
    Effect.gen(function* () {
      let proxiedUrl: string | undefined

      const response = yield* Effect.gen(function* () {
        const fs = yield* FSUtil.Service
        const client = yield* HttpClient.HttpClient
        const flags = yield* RuntimeFlags.Service
        return yield* serveUIEffect(HttpServerRequest.fromWeb(new Request("http://localhost/assets/app.js")), {
          fs,
          client,
          disableEmbeddedWebUi: flags.disableEmbeddedWebUi,
        })
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            RuntimeFlags.layer({ disableEmbeddedWebUi: true }),
            Layer.succeed(
              HttpClient.HttpClient,
              HttpClient.make((request) => {
                proxiedUrl = request.url
                return Effect.succeed(
                  HttpClientResponse.fromWeb(
                    request,
                    new Response("console.log('ok')", {
                      headers: {
                        "content-encoding": "br",
                        "content-length": "999",
                        "content-type": "text/javascript",
                      },
                    }),
                  ),
                )
              }),
            ),
          ),
        ),
        Effect.map(HttpServerResponse.toWeb),
      )

      expect(response.status).toBe(200)
      expect(proxiedUrl).toBe("https://app.aigcfroge.ai/assets/app.js")
      expect(response.headers.get("content-encoding")).toBeNull()
      expect(response.headers.get("content-length")).not.toBe("999")
      expect(response.headers.get("content-type")).toContain("text/javascript")
      expect(yield* responseText(response)).toBe("console.log('ok')")
    }),
  )

  // Regression for #25698 (Ope): upstream `transfer-encoding: chunked` was
  // forwarded through the proxy while the proxy itself re-frames the body,
  // causing browsers to fail with `ERR_INVALID_CHUNKED_ENCODING`.
  it.live("strips upstream transfer-encoding header from proxied assets", () =>
    Effect.gen(function* () {
      const response = yield* Effect.gen(function* () {
        const fs = yield* FSUtil.Service
        const client = yield* HttpClient.HttpClient
        const flags = yield* RuntimeFlags.Service
        return yield* serveUIEffect(HttpServerRequest.fromWeb(new Request("http://localhost/")), {
          fs,
          client,
          disableEmbeddedWebUi: flags.disableEmbeddedWebUi,
        })
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            RuntimeFlags.layer({ disableEmbeddedWebUi: true }),
            Layer.succeed(
              HttpClient.HttpClient,
              HttpClient.make((request) =>
                Effect.succeed(
                  HttpClientResponse.fromWeb(
                    request,
                    new Response("<html>aigcfroge</html>", {
                      headers: {
                        "transfer-encoding": "chunked",
                        "content-type": "text/html",
                      },
                    }),
                  ),
                ),
              ),
            ),
          ),
        ),
        Effect.map(HttpServerResponse.toWeb),
      )

      expect(response.status).toBe(200)
      expect(response.headers.get("transfer-encoding")).toBeNull()
      expect(yield* responseText(response)).toBe("<html>aigcfroge</html>")
    }),
  )

  it.live("serves embedded UI assets when Bun can read them but access reports missing", () =>
    Effect.gen(function* () {
      let readPath: string | undefined

      const fs = yield* FSUtil.Service
      const response = yield* serveEmbeddedUIEffect(
        "/assets/app.js",
        {
          ...fs,
          existsSafe: () => Effect.die("embedded UI should not rely on filesystem access checks"),
          readFile: (path) => {
            readPath = path
            return path === "/$bunfs/root/assets/app.js"
              ? Effect.succeed(new TextEncoder().encode("console.log('embedded')"))
              : Effect.die(`unexpected embedded UI path: ${path}`)
          },
        },
        { "assets/app.js": "/$bunfs/root/assets/app.js" },
      ).pipe(Effect.map(HttpServerResponse.toWeb))

      expect(response.status).toBe(200)
      expect(readPath).toBe("/$bunfs/root/assets/app.js")
      expect(response.headers.get("content-type")).toContain("text/javascript")
      expect(yield* responseText(response)).toBe("console.log('embedded')")
    }),
  )

  it.live("allows embedded UI terminal wasm and theme preload CSP", () =>
    Effect.gen(function* () {
      const script = 'document.documentElement.dataset.theme = "dark"'

      const fs = yield* FSUtil.Service
      const response = yield* serveEmbeddedUIEffect(
        "/",
        {
          ...fs,
          readFile: (path) => {
            return path === "/$bunfs/root/index.html"
              ? Effect.succeed(
                  new TextEncoder().encode(
                    `<html><head><script id="oc-theme-preload-script">${script}</script></head></html>`,
                  ),
                )
              : Effect.die(`unexpected embedded UI path: ${path}`)
          },
        },
        { "index.html": "/$bunfs/root/index.html" },
      ).pipe(Effect.map(HttpServerResponse.toWeb))

      const csp = response.headers.get("content-security-policy") ?? ""
      expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval'")
      expect(csp).toContain(`'sha256-${createHash("sha256").update(script).digest("base64")}'`)
      expect(csp).toContain("connect-src * data:")
      // form-action does not fall back to default-src; without it an injected
      // form could post credentials to any origin.
      expect(csp).toContain("form-action 'self'")
    }),
  )

  it.live("keeps matched API routes ahead of the UI fallback", () =>
    Effect.gen(function* () {
      const server = routeOrderingApp()
      const response = yield* server.request("/session/ses_nope")

      expect(response.status).toBe(404)
      expect(server.proxiedUrl()).toBeUndefined()
    }),
  )

  // Without the mapping these three land on Effect's generic
  // `Response.empty({ status: 500 })`: no body, no content-type. The per-route
  // `errorLayer` cannot fill that in — it only replaces defect-only empty 500s,
  // and this arrives as a typed `HttpClientError`.
  it.live("answers 502 with a body when the UI upstream is unreachable", () =>
    Effect.gen(function* () {
      const response = yield* uiApp({
        disableEmbeddedWebUi: true,
        client: unreachableUpstream(),
      }).request("/definitely-not-a-route")

      expect(response.status).toBe(502)
      expect(response.headers.get("content-type")).toContain("application/json")
      expect(JSON.parse(yield* responseText(response))).toEqual({
        error: "Bad Gateway",
        upstream: "app.aigcfroge.ai",
        reason: "TransportError",
      })
    }),
  )

  it.live("answers 502 for the root path too, not only unmatched ones", () =>
    Effect.gen(function* () {
      const response = yield* uiApp({ disableEmbeddedWebUi: true, client: unreachableUpstream() }).request("/")

      expect(response.status).toBe(502)
      expect(yield* responseText(response)).not.toBe("")
    }),
  )

  it.live("keeps serving the UI when the upstream is reachable", () =>
    Effect.gen(function* () {
      const response = yield* uiApp({ disableEmbeddedWebUi: true }).request("/")

      expect(response.status).toBe(200)
      expect(yield* responseText(response)).toBe("ui")
    }),
  )

  it.live("requires server password for the web UI", () =>
    Effect.gen(function* () {
      const response = yield* uiApp({
        password: "secret",
        username: "aigcfroge",
        disableEmbeddedWebUi: true,
      }).request("/")

      expect(response.status).toBe(401)
      expect(response.headers.get("www-authenticate")).toBe('Basic realm="Secure Area"')
    }),
  )

  it.live("accepts auth token for the web UI", () =>
    Effect.gen(function* () {
      const response = yield* uiApp({
        password: "secret",
        username: "aigcfroge",
        disableEmbeddedWebUi: true,
        client: httpClient(new Response("<html>aigcfroge</html>", { headers: { "content-type": "text/html" } })),
      }).request(`/?auth_token=${btoa("aigcfroge:secret")}`)

      expect(response.status).toBe(200)
      expect(yield* responseText(response)).toBe("<html>aigcfroge</html>")
    }),
  )

  it.live("accepts basic auth for the web UI", () =>
    Effect.gen(function* () {
      const response = yield* uiApp({
        password: "secret",
        username: "aigcfroge",
        disableEmbeddedWebUi: true,
      }).request("/", {
        headers: { authorization: `Basic ${btoa("aigcfroge:secret")}` },
      })

      expect(response.status).toBe(200)
    }),
  )

  it.live("accepts basic auth passwords containing colons for the web UI", () =>
    Effect.gen(function* () {
      const response = yield* uiApp({
        password: "sec:ret",
        username: "aigcfroge",
        disableEmbeddedWebUi: true,
      }).request("/", {
        headers: { authorization: `Basic ${btoa("aigcfroge:sec:ret")}` },
      })

      expect(response.status).toBe(200)
    }),
  )

  // Regression for #25698 (Ope): the browser fetches the PWA manifest and
  // its icons via flows that don't carry app-managed credentials (the
  // `<link rel="manifest">` request is not under page-auth control), so the
  // server returning 401 breaks PWA install. These specific public assets
  // should bypass auth.
  it.live("serves the PWA manifest without auth even when a server password is set", () =>
    Effect.gen(function* () {
      for (const path of ["/site.webmanifest", "/web-app-manifest-192x192.png", "/web-app-manifest-512x512.png"]) {
        const response = yield* uiApp({
          password: "secret",
          username: "aigcfroge",
          disableEmbeddedWebUi: true,
          client: httpClient(new Response("ok")),
        }).request(path)
        expect(response.status).not.toBe(401)
      }
    }),
  )

  it.live("allows web UI preflight without auth", () =>
    Effect.gen(function* () {
      const response = yield* app({ password: "secret", username: "aigcfroge" }).request("/", {
        method: "OPTIONS",
        headers: {
          origin: "http://localhost:3000",
          "access-control-request-method": "GET",
        },
      })

      expect(response.status).toBe(204)
      expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:3000")
    }),
  )
})

describe("UI transport boundary", () => {
  for (const input of [
    { method: "GET", path: "/question" },
    { method: "GET", path: "/%71uestion" },
    { method: "GET", path: "/QUESTION" },
    { method: "GET", path: "/%51uestion" },
    { method: "GET", path: "/question;probe=fixture" },
    { method: "GET", path: "//question/qst_fixture/reply" },
    { method: "GET", path: "//session/ses_fixture/todo" },
    { method: "GET", path: "//api/not-a-route" },
    { method: "HEAD", path: "/question" },
    { method: "POST", path: "/question/qst_fixture/reply" },
    { method: "POST", path: "/question/qst_fixture/reject" },
    { method: "GET", path: "/session/ses_fixture/todo" },
    { method: "GET", path: "/api/not-a-route" },
    { method: "GET", path: "/%E0%A4%A" },
  ]) {
    it.live(`refuses API fallback ${input.method} ${input.path} without contacting UI`, () =>
      Effect.gen(function* () {
        const calls: string[] = []
        const response = yield* uiApp({
          password: "local-test-password",
          username: "aigcfroge",
          disableEmbeddedWebUi: true,
          client: httpClient(
            new Response("<html>ui</html>", { headers: { "content-type": "text/html" } }),
            (request) => {
              calls.push(request.url)
            },
          ),
        }).request(
          new Request(`http://localhost${input.path}`, {
            method: input.method,
            headers: {
              authorization: `Basic ${btoa("aigcfroge:local-test-password")}`,
              accept: "text/html",
              "content-type": "application/json",
            },
            ...(input.method === "POST" ? { body: JSON.stringify({ answers: [["private-test-answer"]] }) } : {}),
          }),
        )

        expect(calls).toHaveLength(0)
        expect(response.status).toBe(404)
      }),
    )
  }

  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    it.live(`refuses unknown ${method} writes instead of forwarding their body`, () =>
      Effect.gen(function* () {
        const calls: string[] = []
        const response = yield* uiApp({
          disableEmbeddedWebUi: true,
          client: httpClient(new Response("ui"), (request) => {
            calls.push(request.url)
          }),
        }).request("/unmatched-ui-path", {
          method,
          body: JSON.stringify({ private: "fixture-payload" }),
          headers: { "content-type": "application/json" },
        })

        expect(calls).toHaveLength(0)
        expect(response.status).toBe(404)
      }),
    )
  }

  for (const path of ["/site.webmanifest", "/web-app-manifest-192x192.png", "/web-app-manifest-512x512.png"]) {
    it.live(`does not grant public asset authentication to //probe${path}`, () =>
      Effect.gen(function* () {
        const calls: string[] = []
        const response = yield* uiApp({
          password: "local-test-password",
          username: "aigcfroge",
          disableEmbeddedWebUi: true,
          client: httpClient(new Response("asset"), (request) => {
            calls.push(request.url)
          }),
        }).request(new Request(`http://localhost//probe${path}`))

        expect(response.status).toBe(401)
        expect(calls).toHaveLength(0)
      }),
    )
  }

  it.live("keeps local credentials and private headers out of the hosted UI request", () =>
    Effect.gen(function* () {
      const calls: HttpClientRequest.HttpClientRequest[] = []
      const response = yield* uiApp({
        password: "local-test-password",
        username: "aigcfroge",
        disableEmbeddedWebUi: true,
        client: httpClient(new Response("asset"), (request) => {
          calls.push(request)
        }),
      }).request("/assets/client.js", {
        headers: {
          authorization: `Basic ${btoa("aigcfroge:local-test-password")}`,
          cookie: "private=fixture-cookie",
          "x-api-key": "fixture-api-key",
          "x-aigcfroge-directory": "/private-fixture",
          "x-aigcfroge-workspace": "workspace-fixture",
          referer: "http://localhost/private-fixture",
          accept: "application/javascript",
          "accept-language": "zh-CN",
          "if-none-match": '"fixture-etag"',
          range: "bytes=0-10",
        },
      })

      expect(response.status).toBe(200)
      expect(calls).toHaveLength(1)
      const forwarded = calls[0]
      if (!forwarded) throw new Error("expected one hosted UI request")
      expect(forwarded.headers["authorization"]).toBeUndefined()
      expect(forwarded.headers["cookie"]).toBeUndefined()
      expect(forwarded.headers["x-api-key"]).toBeUndefined()
      expect(forwarded.headers["x-aigcfroge-directory"]).toBeUndefined()
      expect(forwarded.headers["x-aigcfroge-workspace"]).toBeUndefined()
      expect(forwarded.headers["referer"]).toBeUndefined()
      expect(forwarded.headers["accept"]).toBe("application/javascript")
      expect(forwarded.headers["accept-language"]).toBe("zh-CN")
      expect(forwarded.headers["if-none-match"]).toBe('"fixture-etag"')
      expect(forwarded.headers["range"]).toBe("bytes=0-10")
      expect(forwarded.body._tag).toBe("Empty")
    }),
  )

  it.live("cannot replace the hosted UI origin with a network-path request", () =>
    Effect.gen(function* () {
      const calls: string[] = []
      const fs = yield* FSUtil.Service
      const response = yield* serveUIEffect(
        HttpServerRequest.fromWeb(new Request("http://localhost//different-origin.invalid/client.js")),
        {
          fs,
          disableEmbeddedWebUi: true,
          client: HttpClient.make((request) => {
            calls.push(request.url)
            return Effect.succeed(HttpClientResponse.fromWeb(request, new Response("asset")))
          }),
        },
      )

      expect(response.status).toBe(200)
      expect(calls).toHaveLength(1)
      const forwarded = calls[0]
      if (!forwarded) throw new Error("expected one hosted UI request")
      expect(new URL(forwarded).origin).toBe(UI_UPSTREAM.origin)
      expect(new URL(forwarded).pathname).toBe("//different-origin.invalid/client.js")
    }),
  )

  for (const method of ["GET", "HEAD"]) {
    it.live(`preserves SPA deep-link ${method}`, () =>
      Effect.gen(function* () {
        const calls: string[] = []
        const response = yield* uiApp({
          disableEmbeddedWebUi: true,
          client: httpClient(
            new Response("<html>ui</html>", { headers: { "content-type": "text/html" } }),
            (request) => {
              calls.push(request.method)
            },
          ),
        }).request("/server/server-fixture/session/ses_fixture", { method })

        expect(response.status).toBe(200)
        expect(calls).toEqual([method])
      }),
    )
  }

  for (const path of ["/question", "/question/qst_fixture/reply", "/session/ses_fixture/todo", "/api/not-a-route"]) {
    it.live(`embedded UI does not turn API path ${path} into index.html`, () =>
      Effect.gen(function* () {
        const fs = yield* FSUtil.Service
        const reads: string[] = []
        const response = yield* serveEmbeddedUIEffect(
          path,
          {
            ...fs,
            readFile: (file) => {
              reads.push(file)
              return Effect.succeed(new TextEncoder().encode("<html>ui</html>"))
            },
          },
          { "index.html": "/$bunfs/root/index.html" },
        )

        expect(reads).toHaveLength(0)
        expect(response.status).toBe(404)
      }),
    )
  }

  it.live("preserves local CORS preflight for a retired API path", () =>
    Effect.gen(function* () {
      const response = yield* app({ password: "local-test-password", username: "aigcfroge" }).request(
        "/question/qst_fixture/reply",
        {
          method: "OPTIONS",
          headers: {
            origin: "http://localhost:3000",
            "access-control-request-method": "POST",
            "access-control-request-headers": "authorization,content-type",
          },
        },
      )

      expect(response.status).toBe(204)
      expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:3000")
    }),
  )
})
