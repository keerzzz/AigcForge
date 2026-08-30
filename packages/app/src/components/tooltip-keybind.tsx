/**
 * Migration shim — TooltipKeybind until call sites adopt TooltipV2 directly.
 * Matches the old @aigcfroge/ui/tooltip TooltipKeybind API using TooltipV2.
 */
import { TooltipV2 } from "@aigcfroge/ui/v2/tooltip-v2"
import type { TooltipV2Props } from "@aigcfroge/ui/v2/tooltip-v2"
import { splitProps } from "solid-js"

interface TooltipKeybindProps extends Omit<TooltipV2Props, "value"> {
  title: string
  keybind: string
}

export function TooltipKeybind(props: TooltipKeybindProps) {
  const [local, others] = splitProps(props, ["title", "keybind"])
  return (
    <TooltipV2
      {...others}
      value={
        <span class="flex items-center gap-1.5">
          <span>{local.title}</span>
          <span
            class="text-11-medium rounded p-0.5 px-1"
            style="background: var(--v2-background-bg-base); border: 0.5px solid var(--v2-border-border-muted)"
          >
            {local.keybind}
          </span>
        </span>
      }
    >
      {props.children}
    </TooltipV2>
  )
}
