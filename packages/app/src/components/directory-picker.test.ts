import { readFileSync } from "node:fs"
import { resolve } from "node:path"
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

// Plan §11.1 / manifest `project-invalid-path`: the registration boundary must
// never accept a directory the server cannot read. `validateDirectorySelection`
// already covered the native picker; this contract pins that the server-backed
// dialog path (the one that actually registers most projects) funnels through
// the same validation before `onSelect` forwards the result. Asserted at the
// wiring level because this package has no Solid DOM harness.
describe("server-backed picker validation", () => {
  test("the non-native picker path validates the selection before forwarding it", () => {
    const source = readFileSync(resolve(__dirname, "directory-picker.tsx"), "utf-8")
    const serverBranch = source.slice(source.indexOf("let selected = false"))
    expect(serverBranch).toContain("validateDirectorySelection")
    expect(serverBranch).toContain("input.onSelect(validated)")
  })

  test("the validated result is what reaches onSelect, never the raw picker value", () => {
    const source = readFileSync(resolve(__dirname, "directory-picker.tsx"), "utf-8")
    expect(source).not.toContain("input.onSelect(result)")
  })
})
