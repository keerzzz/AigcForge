import { describe, expect, test } from "bun:test"
import { PermissionStateContext } from "@aigcfroge/core/system-context/permission-state"

function input(overrides: Partial<Parameters<typeof PermissionStateContext.render>[0]> = {}) {
  return {
    mode: "coding",
    agent: "meta",
    tier: "propose",
    attended: undefined,
    masterPermissionEnabled: false,
    savedApprovals: [],
    ...overrides,
  } as Parameters<typeof PermissionStateContext.render>[0]
}

describe("PermissionStateContext.render", () => {
  test("coding × meta：写入继续委派 build", () => {
    const text = PermissionStateContext.render(input({ mode: "coding" }))
    expect(text).toContain("coding")
    expect(text).toContain("build")
  })

  test("非 coding × meta × propose：只使用当前安全/领域工具，不尝试通用写入", () => {
    const text = PermissionStateContext.render(input({ mode: "chat", tier: "propose" }))
    expect(text).toContain("propose")
    expect(text).not.toContain("full")
  })

  test("非 coding × meta × full：可直接使用当前可见工具，ask 表示等待确认", () => {
    const text = PermissionStateContext.render(input({ mode: "work", tier: "full" }))
    expect(text).toContain("full")
  })

  test("break-glass：显式全开但仍须遵守用户任务与安全协议", () => {
    const text = PermissionStateContext.render(input({ mode: "chat", tier: "full", masterPermissionEnabled: true }))
    expect(text).toContain("Permission override")
  })

  test("非 meta agent：仅声明当前模式与档位不适用", () => {
    const text = PermissionStateContext.render(input({ mode: "chat", agent: "chat-orchestrator" }))
    expect(text).toContain("chat-orchestrator")
  })

  test("unattended：无确认者，写工具不可用", () => {
    const text = PermissionStateContext.render(input({ mode: "chat", tier: "full", attended: false }))
    expect(text).toContain("unattended")
  })
})
