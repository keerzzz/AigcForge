/** @jsxImportSource @opentui/solid */
import { expect, spyOn, test } from "bun:test"
import { CodeRenderable, type BaseRenderable } from "@opentui/core"
import { MockTreeSitterClient, createTestRenderer } from "@opentui/core/testing"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import { RunScrollbackStream } from "@/cli/cmd/run/scrollback.surface"
import { RunEntryContent } from "@/cli/cmd/run/scrollback.writer"
import { RUN_THEME_FALLBACK } from "@/cli/cmd/run/theme"
import type { RunEntryBody, StreamCommit } from "@/cli/cmd/run/types"

async function setupScrollback() {
  const out = await createTestRenderer({
    width: 80,
    screenMode: "split-footer",
    footerHeight: 6,
    externalOutputMode: "capture-stdout",
    consoleMode: "disabled",
  })
  const treeSitterClient = new MockTreeSitterClient({ autoResolveTimeout: 0 })
  const highlight = spyOn(treeSitterClient, "highlightOnce")
  const scrollback = new RunScrollbackStream(out.renderer, RUN_THEME_FALLBACK, { treeSitterClient })

  return {
    ...out,
    treeSitterClient,
    highlight,
    scrollback,
    async cleanup() {
      scrollback.destroy()
      await treeSitterClient.destroy()
      out.renderer.destroy()
      highlight.mockRestore()
    },
  }
}

function finalTool(tool: string, input: Record<string, unknown>, metadata: Record<string, unknown> = {}): StreamCommit {
  return {
    kind: "tool",
    text: "",
    phase: "final",
    source: "tool",
    toolState: "completed",
    tool,
    messageID: "msg-client",
    partID: `part-${tool}`,
    part: {
      id: `part-${tool}`,
      sessionID: "session-client",
      messageID: "msg-client",
      type: "tool",
      callID: `call-${tool}`,
      tool,
      state: {
        status: "completed",
        input,
        output: "",
        title: tool,
        metadata,
        time: { start: 1, end: 2 },
      },
    },
  }
}

test("static write finals highlight with the injected tree-sitter client", async () => {
  const out = await setupScrollback()
  const content = "const writeClient = 1\nconst nextClient = 2\n"

  try {
    await out.scrollback.append(finalTool("write", { filePath: "src/client-write.ts", content }))

    expect(out.highlight).toHaveBeenCalledWith(content, "typescript")
    const commits = out.externalOutput.take()
    expect(commits).toHaveLength(1)
    expect(commits[0].text).toContain("# Wrote src/client-write.ts")
    expect(commits[0].text).toMatch(/1\s+const writeClient = 1/)
    expect(commits[0].text).toMatch(/2\s+const nextClient = 2/)
  } finally {
    await out.cleanup()
  }
})

test("static diff finals highlight with the injected tree-sitter client", async () => {
  const out = await setupScrollback()

  try {
    await out.scrollback.append(
      finalTool(
        "edit",
        { filePath: "src/client-diff.ts" },
        { diff: "@@ -1 +1 @@\n-export const client = 1\n+export const client = 2\n" },
      ),
    )

    expect(out.highlight).toHaveBeenCalledWith(expect.stringContaining("export const client = 2"), "typescript")
    expect(out.highlight).toHaveBeenCalledWith(expect.stringContaining("export const client = 1"), "typescript")
    const commits = out.externalOutput.take()
    expect(commits).toHaveLength(1)
    expect(commits[0].text).toContain("# Edited src/client-diff.ts")
    expect(commits[0].text).toContain("export const client = 1")
    expect(commits[0].text).toContain("export const client = 2")
  } finally {
    await out.cleanup()
  }
})

async function setupEntry(input: RunEntryBody) {
  const treeSitterClient = new MockTreeSitterClient()
  const highlight = spyOn(treeSitterClient, "highlightOnce")
  const [body, setBody] = createSignal(input)
  const injected = { treeSitterClient }
  const commit: StreamCommit = {
    kind: "reasoning",
    text: "",
    phase: "progress",
    source: "reasoning",
    messageID: "msg-direct-client",
    partID: "part-direct-client",
  }
  const out = await testRender(
    () => (
      <box width={80} height={8}>
        <RunEntryContent {...injected} commit={commit} body={body()} theme={RUN_THEME_FALLBACK} width={80} />
      </box>
    ),
    { width: 80, height: 8, consoleMode: "disabled" },
  )

  return {
    ...out,
    treeSitterClient,
    highlight,
    setBody,
    async cleanup() {
      await treeSitterClient.destroy()
      out.renderer.destroy()
      highlight.mockRestore()
    },
  }
}

function codeRenderables(node: BaseRenderable): CodeRenderable[] {
  return [
    ...(node instanceof CodeRenderable ? [node] : []),
    ...node.getChildren().flatMap((child) => codeRenderables(child)),
  ]
}

async function settleEntry(out: Awaited<ReturnType<typeof setupEntry>>) {
  await out.renderOnce()
  const code = codeRenderables(out.renderer.root)
  expect(code.length).toBeGreaterThan(0)
  // Fail before awaiting the default client's work when injection is missing.
  expect(out.highlight).toHaveBeenCalled()
  code.forEach((node) => expect(node.treeSitterClient).toBe(out.treeSitterClient))
  out.treeSitterClient.resolveAllHighlightOnce()
  await Promise.all(code.map((node) => node.highlightingDone))
  await out.renderOnce()
}

test("direct code entries retain the injected tree-sitter client after reactive updates", async () => {
  const out = await setupEntry({ type: "code", filetype: "typescript", content: "const beforeClient = 1" })

  try {
    await settleEntry(out)
    expect(out.highlight).toHaveBeenCalledWith("const beforeClient = 1", "typescript")
    expect(out.captureCharFrame()).toContain("const beforeClient = 1")

    out.highlight.mockClear()
    out.setBody({ type: "code", filetype: "typescript", content: "const afterClient = 2" })
    await settleEntry(out)

    expect(out.highlight).toHaveBeenCalledWith("const afterClient = 2", "typescript")
    expect(out.captureCharFrame()).toContain("const afterClient = 2")
    expect(out.captureCharFrame()).not.toContain("const beforeClient = 1")
  } finally {
    await out.cleanup()
  }
})

test("direct markdown entries retain the injected tree-sitter client after reactive updates", async () => {
  const out = await setupEntry({
    type: "markdown",
    content: "Before client\n\n```typescript\nconst beforeClient = 1\n```",
  })

  try {
    await settleEntry(out)
    expect(out.highlight).toHaveBeenCalledWith(expect.stringContaining("const beforeClient = 1"), "typescript")
    expect(out.captureCharFrame()).toContain("Before client")
    expect(out.captureCharFrame()).toContain("const beforeClient = 1")

    out.highlight.mockClear()
    out.setBody({ type: "markdown", content: "After client\n\n```typescript\nconst afterClient = 2\n```" })
    await settleEntry(out)

    expect(out.highlight).toHaveBeenCalledWith(expect.stringContaining("const afterClient = 2"), "typescript")
    expect(out.captureCharFrame()).toContain("After client")
    expect(out.captureCharFrame()).toContain("const afterClient = 2")
    expect(out.captureCharFrame()).not.toContain("Before client")
    expect(out.captureCharFrame()).not.toContain("const beforeClient = 1")
  } finally {
    await out.cleanup()
  }
})
