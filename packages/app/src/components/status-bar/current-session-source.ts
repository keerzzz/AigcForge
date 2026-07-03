import { createMemo } from "solid-js"
import { useParams } from "@solidjs/router"
import type { Message } from "@aigcfroge/sdk/v2/client"
import { useGlobal } from "@/context/global"
import { useServer, ServerConnection, serverName } from "@/context/server"
import { useLanguage } from "@/context/language"
import { getSessionContextMetrics } from "@/components/session/session-context-metrics"
import { requireServerKey } from "@/utils/session-route"
import type { ConnectionState, StatusBarModelInfo, StatusBarCacheInfo, StatusBarSource } from "./types"
import type { StatusBarMetric, MetricGroup } from "./metrics"
import { createStore } from "solid-js/store"

const DEFAULT_PINNED = ["tokens.total", "cost.total"]

export function createCurrentSessionSource(): StatusBarSource {
  const params = useParams<{ serverKey?: string; id?: string }>()
  const server = useServer()
  const global = useGlobal()
  const lang = useLanguage()

  const routeKey = createMemo(() => {
    if (!params.serverKey) return undefined
    return requireServerKey(params.serverKey)
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

  const metrics = createMemo(() => getSessionContextMetrics(messages()))
  const context = createMemo(() => metrics().context)
  const findModel = (providerID: string, modelID: string) => childStore()?.provider.all.get(providerID)?.models[modelID]

  const sessModel = createMemo((): StatusBarModelInfo | undefined => {
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

  const sessTokens = () => sessionInfo()?.tokens
  const sessCost = () => sessionInfo()?.cost
  const modelLimit = () => {
    const ctx = context()
    if (!ctx) return undefined
    return findModel(ctx.message.providerID, ctx.message.modelID)?.limit.context
  }

  const PINNED_METRICS_KEY = "aigcfroge:pinned_metrics"

  const loadPinned = (): string[] => {
    try {
      const stored = localStorage.getItem(PINNED_METRICS_KEY)
      if (stored) {
        const parsed = JSON.parse(stored)
        if (Array.isArray(parsed) && parsed.every((v) => typeof v === "string")) return parsed
      }
    } catch {}
    return DEFAULT_PINNED
  }

  const [pinnedStore, setPinnedStore] = createStore({ ids: loadPinned() })

  const togglePin = (metricID: string) => {
    setPinnedStore("ids", (prev) => {
      const next = prev.includes(metricID)
        ? prev.filter((id) => id !== metricID)
        : prev.length >= 20
          ? prev
          : [...prev, metricID]
      try {
        localStorage.setItem(PINNED_METRICS_KEY, JSON.stringify(next))
      } catch {}
      return next
    })
  }

  const mk = (
    id: string,
    group: MetricGroup,
    labelKey: string,
    value: () => string,
    available: () => boolean,
  ): StatusBarMetric => ({ id, group, labelKey, value, available })

  const allMetrics = createMemo((): StatusBarMetric[] => {
    const t = sessTokens()
    const c = sessCost()
    const ctx = context()
    const limit = modelLimit()
    const locale = lang.intl()
    const fmtNum = (n: number) => n.toLocaleString(locale)
    const fmtCurrency = (n: number) =>
      new Intl.NumberFormat(locale, { style: "currency", currency: "USD" }).format(n)

    return [
      mk("tokens.total", "tokens", "statusBar.metrics.totalTokens",
        () => t ? fmtNum(t.input + t.output + t.reasoning + t.cache.read + t.cache.write) : "—",
        () => !!t),
      mk("tokens.input", "tokens", "statusBar.metrics.inputTokens",
        () => t ? fmtNum(t.input) : "—",
        () => !!t),
      mk("tokens.output", "tokens", "statusBar.metrics.outputTokens",
        () => t ? fmtNum(t.output) : "—",
        () => !!t),
      mk("tokens.reasoning", "tokens", "statusBar.metrics.reasoningTokens",
        () => t ? fmtNum(t.reasoning) : "—",
        () => !!t),
      mk("context.usage", "context", "statusBar.metrics.contextUsage",
        () => ctx && limit ? `${fmtNum(ctx.total)} / ${fmtNum(limit)} (${Math.round(ctx.total / limit * 100)}%)` : "—",
        () => !!(ctx && limit)),
      mk("cache.rate", "cache", "statusBar.metrics.cacheRate",
        () => {
          if (!ctx) return "—"
          const d = ctx.input + ctx.cacheRead
          return d > 0 ? `${Math.round(ctx.cacheRead / d * 100)}%` : "—"
        },
        () => !!ctx),
      mk("cache.read", "cache", "statusBar.metrics.cacheRead",
        () => ctx ? fmtNum(ctx.cacheRead) : "—",
        () => !!ctx),
      mk("cache.write", "cache", "statusBar.metrics.cacheWrite",
        () => ctx ? fmtNum(ctx.cacheWrite) : "—",
        () => !!ctx),
      mk("cost.total", "cost", "statusBar.metrics.totalCost",
        () => c !== undefined ? fmtCurrency(c) : "—",
        () => c !== undefined),
    ]
  })

  const pinnedMetrics = createMemo(() => {
    const ids = pinnedStore.ids
    return allMetrics().filter((m) => ids.includes(m.id))
  })

  return {
    label: () => sessionInfo()?.title ?? "—",
    connection: () => {
      const key = activeServerKey()
      const health = key ? global.servers.health[key] : undefined
      const conn = routeServer()
      const state: ConnectionState =
        health?.healthy === true ? "online"
        : health?.healthy === false ? "offline"
        : conn?.type === "sidecar" || conn?.type === "http" ? "online"
        : "reconnecting"
      return { state, serverName: serverName(conn), serverKey: key }
    },
    model: sessModel,
    cache: createMemo((): StatusBarCacheInfo | undefined => {
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
  }
}
