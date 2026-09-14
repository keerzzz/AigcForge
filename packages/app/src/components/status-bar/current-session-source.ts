import { createMemo } from "solid-js"
import { useParams } from "@solidjs/router"
import type { Message, Part } from "@aigcfroge/sdk/v2/client"
import { useGlobal } from "@/context/global"
import { useServer, ServerConnection, serverName } from "@/context/server"
import { useLanguage } from "@/context/language"
import { getSessionContextMetrics } from "@/components/session/session-context-metrics"
import { parseServerKey } from "@/utils/session-route"
import { toolCountFromParts } from "./tool-count"
import type { ConnectionState, StatusBarModelInfo, StatusBarCacheInfo, StatusBarSource } from "./types"
import type { StatusBarMetric, MetricGroup } from "./metrics"
import { createStore } from "solid-js/store"
import { Persist, persisted } from "@/utils/persist"
import { useRouteContribution } from "@/context/route-contribution"

const DEFAULT_PINNED = ["tokens.total", "cost.total", "tools.count"]

export function createCurrentSessionSource(): StatusBarSource {
  const params = useParams<{ serverKey?: string; id?: string }>()
  const server = useServer()
  const global = useGlobal()
  const lang = useLanguage()
  const routeContribution = useRouteContribution()

  const routeKey = createMemo(() => {
    if (!params.serverKey) return undefined
    // Malformed keys are the route resolver's problem to surface; the status
    // bar simply has no route-scoped server to show.
    const parsed = parseServerKey(params.serverKey)
    return parsed.ok ? parsed.key : undefined
  })

  const routeServer = createMemo(() => {
    const key = routeKey()
    if (!key) return server.current
    return server.list.find((conn) => ServerConnection.key(conn) === key)
  })

  const activeServerKey = createMemo(() => {
    const conn = routeServer()
    if (conn) return ServerConnection.key(conn)
    return routeKey() ?? server.key
  })

  const placement = createMemo(() => {
    const id = params.id
    if (!id) return undefined
    return global.sessionPlacement.get(activeServerKey(), id)
  })

  const directory = createMemo(() => placement()?.directory)
  const childStore = createMemo(() => {
    const conn = routeServer()
    const dir = directory()
    if (!conn || !dir) return undefined
    return global.ensureServerCtx(conn).sync.child(dir, { bootstrap: false })[0]
  })

  const currentContribution = () => {
    const current = routeContribution?.current()
    if (!current || current.server !== activeServerKey() || current.leafID !== params.id) return undefined
    return current
  }

  const openContext = () => currentContribution()?.openContext()

  const sessionInfo = createMemo(() => {
    const id = params.id
    if (!id) return undefined
    return childStore()?.session.find((item) => item.id === id)
  })

  const messages = createMemo((): Message[] => {
    const id = params.id
    if (!id) return []
    return childStore()?.message[id] ?? []
  })

  const allParts = createMemo((): Record<string, Part[] | undefined> => childStore()?.part ?? {})
  const toolCount = createMemo(() => toolCountFromParts(allParts(), messages()))

  const metrics = createMemo(() => getSessionContextMetrics(messages()))
  const context = createMemo(() => metrics().context)
  const findModel = (providerID: string, modelID: string) => childStore()?.provider.all.get(providerID)?.models[modelID]

  const sessModel = createMemo((): StatusBarModelInfo | undefined => {
    if (!currentContribution()) return undefined
    const session = sessionInfo()
    const model = session?.model
    if (model) {
      const found = findModel(model.providerID, model.id)
      return {
        providerID: model.providerID,
        modelID: model.id,
        variant: model.variant,
        displayName: found?.name ?? model.id,
      }
    }
    const ctx = context()
    if (!ctx) return undefined
    const found = findModel(ctx.message.providerID, ctx.message.modelID)
    return {
      providerID: ctx.message.providerID,
      modelID: ctx.message.modelID,
      variant: ctx.message.variant,
      displayName: found?.name ?? ctx.message.modelID,
    }
  })

  const sessTokens = () => (currentContribution() ? sessionInfo()?.tokens : undefined)
  const sessCost = () => (currentContribution() ? sessionInfo()?.cost : undefined)
  const modelLimit = () => {
    const ctx = context()
    if (!ctx) return undefined
    return findModel(ctx.message.providerID, ctx.message.modelID)?.limit.context
  }

  const normalizePinned = (value: unknown) => {
    if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) return { ids: DEFAULT_PINNED }
    return { ids: [...new Set(value)].slice(0, 20) }
  }
  const [pinnedStore, setPinnedStore, , pinnedReady] = persisted(
    {
      ...Persist.global("status-bar.pinned-metrics", ["aigcfroge:pinned_metrics"]),
      migrate: normalizePinned,
    },
    createStore({ ids: DEFAULT_PINNED }),
  )

  const togglePin = (metricID: string) => {
    if (!pinnedReady()) return
    setPinnedStore("ids", (prev) =>
      prev.includes(metricID) ? prev.filter((id) => id !== metricID) : prev.length >= 20 ? prev : [...prev, metricID],
    )
  }

  const mk = (
    id: string,
    group: MetricGroup,
    labelKey: string,
    value: () => string,
    available: () => boolean,
  ): StatusBarMetric => ({ id, group, labelKey, value, available })

  const allMetrics = createMemo((): StatusBarMetric[] => {
    if (!currentContribution()) return []
    const t = sessTokens()
    const c = sessCost()
    const ctx = context()
    const limit = modelLimit()
    const locale = lang.intl()
    const fmtNum = (n: number) => n.toLocaleString(locale)
    const fmtCurrency = (n: number) => new Intl.NumberFormat(locale, { style: "currency", currency: "USD" }).format(n)

    return [
      mk(
        "tokens.total",
        "tokens",
        "statusBar.metrics.totalTokens",
        () => (t ? fmtNum(t.input + t.output + t.reasoning + t.cache.read + t.cache.write) : "—"),
        () => !!t,
      ),
      mk(
        "tokens.input",
        "tokens",
        "statusBar.metrics.inputTokens",
        () => (t ? fmtNum(t.input) : "—"),
        () => !!t,
      ),
      mk(
        "tokens.output",
        "tokens",
        "statusBar.metrics.outputTokens",
        () => (t ? fmtNum(t.output) : "—"),
        () => !!t,
      ),
      mk(
        "tokens.reasoning",
        "tokens",
        "statusBar.metrics.reasoningTokens",
        () => (t ? fmtNum(t.reasoning) : "—"),
        () => !!t,
      ),
      mk(
        "context.usage",
        "context",
        "statusBar.metrics.contextUsage",
        () =>
          ctx && limit ? `${fmtNum(ctx.total)} / ${fmtNum(limit)} (${Math.round((ctx.total / limit) * 100)}%)` : "—",
        () => !!(ctx && limit),
      ),
      mk(
        "cache.rate",
        "cache",
        "statusBar.metrics.cacheRate",
        () => {
          if (!ctx) return "—"
          const d = ctx.input + ctx.cacheRead
          return d > 0 ? `${Math.round((ctx.cacheRead / d) * 100)}%` : "—"
        },
        () => !!ctx,
      ),
      mk(
        "cache.read",
        "cache",
        "statusBar.metrics.cacheRead",
        () => (ctx ? fmtNum(ctx.cacheRead) : "—"),
        () => !!ctx,
      ),
      mk(
        "cache.write",
        "cache",
        "statusBar.metrics.cacheWrite",
        () => (ctx ? fmtNum(ctx.cacheWrite) : "—"),
        () => !!ctx,
      ),
      mk(
        "cost.total",
        "cost",
        "statusBar.metrics.totalCost",
        () => (c !== undefined ? fmtCurrency(c) : "—"),
        () => c !== undefined,
      ),
      mk(
        "tools.count",
        "tools",
        "statusBar.metrics.toolCount",
        () => fmtNum(toolCount()),
        () => toolCount() > 0,
      ),
    ]
  })

  const pinnedMetrics = createMemo(() => {
    const ids = pinnedStore.ids
    return allMetrics().filter((m) => ids.includes(m.id))
  })

  return {
    label: () => (currentContribution() ? sessionInfo()?.title : undefined),
    connection: () => {
      const key = activeServerKey()
      const health = key ? global.servers.health[key] : undefined
      const conn = routeServer()
      const state: ConnectionState =
        health?.healthy === true
          ? "online"
          : health?.healthy === false
            ? "offline"
            : conn?.type === "sidecar" || conn?.type === "http"
              ? "online"
              : "reconnecting"
      return { state, serverName: serverName(conn), serverKey: key }
    },
    model: sessModel,
    cache: createMemo((): StatusBarCacheInfo | undefined => {
      if (!currentContribution()) return undefined
      const ctx = context()
      if (!ctx) return undefined
      const d = ctx.input + ctx.cacheRead
      return d > 0
        ? { hitRate: Math.round((ctx.cacheRead / d) * 100), read: ctx.cacheRead, write: ctx.cacheWrite }
        : { hitRate: 0, read: ctx.cacheRead, write: ctx.cacheWrite }
    }),
    allMetrics,
    pinnedMetrics,
    togglePin,
    openContext,
  }
}
