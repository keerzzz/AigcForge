/** Protocol predicates shared by the real scenarios and their no-service regression tests. */
import { expect } from "@playwright/test"
import { isRecord, stringField } from "./manifest"

// The expected output is assembled by the shell; input echo never contains that line.
export const ptyCommand = "printf '\\ns5-%s-%s\\n' pty ok\n"

export function hasPtyOutput(text: string) {
  return text.replaceAll("\r\n", "\n").split("\n").slice(0, -1).includes("s5-pty-ok")
}

export function largeFile(status: number, body: unknown, expected: string) {
  // The existing file.content route declares no size-refusal contract. A seeded, readable
  // text file must succeed: neither an arbitrary 4xx nor a typed missing-file error is green.
  expect(status, "seeded large file is readable").toBe(200)
  // LegacyContent wire shape: groups/file.ts. Validate before inspecting any content.
  if (!isRecord(body)) throw new Error("large-file response schema: expected an object")
  expect(body.type === "text", "large-file response schema: type=text").toBe(true)
  expect(typeof body.content, "large-file response schema: content is a string").toBe("string")
  expect(body.encoding, "text fixture must not be base64 encoded").toBeUndefined()
  const content = stringField(body, "content", "large-file response")
  expect(content.length, "large file is complete and bounded by the fixture").toBe(expected.length)
  // Do not dump megabytes of file content into a failing report.
  expect(content === expected, "large file bytes match the seeded fixture").toBe(true)
}

export * as Contracts from "./contracts"
