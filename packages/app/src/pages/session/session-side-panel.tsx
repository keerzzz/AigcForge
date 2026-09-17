import { For, Match, Show, Switch, createEffect, createMemo, onCleanup, type JSX } from "solid-js"
import { createMediaQuery } from "@solid-primitives/media"
import { TabsV2 } from "@aigcfroge/ui/v2/tabs-v2"
import { IconButton } from "@aigcfroge/ui/icon-button"
import { TooltipKeybind } from "@/components/tooltip-keybind"
import { Mark } from "@aigcfroge/ui/logo"
import type { SnapshotFileDiff, VcsFileDiff } from "@aigcfroge/sdk/v2"
import { useDialog } from "@aigcfroge/ui/context/dialog"

import FileTree from "@/components/file-tree"
import { SessionContextTabPanel, FileVisual } from "@/components/session"
import { useCommand } from "@/context/command"
import { useFile, type SelectedLineRange } from "@/context/file"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { modeContentPanelShown, MODE_CONTENT_PANEL_QUERY } from "@/context/layout-helpers"
import { useMode } from "@/context/mode"
import { useSDK } from "@/context/sdk"
import { CustomDraftProvider } from "@/context/custom-draft"
import { ChatRightPanel } from "@/components/chat/chat-right-panel"
import { AssistantSessionPanel } from "@/pages/session/assistant-session-panel"
import { WorkSessionPanel } from "@/pages/work-artifact-panel"
import { CustomSessionPanel } from "@/components/custom/custom-snapshot-panel"
import { SessionRightPanel } from "@/components/session-right-panel"
import { SessionFileTabStrip } from "@/pages/session/file-tab-strip"
import { FileTabContent } from "@/pages/session/file-tabs"
import { createOpenSessionFileTab, createSessionTabs, getTabReorderIndex, type Sizing } from "@/pages/session/helpers"
import { setSessionHandoff } from "@/pages/session/handoff"
import { useSessionLayout } from "@/pages/session/session-layout"

type RenderDiff = (SnapshotFileDiff & { file: string }) | VcsFileDiff

function renderDiff(value: SnapshotFileDiff | VcsFileDiff): value is RenderDiff {
  return typeof value.file === "string"
}

export function SessionSidePanel(props: {
  canReview: () => boolean
  diffs: () => (SnapshotFileDiff | VcsFileDiff)[]
  diffsReady: () => boolean
  empty: () => string
  hasReview: () => boolean
  reviewCount: () => number
  reviewPanel: () => JSX.Element
  activeDiff?: string
  focusReviewDiff: (path: string) => void
  reviewSnap: boolean
  size: Sizing
}) {
  const layout = useLayout()
  const file = useFile()
  const language = useLanguage()
  const mode = useMode()
  const command = useCommand()
  const dialog = useDialog()
  const sdk = useSDK()
  const { sessionKey, tabs, view, params } = useSessionLayout()

  const isDesktop = createMediaQuery(MODE_CONTENT_PANEL_QUERY)

  // S7: the mode content panel is docked from `md` up exactly as before. Below it the same
  // owner floats OVER the session body — the narrow mode already reaches the review surface
  // through its own Session/Changes tabs, and a docked column would squeeze the session it
  // belongs to (measured before this: the panels were not hidden at 390px, they were never
  // mounted, because the whole block sat behind the `md` gate).
  //
  // The panel is never unmounted for the narrow case: the main column stays mounted underneath
  // (made `inert` by `session.tsx`), so resizing cannot reset the active tab or the scroll.
  const contentPanelShown = () =>
    modeContentPanelShown({ routeType: layout.route().type, mode: mode.currentMode, docked: isDesktop() })
  const contentPanelFloats = () => contentPanelShown() && !isDesktop()
  const contentPanelOpen = () => contentPanelFloats() && mode.contentPanelOpen

  // The two affordances an overlay owes a keyboard user, gated on the same breakpoint as the
  // floating behaviour so desktop interaction is unchanged. `createMediaQuery` rather than a raw
  // `matchMedia().matches`, which is not reactive and would install the listener for the wrong
  // width (the lesson `pages/layout.tsx` records for the secondary sidebar).
  createEffect(() => {
    if (!contentPanelOpen()) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault()
      mode.toggleContentPanel()
    }
    document.addEventListener("keydown", onKeyDown)
    onCleanup(() => document.removeEventListener("keydown", onKeyDown))
  })
  let contentPanelWasOpen = false
  createEffect(() => {
    const open = contentPanelOpen()
    if (contentPanelWasOpen && !open) document.getElementById("session-mode-panel-toggle")?.focus()
    contentPanelWasOpen = open
  })

  const reviewOpen = createMemo(() => isDesktop() && view().reviewPanel.opened())
  const reviewTab = createMemo(() => isDesktop())

  const diffs = createMemo(() => props.diffs().filter(renderDiff))
  const diffFiles = createMemo(() => diffs().map((d) => d.file))
  const kinds = createMemo(() => {
    const merge = (a: "add" | "del" | "mix" | undefined, b: "add" | "del" | "mix") => {
      if (!a) return b
      if (a === b) return a
      return "mix" as const
    }

    const normalize = (p: string) => p.replaceAll("\\\\", "/").replace(/\/+$/, "")

    const out = new Map<string, "add" | "del" | "mix">()
    for (const diff of diffs()) {
      const file = normalize(diff.file)
      const kind = diff.status === "added" ? "add" : diff.status === "deleted" ? "del" : "mix"

      out.set(file, kind)

      const parts = file.split("/")
      for (const [idx] of parts.slice(0, -1).entries()) {
        const dir = parts.slice(0, idx + 1).join("/")
        if (!dir) continue
        out.set(dir, merge(out.get(dir), kind))
      }
    }
    return out
  })

  const empty = (msg: string) => (
    <div class="h-full flex flex-col">
      <div class="h-6 shrink-0" aria-hidden />
      <div class="flex-1 pb-64 flex items-center justify-center text-center">
        <div class="text-12-regular text-text-weak">{msg}</div>
      </div>
    </div>
  )

  const nofiles = createMemo(() => {
    const state = file.tree.state("")
    if (!state?.loaded) return false
    return file.tree.children("").length === 0
  })

  const normalizeTab = (tab: string) => {
    if (!tab.startsWith("file://")) return tab
    return file.tab(tab)
  }

  const openReviewPanel = () => {
    if (!view().reviewPanel.opened()) view().reviewPanel.open()
  }

  const openTab = createOpenSessionFileTab({
    normalizeTab,
    openTab: tabs().open,
    pathFromTab: file.pathFromTab,
    loadFile: file.load,
    openReviewPanel,
    setActive: tabs().setActive,
  })

  const tabState = createSessionTabs({
    tabs,
    pathFromTab: file.pathFromTab,
    normalizeTab,
    review: reviewTab,
    hasReview: props.canReview,
  })
  const contextOpen = tabState.contextOpen
  const openedTabs = tabState.openedTabs
  const activeTab = tabState.activeTab
  const activeFileTab = tabState.activeFileTab

  const fileTreeTab = () => layout.fileTree.tab()

  const setFileTreeTabValue = (value: string) => {
    if (value !== "changes" && value !== "all") return
    layout.fileTree.setTab(value)
  }

  const showAllFiles = () => {
    if (fileTreeTab() !== "changes") return
    layout.fileTree.setTab("all")
  }

  createEffect(() => {
    if (!file.ready()) return

    setSessionHandoff(sessionKey(), {
      files: tabs()
        .all()
        .reduce<Record<string, SelectedLineRange | null>>((acc, tab) => {
          const path = file.pathFromTab(tab)
          if (!path) return acc

          const selected = file.selectedLines(path)
          acc[path] =
            selected && typeof selected === "object" && "start" in selected && "end" in selected
              ? (selected as SelectedLineRange)
              : null

          return acc
        }, {}),
    })
  })

  // One wrapper per mode, kept mounted and toggled by `display` (the pre-existing contract:
  // switching modes must not reset a panel's state). The narrow presentation only changes the
  // wrapper's box, never the owner inside it.
  const modePanel = (id: string, children: JSX.Element) => (
    <div
      data-component="session-mode-panel"
      data-mode={id}
      id={`session-mode-panel-${id}`}
      classList={{
        "flex-1 min-w-0": isDesktop(),
        "absolute inset-0 z-30 overflow-hidden rounded-[10px] bg-v2-background-bg-base": contentPanelFloats(),
      }}
      style={{ display: mode.currentMode === id && (isDesktop() || mode.contentPanelOpen) ? "" : "none" }}
    >
      {children}
    </div>
  )

  return (
    <Show when={!!params.id}>
      <Show when={isDesktop() && mode.currentMode === "coding"}>
        <SessionRightPanel
          size={props.size}
          ariaLabel={language.t("session.panel.reviewAndFiles")}
          snap={props.reviewSnap}
          fileTree={
            <TabsV2
              variant="pill"
              value={fileTreeTab()}
              onChange={setFileTreeTabValue}
              class="h-full"
              data-scope="filetree"
            >
              <TabsV2.List>
                <TabsV2.Trigger value="changes" class="flex-1" classes={{ button: "w-full" }}>
                  {props.reviewCount()}{" "}
                  {language.t(props.reviewCount() === 1 ? "session.review.change.one" : "session.review.change.other")}
                </TabsV2.Trigger>
                <TabsV2.Trigger value="all" class="flex-1" classes={{ button: "w-full" }}>
                  {language.t("session.files.all")}
                </TabsV2.Trigger>
              </TabsV2.List>
              <TabsV2.Content value="changes" class="bg-background-stronger px-3 py-0">
                <Switch>
                  <Match when={props.hasReview() || !props.diffsReady()}>
                    <Show
                      when={props.diffsReady()}
                      fallback={
                        <div class="px-2 py-2 text-12-regular text-text-weak">
                          {language.t("common.loading")}
                          {language.t("common.loading.ellipsis")}
                        </div>
                      }
                    >
                      <FileTree
                        path=""
                        class="pt-3"
                        allowed={diffFiles()}
                        kinds={kinds()}
                        draggable={false}
                        active={props.activeDiff}
                        onFileClick={(node) => props.focusReviewDiff(node.path)}
                      />
                    </Show>
                  </Match>
                </Switch>
              </TabsV2.Content>
              <TabsV2.Content value="all" class="bg-background-stronger px-3 py-0">
                <Switch>
                  <Match when={nofiles()}>{empty(language.t("session.files.empty"))}</Match>
                  <Match when={true}>
                    <FileTree
                      path=""
                      class="pt-3"
                      modified={diffFiles()}
                      kinds={kinds()}
                      onFileClick={(node) => openTab(file.tab(node.path))}
                    />
                  </Match>
                </Switch>
              </TabsV2.Content>
            </TabsV2>
          }
        >
          <TabsV2 value={activeTab()} onChange={openTab}>
            <SessionFileTabStrip
              openedTabs={openedTabs}
              contextOpen={contextOpen}
              onClose={(tab) => tabs().close(tab)}
              onMove={(from, to) => {
                const currentTabs = tabs().all()
                const toIndex = getTabReorderIndex(currentTabs, from, to)
                if (toIndex === undefined) return
                tabs().move(from, toIndex)
              }}
              listWrapperClass="sticky top-0 shrink-0 flex"
              renderLeading={() => (
                <Show when={reviewTab() && props.canReview()}>
                  <TabsV2.Trigger value="review">
                    <div class="flex items-center gap-1.5">
                      <div>{language.t("session.tab.review")}</div>
                      <Show when={props.hasReview()}>
                        <div>{props.reviewCount()}</div>
                      </Show>
                    </div>
                  </TabsV2.Trigger>
                </Show>
              )}
              renderTrailing={() => (
                <div class="bg-background-stronger shrink-0 sticky right-0 z-10 flex items-center justify-center px-2 self-start h-full">
                  <TooltipKeybind
                    title={language.t("command.file.open")}
                    keybind={command.keybind("file.open")}
                    class="flex items-center"
                  >
                    <IconButton
                      icon="plus-small"
                      variant="ghost"
                      iconSize="large"
                      class="!rounded-md"
                      onClick={() => {
                        void import("@/components/dialog-select-file").then((x) => {
                          void dialog.show(() => <x.DialogSelectFile mode="files" onOpenFile={showAllFiles} />)
                        })
                      }}
                      aria-label={language.t("command.file.open")}
                    />
                  </TooltipKeybind>
                </div>
              )}
              renderOverlay={(tab) => {
                const path = file.pathFromTab(tab)
                return <Show when={path}>{(p) => <FileVisual active path={p()} />}</Show>
              }}
            >
              <Show when={reviewTab() && props.canReview()}>
                <TabsV2.Content value="review" class="flex flex-col h-full overflow-hidden contain-strict">
                  <Show when={reviewOpen() && activeTab() === "review"}>{props.reviewPanel()}</Show>
                </TabsV2.Content>
              </Show>

              <TabsV2.Content value="empty" class="flex flex-col h-full overflow-hidden contain-strict">
                <Show when={activeTab() === "empty"}>
                  <div class="relative pt-2 flex-1 min-h-0 overflow-hidden">
                    <div class="h-full px-6 pb-42 -mt-4 flex flex-col items-center justify-center text-center gap-6">
                      <Mark class="w-14 opacity-10" />
                      <div class="text-14-regular text-text-weak max-w-56">
                        {language.t("session.files.selectToOpen")}
                      </div>
                    </div>
                  </div>
                </Show>
              </TabsV2.Content>

              <SessionContextTabPanel contextOpen={contextOpen} active={activeTab} />

              <Show when={activeFileTab()} keyed>
                {(tab) => <FileTabContent tab={tab} />}
              </Show>
            </SessionFileTabStrip>
          </TabsV2>
        </SessionRightPanel>
      </Show>
      {/* Keep mode panels mounted so switching modes does not reset their state. */}
      <Show when={contentPanelShown()}>
        {modePanel("chat", <ChatRightPanel />)}
        {modePanel("work", <WorkSessionPanel />)}
        {modePanel("assistant", <AssistantSessionPanel />)}
        {modePanel(
          "custom",
          <CustomDraftProvider
            location={() => {
              const current = sdk()
              return current ? { scope: current.scope, directory: current.directory } : undefined
            }}
          >
            <CustomSessionPanel sessionID={params.id} />
          </CustomDraftProvider>,
        )}
      </Show>
    </Show>
  )
}
