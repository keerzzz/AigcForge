import { createMemo } from "solid-js"
import { useLocal } from "../context/local"
import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { DialogModel } from "./dialog-model"

export function DialogAgent(props: { domain?: "session" | "executor" } = {}) {
  const local = useLocal()
  const dialog = useDialog()

  const options = createMemo(() => {
    const choices = (props.domain === "executor" ? local.executor.agent : local.agent).list().map((item) => ({
      value: item.id,
      title: item.id,
      description: item.description,
    }))
    const selected = props.domain === "executor" ? local.executor.preference()?.agent : undefined
    if (!selected || choices.some((item) => item.value === selected)) return choices
    return [...choices, { value: selected, title: selected, description: "Unavailable executor; saved preference" }]
  })

  return (
    <DialogSelect
      title={props.domain === "executor" ? "Select executor" : local.locked() ? "Adopted executor" : "Select agent"}
      current={props.domain === "executor" ? local.executor.preference()?.agent : local.agent.current()?.id}
      options={options()}
      actions={
        local.meta()
          ? [
              {
                command: "agent.domain",
                title: props.domain === "executor" ? "Session Agent" : "Delegation preference",
                bind: "tab",
                selection: "none",
                onTrigger: () =>
                  dialog.replace(() => <DialogAgent domain={props.domain === "executor" ? "session" : "executor"} />),
              },
            ]
          : []
      }
      onSelect={(option) => {
        if (props.domain === "executor") {
          local.executor.agent.set(option.value)
          dialog.replace(() => <DialogModel domain="executor" />)
          return
        }
        local.agent.set(option.value)
        dialog.clear()
      }}
    />
  )
}
