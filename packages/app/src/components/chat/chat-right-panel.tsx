import { For, Show, createEffect, createMemo, createResource, createSignal } from "solid-js"
import { ButtonV2 } from "@aigcfroge/ui/v2/button-v2"
import { Icon } from "@aigcfroge/ui/v2/icon"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { useSessionLayout } from "@/pages/session/session-layout"
import { useNavigate } from "@solidjs/router"
import { useProposeCandidate, setProposeCandidate, clearProposeCandidate, setApplying, setApplied } from "./prompt-asset-store"
import { normalizeProposeCandidate } from "./prompt-asset-candidate"
import type { Part, PromptAssetSummary } from "@aigcfroge/sdk/v2/client"

/** Find the first propose_prompt_asset completed tool part in session parts. */
function findProposeResult(parts: Part[]) {
  for (const part of parts) {
    if (part.type !== "tool") continue
    if (part.tool !== "propose_prompt_asset") continue
    if (part.state.status !== "completed") continue
    return normalizeProposeCandidate({
      tool: part.tool,
      state: part.state as unknown as { input: Record<string, unknown>; output?: string; structured?: Record<string, unknown> },
    })
  }
  return null
}

export function ChatRightPanel() {
  const language = useLanguage()
  const sdk = useSDK()
  const sync = useSync()
  const navigate = useNavigate()
  const candidate = useProposeCandidate()
  const [searchQuery, setSearchQuery] = createSignal("")
  let sessionLayout: ReturnType<typeof useSessionLayout> | undefined

  try {
    sessionLayout = useSessionLayout()
  } catch {
    // Not inside a session layout
  }

  // Detect propose results from session sync data
  createEffect(() => {
    if (!sessionLayout) return
    const sessionID = sessionLayout.params.id
    if (!sessionID) return
    const syncData = sync().data as { part?: Record<string, Part[]> }
    const parts: Part[] | undefined = syncData.part?.[sessionID]
    if (!parts) return
    const info = findProposeResult(parts)
    if (info && info.status !== "conflict") {
      setProposeCandidate(sessionID, info)
    }
  })

  const [result, { refetch }] = createResource(
    () => sdk().client,
    (client) => client.promptAsset.list(),
  )
  const assets = createMemo(() => result()?.data ?? [])

  const filteredAssets = createMemo(() => {
    const all = assets()
    if (!all) return []
    const q = searchQuery().toLowerCase()
    if (!q) return all
    return all.filter((a: PromptAssetSummary) => a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q))
  })

  const handleApply = async () => {
    const c = candidate.candidate
    if (!c || !candidate.sessionID) return
    setApplying(true)
    try {
      await sdk().client.promptAsset.apply({
        sessionID: candidate.sessionID,
        candidate: { name: c.name, description: c.description, template: c.template, relativePath: c.relativePath },
        baseRevision: c.revision ?? undefined,
        overwrite: c.exists,
      })
      setApplied()
      refetch()
    } catch (err) {
      console.error("Apply failed:", err)
      setApplying(false)
    }
  }

  return (
    <aside class="flex w-64 shrink-0 flex-col border-l border-v2-border-border-base bg-v2-background-bg-base">
      <div class="flex items-center justify-between border-b border-v2-border-border-base px-3 py-2">
        <span class="text-v2-text-text-base text-13-semibold">{language.t("promptAsset.panel.title")}</span>
      </div>

      <Show when={candidate.candidate && !candidate.applied}>
        <div class="border-b border-v2-border-border-base px-3 py-2">
          <div class="mb-1 truncate text-v2-text-text-base text-12-semibold">{candidate.candidate?.name}</div>
          <div class="mb-2 line-clamp-2 text-v2-text-text-muted text-12-regular">{candidate.candidate?.description}</div>
          <Show
            when={candidate.candidate?.status === "valid"}
            fallback={
              <span class="mb-2 block text-v2-state-bg-warning text-12-regular">
                {candidate.candidate?.status === "conflict"
                  ? language.t("promptAsset.candidate.conflict")
                  : language.t("promptAsset.candidate.exists")}
              </span>
            }
          >
            <span class="mb-2 block text-v2-state-bg-success text-12-regular">
              {language.t("promptAsset.candidate.valid")}
            </span>
          </Show>
          <ButtonV2
            variant="contrast"
            size="small"
            class="w-full"
            onClick={handleApply}
            disabled={candidate.candidate?.status !== "valid" || candidate.applying}
          >
            {candidate.applying ? language.t("promptAsset.candidate.applying") : language.t("promptAsset.candidate.apply")}
          </ButtonV2>
        </div>
      </Show>

      <Show when={candidate.applied}>
        <div class="border-b border-v2-border-border-base px-3 py-2">
          <span class="text-v2-state-bg-success text-12-semibold">{language.t("promptAsset.candidate.applied")}</span>
        </div>
      </Show>

      <div class="flex min-h-0 flex-1 flex-col">
        <div class="flex items-center gap-2 border-b border-v2-border-border-base px-3 py-1.5">
          <input
            type="text"
            placeholder={language.t("promptAsset.list.searchPlaceholder")}
            class="min-w-0 flex-1 bg-transparent text-v2-text-text-base text-12-regular outline-none placeholder:text-v2-text-text-faint"
            value={searchQuery()}
            onInput={(e) => setSearchQuery(e.currentTarget.value)}
          />
          <ButtonV2 variant="ghost" size="small" onClick={() => navigate("/mode/chat")} aria-label={language.t("promptAsset.panel.newPrompt")}>
            <Icon name="plus" size="small" />
          </ButtonV2>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto px-2 py-1">
          <Show
            when={!result.loading}
            fallback={
              <div class="py-4 text-center text-v2-text-text-muted text-12-regular">
                {language.t("promptAsset.panel.loading")}
              </div>
            }
          >
            <Show
              when={filteredAssets().length > 0}
              fallback={
                <div class="py-4 text-center text-v2-text-text-muted text-12-regular">
                  {language.t("promptAsset.panel.noAssets")}
                </div>
              }
            >
              <For each={filteredAssets()}>
                {(asset: PromptAssetSummary) => (
                  <div class="rounded-md px-2 py-1.5">
                    <div class="truncate text-v2-text-text-base text-12-semibold">{asset.name}</div>
                    <div class="line-clamp-2 text-v2-text-text-muted text-12-regular">{asset.description}</div>
                  </div>
                )}
              </For>
            </Show>
          </Show>
        </div>
      </div>
    </aside>
  )
}
