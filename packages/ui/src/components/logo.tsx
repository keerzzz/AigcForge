import { type ComponentProps } from "solid-js"
import { BrandGeometry } from "../assets/brand/geometry"

export const Mark = (props: { class?: string }) => {
  return (
    <svg
      data-component="logo-mark"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <BrandShape slot="logo-mark" />
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
      <BrandShape slot="logo-splash" />
    </svg>
  )
}

function BrandShape(props: { slot: "logo-mark" | "logo-splash" }) {
  return (
    <>
      <polygon data-slot={`${props.slot}-a`} points={BrandGeometry.full.a} fill="var(--v2-avatar-bg-blue)" />
      <polygon data-slot={`${props.slot}-g`} points={BrandGeometry.full.g} fill="var(--v2-avatar-bg-cyan)" />
      <circle data-slot={`${props.slot}-i`} {...BrandGeometry.full.dot} fill="var(--v2-text-text-base)" />
      <path
        data-slot={`${props.slot}-c`}
        d={BrandGeometry.full.c}
        fill="color-mix(in srgb, var(--v2-avatar-bg-cyan) 55%, var(--v2-text-text-contrast))"
      />
    </>
  )
}

export const Logo = (props: { class?: string }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 204 42"
      fill="none"
      classList={{ [props.class ?? ""]: !!props.class }}
    >
      <g fill="var(--v2-text-text-base)">
        <g data-slot="logo-ai">
          <path d="M3 36 L13 6 L23 36 H18 L15 26 H11 L8 36 Z" />
          <path d="M10 20 H16 V22 H10 Z" />
          <path d="M29 6 H33 V36 H29 Z" />
        </g>
        <g data-slot="logo-gc" transform="translate(5 14.4) scale(.6)">
          <path d="M55 6 H75 V12 H61 V30 H75 V36 H55 Z" />
          <path d="M68 20 H75 V26 H68 Z" />
          <path d="M78 6 H98 V12 H84 V30 H98 V36 H78 Z" />
        </g>
        <g data-slot="logo-forge" transform="translate(-30 0)">
          {/* FORGE */}
          <path d="M104 6 H124 V12 H110 V36 H104 Z" />
          <path d="M110 19 H122 V25 H110 Z" />
          <path fill-rule="evenodd" d="M130 6 H150 V36 H130 Z M134 12 H146 V30 H134 Z" />
          <path d="M156 6 H172 V20 H162 V22 H156 V6 Z" />
          <path d="M160 24 H166 V27 H162 V31 H166 V36 H160 V31 H154 V24 Z" />
          <path d="M182 6 H202 V12 H188 V30 H202 V36 H182 Z" />
          <path d="M195 20 H202 V26 H195 Z" />
          <path d="M208 6 H228 V12 H214 V36 H208 Z" />
          <path d="M214 19 H226 V25 H214 Z" />
          <path data-slot="logo-e-bottom" d="M214 30 H228 V36 H214 Z" />
        </g>
      </g>
    </svg>
  )
}
