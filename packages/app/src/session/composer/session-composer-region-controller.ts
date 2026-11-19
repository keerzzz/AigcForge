import type { Accessor } from "solid-js"
import type { SessionRequestModel } from "../requests/model"
import type { CommandOption } from "@/shell/commands/command"

export function createSessionComposerRegionController(input: {
  state: SessionRequestModel
  readonly?: Accessor<boolean>
  acceptsDrop?: (event: DragEvent) => boolean
  commands?: Accessor<CommandOption[]>
  parentID: Accessor<string | undefined>
  centered: Accessor<boolean>
  onResponseSubmit: () => void
  openParent: () => void
  setPromptRef: (el: HTMLDivElement) => void
  setDockRef: (el: HTMLDivElement) => void
}) {
  return {
    state: input.state,
    readonly: input.readonly,
    centered: input.centered,
    onResponseSubmit: input.onResponseSubmit,
    openParent: input.openParent,
    setPromptRef: input.setPromptRef,
    setDockRef: input.setDockRef,
    parentID: input.parentID,
    child: () => !!input.parentID(),
    showComposer: () => !input.state.blocked() || !!input.parentID() || !!input.readonly?.(),
  }
}

export type SessionComposerRegionController = ReturnType<typeof createSessionComposerRegionController>
