import { describe as group, expect, test } from "bun:test"
import { Cause, Exit, Schema } from "effect"
import { SessionV1 } from "@aigcfroge/core/v1/session"
import { DecodeDiagnostic } from "../../src/session/decode-diagnostic"

// P2-19: `createUserMessage` logs every part that fails to decode. It used to log
// the whole `part` object plus raw `Cause.pretty`, so a file attachment's base64
// data URL and any prompt text landed in the log. These cases pin the redaction —
// the failure detail a maintainer needs (what was expected, at which path) has to
// survive, and the value must not.

const decode = Schema.decodeUnknownExit(SessionV1.Part)
const BYTES = "data:image/png;base64,SUPERSECRETBYTES=="
const base = { id: "prt_1", messageID: "msg_1", sessionID: "ses_1" }

const diagnose = (value: unknown) => {
  const exit = decode(value, { errors: "all", propertyOrder: "original" })
  if (!Exit.isFailure(exit)) throw new Error("fixture was expected to fail decoding")
  return { raw: Cause.pretty(exit.cause), redacted: DecodeDiagnostic.describe(exit.cause) }
}

group("DecodeDiagnostic.describe", () => {
  test("withholds the whole candidate when the part type is not a known variant", () => {
    // The union has no arm for `type: "bogus"`, so `Cause.pretty` falls back to
    // dumping the candidate — which is where the data URL is.
    const { raw, redacted } = diagnose({ ...base, type: "bogus", url: BYTES })

    expect(raw).toContain("SUPERSECRETBYTES")
    expect(redacted).not.toContain("SUPERSECRETBYTES")
    expect(redacted).not.toContain("base64")
    expect(redacted).toContain("<redacted>")
  })

  test("withholds a mistyped leaf value but keeps the expectation and path", () => {
    const { raw, redacted } = diagnose({ ...base, type: "text", text: { leaked: BYTES } })

    expect(raw).toContain("SUPERSECRETBYTES")
    expect(redacted).not.toContain("SUPERSECRETBYTES")
    expect(redacted).toContain("Expected string, got <redacted>")
    expect(redacted).toContain('at ["text"]')
  })

  test("keeps a missing-key failure verbatim: it names a field, not a value", () => {
    const { redacted } = diagnose({ ...base, type: "file", url: BYTES })

    expect(redacted).toContain("Missing key")
    expect(redacted).toContain('at ["mime"]')
    expect(redacted).not.toContain("SUPERSECRETBYTES")
  })

  test("drops and counts a line it cannot classify instead of passing it through", () => {
    // Fail-closed: an unrecognised line is exactly where a value would hide, so it
    // is withheld rather than forwarded.
    const lines = DecodeDiagnostic.redactedLines(
      ['Expected string, got "x"', '  at ["text"]', "some unknown formatter output with " + BYTES].join("\n"),
    )

    expect(lines.join("\n")).not.toContain("SUPERSECRETBYTES")
    expect(lines.at(-1)).toContain("1 line(s) withheld")
  })

  test("returns nothing but the withheld marker when no line is recognised", () => {
    const lines = DecodeDiagnostic.redactedLines(BYTES)
    expect(lines).toEqual(["<1 line(s) withheld: unrecognised shape may contain input>"])
  })
})
