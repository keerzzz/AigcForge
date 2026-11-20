import { splitProps, type ComponentProps } from "solid-js"
import "./session-progress-indicator-v2.css"

export function SessionProgressIndicatorV2(props: ComponentProps<"svg">) {
  const [local, rest] = splitProps(props, ["class", "classList", "width", "height"])

  return (
    <svg
      {...rest}
      class={local.class}
      classList={local.classList}
      width={local.width ?? 16}
      height={local.height ?? 16}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      data-component="session-progress-indicator-v2"
      aria-hidden={rest["aria-hidden"] ?? "true"}
    >
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
    </svg>
  )
}
