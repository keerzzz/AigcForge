import { type ComponentProps } from "solid-js"
import { Logo } from "../../components/logo"

export function WordmarkV2(props: Pick<ComponentProps<"svg">, "class">) {
  return (
    <svg
      data-component="wordmark-v2"
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 720 129"
      classList={{ [props.class ?? ""]: !!props.class }}
    >
      <g opacity="0.12">
        <Logo />
      </g>
    </svg>
  )
}
