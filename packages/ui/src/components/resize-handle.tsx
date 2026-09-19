import { splitProps, type JSX } from "solid-js"

export interface ResizeHandleProps extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "onResize"> {
  direction: "horizontal" | "vertical"
  edge?: "start" | "end"
  size: number
  min: number
  max: number
  /** Keyboard resize increment. Defaults to 16px, matching a coarse text step. */
  step?: number
  /**
   * Accessible name. Required, not optional: a separator with no name is announced as an
   * unlabeled splitter, which is exactly the defect this component used to ship.
   */
  label: string
  onResize: (size: number) => void
  onCollapse?: () => void
  collapseThreshold?: number
}

/**
 * Which end of the axis the panel is anchored to.
 *
 * `edge: "start"` means the panel grows toward the axis start (a right-docked panel dragged
 * left), `"end"` the opposite. Defaults match the drag geometry the mouse path already used.
 */
export const resolveEdge = (direction: "horizontal" | "vertical", edge?: "start" | "end") =>
  edge ?? (direction === "vertical" ? "start" : "end")

/**
 * Signed contribution of a positive axis delta (pointer moving right/down, or ArrowRight/
 * ArrowDown) to the panel size. Pure so the sign rule is testable without a DOM — the old
 * inline ternary was correct but unreachable from a unit test.
 */
export const sizeDeltaFor = (direction: "horizontal" | "vertical", edge: "start" | "end", delta: number) =>
  direction === "vertical" ? (edge === "end" ? delta : -delta) : edge === "start" ? -delta : delta

/**
 * The keyboard increment for a key, or `undefined` when the key is not a resize key.
 *
 * A separator is a single-dimensional control: only the arrows along its axis apply, so a
 * vertical separator (a left/right drag) ignores Up/Down rather than silently resizing.
 */
export const keyDeltaFor = (direction: "horizontal" | "vertical", key: string, step: number): number | undefined => {
  if (direction === "horizontal") {
    if (key === "ArrowLeft") return -step
    if (key === "ArrowRight") return step
    return undefined
  }
  if (key === "ArrowUp") return -step
  if (key === "ArrowDown") return step
  return undefined
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export function ResizeHandle(props: ResizeHandleProps) {
  const [local, rest] = splitProps(props, [
    "direction",
    "edge",
    "size",
    "min",
    "max",
    "step",
    "label",
    "onResize",
    "onCollapse",
    "collapseThreshold",
    "class",
    "classList",
  ])

  const edge = () => resolveEdge(local.direction, local.edge)
  const step = () => local.step ?? 16

  const apply = (next: number) => {
    const size = clamp(next, local.min, local.max)
    local.onResize(size)
    return size
  }

  const handlePointerDown = (event: PointerEvent) => {
    // Touch/pen included, and capture keeps the drag alive when the pointer leaves the handle.
    event.preventDefault()
    // A real narrowing, not an assertion: `currentTarget` is `EventTarget | null`, and the
    // pointer-capture API only exists on Element. Bailing out is correct here — without a
    // captured element there is nothing to keep the drag alive on.
    const element = event.currentTarget
    if (!(element instanceof HTMLElement)) return
    const start = local.direction === "horizontal" ? event.clientX : event.clientY
    const startSize = local.size
    let current = startSize

    element.setPointerCapture(event.pointerId)
    document.body.style.userSelect = "none"
    document.body.style.overflow = "hidden"

    const onPointerMove = (moveEvent: PointerEvent) => {
      const pos = local.direction === "horizontal" ? moveEvent.clientX : moveEvent.clientY
      current = clamp(startSize + sizeDeltaFor(local.direction, edge(), pos - start), local.min, local.max)
      local.onResize(current)
    }

    const onPointerUp = () => {
      document.body.style.userSelect = ""
      document.body.style.overflow = ""
      element.removeEventListener("pointermove", onPointerMove)
      element.removeEventListener("pointerup", onPointerUp)
      element.removeEventListener("pointercancel", onPointerUp)
      if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId)

      const threshold = local.collapseThreshold ?? 0
      if (local.onCollapse && threshold > 0 && current < threshold) local.onCollapse()
    }

    element.addEventListener("pointermove", onPointerMove)
    element.addEventListener("pointerup", onPointerUp)
    element.addEventListener("pointercancel", onPointerUp)
  }

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Home") {
      event.preventDefault()
      apply(local.min)
      return
    }
    if (event.key === "End") {
      event.preventDefault()
      apply(local.max)
      return
    }
    const delta = keyDeltaFor(local.direction, event.key, step())
    if (delta === undefined) return
    event.preventDefault()
    apply(local.size + sizeDeltaFor(local.direction, edge(), delta))
  }

  return (
    <div
      {...rest}
      role="separator"
      // A separator that is dragged left/right IS vertical; the axis names the divider, not the
      // gesture. `aria-orientation` defaults to "horizontal", so only the vertical case needs it.
      aria-orientation={local.direction === "horizontal" ? "vertical" : "horizontal"}
      aria-label={local.label}
      aria-valuenow={Math.round(local.size)}
      aria-valuemin={local.min}
      aria-valuemax={local.max}
      tabIndex={0}
      data-component="resize-handle"
      data-direction={local.direction}
      data-edge={edge()}
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
      onPointerDown={handlePointerDown}
      onKeyDown={handleKeyDown}
    />
  )
}
