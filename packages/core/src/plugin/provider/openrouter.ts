import { define } from "@omnixa/plugin/effect/plugin"
import type { ModelSource } from "@omnixa/schema/model-source"
import { DateTime, Effect, Semaphore, Stream } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import { App } from "../../app.js"
import { Bus } from "../../bus.js"
import { Credential } from "../../credential.js"
import { Integration } from "../../integration.js"
import { IntegrationConnection } from "../../integration/connection.js"
import { Model } from "../../model.js"
import { Provider } from "../../provider.js"
import { ProviderQuota } from "../../provider/quota.js"

const integrationID = Integration.ID.make("openrouter")
const defaultBaseURL = "https://openrouter.ai/api/v1"
const quotaCacheTTL = 300_000

type QuotaState = {
  token?: string
  quota?: ModelSource.Quota
  lastSuccess?: ModelSource.Quota
  readAt?: number
  readonly loading: ReturnType<typeof Semaphore.makeUnsafe>
}

export const OpenRouterPlugin = define({
  id: "omnixa.provider.openrouter",
  effect: Effect.fn(function* (ctx) {
    const bus = yield* Bus.Service
    const integrations = yield* Integration.Service
    const providers = yield* Provider.Service
    const http = yield* HttpClient.HttpClient
    const accounts = new Map<string, QuotaState>()

    const ensureAccount = (key: string) => {
      const existing = accounts.get(key)
      if (existing) return existing
      const created: QuotaState = { loading: Semaphore.makeUnsafe(1) }
      accounts.set(key, created)
      return created
    }

    yield* ctx.provider.transform((evt) => {
      for (const item of evt.list()) {
        if (item.provider.package !== "@omnixa/ai/providers/openrouter") continue
        evt.update(item.provider.id, (provider) => {
          provider.headers = { ...provider.headers, "HTTP-Referer": "https://omnixa.ai/", "X-Title": "omnixa" }
        })
      }
    })

    yield* ctx.model.transform((models) => {
      const connection = models.connection(integrationID)
      const key = connection ? IntegrationConnection.key(connection) : undefined
      const quota = key ? accounts.get(key)?.quota : undefined
      for (const item of models.provider.list()) {
        if (item.provider.package !== "@omnixa/ai/providers/openrouter") continue
        if (item.provider.id === Provider.ID.openrouter && quota) {
          for (const model of models.list(item.provider.id)) {
            models.update(item.provider.id, model.id, (draft) => {
              draft.metadata = {
                ...draft.metadata,
                quota: {
                  ...quota,
                  windows: quota.windows.map((window) => ({
                    ...window,
                    modelIDs: window.modelIDs && [...window.modelIDs],
                  })),
                },
              }
            })
          }
        }
        for (const modelID of [Model.ID.make("gpt-5-chat-latest"), Model.ID.make("openai/gpt-5-chat")]) {
          if (!models.get(item.provider.id, modelID)) continue
          models.update(item.provider.id, modelID, (model) => {
            // These are OpenRouter-specific OpenAI chat aliases that do not work
            // on the generic path. Keep custom providers with matching IDs untouched.
            model.enabled = false
          })
        }
      }
    })

    yield* ctx.session.hook(
      "model.quota",
      (evt) =>
        Effect.gen(function* () {
          const resolvedConnection = evt.connection
            ? yield* integrations.connection.get(integrationID, evt.connection)
            : yield* integrations.connection.active(integrationID)
          const requestedEnv = evt.connection?.type === "env" ? evt.connection : undefined
          const envMethodConfigured =
            resolvedConnection === undefined &&
            requestedEnv !== undefined &&
            (yield* integrations.get(integrationID))?.methods.some(
              (method) => method.type === "env" && method.names.includes(requestedEnv.name),
            )
          const ref: ModelSource.ConnectionRef | undefined =
            resolvedConnection?.type === "credential"
              ? { type: "credential", id: resolvedConnection.id }
              : resolvedConnection?.type === "env"
                ? { type: "env", name: resolvedConnection.name }
                : envMethodConfigured
                  ? requestedEnv
                  : undefined
          if (!ref) return
          const key = IntegrationConnection.key(ref)
          if (!key) return
          const source = ensureAccount(key)
          yield* source.loading.withPermit(
            Effect.gen(function* () {
              const now = (yield* DateTime.nowAsDate).getTime()
              const credential = resolvedConnection
                ? yield* ctx.integration.connection
                    .resolve(resolvedConnection)
                    .pipe(Effect.orElseSucceed(() => undefined))
                : undefined
              const token = credential?.type === "key" ? credential.key : undefined
              if (source.token !== token) {
                source.token = token
                source.quota = undefined
                source.lastSuccess = undefined
                source.readAt = undefined
              }
              if (source.quota && source.readAt !== undefined && now - source.readAt < quotaCacheTTL) {
                evt.quota = source.quota
                return
              }
              const quota: ModelSource.Quota = token
                ? yield* fetchOpenRouterQuota({
                    http,
                    app: ctx.app,
                    baseURL: (yield* providers.get(Provider.ID.openrouter, ref))?.settings?.baseURL ?? defaultBaseURL,
                    token,
                    connection: ref,
                  })
                : {
                    status: "error",
                    source: "openrouter",
                    connection: ref,
                    observedAt: now,
                    freshUntil: now + quotaCacheTTL,
                    reason: "authentication",
                    windows: [],
                  }
              source.readAt = now
              if (quota.status === "known") source.lastSuccess = quota
              if (quota.reason === "authentication") source.lastSuccess = undefined
              source.quota =
                quota.status !== "known" && quota.reason !== "authentication" && source.lastSuccess
                  ? { ...source.lastSuccess, status: "unknown", reason: quota.reason }
                  : quota
              evt.quota = source.quota
              yield* ctx.model.reload()
            }),
          )
        }),
      { providerID: Provider.ID.openrouter },
    )

    yield* bus.subscribe([Credential.Event.Updated, Credential.Event.Switched]).pipe(
      Stream.filter(
        (event) => event.type === Credential.Event.Updated.type || event.data.integrationID === integrationID,
      ),
      Stream.runForEach((event) =>
        Effect.gen(function* () {
          if (event.type === Credential.Event.Updated.type) {
            for (const state of accounts.values()) state.readAt = undefined
          }
          yield* ctx.model.reload()
        }),
      ),
      Effect.forkScoped({ startImmediately: true }),
    )
  }),
})

const fetchOpenRouterQuota = Effect.fn("OpenRouterPlugin.fetchQuota")(function* (input: {
  readonly http: HttpClient.HttpClient
  readonly app: App.Info
  readonly baseURL: string
  readonly token: string
  readonly connection: ModelSource.ConnectionRef
}) {
  return yield* Effect.gen(function* () {
    const response = yield* input.http.execute(
      HttpClientRequest.get(`${input.baseURL.replace(/\/+$/, "")}/key`).pipe(
        HttpClientRequest.bearerToken(input.token),
        HttpClientRequest.setHeaders({
          Accept: "application/json",
          "User-Agent": App.useragent(input.app),
        }),
      ),
    )
    const body =
      response.status >= 200 && response.status < 300
        ? yield* response.json.pipe(Effect.orElseSucceed(() => undefined))
        : undefined
    const observedAt = (yield* DateTime.nowAsDate).getTime()
    if (body === undefined)
      return {
        status: "error",
        source: "openrouter",
        connection: input.connection,
        observedAt,
        freshUntil: observedAt + quotaCacheTTL,
        reason:
          response.status === 401 || response.status === 403
            ? "authentication"
            : response.status === 429
              ? "rate-limit"
              : response.status >= 200 && response.status < 300
                ? "invalid-output"
                : "transport",
        windows: [],
      } satisfies ModelSource.Quota
    const parsed = ProviderQuota.openrouter(body, observedAt)
    return {
      status: parsed.known ? "known" : "unknown",
      source: "openrouter",
      connection: input.connection,
      observedAt,
      freshUntil: observedAt + quotaCacheTTL,
      reason: parsed.known ? undefined : "invalid-output",
      freePlan: parsed.freePlan,
      allowed: parsed.allowed,
      credits: parsed.balance === undefined ? undefined : { balance: parsed.balance, unlimited: false },
      windows: parsed.windows.map((window) => ({ ...window, scope: "account" as const })),
    } satisfies ModelSource.Quota
  }).pipe(
    Effect.timeout("5 seconds"),
    Effect.catch(() =>
      Effect.gen(function* () {
        const observedAt = (yield* DateTime.nowAsDate).getTime()
        return {
          status: "error",
          source: "openrouter",
          connection: input.connection,
          observedAt,
          freshUntil: observedAt + quotaCacheTTL,
          reason: "transport",
          windows: [],
        } satisfies ModelSource.Quota
      }),
    ),
  )
})
