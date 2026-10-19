import { describe, expect, test } from "bun:test"
import { OpenApi } from "effect/unstable/httpapi"
import { PublicApi } from "../../src/server/routes/instance/httpapi/public"
import { SessionApi } from "../../src/server/routes/instance/httpapi/groups/session"

type Method = "get" | "post" | "put" | "delete" | "patch"
type OpenApiSchema = {
  readonly $ref?: string
  readonly anyOf?: ReadonlyArray<OpenApiSchema>
  readonly oneOf?: ReadonlyArray<OpenApiSchema>
  readonly allOf?: ReadonlyArray<OpenApiSchema>
  readonly type?: string
  readonly enum?: readonly unknown[]
  readonly properties?: Record<string, OpenApiSchema>
  readonly required?: readonly string[]
}
type OpenApiResponse = {
  readonly description?: string
  readonly content?: Record<string, { readonly schema?: OpenApiSchema }>
}
type OpenApiOperation = {
  readonly parameters?: ReadonlyArray<{
    readonly name: string
    readonly in: string
    readonly required?: boolean
    readonly schema?: { readonly type?: string }
  }>
  readonly responses?: Record<string, OpenApiResponse>
  readonly requestBody?: { readonly required?: boolean }
  readonly security?: unknown
}
type OpenApiPathItem = Partial<Record<Method, OpenApiOperation>>
type OpenApiSpec = {
  readonly paths: Record<string, OpenApiPathItem>
  readonly components: { readonly schemas: Record<string, OpenApiSchema> }
}

const methods = ["get", "post", "put", "delete", "patch"] as const

const allowedV2BuiltInEndpointErrors: string[] = []

function v2Operations(spec: OpenApiSpec) {
  return Object.entries(spec.paths).flatMap(([path, item]) =>
    path.startsWith("/api/")
      ? methods.flatMap((method) => {
          const operation = item[method]
          return operation ? [{ method, path, operation }] : []
        })
      : [],
  )
}

function responseRef(response: OpenApiResponse | undefined) {
  return response?.content?.["application/json"]?.schema?.$ref
}

function componentName(ref: string) {
  return ref.replace("#/components/schemas/", "")
}

function componentNames(response: OpenApiResponse | undefined) {
  const schema = response?.content?.["application/json"]?.schema
  if (!schema) return []
  return [...new Set(schemaComponentNames(schema))]
}

function schemaComponentNames(schema: OpenApiSchema): string[] {
  return [
    ...(schema.$ref ? [componentName(schema.$ref)] : []),
    ...[...(schema.anyOf ?? []), ...(schema.oneOf ?? []), ...(schema.allOf ?? [])].flatMap(schemaComponentNames),
  ]
}

function isBuiltInEndpointError(name: string) {
  return name.startsWith("EffectHttpApiError") || name.startsWith("effect_HttpApiError_")
}

describe("PublicApi OpenAPI v2 errors", () => {
  test("includes plugin-facing core schemas", () => {
    const spec = OpenApi.fromApi(PublicApi) as OpenApiSpec

    expect(Object.keys(spec.components.schemas)).toEqual(
      expect.arrayContaining([
        "CredentialValue",
        "IntegrationInputs",
        "IntegrationMethod",
        "IntegrationRef",
        "SkillV2Source",
      ]),
    )
  })

  test("documents nested legacy global sync events", () => {
    const spec = OpenApi.fromApi(PublicApi) as OpenApiSpec
    const schema = spec.components.schemas.SyncEventSessionCreated

    expect(schema?.required).toEqual(["type", "id", "syncEvent"])
    expect(schema?.properties?.type?.enum).toEqual(["sync"])
    expect(schema?.properties?.syncEvent).toMatchObject({
      required: ["type", "id", "seq", "aggregateID", "data"],
      properties: {
        type: { enum: ["session.created.1"] },
        id: { type: "string" },
        seq: { type: "number" },
        aggregateID: { type: "string" },
      },
    })
  })

  test("preserves /api auth responses", () => {
    const spec = OpenApi.fromApi(PublicApi) as OpenApiSpec

    for (const route of v2Operations(spec)) {
      expect(route.operation.responses?.["401"], `${route.method.toUpperCase()} ${route.path}`).toBeDefined()
      expect(route.operation.security, `${route.method.toUpperCase()} ${route.path}`).toEqual([])
    }
  })

  test("documents references separately from filesystem routes", () => {
    const spec = OpenApi.fromApi(PublicApi) as OpenApiSpec

    for (const path of ["/api/fs/read/*", "/api/fs/list"]) {
      expect(spec.paths[path]?.get?.parameters, path).not.toContainEqual(expect.objectContaining({ name: "reference" }))
    }
    expect(spec.paths["/api/reference"]?.get).toBeDefined()
  })

  test("preserves required request bodies for v2 mutations", () => {
    const spec = OpenApi.fromApi(PublicApi) as OpenApiSpec

    for (const path of [
      "/api/session/{sessionID}/prompt",
      "/api/session/{sessionID}/permission/{requestID}/reply",
      "/api/session/{sessionID}/question/{requestID}/reply",
    ]) {
      expect(spec.paths[path]?.post?.requestBody?.required, path).toBe(true)
    }
  })

  test("documents integration discovery and connection routes", () => {
    const spec = OpenApi.fromApi(PublicApi) as OpenApiSpec

    for (const [method, path] of [
      ["get", "/api/integration"],
      ["get", "/api/integration/{integrationID}"],
      ["post", "/api/integration/{integrationID}/connect/key"],
      ["post", "/api/integration/{integrationID}/connect/oauth"],
      ["get", "/api/integration/attempt/{attemptID}"],
      ["post", "/api/integration/attempt/{attemptID}/complete"],
      ["delete", "/api/integration/attempt/{attemptID}"],
      ["delete", "/api/credential/{credentialID}"],
      ["patch", "/api/credential/{credentialID}"],
    ] as const) {
      expect(spec.paths[path]?.[method], `${method.toUpperCase()} ${path}`).toBeDefined()
    }

    for (const path of [
      "/api/integration/{integrationID}/connect/key",
      "/api/integration/{integrationID}/connect/oauth",
      "/api/integration/attempt/{attemptID}/complete",
    ]) {
      expect(spec.paths[path]?.post?.requestBody?.required, path).toBe(true)
    }
  })

  test("does not rewrite /api endpoint errors to legacy error components", () => {
    const spec = OpenApi.fromApi(PublicApi) as OpenApiSpec
    const refs = v2Operations(spec)
      .flatMap((route) =>
        Object.entries(route.operation.responses ?? {}).flatMap(([status, response]) => {
          return componentNames(response).map((name) => `${route.method.toUpperCase()} ${route.path} ${status} ${name}`)
        }),
      )
      .filter((entry) => entry.endsWith(" BadRequestError") || entry.endsWith(" NotFoundError"))

    expect(refs).toEqual([])
  })

  test("new /api endpoint errors cannot use built-in components without an explicit allowlist", () => {
    const spec = OpenApi.fromApi(PublicApi) as OpenApiSpec
    const builtInEndpointErrors = v2Operations(spec)
      .flatMap((route) =>
        Object.entries(route.operation.responses ?? {}).flatMap(([status, response]) => {
          if (status === "401") return []
          const ref = responseRef(response)
          if (!ref) return []
          const name = componentName(ref)
          return isBuiltInEndpointError(name) ? [`${route.method.toUpperCase()} ${route.path} ${status} ${name}`] : []
        }),
      )
      .sort()

    expect(builtInEndpointErrors).toEqual(allowedV2BuiltInEndpointErrors)
  })

  test("documents v2 provider and model catalog errors", () => {
    const spec = OpenApi.fromApi(PublicApi) as OpenApiSpec

    expect(componentName(responseRef(spec.paths["/api/provider"]?.get?.responses?.["503"]) ?? "")).toBe(
      "ServiceUnavailableError",
    )
    expect(componentName(responseRef(spec.paths["/api/model"]?.get?.responses?.["503"]) ?? "")).toBe(
      "ServiceUnavailableError",
    )
    // LocationMiddleware now declares a typed 404 error, which merges into every
    // endpoint that consumes it as an `anyOf` alongside the endpoint's own error.
    expect(componentNames(spec.paths["/api/provider/{providerID}"]?.get?.responses?.["404"])).toEqual([
      "ProviderNotFoundError",
      "LocationNotFoundError",
    ])
    expect(componentName(responseRef(spec.paths["/api/provider/{providerID}"]?.get?.responses?.["503"]) ?? "")).toBe(
      "ServiceUnavailableError",
    )
  })

  test("documents v2 session not-found errors", () => {
    const spec = OpenApi.fromApi(PublicApi) as OpenApiSpec

    for (const route of [
      ["post", "/api/session/{sessionID}/prompt"],
      ["post", "/api/session/{sessionID}/compact"],
      ["post", "/api/session/{sessionID}/wait"],
      ["get", "/api/session/{sessionID}/context"],
      ["get", "/api/session/{sessionID}/message"],
    ] as const) {
      expect(componentNames(spec.paths[route[1]]?.[route[0]]?.responses?.["404"])).toContain("SessionNotFoundError")
    }
  })

  test("documents v2 unfinished session mutation errors", () => {
    const spec = OpenApi.fromApi(PublicApi) as OpenApiSpec

    for (const route of [
      ["post", "/api/session/{sessionID}/compact"],
      ["post", "/api/session/{sessionID}/wait"],
    ] as const) {
      expect(componentName(responseRef(spec.paths[route[1]]?.[route[0]]?.responses?.["503"]) ?? "")).toBe(
        "ServiceUnavailableError",
      )
    }
  })

  test("documents v2 session read data errors", () => {
    const spec = OpenApi.fromApi(PublicApi) as OpenApiSpec

    for (const route of [
      ["get", "/api/session/{sessionID}/context"],
      ["get", "/api/session/{sessionID}/message"],
    ] as const) {
      expect(componentName(responseRef(spec.paths[route[1]]?.[route[0]]?.responses?.["500"]) ?? "")).toMatch(
        /^UnknownError\d*$/,
      )
    }
  })

  test("documents session busy errors", () => {
    const spec = OpenApi.fromApi(PublicApi) as OpenApiSpec

    for (const route of [
      ["post", "/session/{sessionID}/shell"],
      ["post", "/session/{sessionID}/revert"],
      ["post", "/session/{sessionID}/unrevert"],
      ["delete", "/session/{sessionID}/message/{messageID}"],
    ] as const) {
      expect(componentName(responseRef(spec.paths[route[1]]?.[route[0]]?.responses?.["409"]) ?? "")).toBe(
        "SessionBusyError",
      )
    }
  })

  test("documents permission and question not-found errors", () => {
    const spec = OpenApi.fromApi(PublicApi) as OpenApiSpec

    // Instance middleware adds its location-not-found case to endpoint errors.
    expect(componentNames(spec.paths["/permission/{requestID}/reply"]?.post?.responses?.["404"])).toEqual([
      "PermissionNotFoundError",
      "NotFoundError",
    ])
    for (const path of ["/question", "/question/{requestID}/reply", "/question/{requestID}/reject"]) {
      expect(spec.paths[path], "Retired question routes must not remain in the public contract").toBeUndefined()
    }
    for (const route of [
      ["post", "/api/session/{sessionID}/question/{requestID}/reply"],
      ["post", "/api/session/{sessionID}/question/{requestID}/reject"],
    ] as const) {
      expect(componentNames(spec.paths[route[1]]?.[route[0]]?.responses?.["404"])).toEqual([
        "QuestionNotFoundError",
        "SessionNotFoundError",
      ])
    }
  })

  test("documents MCP server not-found errors", () => {
    const spec = OpenApi.fromApi(PublicApi) as OpenApiSpec

    for (const route of [
      ["post", "/mcp/{name}/auth"],
      ["post", "/mcp/{name}/auth/authenticate"],
      ["post", "/mcp/{name}/auth/callback"],
      ["delete", "/mcp/{name}/auth"],
      ["post", "/mcp/{name}/connect"],
      ["post", "/mcp/{name}/disconnect"],
    ] as const) {
      expect(componentNames(spec.paths[route[1]]?.[route[0]]?.responses?.["404"])).toEqual([
        "McpServerNotFoundError",
        "NotFoundError",
      ])
    }
  })

  test("documents PTY resource and ticket errors", () => {
    const spec = OpenApi.fromApi(PublicApi) as OpenApiSpec

    for (const route of [
      ["get", "/pty/{ptyID}"],
      ["put", "/pty/{ptyID}"],
      ["delete", "/pty/{ptyID}"],
      ["post", "/pty/{ptyID}/connect-token"],
    ] as const) {
      expect(componentNames(spec.paths[route[1]]?.[route[0]]?.responses?.["404"])).toEqual([
        "PtyNotFoundError",
        "NotFoundError",
      ])
    }
    expect(componentName(responseRef(spec.paths["/pty/{ptyID}/connect-token"]?.post?.responses?.["403"]) ?? "")).toBe(
      "PtyForbiddenError",
    )
    expect(
      spec.paths["/pty/{ptyID}/connect"]?.get?.parameters
        ?.filter((parameter) => parameter.in === "query")
        .map((parameter) => parameter.name),
    ).toEqual(["directory", "workspace", "cursor", "ticket"])
  })

  test("documents project not-found errors", () => {
    const spec = OpenApi.fromApi(PublicApi) as OpenApiSpec

    expect(componentNames(spec.paths["/project/{projectID}"]?.patch?.responses?.["404"])).toEqual([
      "ProjectNotFoundError",
      "NotFoundError",
    ])
  })
  test("legacy Sync errors include validation and retain the built-in handler arm", () => {
    const spec = OpenApi.fromApi(PublicApi) as OpenApiSpec
    for (const path of ["/sync/history", "/sync/replay", "/sync/steal"]) {
      expect(componentNames(spec.paths[path]?.post?.responses?.["400"]), path).toEqual(
        expect.arrayContaining(["BadRequestError", "effect_HttpApiError_BadRequest"]),
      )
    }
  })

  test("legacy business and domain errors remain beside the validation envelope", () => {
    const spec = OpenApi.fromApi(PublicApi) as OpenApiSpec
    expect(componentNames(spec.paths["/session/{sessionID}/fork"]?.post?.responses?.["400"])).toEqual(
      expect.arrayContaining(["BadRequestError", "effect_HttpApiError_BadRequest", "UnsupportedProductModeError"]),
    )
    expect(componentNames(spec.paths["/session/{sessionID}/permission-override"]?.put?.responses?.["400"])).toEqual(
      expect.arrayContaining([
        "BadRequestError",
        "effect_HttpApiError_BadRequest",
        "InvalidRequestError",
        "UnsupportedProductModeError",
      ]),
    )
  })

  test("legacy validation schema preserves its name/data envelope and optional kind", () => {
    const spec = OpenApi.fromApi(PublicApi) as OpenApiSpec
    const error = spec.components.schemas.BadRequestError
    const data = error?.properties?.data
    const fields = data?.$ref ? spec.components.schemas[componentName(data.$ref)] : data
    expect(error?.required).toEqual(["name", "data"])
    expect(error?.properties?.name?.enum).toEqual(["BadRequest"])
    expect(error?.properties?._tag).toBeUndefined()
    expect(fields?.required).toEqual(["message"])
    expect(fields?.properties?.kind?.enum).toEqual(["Params", "Headers", "Query", "Body", "Payload"])
  })

  test("Session handler rejection contracts belong to their endpoints", () => {
    const spec = OpenApi.fromApi(SessionApi) as OpenApiSpec
    for (const route of [
      ["get", "/session/{sessionID}/identity"],
      ["patch", "/session/{sessionID}"],
      ["post", "/session/{sessionID}/prompt_async"],
      ["post", "/session/{sessionID}/workflow/run"],
      ["post", "/session/{sessionID}/workflow/{runID}/step/{stepRunID}/retry"],
    ] as const) {
      expect(componentNames(spec.paths[route[1]]?.[route[0]]?.responses?.["400"]), route.join(" ")).toContain(
        "InvalidRequestError",
      )
    }
  })

  test("Sync validation does not inherit unrelated business error contracts", () => {
    const spec = OpenApi.fromApi(PublicApi) as OpenApiSpec
    for (const path of ["/sync/history", "/sync/replay", "/sync/steal"]) {
      expect(componentNames(spec.paths[path]?.post?.responses?.["400"]).sort(), path).toEqual([
        "BadRequestError",
        "effect_HttpApiError_BadRequest",
      ])
    }
  })

  test("Console switch documents both validation and handler rejection contracts", () => {
    const spec = OpenApi.fromApi(PublicApi) as OpenApiSpec
    expect(componentNames(spec.paths["/experimental/console/switch"]?.post?.responses?.["400"]).sort()).toEqual([
      "BadRequestError",
      "effect_HttpApiError_BadRequest",
    ])
  })
})
