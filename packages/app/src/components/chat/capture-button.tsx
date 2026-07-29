import { Icon } from "@aigcfroge/ui/v2/icon"
import { TooltipV2 } from "@aigcfroge/ui/v2/tooltip-v2"

export function CaptureButton(props: { onClick: () => void; label: string }) {
  return (
    <TooltipV2 value={props.label} placement="top" gutter={4}>
      <button
        onClick={props.onClick}
        aria-label={props.label}
        class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-13-medium border transition-colors cursor-pointer
          border-border-base bg-bg-base hover:bg-bg-soft active:bg-bg-strong
          text-text-base hover:text-text-strong"
      >
        <Icon name="folder-add-left" />
        <span>{props.label}</span>
      </button>
    </TooltipV2>
  )
}
