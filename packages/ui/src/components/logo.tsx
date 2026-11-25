import { type ComponentProps } from "solid-js"
import { Wordmark } from "../typography/wordmark/wordmark"
import "./logo.css"

export const WING_STANDARD =
  "M 48.4 59.8 Q 50 58.0 51.6 59.8 L 70.3 78.5 A 35 35 0 0 1 58.2 84.0 L 51.5 70.4 Q 50 68.0 48.5 70.4 L 41.8 84.0 A 35 35 0 0 1 29.7 78.5 Z"

export const WING_OPTICAL =
  "M 47.8 60.8 Q 50 58.6 52.2 60.8 L 72 80.6 A 36 36 0 0 1 58.6 86.2 L 51.8 72.4 Q 50 69.8 48.2 72.4 L 41.4 86.2 A 36 36 0 0 1 28 80.6 Z"

export const Mark = (props: { class?: string }) => {
  return (
    <svg
      data-component="logo-mark"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g data-slot="wing-top">
        <path d={WING_OPTICAL} transform="rotate(180 50 50)" fill="currentColor" />
      </g>
      <g data-slot="wing-right">
        <path d={WING_OPTICAL} transform="rotate(270 50 50)" fill="currentColor" />
      </g>
      <g data-slot="wing-bottom">
        <path d={WING_OPTICAL} fill="currentColor" fill-opacity="0.86" />
      </g>
      <g data-slot="wing-left">
        <path d={WING_OPTICAL} transform="rotate(90 50 50)" fill="currentColor" fill-opacity="0.86" />
      </g>
      <rect
        data-slot="core"
        x="41.5"
        y="41.5"
        width="17"
        height="17"
        rx="4"
        transform="rotate(45 50 50)"
        fill="var(--omnxa-core-color, var(--v2-icon-brand-core, #00abcfff))"
      />
    </svg>
  )
}

export const Splash = (props: Pick<ComponentProps<"svg">, "ref" | "class">) => {
  return (
    <svg
      ref={props.ref}
      data-component="logo-splash"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g data-slot="wing-top">
        <path d={WING_STANDARD} transform="rotate(180 50 50)" fill="currentColor" />
      </g>
      <g data-slot="wing-right">
        <path d={WING_STANDARD} transform="rotate(270 50 50)" fill="currentColor" />
      </g>
      <g data-slot="wing-bottom">
        <path d={WING_STANDARD} fill="currentColor" fill-opacity="0.86" />
      </g>
      <g data-slot="wing-left">
        <path d={WING_STANDARD} transform="rotate(90 50 50)" fill="currentColor" fill-opacity="0.86" />
      </g>
      <rect
        data-slot="core"
        x="43.8"
        y="43.8"
        width="12.4"
        height="12.4"
        rx="3.4"
        transform="rotate(45 50 50)"
        fill="var(--omnxa-core-color, var(--v2-icon-brand-core, #00abcfff))"
      />
    </svg>
  )
}

export const Logo = (props: { class?: string }) => <Wordmark class={props.class} fade={false} muted={false} />
