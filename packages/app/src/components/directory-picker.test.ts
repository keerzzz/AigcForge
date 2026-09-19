import { describe, expect, test } from "bun:test"
import { directoryPickerKind, validateDirectorySelection } from "./directory-picker-policy"

const local = {
  type: "sidecar",
  variant: "base",
  http: { url: "http://localhost:4096" },
} as const
const remote = {
  type: "ssh",
  host: "example.test",
  http: { url: "http://localhost:4096" },
} as const

describe("directoryPickerKind", () => {
  test("uses the native picker only for local desktop projects", () => {
    expect(directoryPickerKind("desktop", local)).toBe("native")
    expect(directoryPickerKind("desktop", remote)).toBe("server")
    expect(directoryPickerKind("web", local)).toBe("server")
  })
})

describe("validateDirectorySelection", () => {
  test("rejects an unreadable native picker result before selection reaches the caller", async () => {
    const rejected = "/missing"
    await expect(
      validateDirectorySelection(rejected, async (directory) => {
        if (directory === rejected) throw new Error("not found")
      }),
    ).rejects.toThrow("not found")
  })

  test("validates every directory in a multiple native selection", async () => {
    const checked: string[] = []
    const result = await validateDirectorySelection(["/one", "/two"], async (directory) => {
      checked.push(directory)
    })
    expect(result).toEqual(["/one", "/two"])
    expect(checked).toEqual(["/one", "/two"])
  })
})
