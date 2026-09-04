export * as DecodeDiagnostic from "./decode-diagnostic"

import { Cause } from "effect"

/**
 * Renders a Schema decode failure for a log line WITHOUT echoing the value that
 * failed to decode.
 *
 * `Cause.pretty` embeds the offending input. For a leaf type mismatch that is
 * `Expected string, got {…}`, and for a union discriminator miss it dumps the
 * WHOLE candidate — which for a file part is the base64 data URL, i.e. the file's
 * bytes. Prompt text, file bodies and base64 must never reach a log line, so this
 * keeps only the expectation and the JSON path.
 *
 * The filter is an allow-list on purpose: a line whose shape is not recognised is
 * dropped and counted rather than passed through, because an unrecognised line is
 * exactly where a value would hide. Losing detail from a diagnostic is acceptable;
 * leaking a user's file into the log is not.
 */
const EXPECTED = /^(\s*)(?:(\S+):\s*)?Expected\s+(.+?),\s+got\s/
const MISSING = /^\s*(?:\S+:\s*)?Missing key\s*$/
const PATH = /^\s*at\s+\[[^\]]*\]\s*$/

export const redactedLines = (pretty: string) => {
  const kept: string[] = []
  let dropped = 0
  for (const line of pretty.split("\n")) {
    if (line.trim() === "") continue
    const expected = EXPECTED.exec(line)
    if (expected) {
      const prefix = expected[2] === undefined ? "" : `${expected[2]}: `
      kept.push(`${expected[1]}${prefix}Expected ${expected[3]}, got <redacted>`)
      continue
    }
    if (MISSING.test(line) || PATH.test(line)) {
      kept.push(line)
      continue
    }
    dropped++
  }
  if (dropped > 0) kept.push(`<${dropped} line(s) withheld: unrecognised shape may contain input>`)
  return kept
}

/** `Cause.pretty`, with every decoded value replaced by `<redacted>`. */
export const describe = (cause: Cause.Cause<unknown>) => redactedLines(Cause.pretty(cause)).join("\n")
