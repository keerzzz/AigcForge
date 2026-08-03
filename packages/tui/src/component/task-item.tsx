import { Show } from "solid-js"
import { useTheme } from "../context/theme"
import { formatNextRun, taskStatusStyle } from "./task-status"

export interface TaskItemProps {
  status: string
  content: string
  nextRun?: number
}

export function TaskItem(props: TaskItemProps) {
  const { theme } = useTheme()
  const style = () => taskStatusStyle(props.status)
  const fg = () => theme[style()?.color ?? "textMuted"]
  const nextRunLabel = () => (props.nextRun === undefined ? undefined : formatNextRun(props.nextRun))

  return (
    <box flexDirection="row" gap={0}>
      <text flexShrink={0} style={{ fg: fg() }}>
        [{style()?.marker ?? " "}]
      </text>
      <text flexGrow={1} wrapMode="word" style={{ fg: fg() }}>
        {props.content}
      </text>
      <Show when={props.status === "scheduled" && nextRunLabel()}>
        <text flexShrink={0} style={{ fg: theme.textMuted }}>
          {" · "}
          {nextRunLabel()}
        </text>
      </Show>
    </box>
  )
}
