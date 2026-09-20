import { expect, test } from "bun:test"
import { Contracts } from "../real/contracts"

test("PTY submits a real newline, and neither raw nor CRLF input echo proves execution", () => {
  expect(Contracts.ptyCommand.endsWith("\n")).toBe(true)
  expect(Contracts.hasPtyOutput(Contracts.ptyCommand)).toBe(false)
  expect(Contracts.hasPtyOutput(Contracts.ptyCommand.replaceAll("\n", "\r\n"))).toBe(false)
})

test("PTY requires a complete output line, not a prompt, prefix, or partial output", () => {
  expect(Contracts.hasPtyOutput("\r\ns5-pty-ok\r\n")).toBe(true)
  expect(Contracts.hasPtyOutput("\ns5-pty-ok\n")).toBe(true)
  for (const text of ["", "s5-pty-", "s5-pty-ok", "$ s5-pty-ok\r\n", "\ns5-pty-ok-extra\n"]) {
    expect(Contracts.hasPtyOutput(text)).toBe(false)
  }
})

const expected = "x".repeat(2 * 1024 * 1024)

test("large-file assertion accepts the complete text fixture", () => {
  expect(() => Contracts.largeFile(200, { type: "text", content: expected }, expected)).not.toThrow()
})

for (const [name, body] of Object.entries({
  missing: {},
  null: null,
  array: [],
  number: { type: "text", content: 12 },
  noType: { content: expected },
  binary: { type: "binary", encoding: "base64", content: expected },
  encoded: { type: "text", encoding: "base64", content: expected },
  empty: { type: "text", content: "" },
  truncated: { type: "text", content: "x" },
  oversized: { type: "text", content: expected + "x" },
  corrupted: { type: "text", content: "y".repeat(expected.length) },
})) {
  test(`large-file assertion rejects HTTP 200 ${name}`, () => {
    expect(() => Contracts.largeFile(200, body, expected)).toThrow()
  })
}

for (const status of [204, 302, 400, 401, 404, 413, 500]) {
  test(`large-file fixture does not accept status ${status} as success`, () => {
    expect(() => Contracts.largeFile(status, {}, expected)).toThrow()
  })
}
