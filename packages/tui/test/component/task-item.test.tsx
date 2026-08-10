/** @jsxImportSource @opentui/solid */
import { afterEach, describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { TaskItem, type TaskItemProps } from "../../src/component/task-item"
import { formatNextRun } from "../../src/component/task-status"
import { KVProvider } from "../../src/context/kv"
import { ThemeProvider } from "../../src/context/theme"
import { TuiConfigProvider } from "../../src/config"
import { tmpdir } from "../fixture/fixture"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined

afterEach(() => {
  testSetup?.renderer.destroy()
  testSetup = undefined
})

function frameText(): string {
  return testSetup!
    .captureCharFrame()
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trimEnd()
}

async function renderTaskItem(root: string, props: TaskItemProps): Promise<string> {
  const state = path.join(root, "state")
  await mkdir(state, { recursive: true })
  await Bun.write(path.join(state, "kv.json"), "{}")

  testSetup = await testRender(
    () => (
      <TestTuiContexts paths={{ home: root, state, worktree: root }}>
        <TuiConfigProvider config={createTuiResolvedConfig({})}>
          <KVProvider>
            <ThemeProvider mode="dark">
              <box width={60}>
                <TaskItem {...props} />
              </box>
            </ThemeProvider>
          </KVProvider>
        </TuiConfigProvider>
      </TestTuiContexts>
    ),
    { width: 60, height: 3 },
  )

  // The theme provider hides children until its async ready resolves, so poll
  // the frame until the content is actually rendered.
  const start = Date.now()
  while (Date.now() - start < 2000) {
    await testSetup.renderOnce()
    const frame = frameText()
    if (frame.includes(props.content)) return frame
    await Bun.sleep(10)
  }
  return frameText()
}

describe("TaskItem", () => {
  test("scheduled task renders the ⚡ marker and the nextRun text", async () => {
    await using tmp = await tmpdir()
    const NEXT_RUN = 1700000000000
    const frame = await renderTaskItem(tmp.path, {
      status: "scheduled",
      content: "Deploy canary",
      nextRun: NEXT_RUN,
    })

    expect(frame).toContain("⚡")
    expect(frame).toContain(formatNextRun(NEXT_RUN))
    expect(frame).toContain("Deploy canary")
  })

  test("completed task renders the ✓ marker separated from the content by a space", async () => {
    await using tmp = await tmpdir()
    const frame = await renderTaskItem(tmp.path, {
      status: "completed",
      content: "Deploy canary",
    })

    expect(frame).toContain("[✓] ")
    expect(frame).toContain("[✓] Deploy canary")
  })

  test("a NaN nextRun renders no nextRun text", async () => {
    await using tmp = await tmpdir()
    const frame = await renderTaskItem(tmp.path, {
      status: "scheduled",
      content: "Deploy canary",
      nextRun: Number.NaN,
    })

    expect(frame).toContain("⚡")
    expect(frame).toContain("Deploy canary")
    expect(frame).not.toContain("Invalid Date")
    expect(frame).not.toContain(" · ")
  })
})
