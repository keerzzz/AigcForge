import type {
  FormAnswer,
  IntegrationInfo,
  IntegrationMethod,
  IntegrationOauthConnectOutput,
} from "@omnixa/client/promise"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { useServerSDK } from "@/runtime/server/client"
import { formatServerError } from "@/runtime/server/errors"
import { useData } from "@/runtime/server/current"
import { createEffect, createMemo, on, onCleanup } from "solid-js"
import { createStore, produce } from "solid-js/store"

export type ProviderConnectMethod = Extract<IntegrationMethod, { type: "key" | "oauth" | "external" }>

type Authorization = IntegrationOauthConnectOutput["data"]

type Polling = {
  generation: number
  timer?: ReturnType<typeof setTimeout>
  disposed: boolean
  // An attempt the server still considers open; cancelled when the dialog goes away.
  attempt?: Authorization
}

export function providerFormDefaults(fields: ProviderConnectMethod["form"]) {
  return (fields ?? []).reduce<FormAnswer>((answer, field) => {
    if (field.type === "external" || !field.hidden || field.default === undefined) return answer

    const active = (field.when ?? []).every((condition) => {
      const actual = answer[condition.key]

      if (actual === undefined) return false

      const equal = Array.isArray(actual) ? actual.some((item) => item === condition.value) : actual === condition.value

      return condition.op === "eq" ? equal : !equal
    })

    if (!active) return answer

    return Object.assign(answer, { [field.key]: field.default })
  }, {})
}

export function createProviderConnectionController(options: {
  provider: () => string
  directory: () => string | undefined
  onComplete: () => void
}) {
  const language = useLanguage()
  const platform = usePlatform()
  const serverSDK = useServerSDK()
  const data = useData()

  const location = () => {
    const directory = options.directory()

    return directory ? { directory } : undefined
  }

  // Not createResource: the dialog is owned by whichever page opened it, so reading a pending
  // resource here would suspend that page's <Suspense> and blank the screen behind the dialog.
  const [integration, setIntegration] = createStore<{ loading: boolean; latest?: IntegrationInfo }>({
    loading: true,
  })

  createEffect(
    on(
      () => ({ provider: options.provider(), directory: options.directory() }),
      (input) => {
        setIntegration({ loading: true, latest: undefined })
        serverSDK.api.integration
          .get({ integrationID: input.provider, location: location() })
          .then((result) => result.data)
          .catch(() => undefined)
          .then((latest) => {
            if (polling.disposed) return

            if (input.provider !== options.provider() || input.directory !== options.directory()) return
            setIntegration({ loading: false, latest })
          })
      },
    ),
  )

  const methods = createMemo<ProviderConnectMethod[]>(() => {
    const values = integration.latest?.methods.filter(
      (method): method is ProviderConnectMethod =>
        method.type === "key" || method.type === "oauth" || method.type === "external",
    )

    if (values?.length) return [...values]

    return [{ type: "key", label: language.t("provider.connect.method.apiKey") }]
  })

  const [store, setStore] = createStore<{
    methodIndex?: number
    authorization?: Authorization
    formAnswer?: FormAnswer
    // Nothing is in flight until a method is selected; `busy()` reads this, so a truthy initial
    // value would keep multi-method providers on the spinner instead of the method list.
    state?: "pending" | "waiting" | "refreshing" | "ready" | "error" | "form"
    error?: string
    auto: boolean
    connected: boolean
    browserFailed: boolean
    statusFailed: boolean
  }>({
    auto: false,
    // The credential is stored; a retry only needs to reload the catalogs.
    connected: false,
    browserFailed: false,
    // The attempt is still open on the server; a retry resumes polling it.
    statusFailed: false,
  })

  const polling: Polling = {
    generation: 0,
    disposed: false,
  }

  const currentMethod = createMemo(() =>
    store.methodIndex === undefined ? undefined : methods().at(store.methodIndex),
  )

  const autoIndex = createMemo(() => {
    if (integration.loading) return undefined
    const values = methods()

    if (values.length === 1) return 0

    return undefined
  })

  type Action =
    | { type: "method.select"; index: number }
    | { type: "method.reset" }
    | { type: "auth.form" }
    | { type: "auth.answer"; answer: FormAnswer | undefined }
    | { type: "auth.pending" }
    | { type: "auth.waiting"; authorization: Authorization }
    | { type: "auth.error"; error: string }

  const dispatch = (action: Action) => {
    setStore(
      produce((draft) => {
        if (action.type === "method.select" || action.type === "method.reset") {
          draft.methodIndex = action.type === "method.select" ? action.index : undefined
          draft.authorization = undefined
          draft.formAnswer = undefined
          draft.state = undefined
          draft.error = undefined
          draft.connected = false
          draft.browserFailed = false
          draft.statusFailed = false

          return
        }

        if (action.type === "auth.form") {
          draft.state = "form"
          draft.error = undefined

          return
        }

        if (action.type === "auth.answer") {
          draft.formAnswer = action.answer
          draft.state = undefined
          draft.error = undefined

          return
        }

        if (action.type === "auth.pending") {
          draft.state = "pending"
          draft.error = undefined

          return
        }

        if (action.type === "auth.waiting") {
          draft.state = "waiting"
          draft.authorization = action.authorization
          draft.error = undefined

          return
        }

        draft.state = "error"
        draft.error = action.error
      }),
    )
  }

  const cancelAttempt = () => {
    const attempt = polling.attempt
    polling.attempt = undefined

    if (!attempt) return
    void serverSDK.api.integration.oauth
      .cancel({ integrationID: options.provider(), attemptID: attempt.attemptID, location: location() })
      .catch(() => undefined)
  }

  const cancelPolling = () => {
    polling.generation++

    if (polling.timer === undefined) return
    clearTimeout(polling.timer)
    polling.timer = undefined
  }

  const finish = async () => {
    cancelPolling()
    polling.attempt = undefined
    const generation = polling.generation
    const active = () => !polling.disposed && generation === polling.generation
    setStore({ connected: true, state: "refreshing", error: undefined })
    const ref = location()
    data.location.integration.invalidate(ref)
    data.location.provider.invalidate(ref)
    data.location.model.invalidate(ref)

    const result = await Promise.all([
      data.location.integration.sync(ref),
      data.location.provider.sync(ref),
      data.location.model.sync(ref),
    ])
      .then(() => ({ ok: true as const }))
      .catch((error) => ({ ok: false as const, error }))

    if (!active()) return

    if (!result.ok) {
      dispatch({ type: "auth.error", error: formatServerError(result.error, language.t) })

      return
    }

    setStore("state", "ready")
    options.onComplete()
  }

  const poll = async (authorization: Authorization, generation: number) => {
    const result = await serverSDK.api.integration.oauth
      .status({
        integrationID: options.provider(),
        attemptID: authorization.attemptID,
        location: location(),
      })
      .then((response) => ({ ok: true as const, status: response.data }))
      .catch((error) => ({ ok: false as const, error }))

    if (polling.disposed || generation !== polling.generation) return

    if (!result.ok) {
      setStore("statusFailed", true)
      dispatch({
        type: "auth.error",
        error: formatServerError(result.error, language.t),
      })

      return
    }

    if (result.status.status === "complete") {
      await finish()

      return
    }

    if (result.status.status === "failed") {
      polling.attempt = undefined
      dispatch({
        type: "auth.error",
        error: result.status.message,
      })

      return
    }

    if (result.status.status === "expired") {
      polling.attempt = undefined
      dispatch({
        type: "auth.error",
        error: language.t("provider.connect.oauth.expired"),
      })

      return
    }

    polling.timer = setTimeout(() => void poll(authorization, generation), 1_000)
  }

  const open = async () => {
    const url = store.authorization?.url

    if (!url) return
    const generation = polling.generation

    const opened = await Promise.resolve()
      .then(() => {
        if (platform.openBrowser) return platform.openBrowser(url)
        platform.openExternal(url)

        return true
      })
      .catch(() => false)

    if (polling.disposed || generation !== polling.generation) return
    setStore("browserFailed", !opened)
  }

  const select = async (index: number, answer?: FormAnswer) => {
    cancelPolling()
    cancelAttempt()
    const generation = polling.generation
    const selected = methods()[index]
    dispatch({ type: "method.select", index })
    const visible = (selected.form ?? []).some((field) => field.type === "external" || !field.hidden)

    if (visible && !answer) {
      dispatch({ type: "auth.form" })

      return
    }

    const merged = { ...providerFormDefaults(selected.form), ...answer }

    if (selected.type === "key") {
      dispatch({ type: "auth.answer", answer: Object.keys(merged).length ? merged : undefined })

      return
    }

    if (selected.form?.some((field) => field.type !== "string")) {
      dispatch({ type: "auth.error", error: language.t("provider.connect.error.unsupportedFields") })

      return
    }

    dispatch({ type: "auth.pending" })

    if (selected.type === "external") {
      const saved = await serverSDK.api.integration.connect
        .external({
          integrationID: options.provider(),
          methodID: selected.id,
          answer: Object.keys(merged).length ? merged : undefined,
          location: location(),
        })
        .then(() => ({ ok: true as const }))
        .catch((error) => ({ ok: false as const, error }))

      if (polling.disposed || generation !== polling.generation) return

      if (!saved.ok) {
        dispatch({ type: "auth.error", error: formatServerError(saved.error, language.t) })

        return
      }

      await finish()

      return
    }

    const result = await serverSDK.api.integration.oauth
      .connect({
        integrationID: options.provider(),
        methodID: selected.id,
        answer: Object.keys(merged).length ? merged : undefined,
        location: location(),
      })
      .then((response) => ({ ok: true as const, authorization: response.data }))
      .catch((error) => ({ ok: false as const, error }))

    if (polling.disposed || generation !== polling.generation) {
      if (result.ok)
        void serverSDK.api.integration.oauth
          .cancel({
            integrationID: options.provider(),
            attemptID: result.authorization.attemptID,
            location: location(),
          })
          .catch(() => undefined)

      return
    }

    if (!result.ok) {
      dispatch({
        type: "auth.error",
        error: formatServerError(result.error, language.t),
      })

      return
    }

    polling.attempt = result.authorization
    dispatch({ type: "auth.waiting", authorization: result.authorization })
    // Same as `omnixa auth login`: hand the user straight to the browser instead of
    // asking them to click a link and retype a code.
    void open()

    if (result.authorization.mode === "auto") void poll(result.authorization, generation)
  }

  const retry = async () => {
    if (store.connected) return finish()
    const authorization = store.authorization

    if (store.statusFailed && authorization) {
      polling.attempt = authorization
      setStore({ state: "waiting", error: undefined, statusFailed: false })

      return poll(authorization, polling.generation)
    }

    const index = store.methodIndex

    if (index === undefined) return

    return select(index, store.formAnswer)
  }

  const reset = () => {
    cancelPolling()
    cancelAttempt()
    dispatch({ type: "method.reset" })
  }

  const connectKey = async (key: string) => {
    if (polling.disposed || store.state === "pending" || store.connected) return
    const generation = polling.generation
    dispatch({ type: "auth.pending" })
    const result = await serverSDK.api.integration.connect
      .key({
        integrationID: options.provider(),
        location: location(),
        key,
        answer: store.formAnswer,
      })
      .then(() => ({ ok: true as const }))
      .catch((error) => ({ ok: false as const, error }))

    if (polling.disposed || generation !== polling.generation) return

    if (!result.ok) {
      dispatch({ type: "auth.error", error: formatServerError(result.error, language.t) })

      return
    }

    await finish()
  }

  const completeCode = async (code: string) => {
    if (polling.disposed || store.state === "pending" || store.connected) return undefined
    const authorization = store.authorization

    if (!authorization) return language.t("provider.connect.oauth.code.invalid")
    const generation = polling.generation
    dispatch({ type: "auth.pending" })

    const result = await serverSDK.api.integration.oauth
      .complete({
        integrationID: options.provider(),
        attemptID: authorization.attemptID,
        location: location(),
        code,
      })
      .then(() => ({ ok: true as const }))
      .catch((error) => ({ ok: false as const, error }))

    if (polling.disposed || generation !== polling.generation) return undefined

    if (!result.ok) {
      setStore("state", "waiting")

      return formatServerError(result.error, language.t, language.t("provider.connect.oauth.code.invalid"))
    }

    await poll(authorization, generation)

    return undefined
  }

  createEffect(() => {
    const index = autoIndex()

    if (store.auto || index === undefined) return
    setStore("auto", true)
    void select(index)
  })
  onCleanup(() => {
    polling.disposed = true
    cancelPolling()
    cancelAttempt()
  })

  return {
    loading: () => integration.loading,
    integration: () => integration.latest,
    methods,
    currentMethod,
    methodIndex: () => store.methodIndex,
    authorization: () => store.authorization,
    browserFailed: () => store.browserFailed,
    // True while nothing useful can be shown yet: the integration is loading, a method is
    // about to be picked automatically, the authorization request is in flight, or an external
    // method, which has no view of its own, is refreshing the catalogs after saving.
    busy: () =>
      integration.loading ||
      (store.methodIndex === undefined && !store.auto && autoIndex() !== undefined) ||
      (store.state === "pending" && currentMethod()?.type !== "key" && store.authorization?.mode !== "code") ||
      (store.state === "refreshing" && currentMethod()?.type === "external"),
    auth: {
      state: () => store.state,
      error: () => store.error,
      connected: () => store.connected,
      select,
      reset,
      retry,
      open,
      refresh: finish,
      connectKey,
      completeCode,
    },
  }
}

export type ProviderConnectionController = ReturnType<typeof createProviderConnectionController>
