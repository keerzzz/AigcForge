import { Show, createMemo, type JSX } from "solid-js"
import { useLayout } from "@/context/layout"
import { useSettings } from "@/context/settings"
import { useSessionLayout } from "@/pages/session/session-layout"
import { SessionFileTree } from "@/components/session-file-tree"
import { shouldShowFileTree, type Sizing } from "@/pages/session/helpers"
import { useFile } from "@/context/file"
import FileTree from "@/components/file-tree"

/**
 * Shared right-panel shell for all Product Modes. Owns the `review-panel` aside,
 * open/close (reviewPanel.opened), width, transition, and the A/B layout: the
 * injected A-zone content plus the shared SessionFileTree B-zone slot.
 *
 * When no `fileTree` is provided the shell renders the default project FileTree
 * used by Work and Assistant; Coding's changes/all tree and Chat's `.aigcfroge`
 * tree are still passed explicitly.
 */
export function SessionRightPanel(props: {
  size: Sizing
  ariaLabel?: string
  /** Extra transition-disable (coding review snap). */
  snap?: boolean
  children: JSX.Element
  fileTree?: JSX.Element
}) {
  const layout = useLayout()
  const settings = useSettings()
  const file = useFile()
  const { view } = useSessionLayout()
  const reviewOpen = createMemo(() => view().reviewPanel.opened())
  const fileOpen = createMemo(() =>
    shouldShowFileTree({ visible: settings.visibility.fileTree(), opened: layout.fileTree.opened() }),
  )
  const open = createMemo(() => reviewOpen() || fileOpen())
  const panelWidth = createMemo(() => {
    if (!open()) return "0px"
    if (reviewOpen()) return "auto"
    return `${layout.fileTree.width()}px`
  })

  const defaultFileTree = (
    <div class="min-h-0 flex-1 overflow-y-auto px-3 pt-3">
      <FileTree path="" class="pt-1" onFileClick={(node) => void file.load(node.path)} />
    </div>
  )

  return (
    <aside
      id="review-panel"
      aria-label={props.ariaLabel}
      aria-hidden={!open()}
      inert={!open()}
      class="relative min-w-0 h-full flex shrink-0 overflow-hidden bg-v2-background-bg-base"
      classList={{
        "pointer-events-none": !open(),
        "transition-[width] duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[width] motion-reduce:transition-none":
          !props.size.active() && !props.snap,
        "rounded-[10px] shadow-[var(--v2-elevation-raised)] overflow-hidden": true,
        "flex-1": reviewOpen(),
      }}
      style={{ width: panelWidth() }}
    >
      <Show when={open()}>
        <div class="size-full flex">
          <div
            aria-hidden={!reviewOpen()}
            inert={!reviewOpen()}
            class="relative flex min-w-0 h-full flex-1 overflow-hidden bg-v2-background-bg-base"
            classList={{ "pointer-events-none": !reviewOpen() }}
          >
            {props.children}
          </div>
          <SessionFileTree
            size={props.size}
            borderClass={reviewOpen() ? "border-l border-v2-border-border-base" : undefined}
          >
            {props.fileTree ?? defaultFileTree}
          </SessionFileTree>
        </div>
      </Show>
    </aside>
  )
}
