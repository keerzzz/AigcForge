import { Show, splitProps, type ComponentProps, type JSX } from "solid-js"
import { WING_OPTICAL, WING_STANDARD } from "@omnixa/ui/logo"
import "./session-progress-indicator-v2.css"

export type SessionProgressIndicatorV2Props = ComponentProps<"svg"> & {
  variant?: "ring" | "agent"
  coreColor?: string
}

export function SessionProgressIndicatorV2(props: SessionProgressIndicatorV2Props) {
  const [local, rest] = splitProps(props, ["class", "classList", "width", "height", "variant", "coreColor", "style"])
  const variant = () => local.variant ?? "ring"
  const optical = () => Number(local.width ?? local.height ?? 16) < 24

  const mergedStyle = (): JSX.CSSProperties | string | undefined => {
    if (!local.coreColor) return local.style
    if (typeof local.style === "string") return `${local.style};--omnxa-core-color:${local.coreColor}`

    return {
      ...local.style,
      "--omnxa-core-color": local.coreColor,
    }
  }

  return (
    <svg
      {...rest}
      style={mergedStyle()}
      class={local.class}
      classList={local.classList}
      width={local.width ?? 16}
      height={local.height ?? 16}
      viewBox={variant() === "agent" ? "0 0 100 100" : "0 0 16 16"}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      data-component="session-progress-indicator-v2"
      data-variant={variant()}
      aria-hidden={rest["aria-hidden"] ?? "true"}
    >
      <Show
        when={variant() === "agent"}
        fallback={
          <>
            <circle
              cx={8}
              cy={8}
              r={5.5}
              stroke="currentColor"
              stroke-width={1.25}
              opacity={0.25}
              vector-effect="non-scaling-stroke"
            />
            <path
              data-progress-arc
              d="M8 2.5a5.5 5.5 0 0 1 5.5 5.5"
              stroke="currentColor"
              stroke-width={1.25}
              stroke-linecap="round"
              vector-effect="non-scaling-stroke"
            />
          </>
        }
      >
        <path
          data-wing="1"
          d={optical() ? WING_OPTICAL : WING_STANDARD}
          transform="rotate(180 50 50)"
          fill="currentColor"
        />
        <path
          data-wing="2"
          d={optical() ? WING_OPTICAL : WING_STANDARD}
          transform="rotate(270 50 50)"
          fill="currentColor"
        />
        <path data-wing="3" d={optical() ? WING_OPTICAL : WING_STANDARD} fill="currentColor" />
        <path
          data-wing="4"
          d={optical() ? WING_OPTICAL : WING_STANDARD}
          transform="rotate(90 50 50)"
          fill="currentColor"
        />
        <rect
          data-core
          x={optical() ? 41.5 : 43.8}
          y={optical() ? 41.5 : 43.8}
          width={optical() ? 17 : 12.4}
          height={optical() ? 17 : 12.4}
          rx={optical() ? 4 : 3.4}
          fill="var(--omnxa-core-color, var(--task-agent-color, var(--v2-icon-brand-core, currentColor)))"
        />
      </Show>
    </svg>
  )
}
