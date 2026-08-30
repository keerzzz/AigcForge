import { Show, createMemo, type JSX } from "solid-js"
import { ResizeHandle } from "@aigcfroge/ui/resize-handle"
import { useLayout } from "@/context/layout"
import { useSettings } from "@/context/settings"
import { shouldShowFileTree, type Sizing } from "@/pages/session/helpers"

/** Shared visibility, sizing, and resize shell for mode-specific file trees. */
export function SessionFileTree(props: { size: Sizing; borderClass?: string; children: JSX.Element }) {
  const layout = useLayout()
  const settings = useSettings()
  const fileOpen = createMemo(() =>
    shouldShowFileTree({ visible: settings.visibility.fileTree(), opened: layout.fileTree.opened() }),
  )
  const treeWidth = createMemo(() => (fileOpen() ? `${layout.fileTree.width()}px` : "0px"))

  return (
    <Show when={settings.visibility.fileTree()}>
      <div
        id="file-tree-panel"
        aria-hidden={!fileOpen()}
        inert={!fileOpen()}
        class="relative min-w-0 h-full shrink-0 overflow-hidden"
        classList={{
          "pointer-events-none": !fileOpen(),
          "transition-[width] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[width] motion-reduce:transition-none":
            !props.size.active(),
        }}
        style={{ width: treeWidth() }}
      >
        <div
          class="h-full flex flex-col overflow-hidden group/filetree"
          classList={{ [props.borderClass ?? ""]: !!props.borderClass }}
        >
          {props.children}
        </div>
        <Show when={fileOpen()}>
          <div onPointerDown={() => props.size.start()}>
            <ResizeHandle
              direction="horizontal"
              edge="start"
              size={layout.fileTree.width()}
              min={200}
              max={480}
              onResize={(width) => {
                props.size.touch()
                layout.fileTree.resize(width)
              }}
            />
          </div>
        </Show>
      </div>
    </Show>
  )
}
