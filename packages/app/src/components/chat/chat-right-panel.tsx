import { For, Show, createEffect, createMemo, createResource, createSignal, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { diffLines } from "diff"
import { DragDropProvider, DragDropSensors, DragOverlay, SortableProvider, closestCenter } from "@thisbeyond/solid-dnd"
import type { DragEvent } from "@thisbeyond/solid-dnd"
import { ButtonV2 } from "@aigcfroge/ui/v2/button-v2"
import { Icon } from "@aigcfroge/ui/v2/icon"
import { TabsV2 } from "@aigcfroge/ui/v2/tabs-v2"
import { ResizeHandle } from "@aigcfroge/ui/resize-handle"
import { useLayout } from "@/context/layout"
import { useLanguage } from "@/context/language"
import { useSettings } from "@/context/settings"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { useSessionLayout } from "@/pages/session/session-layout"
import { useFile } from "@/context/file"
import { SessionContextTab, SortableTab, FileVisual } from "@/components/session"
import FileTree from "@/components/file-tree"
import { FileTabContent } from "@/pages/session/file-tabs"
import { SessionContextUsage } from "@/components/session-context-usage"
import { TooltipKeybind } from "@/components/tooltip-keybind"
import { IconButton } from "@aigcfroge/ui/icon-button"
import { useCommand } from "@/context/command"
import { ConstrainDragYAxis, getDraggableId } from "@/utils/solid-dnd"
import { getTabReorderIndex, shouldShowFileTree, createSizing } from "@/pages/session/helpers"
import { createFileTabListSync } from "@/pages/session/file-tab-scroll"
import { clearProposeCandidate, useProposeCandidate, setProposeCandidate, setApplying, setApplied } from "./prompt-asset-store"
import { findProposeResult } from "./prompt-asset-candidate"
import { applyAssetCandidate, assetKindDir, fetchAssetInsertText, listAssets } from "./asset-insert"
import type { AssetKindId } from "@aigcfroge/schema/asset"

type DiffLine = { type: "add" | "del" | "eq"; text: string }

/** 用 diff 库 diffLines(Myers O(ND),无稠密矩阵)做行级 diff。复用已有依赖(E1)。 */
function computeDiff(oldText: string, newText: string): DiffLine[] {
  const out: DiffLine[] = []
  for (const change of diffLines(oldText, newText)) {
    const lines = change.value.split("\n")
    // diffLines 的 value 末尾常含 \n,split 产生空尾,去掉
    if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop()
    const type: DiffLine["type"] = change.added ? "add" : change.removed ? "del" : "eq"
    for (const text of lines) out.push({ type, text })
  }
  return out
}

export function ChatRightPanel() {
  const language = useLanguage()
  const sdk = useSDK()
  const sync = useSync()
  const candidate = useProposeCandidate()
  const [searchQuery, setSearchQuery] = createSignal("")
  const layout = useLayout()
  const file = useFile()
  let sessionLayout: ReturnType<typeof useSessionLayout> | undefined

  try {
    sessionLayout = useSessionLayout()
  } catch {
    // Not inside a session layout
  }
  const command = useCommand()
  // tab 状态走 layout.tabs store(对齐 code:持久化 + 拖拽 move/close 复用)。
  // preview 为固定 tab(不进 all,仅 setActive);context 已由 openSessionContext 写 store;文件 tab 走 file:// 进 all。
  const tabs = createMemo(() => sessionLayout?.tabs())
  const openedFileTabs = createMemo(
    () =>
      tabs()
        ?.all()
        .filter((t) => t.startsWith("file://")) ?? [],
  )
  const contextOpen = createMemo(() => tabs()?.active() === "context" || (tabs()?.all().includes("context") ?? false))
  const activeTab = createMemo(() => {
    const active = tabs()?.active()
    if (active === "preview" || active === "context" || active?.startsWith("file://")) return active
    return openedFileTabs()[0] ?? (contextOpen() ? "context" : "preview")
  })
  createEffect(() => {
    const current = tabs()
    const active = activeTab()
    if (!current || current.active() === active) return
    current.setActive(active)
  })
  // A 区显隐:复用 view().reviewPanel.opened()(对齐 code review toggle;session-header 的 sidebar-right icon 点击 toggle 此状态)。全局单例,chat/code 共享同一 A 区开关。
  const reviewOpen = createMemo(() => (sessionLayout ? sessionLayout.view().reviewPanel.opened() : true))
  // B 区显隐 + 宽度联动:复用 layout.fileTree + settings.visibility.fileTree(对齐 code file-tree;命令面板 fileTree.toggle 切换)。size 复用 createSizing(ResizeHandle 拖拽态,对齐 code props.size)。
  const settings = useSettings()
  const size = createSizing()
  const shown = createMemo(() => settings.visibility.fileTree())
  const fileOpen = createMemo(() => shouldShowFileTree({ visible: shown(), opened: layout.fileTree.opened() }))
  const open = createMemo(() => reviewOpen() || fileOpen())
  const panelWidth = createMemo(() => {
    if (!open()) return "0px"
    if (reviewOpen()) return "auto"
    return `${layout.fileTree.width()}px`
  })
  const treeWidth = createMemo(() => (fileOpen() ? `${layout.fileTree.width()}px` : "0px"))
  // 拖拽排序:复用 code 的 DragDrop + getTabReorderIndex + tabs().move 模式(session-side-panel)
  const [dragStore, setDragStore] = createStore({ activeDraggable: undefined as string | undefined })
  const handleDragStart = (event: unknown) => {
    const id = getDraggableId(event)
    if (!id) return
    setDragStore("activeDraggable", id)
  }
  const handleDragOver = (event: DragEvent) => {
    const { draggable, droppable } = event
    if (!draggable || !droppable) return
    const currentTabs = tabs()?.all() ?? []
    const toIndex = getTabReorderIndex(currentTabs, draggable.id.toString(), droppable.id.toString())
    if (toIndex === undefined) return
    tabs()?.move(draggable.id.toString(), toIndex)
  }
  const handleDragEnd = () => {
    setDragStore("activeDraggable", undefined)
  }
  // 文件 tab:点击 FileTree 文件 -> open file:// tab(对齐 code session-side-panel openTab(file.tab(path)))
  const openFileTab = (path: string) => {
    void tabs()?.open(file.tab(path))
  }
  // FileTree active:当前激活 file:// tab 的 path(高亮 FileTree 对应文件,对齐 code active prop)
  const activeFilePath = createMemo(() => {
    const tab = activeTab()
    return tab.startsWith("file://") ? (file.pathFromTab(tab) ?? undefined) : undefined
  })
  // 搜索过滤:query 变 -> 防抖 150ms -> 递归遍历 .aigcfroge/ 匹配文件名 -> allowed 集合。
  // 用 cancelled flag + onCleanup 取消先前慢 walk，避免并发。
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
    onCleanup(() => { cancelled = true; clearTimeout(timer) })
  })

  // Detect propose results:sync.data.message[sessionID] -> 各 message 的 parts(F-critical 修复)
  createEffect(() => {
    if (!sessionLayout) return
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
  // diff 用 createMemo,仅在 oldContent/candidate.content 变化时重算(E3)
  const diffLinesMemo = createMemo(() => {
    if (candidate.candidate?.status !== "exists") return null
    return computeDiff(oldContent() ?? "", candidate.candidate?.content ?? "")
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
      void file.tree.refresh(assetKindDir(c.kind))
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
      void file.tree.refresh(assetKindDir(c.kind))
    } catch (err) {
      console.error("Apply overwrite failed:", err)
      setApplying(false)
    }
  }

  return (
    // id="review-panel": 复用 session-header icon 的 aria-controls 目标(对齐 code aside id),chat 模式下指向受控右栏容器
    <aside
      id="review-panel"
      class="relative min-w-0 h-full flex shrink-0 overflow-hidden bg-v2-background-bg-base"
      classList={{
        "rounded-[10px] shadow-[var(--v2-elevation-raised)] overflow-hidden": true,
        "flex-1": reviewOpen(),
      }}
      style={{ width: panelWidth() }}
    >
      <Show when={open()}>
        <div class="size-full flex">
          {/* A 区:tab 工作区。显隐复用 reviewOpen(对齐 code review toggle,session-header icon);窄屏由 SessionSidePanel 外层 Show 挡住。 */}
          <div
            class="relative min-w-0 h-full flex-1 overflow-hidden bg-v2-background-bg-base"
            inert={!reviewOpen()}
          >
            <DragDropProvider
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onDragOver={handleDragOver}
              collisionDetector={closestCenter}
            >
              <DragDropSensors />
              <ConstrainDragYAxis />
              <TabsV2 value={activeTab()} onChange={(t) => tabs()?.setActive(t)} class="flex min-h-0 flex-1 flex-col">
                <TabsV2.List
                  class="shrink-0"
                  ref={(el: HTMLDivElement) => {
                    const stop = createFileTabListSync({ el, contextOpen })
                    onCleanup(stop)
                  }}
                >
                  <TabsV2.Trigger value="preview">{language.t("promptAsset.tab.preview")}</TabsV2.Trigger>
                  <Show when={contextOpen()}>
                    <TabsV2.Trigger
                      value="context"
                      closeButton={
                        <TooltipKeybind
                          title={language.t("common.closeTab")}
                          keybind={command.keybind("tab.close")}
                          placement="bottom"
                          gutter={10}
                        >
                          <IconButton
                            icon="close-small"
                            variant="ghost"
                            class="h-5 w-5"
                            onClick={() => sessionLayout?.tabs().close("context")}
                            aria-label={language.t("common.closeTab")}
                          />
                        </TooltipKeybind>
                      }
                      hideCloseButton
                      onMiddleClick={() => sessionLayout?.tabs().close("context")}
                    >
                      <div class="flex items-center gap-2">
                        <SessionContextUsage variant="indicator" />
                        <div>{language.t("session.tab.context")}</div>
                      </div>
                    </TabsV2.Trigger>
                  </Show>
                  {/* 文件 tab:复用 SortableTab(默认 file visual:file.pathFromTab + FileVisual) + SortableProvider 拖拽排序,对齐 code */}
                  <SortableProvider ids={openedFileTabs()}>
                    <For each={openedFileTabs()}>
                      {(p) => <SortableTab tab={p} onTabClose={(t) => tabs()?.close(t)} />}
                    </For>
                  </SortableProvider>
                </TabsV2.List>

                {/* 预览 tab:候选预览 + apply */}
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
                      <div class="mb-1 truncate text-v2-text-text-base text-12-semibold">
                        {candidate.candidate?.name}
                      </div>
                      <div class="mb-2 line-clamp-2 text-v2-text-text-muted text-12-regular">
                        {candidate.candidate?.description}
                      </div>
                      <Show
                        when={candidate.candidate?.status === "valid"}
                        fallback={
                          <Show
                            when={candidate.candidate?.status === "exists"}
                            fallback={
                              <span class="mb-2 block shrink-0 text-v2-state-fg-warning text-12-regular">
                                {language.t("promptAsset.candidate.conflict")}
                              </span>
                            }
                          >
                            {/* exists: 旧↔新 diff + 显式覆盖确认(PRD §9.3) */}
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
                        {/* valid: 直接应用(overwrite=false) */}
                        <span class="mb-2 block shrink-0 text-v2-state-fg-success text-12-regular">
                          {language.t("promptAsset.candidate.valid")}
                        </span>
                        <div class="mt-auto shrink-0">
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

                {/* 上下文 tab:复用 SessionContextTab(ADR-15 A1-3, PRD §9.2),对齐 Code contextOpen 开关 */}
                <Show when={contextOpen()}>
                  <TabsV2.Content value="context" class="flex flex-col h-full overflow-hidden contain-strict">
                    <Show when={activeTab() === "context"}>
                      <div class="relative pt-2 flex-1 min-h-0 overflow-hidden">
                        <SessionContextTab />
                      </div>
                    </Show>
                  </TabsV2.Content>
                </Show>

                {/* 文件 tab:FileTabContent(文件系统查看/编辑,对齐 code session-side-panel)。Step 2 改 ChatFileTabContent 加弹窗确认 */}
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
          </div>

          {/* B 区:资产树。显隐复用 fileOpen(对齐 code file-tree:settings.visibility.fileTree + layout.fileTree.opened,命令面板 toggle);宽度复用 layout.fileTree.width。 */}
          <Show when={shown()}>
            <div
              id="file-tree-panel"
              class="relative min-w-0 h-full shrink-0 overflow-hidden"
              inert={!fileOpen()}
              classList={{
                "transition-[width] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[width] motion-reduce:transition-none":
                  !size.active(),
              }}
              style={{ width: treeWidth() }}
            >
              <div
                class="h-full flex flex-col overflow-hidden group/filetree"
                classList={{ "border-l border-v2-border-border-base": reviewOpen() }}
              >
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
                {/* FileTree:复用 code FileTree 组件,path=".aigcfroge" 显示总文件夹文件树(对齐 code)。搜索框过滤:query -> 递归 walk .aigcfroge/ 匹配文件名 -> allowed 集合 */}
                <div class="min-h-0 flex-1 overflow-y-auto px-3 pt-3">
                  <FileTree
                    path=".aigcfroge"
                    active={activeFilePath()}
                    allowed={searchAllowed()}
                    onFileClick={(node) => openFileTab(node.path)}
                  />
                </div>
              </div>
              <Show when={fileOpen()}>
                <div onPointerDown={() => size.start()}>
                  <ResizeHandle
                    direction="horizontal"
                    edge="start"
                    size={layout.fileTree.width()}
                    min={200}
                    max={480}
                    onResize={(width) => {
                      size.touch()
                      layout.fileTree.resize(width)
                    }}
                  />
                </div>
              </Show>
            </div>
          </Show>
        </div>
      </Show>
    </aside>
  )
}
