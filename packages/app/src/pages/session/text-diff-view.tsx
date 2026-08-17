import { For, createMemo } from "solid-js"
import { diffTextLines } from "@/utils/text-diff"

/**
 * Read-only overwrite-confirm diff shared by Chat and Work. The variant preserves
 * each surface's visual contract: "chat" keeps the inline add/del/eq rows rendered
 * inside the caller's preview container; "work" keeps its bordered scrolled box.
 * Diff computation stays on the shared diffTextLines pipeline.
 */
export function TextDiffView(props: {
  oldText: string
  newText: string
  variant: "chat" | "work"
}) {
  const lines = createMemo(() => diffTextLines(props.oldText, props.newText))

  if (props.variant === "work") {
    return (
      <div class="flex max-h-48 min-h-0 flex-col overflow-y-auto rounded-lg border border-v2-border-border-base">
        <For each={lines()}>
          {(line) => (
            <div
              class={[
                "bg-v2-background-bg-base text-v2-text-text-muted text-12-regular",
                line.type === "add" && "bg-v2-state-fg-success/10 text-v2-state-fg-success",
                line.type === "del" && "bg-v2-state-fg-danger/10 text-v2-state-fg-danger",
              ].join(" ")}
            >
              <span class="mr-2 inline-block w-6 select-none text-right opacity-50">
                {line.type === "add" ? "+" : line.type === "del" ? "-" : " "}
              </span>
              <span class="whitespace-pre-wrap break-all">{line.text}</span>
            </div>
          )}
        </For>
      </div>
    )
  }

  return (
    <>
      <For each={lines()}>
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
    </>
  )
}
