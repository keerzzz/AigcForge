import { describe, expect, test } from "bun:test"
import { isChatGPTUsageLimit } from "./usage-exceeded-dialogs"

describe("ChatGPT usage limit", () => {
  const message =
    "ChatGPT usage limit reached. Try again after your allowance resets; check ChatGPT Settings → Usage for details."

  test.each([
    [{ type: "provider.rate-limit", message, status: 429 }, true],
    [{ type: "provider.unknown", message }, true],
    [{ type: "provider.rate-limit", message: "Rate limit exceeded", status: 429 }, false],
    [{ type: "provider.rate-limit", message: "ChatGPT usage limit reached" }, false],
  ] as const)("matches %o: %p", (failure, expected) => {
    expect(isChatGPTUsageLimit(failure)).toBe(expected)
  })
})
