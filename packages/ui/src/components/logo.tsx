import { type ComponentProps } from "solid-js"

/*
 * AigcForge brand mark — AIGC pyramid.
 * Facets spell the brand initials: left A, right G, base C (vessel arc), center I (pillar).
 * Colors use existing v2 tokens only (--v2-avatar-bg-* blue/cyan, --v2-text-text-contrast).
 */
export const Mark = (props: { class?: string }) => {
  return (
    <svg
      data-component="logo-mark"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Left facet A */}
      <path data-slot="logo-mark-a" d="M12 2L4 18H8L12 9.5V2Z" fill="var(--v2-avatar-bg-blue)" opacity="0.75" />
      {/* Right facet G */}
      <path data-slot="logo-mark-g" d="M12 2V9.5L16 18H20L12 2Z" fill="var(--v2-avatar-bg-cyan)" opacity="0.6" />
      {/* Base C vessel */}
      <path
        data-slot="logo-mark-c"
        d="M6 18C6 20.2 9 21.5 12 21.5C15 21.5 18 20.2 18 18H15C15 19 13.5 19.5 12 19.5C10.5 19.5 9 19 9 18H6Z"
        fill="var(--v2-avatar-bg-cyan)"
        opacity="0.85"
      />
      {/* Center I pillar */}
      <path data-slot="logo-mark-i" d="M11 6H13V18.5H11V6Z" fill="var(--v2-text-text-contrast)" />
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
      {/* Outer pyramid glow border */}
      <polygon points="50,8 10,82 90,82" fill="none" stroke="var(--v2-avatar-bg-cyan)" stroke-width="2" opacity="0.4" />
      {/* Left facet A */}
      <path data-slot="logo-splash-a" d="M50 8L10 82H30L50 42V8Z" fill="var(--v2-avatar-bg-blue)" opacity="0.7" />
      {/* Right facet G */}
      <path data-slot="logo-splash-g" d="M50 8V42L70 82H90L50 8Z" fill="var(--v2-avatar-bg-cyan)" opacity="0.5" />
      {/* Base C vessel */}
      <path
        data-slot="logo-splash-c"
        d="M22 78C22 88 36 94 50 94C64 94 78 88 78 78H64C64 83 57 86 50 86C43 86 36 83 36 78H22Z"
        fill="var(--v2-avatar-bg-cyan)"
        opacity="0.9"
      />
      {/* Center I pillar */}
      <rect data-slot="logo-splash-i" x="46" y="24" width="8" height="58" rx="2" fill="var(--v2-text-text-contrast)" />
    </svg>
  )
}

export const Logo = (props: { class?: string }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 234 42"
      fill="none"
      classList={{ [props.class ?? ""]: !!props.class }}
    >
      {/* AIGCFORGE wordmark — geometric sans, stroke-width 6, letter width 26 */}
      <g fill="var(--v2-text-text-base)">
        {/* A */}
        <path d="M3 36 L13 6 L23 36 H18 L15 26 H11 L8 36 Z" />
        <path d="M10 20 H16 V22 H10 Z" />
        {/* I */}
        <path d="M29 6 H33 V36 H29 Z" />
        {/* G */}
        <path d="M55 6 H75 V12 H61 V30 H75 V36 H55 Z" />
        <path d="M68 20 H75 V26 H68 Z" />
        {/* C */}
        <path d="M78 6 H98 V12 H84 V30 H98 V36 H78 Z" />
        {/* F */}
        <path d="M104 6 H124 V12 H110 V36 H104 Z" />
        <path d="M110 19 H122 V25 H110 Z" />
        {/* O */}
        <path fill-rule="evenodd" d="M130 6 H150 V36 H130 Z M134 12 H146 V30 H134 Z" />
        {/* R */}
        <path d="M156 6 H172 V20 H162 V22 H156 V6 Z" />
        <path d="M160 24 H166 V27 H162 V31 H166 V36 H160 V31 H154 V24 Z" />
        {/* G */}
        <path d="M182 6 H202 V12 H188 V30 H202 V36 H182 Z" />
        <path d="M195 20 H202 V26 H195 Z" />
        {/* E */}
        <path d="M208 6 H228 V12 H214 V36 H208 Z" />
        <path d="M214 19 H226 V25 H214 Z" />
      </g>
    </svg>
  )
}
