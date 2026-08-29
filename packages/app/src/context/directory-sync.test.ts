import { describe, expect, test } from "bun:test"
import { pickTarget } from "./directory-sync"

describe("pickTarget", () => {
  test("returns requested directory when it differs from own", () => {
    expect(pickTarget("/tmp/project", "/tmp/worktree")).toBe("/tmp/worktree")
  })

  test("returns own directory when requested is undefined or same", () => {
    expect(pickTarget("/tmp/project", undefined)).toBe("/tmp/project")
    expect(pickTarget("/tmp/project", "/tmp/project")).toBe("/tmp/project")
  })
})
