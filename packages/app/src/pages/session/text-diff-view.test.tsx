import { describe, expect, test } from "bun:test"
import { render } from "solid-js/web"
import { TextDiffView } from "./text-diff-view"

// Phase 3b DOM contract tests: TextDiffView extracts the overwrite-confirm diff
// rendering shared by Chat and Work, with a variant preserving each surface's
// visual contract. These assert the rendered DOM (row prefixes, variant
// container, color classes), not the component's source text.

function mount(props: { oldText: string; newText: string; variant: "chat" | "work" }) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const dispose = render(() => <TextDiffView {...props} />, container)
  return { container, dispose }
}

const rowTexts = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("div"))
    .map((row) => row.textContent?.trim())
    .filter((text): text is string => text !== undefined)

const rowClasses = (container: HTMLElement) => Array.from(container.querySelectorAll("div")).map((row) => row.className)

describe("TextDiffView (variant diff rendering)", () => {
  test("renders add/del/eq rows with the + - prefix markers", () => {
    const { container, dispose } = mount({
      oldText: "line1\nline2",
      newText: "line1\nline3",
      variant: "chat",
    })
    expect(rowTexts(container)).toEqual(expect.arrayContaining(["+line3", "-line2", "line1"]))
    dispose()
  })

  test("chat add/del rows carry the success/warning color contract", () => {
    const { container, dispose } = mount({
      oldText: "old\nkeep",
      newText: "new\nkeep",
      variant: "chat",
    })
    const classes = rowClasses(container)
    expect(classes.some((c) => c.includes("text-v2-state-fg-success"))).toBe(true)
    expect(classes.some((c) => c.includes("text-v2-state-fg-warning"))).toBe(true)
    expect(classes.some((c) => c.includes("text-v2-text-text-muted"))).toBe(true)
    dispose()
  })

  test("work variant renders inside the bordered scrolled container", () => {
    const { container, dispose } = mount({
      oldText: "old",
      newText: "new",
      variant: "work",
    })
    const shell = container.querySelector("div")
    expect(shell?.className).toContain("overflow-y-auto")
    expect(shell?.className).toContain("max-h-48")
    expect(shell?.className).toContain("rounded-lg")
    expect(shell?.className).toContain("border-v2-border-border-base")
    // Work rows use the filled success/danger background, unlike chat's text-only.
    const classes = rowClasses(container)
    expect(classes.some((c) => c.includes("bg-v2-state-fg-success"))).toBe(true)
    expect(classes.some((c) => c.includes("bg-v2-state-fg-danger"))).toBe(true)
    dispose()
  })

  test("row prefixes mark adds and deletes in both variants", () => {
    for (const variant of ["chat", "work"] as const) {
      const { container, dispose } = mount({ oldText: "a", newText: "b", variant })
      expect(rowTexts(container)).toEqual(expect.arrayContaining(["+b", "-a"]))
      dispose()
    }
  })
})
