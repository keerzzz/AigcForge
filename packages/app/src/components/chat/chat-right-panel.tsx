import { For, Show, createEffect, createMemo, createResource, createSignal, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { DragDropProvider, DragDropSensors, DragOverlay, SortableProvider, closestCenter } from "@thisbeyond/solid-dnd"
import type { DragEvent } from "@thisbeyond/solid-dnd"
import { ButtonV2 } from "@aigcfroge/ui/v2/button-v2"
import { Icon } from "@aigcfroge/ui/v2/icon"
import { TabsV2 } from "@aigcfroge/ui/v2/tabs-v2"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { useSessionLayout } from "@/pages/session/session-layout"
import { useFile } from "@/context/file"
import { SessionContextTabPanel, SessionContextTabTrigger, SortableTab, FileVisual } from "@/components/session"
import FileTree from "@/components/file-tree"
import { FileTabContent } from "@/pages/session/file-tabs"
import { ConstrainDragYAxis, getDraggableId } from "@/utils/solid-dnd"
import { diffTextLines } from "@/utils/text-diff"
import { getTabReorderIndex, createSizing } from "@/pages/session/helpers"
import { createFileTabListSync } from "@/pages/session/file-tab-scroll"
import {
  bumpAssetVersion,
  clearProposeCandidate,
  useProposeCandidate,
  setProposeCandidate,
  setApplying,
  setApplied,
} from "./prompt-asset-store"
import { findProposeResult } from "./prompt-asset-candidate"
import { applyAssetCandidate, assetKindDir, fetchAssetInsertText, listAssets } from "./asset-insert"
import { SessionRightPanel } from "@/components/session-right-panel"
import type { AssetKindId } from "@aigcfroge/schema/asset"

export function ChatRightPanel() {
  const language = useLanguage()
  const sdk = useSDK()
  const sync = useSync()
  const candidate = useProposeCandidate()
  const [searchQuery, setSearchQuery] = createSignal("")
  const file = useFile()
  const sessionLayout = useSessionLayout()
  const tabs = sessionLayout.tabs
  const openedFileTabs = createMemo(
    () =>
      tabs()
        .all()
        .filter((t) => t.startsWith("file://")) ?? [],
  )
  const contextOpen = createMemo(() => tabs().active() === "context" || tabs().all().includes("context"))
  const activeTab = createMemo(() => {
    const active = tabs().active()
    if (active === "preview" || active === "context" || active?.startsWith("file://")) return active
    return openedFileTabs()[0] ?? (contextOpen() ? "context" : "preview")
  })
  createEffect(() => {
    const current = tabs()
    const active = activeTab()
    if (!current || current.active() === active) return
    current.setActive(active)
  })
  const size = createSizing()
  const [dragStore, setDragStore] = createStore({ activeDraggable: undefined as string | undefined })
  const handleDragStart = (event: unknown) => {
    const id = getDraggableId(event)
    if (!id) return
    setDragStore("activeDraggable", id)
  }
  const handleDragOver = (event: DragEvent) => {
    const { draggable, droppable } = event
    if (!draggable || !droppable) return
    const currentTabs = tabs().all()
    const toIndex = getTabReorderIndex(currentTabs, draggable.id.toString(), droppable.id.toString())
    if (toIndex === undefined) return
    tabs().move(draggable.id.toString(), toIndex)
  }
  const handleDragEnd = () => {
    setDragStore("activeDraggable", undefined)
  }
  const openFileTab = (path: string) => {
    void tabs().open(file.tab(path))
  }
  const activeFilePath = createMemo(() => {
    const tab = activeTab()
    return tab.startsWith("file://") ? (file.pathFromTab(tab) ?? undefined) : undefined
  })
  // Cancel stale recursive searches when the query or directory context changes.
  const [searchAllowed, setSearchAllowed] = createSignal<readonly string[] | undefined>(undefined)
  createEffect(() => {
    const q = searchQuery().trim().toLowerCase()
    if (!q) {
      setSearchAllowed(undefined)
      return
    }
    let cancelled = false
    const timer = setTimeout(async () => {
      const result: string[] = []
      const walk = async (dir: string) => {
        if (cancelled) return
        await file.tree.list(dir)
        for (const child of file.tree.children(dir) ?? []) {
          if (cancelled) return
          if (child.type === "directory") await walk(child.path)
          else if (child.path.toLowerCase().includes(q)) result.push(child.path)
        }
      }
      try {
        await walk(".aigcfroge")
        if (!cancelled) setSearchAllowed(result)
      } catch {
        if (!cancelled) setSearchAllowed([])
      }
    }, 150)
    onCleanup(() => {
      cancelled = true
      clearTimeout(timer)
    })
  })

  createEffect(() => {
    const sessionID = sessionLayout.params.id
    if (!sessionID) return
    const data = sync().data
    const messages: readonly { id: string }[] = data.message?.[sessionID] ?? []
    const info = findProposeResult(messages, data.part)
    if (info) {
      setProposeCandidate(sessionID, info)
      return
    }
    if (candidate.sessionID === sessionID || candidate.sessionID === null) return
    clearProposeCandidate()
  })

  const [, { refetch }] = createResource(
    () => ({ client: sdk().client, kind: candidate.candidate?.kind ?? ("prompt" as const) }),
    ({ client, kind }) => listAssets(client, kind),
  )
  // Existing asset content (overwrite diff when candidate.status === "exists")
  const [oldContent] = createResource(
    () => {
      const c = candidate.candidate
      if (!c?.exists) return null
      return { path: c.relativePath, kind: c.kind }
    },
    async (source: { path: string; kind: AssetKindId }) => fetchAssetInsertText(sdk().client, source.kind, source.path),
  )
  const diffLinesMemo = createMemo(() => {
    if (candidate.candidate?.status !== "exists") return null
    return diffTextLines(oldContent() ?? "", candidate.candidate?.content ?? "")
  })

  const handleApply = async () => {
    const c = candidate.candidate
    if (!c || !candidate.sessionID || candidate.applying) return
    setApplying(true)
    try {
      await applyAssetCandidate(sdk().client, {
        sessionID: candidate.sessionID,
        candidate: c,
        overwrite: false,
      })
      setApplied()
      void refetch()
      const kindDir = assetKindDir(c.kind)
      void file.tree.refresh(kindDir)
      file.tree.expand(kindDir)
      void file.tree.refresh(".aigcfroge")
      bumpAssetVersion()
    } catch (err) {
      console.error("Apply failed:", err)
      setApplying(false)
    }
  }

  const handleApplyOverwrite = async () => {
    const c = candidate.candidate
    if (!c || !candidate.sessionID || candidate.applying) return
    setApplying(true)
    try {
      await applyAssetCandidate(sdk().client, {
        sessionID: candidate.sessionID,
        candidate: c,
        overwrite: true,
      })
      setApplied()
      void refetch()
      const kindDir = assetKindDir(c.kind)
      void file.tree.refresh(kindDir)
      file.tree.expand(kindDir)
      void file.tree.refresh(".aigcfroge")
      bumpAssetVersion()
    } catch (err) {
      console.error("Apply overwrite failed:", err)
      setApplying(false)
    }
  }

  return (
    <SessionRightPanel
      size={size}
      fileTree={
        <>
          <div class="flex h-8 items-center gap-2 border-b border-v2-border-border-base px-2">
            <Icon name="magnifying-glass" size="small" class="shrink-0 text-v2-icon-icon-muted" />
            <input
              type="text"
              placeholder={language.t("promptAsset.list.searchPlaceholder")}
              aria-label={language.t("promptAsset.list.searchPlaceholder")}
              class="min-w-0 flex-1 bg-transparent text-v2-text-text-base text-12-regular outline-none placeholder:text-v2-text-text-faint"
              value={searchQuery()}
              onInput={(e) => setSearchQuery(e.currentTarget.value)}
            />
          </div>
          <div class="min-h-0 flex-1 overflow-y-auto px-3 pt-3">
            <FileTree
              path=".aigcfroge"
              active={activeFilePath()}
              allowed={searchAllowed()}
              onFileClick={(node) => openFileTab(node.path)}
            />
          </div>
        </>
      }
    >
      <DragDropProvider
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragOver={handleDragOver}
        collisionDetector={closestCenter}
      >
        <DragDropSensors />
        <ConstrainDragYAxis />
        <TabsV2 value={activeTab()} onChange={(tab) => tabs().setActive(tab)} class="flex min-h-0 flex-1 flex-col">
          <TabsV2.List
            class="shrink-0"
            ref={(el: HTMLDivElement) => {
              const stop = createFileTabListSync({ el, contextOpen })
              onCleanup(stop)
            }}
          >
            <TabsV2.Trigger value="preview">{language.t("promptAsset.tab.preview")}</TabsV2.Trigger>
            <SessionContextTabTrigger contextOpen={contextOpen} onClose={() => sessionLayout.tabs().close("context")} />
            <SortableProvider ids={openedFileTabs()}>
              <For each={openedFileTabs()}>
                {(tab) => <SortableTab tab={tab} onTabClose={(item) => tabs().close(item)} />}
              </For>
            </SortableProvider>
          </TabsV2.List>

          <TabsV2.Content value="preview" class="min-h-0 flex-1 overflow-y-auto">
            <Show
              when={candidate.candidate && !candidate.applied}
              fallback={
                <Show
                  when={candidate.applied}
                  fallback={
                    <div class="p-4 text-center text-v2-text-text-muted text-12-regular">
                      {language.t("promptAsset.candidate.noCandidate")}
                    </div>
                  }
                >
                  <div class="p-3">
                    <span class="text-v2-state-fg-success text-12-semibold">
                      {language.t("promptAsset.candidate.applied")}
                    </span>
                  </div>
                </Show>
              }
            >
              <div class="flex h-full flex-col p-3">
                <div class="mb-1 truncate text-v2-text-text-base text-12-semibold">{candidate.candidate?.name}</div>
                <div class="mb-2 line-clamp-2 text-v2-text-text-muted text-12-regular">
                  {candidate.candidate?.description}
                </div>
                <Show
                  when={candidate.candidate?.status === "valid"}
                  fallback={
                    <Show
                      when={candidate.candidate?.status === "exists"}
                      fallback={
                        <>
                          <span class="mb-2 block shrink-0 text-v2-state-fg-warning text-12-regular">
                            {language.t("promptAsset.candidate.conflict")}
                          </span>
                          <div class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-v2-border-border-base">
                            <div class="shrink-0 border-b border-v2-border-border-base px-2 py-1.5 text-v2-text-text-muted text-11-semibold">
                              {language.t("promptAsset.tab.preview")}
                            </div>
                            <pre class="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-2 font-mono text-v2-text-text-base text-12-regular">
                              {candidate.candidate?.content}
                            </pre>
                          </div>
                        </>
                      }
                    >
                      {/* Existing assets require an explicit overwrite after reviewing the diff. */}
                      <span class="mb-2 block shrink-0 text-v2-state-fg-warning text-12-regular">
                        {language.t("promptAsset.candidate.exists")}
                      </span>
                      <div class="min-h-0 flex-1 overflow-y-auto rounded-md border border-v2-border-border-base">
                        <Show
                          when={!oldContent.loading && oldContent() !== undefined}
                          fallback={
                            <div class="p-2 text-v2-text-text-muted text-12-regular">
                              {language.t("promptAsset.panel.loading")}
                            </div>
                          }
                        >
                          <For each={diffLinesMemo() ?? []}>
                            {(line) => (
                              <div
                                class="flex px-1 font-mono text-12-regular"
                                classList={{
                                  "text-v2-state-fg-success": line.type === "add",
                                  "text-v2-state-fg-warning": line.type === "del",
                                  "text-v2-text-text-muted": line.type === "eq",
                                }}
                              >
                                <span class="shrink-0 select-none">
                                  {line.type === "add" ? "+" : line.type === "del" ? "-" : " "}
                                </span>
                                <span class="whitespace-pre-wrap break-all">{line.text}</span>
                              </div>
                            )}
                          </For>
                        </Show>
                      </div>
                      <div class="mt-2 shrink-0">
                        <ButtonV2
                          variant="contrast"
                          size="small"
                          class="w-full"
                          onClick={handleApplyOverwrite}
                          disabled={candidate.applying}
                        >
                          {candidate.applying
                            ? language.t("promptAsset.candidate.applying")
                            : language.t("promptAsset.candidate.apply")}
                        </ButtonV2>
                      </div>
                    </Show>
                  }
                >
                  <span class="mb-2 block shrink-0 text-v2-state-fg-success text-12-regular">
                    {language.t("promptAsset.candidate.valid")}
                  </span>
                  <div class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-v2-border-border-base">
                    <div class="shrink-0 border-b border-v2-border-border-base px-2 py-1.5 text-v2-text-text-muted text-11-semibold">
                      {language.t("promptAsset.tab.preview")}
                    </div>
                    <pre class="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-2 font-mono text-v2-text-text-base text-12-regular">
                      {candidate.candidate?.content}
                    </pre>
                  </div>
                  <div class="mt-2 shrink-0">
                    <ButtonV2
                      variant="contrast"
                      size="small"
                      class="w-full"
                      onClick={handleApply}
                      disabled={candidate.applying}
                    >
                      {candidate.applying
                        ? language.t("promptAsset.candidate.applying")
                        : language.t("promptAsset.candidate.apply")}
                    </ButtonV2>
                  </div>
                </Show>
              </div>
            </Show>
          </TabsV2.Content>

          <SessionContextTabPanel contextOpen={contextOpen} active={activeTab} />

          <Show when={activeTab().startsWith("file://") ? activeTab() : undefined} keyed>
            {(tab) => <FileTabContent tab={tab} />}
          </Show>
        </TabsV2>
        <DragOverlay>
          <Show when={dragStore.activeDraggable} keyed>
            {(tab) => (
              <div data-component="tabs-drag-preview">
                <FileVisual active path={file.pathFromTab(tab) ?? ""} />
              </div>
            )}
          </Show>
        </DragOverlay>
      </DragDropProvider>
    </SessionRightPanel>
  )
}
