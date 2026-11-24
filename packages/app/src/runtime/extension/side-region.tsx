import { For, Show, createMemo, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { createMediaQuery } from "@solid-primitives/media"
import { createEventListener } from "@solid-primitives/event-listener"
import { DragDropProvider, PointerSensor } from "@dnd-kit/solid"
import { isSortable } from "@dnd-kit/solid/sortable"
import { Accessibility, AutoScroller, Feedback, PointerActivationConstraints } from "@dnd-kit/dom"
import { RestrictToHorizontalAxis } from "@dnd-kit/abstract/modifiers"
import { RestrictToElement } from "@dnd-kit/dom/modifiers"
import { Tabs } from "@omnixa/ui/tabs"
import { Icon } from "@omnixa/ui/icon"
import { IconButton } from "@omnixa/ui/icon-button"
import { ResizeHandle } from "@omnixa/ui/resize-handle"
import { Mark } from "@omnixa/ui/logo"
import type { MountedSession, SessionScreen, PanelSidebar } from "@omnixa/gui-extensions/sdk"
import { useLanguage } from "@/runtime/i18n/language"
import { useLayout } from "@/shell/state/layout"
import { useSessionLayout } from "@/session/session-layout"
import type { Sizing } from "@/session/helpers"
import { PanelTrigger } from "./panel-trigger"
import { RegionContent, type Region } from "./panels"
import { ExtensionSlot } from "./render"
import { createTabStripScroll } from "./tab-strip-scroll"
import { SessionHeaderSpacer } from "@/session/header/session-header"

const FILE_TREE_WIDTH_MIN = 240

/** The side region: the tab strip with contributed actions, the selected panel, and the inner sidebar. */
export function SideRegion(props: {
  view: MountedSession
  screen: SessionScreen
  region: Region
  sidebar: PanelSidebar
  fileTree: boolean
  present?: boolean
  size: Sizing
  stacked?: boolean
}) {
  const layout = useLayout()
  const language = useLanguage()
  const { tabs, view, params } = useSessionLayout()

  const isDesktop = createMediaQuery("(min-width: 768px)")
  const tabsOpen = createMemo(() => isDesktop() && view().side.opened())
  const tabsVisible = createMemo(() => tabsOpen() || !!props.present)
  const fileOpen = createMemo(() => isDesktop() && props.fileTree)
  const open = createMemo(() => tabsOpen() || fileOpen())
  const visible = createMemo(() => tabsVisible() || fileOpen())
  const fileTreeWidth = createMemo(() => Math.max(FILE_TREE_WIDTH_MIN, layout.fileTree.width()))

  const panelWidth = createMemo(() => {
    if (!visible()) return "0px"

    if (tabsVisible()) return "auto"

    return `${fileTreeWidth()}px`
  })

  const treeWidth = createMemo(() => (fileOpen() ? `${fileTreeWidth()}px` : "0px"))

  let tabList: HTMLDivElement | undefined
  let selectionEvent: Event | undefined

  const [scroll, setScroll] = createStore({ overflow: false, previous: false, next: false })

  const scrollTabs = (direction: -1 | 1) => {
    if (!tabList) return

    tabList.scrollBy({
      left: (getComputedStyle(tabList).direction === "rtl" ? -direction : direction) * tabList.clientWidth * 0.8,
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    })
  }

  return (
    <Show when={isDesktop() && !!params.id}>
      <aside
        id="review-panel"
        aria-label={language.t("session.panel.reviewAndFiles")}
        aria-hidden={!open()}
        inert={!open()}
        class="relative min-w-0 flex overflow-hidden bg-v2-background-bg-base rounded-[10px] shadow-[var(--v2-elevation-raised)]"
        classList={{
          "h-full shrink-0": !props.stacked,
          "h-full min-h-0": props.stacked,
          "pointer-events-none": !open(),
          "side-width-transition": !props.size.active(),
          "flex-1": tabsVisible(),
        }}
        style={{ width: panelWidth() }}
      >
        <Show when={visible()}>
          <div
            data-slot="session-review-content"
            class="h-full flex shrink-0"
            style={{ width: "var(--session-side-content-width, 100%)" }}
          >
            <Show when={tabsVisible()}>
              <div
                id="session-side-panel-tabs"
                aria-hidden={!tabsOpen()}
                inert={!tabsOpen()}
                class="relative min-w-0 h-full flex-1 overflow-hidden bg-v2-background-bg-base"
              >
                <div class="size-full min-w-0 h-full bg-v2-background-bg-base">
                  <DragDropProvider
                    sensors={[
                      PointerSensor.configure({
                        activationConstraints: [new PointerActivationConstraints.Distance({ value: 4 })],
                        preventActivation: (event) =>
                          event.target instanceof Element &&
                          (!!event.target.closest('[data-slot="tabs-trigger-close-button"]') ||
                            !!event.target.closest(".session-review-v2-tab-scroll") ||
                            !!event.target.closest(".session-review-v2-open-in-app-slot")),
                      }),
                    ]}
                    modifiers={[
                      RestrictToHorizontalAxis,
                      RestrictToElement.configure({ element: () => tabList ?? null }),
                    ]}
                    plugins={(defaults) => [
                      ...defaults.filter((plugin) => plugin !== Accessibility),
                      AutoScroller.configure({ acceleration: 8, threshold: { x: 0.05, y: 0 } }),
                      Feedback.configure({ dropAnimation: null }),
                    ]}
                    onDragEnd={(event) => {
                      const source = event.operation.source

                      if (event.canceled || !isSortable(source) || source.initialIndex === source.index) return
                      tabs().move(source.id.toString(), source.index)
                    }}
                  >
                    <Tabs
                      value={props.region.active() ?? "empty"}
                      onChange={(value) => {
                        // Kobalte selects the first tab while triggers register, including while the
                        // action's click is still dispatching. Persist input events on a tab only; the
                        // region owns fallback selection.
                        if (
                          selectionEvent &&
                          selectionEvent.eventPhase !== Event.NONE &&
                          selectionEvent.target instanceof Element &&
                          selectionEvent.target.closest('[role="tab"]')
                        )
                          props.region.select(value)
                      }}
                    >
                      {/* Tabs and actions share the review toggle's row: the session header's 48px, or the 51px
                          above a side dock's divider. */}
                      <div
                        class="session-review-v2-tabs-bar sticky top-0 shrink-0 flex items-center"
                        style={{ "--tabs-bar-height": props.stacked ? "51px" : "48px" }}
                      >
                        <div class="session-review-v2-tab-strip">
                          <Show when={scroll.overflow}>
                            <IconButton
                              class="session-review-v2-tab-scroll"
                              variant="ghost-muted"
                              size="large"
                              icon={<Icon name="chevron-left" />}
                              aria-label={language.t("session.tabs.scrollPrevious")}
                              disabled={!scroll.previous}
                              onClick={() => scrollTabs(-1)}
                            />
                          </Show>
                          <Tabs.List
                            ref={(el: HTMLDivElement) => {
                              tabList = el
                              createEventListener(
                                el,
                                ["pointerdown", "click", "keydown"],
                                (event) => (selectionEvent = event),
                                { capture: true },
                              )
                              onCleanup(
                                createTabStripScroll({
                                  el,
                                  lead: props.region.lead,
                                  onOverflowChange: setScroll,
                                }),
                              )
                            }}
                          >
                            <For each={props.region.keys()}>
                              {(key) => (
                                <Show when={props.region.entry(key)}>
                                  {(entry) => (
                                    <PanelTrigger
                                      value={key}
                                      extension={entry().extension}
                                      tab={entry().tab}
                                      icon={entry().provider.mobile?.icon}
                                      session={props.view}
                                      index={tabs().all().indexOf(key)}
                                      active={props.region.active() === key}
                                      preview={tabs().preview() === key}
                                      onClose={props.region.close}
                                      onPromote={(value) => void tabs().open(value)}
                                    />
                                  )}
                                </Show>
                              )}
                            </For>
                          </Tabs.List>
                          <Show when={scroll.overflow}>
                            <IconButton
                              class="session-review-v2-tab-scroll"
                              variant="ghost-muted"
                              size="large"
                              icon={<Icon name="chevron-right" />}
                              aria-label={language.t("session.tabs.scrollNext")}
                              disabled={!scroll.next}
                              onClick={() => scrollTabs(1)}
                            />
                          </Show>
                        </div>
                        <div
                          data-slot="session-side-panel-actions"
                          class="session-review-v2-open-in-app-slot h-[var(--tabs-bar-height)] shrink-0 flex items-center gap-2 pe-3"
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => event.stopPropagation()}
                        >
                          <ExtensionSlot
                            at="session.panel.end"
                            input={{
                              get session() {
                                return props.view
                              },
                              get screen() {
                                return props.screen
                              },
                            }}
                          />
                          <SessionHeaderSpacer visible={tabsVisible() && !fileOpen()} />
                        </div>
                      </div>

                      <Show when={props.region.active() === undefined}>
                        <Tabs.Content value="empty" class="flex flex-col h-full overflow-hidden contain-strict">
                          <div class="relative pt-2 flex-1 min-h-0 overflow-hidden">
                            <div class="h-full px-6 pb-42 -mt-4 flex flex-col items-center justify-center text-center gap-6">
                              <Mark class="w-14 opacity-10" />
                              <div class="text-14-regular text-text-weak max-w-56">
                                {language.t("session.files.selectToOpen")}
                              </div>
                            </div>
                          </div>
                        </Tabs.Content>
                      </Show>
                      <RegionContent
                        region={props.region}
                        view={props.view}
                        screen={props.screen}
                        frame={{
                          shown: tabsOpen,
                          present: tabsVisible,
                          placement: () => "side",
                          reserve: () => false,
                          animate: () => !props.size.active(),
                          sidebar: props.sidebar,
                        }}
                      />
                    </Tabs>
                  </DragDropProvider>
                </div>
              </div>
            </Show>

            <Show when={fileOpen()}>
              <div
                id="file-tree-panel"
                class="relative min-w-0 h-full shrink-0 overflow-hidden"
                classList={{
                  "transition-[width] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[width] motion-reduce:transition-none":
                    !props.size.active(),
                }}
                style={{ width: treeWidth() }}
              >
                <div
                  class="h-full flex flex-col overflow-hidden group/filetree"
                  classList={{ "border-s border-border-weaker-base": tabsOpen() }}
                >
                  <ExtensionSlot
                    at="session.panel.sidebar"
                    input={{
                      get session() {
                        return props.view
                      },
                      get screen() {
                        return props.screen
                      },
                    }}
                  />
                </div>
                <div onPointerDown={() => props.size.start()}>
                  <ResizeHandle
                    direction="horizontal"
                    edge="start"
                    size={fileTreeWidth()}
                    min={FILE_TREE_WIDTH_MIN}
                    max={480}
                    onResize={(width) => {
                      props.size.touch()
                      layout.fileTree.resize(width)
                    }}
                  />
                </div>
              </div>
            </Show>
          </div>
        </Show>
      </aside>
    </Show>
  )
}
