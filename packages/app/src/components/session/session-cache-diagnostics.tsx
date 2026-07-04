import { createQuery } from "@tanstack/solid-query"
import { Show, For, createMemo } from "solid-js"
import { AccordionV2 } from "@aigcfroge/ui/v2/accordion-v2"
import { StickyAccordionHeader } from "@aigcfroge/ui/sticky-accordion-header"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"

const CONFIDENCE_COLOR: Record<string, string> = {
  high: "var(--syntax-success)",
  estimated: "var(--syntax-warning)",
  unavailable: "var(--syntax-comment)",
}

const CONFIDENCE_LABEL: Record<string, string> = {
  high: "cacheDiagnostics.confidence.high",
  estimated: "cacheDiagnostics.confidence.estimated",
  unavailable: "cacheDiagnostics.confidence.unavailable",
}

const n = (v: number | string): number => (typeof v === "string" ? Number(v) : v)

function MiniBar(props: { value: number | string; max?: number; color?: string }) {
  const pct = createMemo(() => {
    const val = n(props.value)
    const max = props.max ?? 100
    return max > 0 ? Math.min((val / max) * 100, 100) : 0
  })

  return (
    <div class="h-2 w-full rounded-full bg-surface-base overflow-hidden">
      <div
        class="h-full rounded-full transition-all"
        style={{
          width: `${pct()}%`,
          "background-color": props.color ?? "var(--accent-base)",
        }}
      />
    </div>
  )
}

export function SessionCacheDiagnostics(props: { sessionID: string }) {
  const language = useLanguage()
  const sdk = useSDK()

  const query = createQuery(() => ({
    queryKey: ["cache-diagnostics", props.sessionID] as const,
    queryFn: async () => {
      const result = await sdk().client.session.cacheDiagnostics({ sessionID: props.sessionID })
      return result.data
    },
    refetchInterval: 30_000,
  }))

  return (
    <div class="flex flex-col gap-2">
      <AccordionV2 multiple>
        <AccordionV2.Item value="cache-diagnostics">
          <StickyAccordionHeader>
            <AccordionV2.Trigger>
              <div class="flex items-center gap-2 w-full min-w-0">
                <span class="text-12-regular text-text-weak">
                  {language.t("cacheDiagnostics.title")}
                </span>
              </div>
            </AccordionV2.Trigger>
          </StickyAccordionHeader>
          <AccordionV2.Content>
            <Show
              when={query.data}
              fallback={
                <div class="flex items-center justify-center py-4 text-12-regular text-text-weaker">
                  {query.isPending
                    ? language.t("cacheDiagnostics.loading")
                    : language.t("cacheDiagnostics.unavailable")}
                </div>
              }
            >
              {(data) => (
              <div class="flex flex-col gap-4 px-3 pb-3">
                {/* Hit rate + Token summary grid */}
                <div class="grid grid-cols-1 @[32rem]:grid-cols-2 gap-4">
                  {/* Session hit rate */}
                  <div class="flex flex-col gap-1.5">
                    <div class="flex items-center justify-between">
                      <span class="text-12-regular text-text-strong">
                        {language.t("cacheDiagnostics.sessionHitRate")}
                      </span>
                      <div class="flex items-center gap-1.5">
                        <span class="text-12-medium text-text-strong">
                          {Math.round(n(data().sessionHitRate))}%
                        </span>
                        <span
                          class="inline-block size-1.5 rounded-full"
                          style={{
                            "background-color": CONFIDENCE_COLOR[data().confidence] ?? "var(--syntax-comment)",
                          }}
                        />
                      </div>
                    </div>
                    <MiniBar
                      value={data().sessionHitRate}
                      color={CONFIDENCE_COLOR[data().confidence]}
                    />
                    <div class="text-11-regular text-text-weaker">
                      {language.t(CONFIDENCE_LABEL[data().confidence] as Parameters<typeof language.t>[0])}
                    </div>
                  </div>

                  {/* Token summary */}
                  <div class="flex flex-col gap-1.5">
                    <div class="text-12-regular text-text-weak">
                      {language.t("cacheDiagnostics.tokenSummary")}
                    </div>
                    <div class="grid grid-cols-3 gap-3 text-11-regular">
                      <div class="flex flex-col px-2 py-1.5 rounded-sm bg-surface-base">
                        <span class="text-text-weaker">{language.t("cacheDiagnostics.cacheRead")}</span>
                        <span class="text-12-medium text-text-strong">{formatTokens(data().sessionCacheRead)}</span>
                      </div>
                      <div class="flex flex-col px-2 py-1.5 rounded-sm bg-surface-base">
                        <span class="text-text-weaker">{language.t("cacheDiagnostics.cacheWrite")}</span>
                        <span class="text-12-medium text-text-strong">{formatTokens(data().sessionCacheWrite)}</span>
                      </div>
                      <div class="flex flex-col px-2 py-1.5 rounded-sm bg-surface-base">
                        <span class="text-text-weaker">{language.t("cacheDiagnostics.totalTokens")}</span>
                        <span class="text-12-medium text-text-strong">{formatTokens(data().sessionTotalInput)}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Per-step hit rate */}
                <Show when={data().perStep.length > 0}>
                  <div class="flex flex-col gap-1.5">
                    <div class="text-12-regular text-text-weak">
                      {language.t("cacheDiagnostics.perStepTitle")}
                    </div>
                    <div class="flex items-end gap-1.5 h-10 @[40rem]:h-12">
                      <For each={data().perStep}>
                        {(step, idx) => (
                          <div class="flex flex-col items-center gap-0.5 flex-1 min-w-0 max-w-12">
                            <div class="w-full h-7 @[40rem]:h-9 rounded-sm bg-surface-base overflow-hidden">
                              <div
                                class="h-full rounded-sm"
                                style={{
                                  width: `${Math.max(n(step.hitRate), 1)}%`,
                                  "background-color": n(step.hitRate) > 50
                                    ? "var(--syntax-success)"
                                    : n(step.hitRate) > 20
                                      ? "var(--syntax-warning)"
                                      : "var(--syntax-danger)",
                                }}
                              />
                            </div>
                            <span class="text-10-regular text-text-weaker truncate max-w-full">
                              R{idx() + 1}
                            </span>
                          </div>
                        )}
                      </For>
                    </div>
                  </div>
                </Show>
              </div>
            )}
          </Show>
        </AccordionV2.Content>
      </AccordionV2.Item>
      </AccordionV2>
    </div>
  )
}

function formatTokens(value: number | string): string {
  const num = n(value)
  if (!Number.isFinite(num)) return "—"
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`
  if (num >= 1_000) return `${(num / 1_000).toFixed(0)}K`
  return String(num)
}
