import { FSUtil } from "@aigcfroge/core/fs-util"
import { Effect, Stream } from "effect"
import { HttpClient, HttpClientRequest, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { createHash } from "node:crypto"
import { ProxyUtil } from "../proxy-util"

let embeddedUIPromise: Promise<Record<string, string> | null> | undefined

export const UI_UPSTREAM = new URL("https://app.aigcfroge.ai")

export const csp = (hash = "") =>
  `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'${hash ? ` 'sha256-${hash}'` : ""}; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; media-src 'self' data:; connect-src * data:; form-action 'self'`
export const DEFAULT_CSP = csp()

export function themePreloadHash(body: string) {
  return body.match(/<script\b(?![^>]*\bsrc\s*=)[^>]*\bid=(['"])oc-theme-preload-script\1[^>]*>([\s\S]*?)<\/script>/i)
}

export function cspForHtml(body: string) {
  const match = themePreloadHash(body)
  return csp(match ? createHash("sha256").update(match[2]).digest("base64") : "")
}

function proxyRequestHeaders(headers: Readonly<Record<string, string>>) {
  // The hosted UI serves public assets; local API credentials and arbitrary
  // client headers must never cross that origin boundary.
  return ProxyUtil.headers(
    Object.fromEntries(
      ["accept", "accept-language", "cache-control", "if-modified-since", "if-none-match", "range", "if-range"].flatMap(
        (name) => {
          const value = headers[name]
          return value === undefined ? [] : [[name, value] as const]
        },
      ),
    ),
    { host: UI_UPSTREAM.host },
  )
}

function proxyResponseHeaders(headers: Record<string, string>) {
  const result = new Headers(headers)
  // FetchHttpClient exposes decoded response bodies, so forwarding upstream
  // transfer metadata makes browsers decode already-decoded assets again.
  result.delete("content-encoding")
  result.delete("content-length")
  result.delete("transfer-encoding")
  return result
}

export function upstreamURL(path: string) {
  const url = new URL(UI_UPSTREAM)
  url.pathname = path
  return url.toString()
}

export function embeddedUI(disableEmbeddedWebUi: boolean) {
  if (disableEmbeddedWebUi) return Promise.resolve(null)
  return (embeddedUIPromise ??=
    // @ts-expect-error - generated file at build time
    import("aigcfroge-web-ui.gen.ts").then((module) => module.default as Record<string, string>).catch(() => null))
}

function notFound() {
  return HttpServerResponse.jsonUnsafe({ error: "Not Found" }, { status: 404 })
}

function isUIPath(path: string) {
  // API namespaces never belong to the SPA, even after an endpoint is retired.
  try {
    // Match the router's case-insensitive paths and raw semicolon query delimiter.
    // Only classification is normalized; asset path casing stays intact.
    return !/^\/+(?:api|question|session)(?:\/|$)/i.test(decodeURIComponent(path.replace(/;.*/s, "")))
  } catch (error) {
    if (error instanceof URIError) return false
    throw error
  }
}

/**
 * The UI fallback proxies to the hosted app whenever no build-time UI is
 * embedded, which is every source checkout. `HttpClientError` is not
 * `Respondable`, so an unreachable upstream escaped as a typed failure and
 * landed on Effect's generic `Response.empty({ status: 500 })`: no body, no
 * content-type, nothing telling the caller the gateway hop failed. The
 * per-route `errorLayer` cannot fill it in either — that boundary only replaces
 * defect-only empty 500s.
 *
 * 502 rather than 404: the path may well be a valid SPA deep link, so the honest
 * statement is that this server could not reach the app upstream, not that the
 * resource does not exist. `reason` carries only the failure discriminator, not
 * the cause, so an upstream error cannot push internals into the response.
 */
function badGateway(reason: string) {
  return HttpServerResponse.jsonUnsafe({ error: "Bad Gateway", upstream: UI_UPSTREAM.host, reason }, { status: 502 })
}

function embeddedUIResponse(file: string, body: Uint8Array) {
  const mime = FSUtil.mimeType(file)
  const headers = new Headers({ "content-type": mime })
  if (mime.startsWith("text/html")) {
    headers.set("content-security-policy", cspForHtml(new TextDecoder().decode(body)))
  }
  return HttpServerResponse.raw(body, { headers })
}

export function serveEmbeddedUIEffect(
  requestPath: string,
  fs: FSUtil.Interface,
  embeddedWebUI: Record<string, string>,
) {
  if (!isUIPath(requestPath)) return Effect.succeed(notFound())
  const file = embeddedWebUI[requestPath.replace(/^\//, "")] ?? embeddedWebUI["index.html"] ?? null
  if (!file) return Effect.succeed(notFound())

  return fs.readFile(file).pipe(
    Effect.map((body) => embeddedUIResponse(file, body)),
    Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(notFound())),
  )
}

export function serveUIEffect(
  request: HttpServerRequest.HttpServerRequest,
  services: { fs: FSUtil.Interface; client: HttpClient.HttpClient; disableEmbeddedWebUi: boolean },
) {
  return Effect.gen(function* () {
    const path = ProxyUtil.requestURL(request.url).pathname
    if ((request.method !== "GET" && request.method !== "HEAD") || !isUIPath(path)) return notFound()
    const embeddedWebUI = yield* Effect.promise(() => embeddedUI(services.disableEmbeddedWebUi))

    if (embeddedWebUI) return yield* serveEmbeddedUIEffect(path, services.fs, embeddedWebUI)

    return yield* proxyUIEffect(request, path, services.client).pipe(
      Effect.catchTag("HttpClientError", (error) => Effect.succeed(badGateway(error.reason._tag))),
    )
  })
}

function proxyUIEffect(request: HttpServerRequest.HttpServerRequest, path: string, client: HttpClient.HttpClient) {
  return Effect.gen(function* () {
    const response = yield* client.execute(
      HttpClientRequest.make(request.method)(upstreamURL(path), {
        headers: proxyRequestHeaders(request.headers),
      }),
    )
    const headers = proxyResponseHeaders(response.headers)

    if (response.headers["content-type"]?.includes("text/html")) {
      const body = yield* response.text
      headers.set("Content-Security-Policy", cspForHtml(body))
      return HttpServerResponse.text(body, { status: response.status, headers })
    }

    headers.set("Content-Security-Policy", csp())
    return HttpServerResponse.stream(response.stream.pipe(Stream.catchCause(() => Stream.empty)), {
      status: response.status,
      headers,
    })
  })
}
