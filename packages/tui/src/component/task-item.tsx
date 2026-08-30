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
  // Guard against NaN (and stray "NaN"/"Infinity" strings from the SDK's
  // number-or-literal union) so a non-finite nextRun renders no nextRun text
  // instead of "Invalid Date".
  const nextRunLabel = () =>
    typeof props.nextRun === "number" && Number.isFinite(props.nextRun) ? formatNextRun(props.nextRun) : undefined

  return (
    <box flexDirection="row" gap={0}>
      <text flexShrink={0} style={{ fg: fg() }}>
        [{style()?.marker ?? " "}]{" "}
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
