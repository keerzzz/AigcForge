import { describe, expect, test } from "bun:test"
import fs from "fs"
import path from "path"

// 批次 4 §4.1/§4.2 右栏归一回归契约（app 无 solid-testing-library，源码契约测）。
// 目标：抽 SessionFileTree 共享组件后 code/chat 的 B 区开关/宽度/ResizeHandle
// 行为不变，work A 区改 auto + 删 workPanel store。

const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, rel), "utf-8")

describe("SessionFileTree (shared B 区, batch 4)", () => {
  test("exports the shared SessionFileTree component", () => {
    const component = read("session-file-tree.tsx")
    expect(component).toContain("export function SessionFileTree")
  })

  test("encapsulates the fileTree visibility wiring (settings + layout store)", () => {
    const component = read("session-file-tree.tsx")
    expect(component).toContain("shouldShowFileTree")
    expect(component).toContain("layout.fileTree.opened()")
    expect(component).toContain("settings.visibility.fileTree")
  })

  test("drives width from layout.fileTree.width and keeps ResizeHandle bounds", () => {
    const component = read("session-file-tree.tsx")
    expect(component).toContain("layout.fileTree.width()")
    expect(component).toContain("layout.fileTree.resize")
    expect(component).toContain("min={200}")
    expect(component).toContain("max={480}")
  })

  test("renders the stable panel id and hides content while closed", () => {
    const component = read("session-file-tree.tsx")
    expect(component).toContain('id="file-tree-panel"')
    expect(component).toContain("inert")
  })

  test("code panel delegates to the shared SessionRightPanel shell", () => {
    const code = read("../pages/session/session-side-panel.tsx")
    expect(code).toContain("<SessionRightPanel")
  })

  test("chat panel delegates to the shared SessionRightPanel shell", () => {
    const chat = read("chat/chat-right-panel.tsx")
    expect(chat).toContain("<SessionRightPanel")
  })

  test("work panel delegates to the shared SessionRightPanel shell", () => {
    const work = read("../pages/work-artifact-panel.tsx")
    expect(work).toContain("<SessionRightPanel")
  })

  test("SessionRightPanel owns the default Work/Assistant FileTree", () => {
    const shell = read("session-right-panel.tsx")
    const work = read("../pages/work-artifact-panel.tsx")
    const assistant = read("../pages/session/assistant-session-panel.tsx")
    expect(shell).toContain("props.fileTree ?? defaultFileTree")
    expect(shell).toContain('onFileClick={(node) => void file.load(node.path)}')
    expect(work).not.toContain("fileTree=")
    expect(assistant).not.toContain("fileTree=")
  })

  test("work A 区 width is auto and no longer reads workPanel store", () => {
    const work = read("../pages/work-artifact-panel.tsx")
    expect(work).not.toContain("workPanel")
    expect(work).not.toContain("DEFAULT_WORK_PANEL_WIDTH")
  })

  test("layout store no longer exposes workPanel width", () => {
    const layout = read("../context/layout.tsx")
    expect(layout).not.toContain("DEFAULT_WORK_PANEL_WIDTH")
    expect(layout).not.toContain("workPanel")
  })
})
