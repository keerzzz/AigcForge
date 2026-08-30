import { For, Show, createEffect, onCleanup, type Accessor, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { DragDropProvider, DragDropSensors, DragOverlay, SortableProvider, closestCenter } from "@thisbeyond/solid-dnd"
import type { DragEvent } from "@thisbeyond/solid-dnd"
import { TabsV2 } from "@aigcfroge/ui/v2/tabs-v2"
import { SessionContextTabTrigger, SortableTab } from "@/components/session"
import { ConstrainDragYAxis, getDraggableId } from "@/utils/solid-dnd"
import { createFileTabListSync } from "@/pages/session/file-tab-scroll"

/**
 * Shared drag-and-drop file-tab surface for Coding and Chat right panels.
 *
 * Owns only the DragDrop surface: DragDropProvider/DragDropSensors, drag state,
 * SortableProvider + SortableTab list, the tab-list scroll sync, and the DragOverlay.
 * Leading/trailing tab content, active-tab fallback, review content, and file-tree
 * business stay with the consuming mode panel, which keeps its own TabsV2 root
 * (value/onChange) so switching modes never remounts tab state.
 */
export type SessionFileTabStripProps = {
  openedTabs: Accessor<readonly string[]>
  contextOpen: Accessor<boolean>
  onClose: (tab: string) => void
  onMove: (from: string, to: string) => void
  renderLeading: () => JSX.Element
  renderTrailing?: () => JSX.Element
  renderOverlay: (tab: string) => JSX.Element
  /** Positioning wrapper class for the tab list (coding uses a sticky bar). */
  listWrapperClass?: string
  children: JSX.Element
}

export function SessionFileTabStrip(props: SessionFileTabStripProps) {
  const [store, setStore] = createStore({ activeDraggable: undefined as string | undefined })

  const handleDragStart = (event: unknown) => {
    const id = getDraggableId(event)
    if (!id) return
    setStore("activeDraggable", id)
  }

  const handleDragOver = (event: DragEvent) => {
    const { draggable, droppable } = event
    if (!draggable || !droppable) return
    props.onMove(draggable.id.toString(), droppable.id.toString())
  }

  const handleDragEnd = () => {
    setStore("activeDraggable", undefined)
  }

  return (
    <DragDropProvider
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragOver={handleDragOver}
      collisionDetector={closestCenter}
    >
      <DragDropSensors />
      <ConstrainDragYAxis />
      <div class={props.listWrapperClass ?? "shrink-0"}>
        <TabsV2.List
          ref={(el: HTMLDivElement) => {
            const stop = createFileTabListSync({ el, contextOpen: props.contextOpen })
            onCleanup(stop)
          }}
        >
          {props.renderLeading()}
          <SessionContextTabTrigger contextOpen={props.contextOpen} onClose={() => props.onClose("context")} />
          <SortableProvider ids={[...props.openedTabs()]}>
            <For each={props.openedTabs()}>{(tab) => <SortableTab tab={tab} onTabClose={props.onClose} />}</For>
          </SortableProvider>
          {props.renderTrailing?.()}
        </TabsV2.List>
      </div>
      {props.children}
      <DragOverlay>
        <Show when={store.activeDraggable} keyed>
          {(tab) => <div data-component="tabs-drag-preview">{props.renderOverlay(tab)}</div>}
        </Show>
      </DragOverlay>
    </DragDropProvider>
  )
}

/**
 * Small effect factory that writes the panel's computed active tab back into the
 * shared session tab store. The consuming mode panel keeps its own allowed tab set
 * and fallback; this helper only syncs, never hardcodes a tab collection.
 */
export function createActiveTabWriteback(input: {
  enabled: () => boolean
  activeTab: () => string
  fallbackTab: () => string
  getActive: () => string | undefined
  setActive: (tab: string) => void
}) {
  createEffect(() => {
    if (!input.enabled()) return
    const active = input.activeTab()
    const current = input.getActive()
    if (current === undefined) {
      input.setActive(input.fallbackTab())
      return
    }
    if (current === active) return
    input.setActive(active)
  })
}
