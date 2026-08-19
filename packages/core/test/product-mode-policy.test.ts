import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { ProductModePolicy } from "@aigcfroge/core/product-mode-policy"
import { ProductModeAgentPolicy } from "@aigcfroge/core/product-mode-agent-policy"

describe("ProductModePolicy & AgentPolicy Governance", () => {
  test("assertCreationSupported fails closed for custom mode without snapshot", async () => {
    const res = await Effect.runPromise(
      ProductModePolicy.assertCreationSupported("custom").pipe(
        Effect.map(() => "success"),
        Effect.catchTag("UnsupportedProductModeError", (err) => Effect.succeed(`error:${err.mode}`)),
      ),
    )
    expect(res).toBe("error:custom")

    const chatRes = await Effect.runPromise(
      ProductModePolicy.assertCreationSupported("chat").pipe(
        Effect.map(() => "success"),
      ),
    )
    expect(chatRes).toBe("success")
    const runtimeRes = await Effect.runPromise(
      ProductModePolicy.assertRuntimeSupported("custom").pipe(
        Effect.map(() => "success"),
        Effect.catchTag("UnsupportedProductModeError", (err) => Effect.succeed(`error:${err.mode}`)),
      ),
    )
    expect(runtimeRes).toBe("error:custom")
  })

  test("ProductModeAgentPolicy fails closed for custom mode across primary, command, and CLI delegation", () => {
    const primaryCheck = ProductModeAgentPolicy.checkPrimaryAgent("custom", "coder")
    expect(primaryCheck.allowed).toBe(false)
    if (!primaryCheck.allowed) {
      expect(primaryCheck.error._tag).toBe("AgentNotAllowedError")
    }

    const commandCheck = ProductModeAgentPolicy.checkCommandAllowed("custom")
    expect(commandCheck.allowed).toBe(false)
    if (!commandCheck.allowed) {
      expect(commandCheck.error._tag).toBe("CommandDeniedError")
    }

    const cliCheck = ProductModeAgentPolicy.checkCliDelegationAllowed("custom")
    expect(cliCheck.allowed).toBe(false)
    if (!cliCheck.allowed) {
      expect(cliCheck.error._tag).toBe("CommandDeniedError")
    }
  })

  test("capable client filtering isolates custom sessions from non-capable clients", () => {
    const sessions = [
      { id: "s1", mode: "chat" },
      { id: "s2", mode: "custom" },
      { id: "s3", mode: "coding" },
    ]

    // Without capability header
    const filtered = ProductModePolicy.filterSupportedSessions(sessions, undefined)
    expect(filtered.map((s) => s.id)).toEqual(["s1", "s3"])

    // With capability header
    const capable = ProductModePolicy.filterSupportedSessions(sessions, ProductModePolicy.CAPABILITY_CUSTOM_V1)
    expect(capable.map((s) => s.id)).toEqual(["s1", "s2", "s3"])
  })

  test("isSessionSupported correctly identifies custom mode eligibility", () => {
    expect(ProductModePolicy.isSessionSupported({ mode: "custom" }, undefined)).toBe(false)
    expect(ProductModePolicy.isSessionSupported({ mode: "custom" }, ProductModePolicy.CAPABILITY_CUSTOM_V1)).toBe(true)
    expect(ProductModePolicy.isSessionSupported({ mode: "chat" }, undefined)).toBe(true)
  })

  test("isEventPayloadSupported filters custom mode SSE events", () => {
    const chatEvent = { session: { mode: "chat" } }
    const customEvent = { session: { mode: "custom" } }
    const customPropEvent = { mode: "custom" }

    expect(ProductModePolicy.isEventPayloadSupported(chatEvent, undefined)).toBe(true)
    expect(ProductModePolicy.isEventPayloadSupported(customEvent, undefined)).toBe(false)
    expect(ProductModePolicy.isEventPayloadSupported(customEvent, ProductModePolicy.CAPABILITY_CUSTOM_V1)).toBe(true)
    expect(ProductModePolicy.isEventPayloadSupported(customPropEvent, undefined)).toBe(false)
    expect(ProductModePolicy.isEventPayloadSupported(customPropEvent, ProductModePolicy.CAPABILITY_CUSTOM_V1)).toBe(true)
    expect(ProductModePolicy.isEventPayloadSupported({ sessionID: "ses_custom" }, undefined)).toBe(false)
    expect(ProductModePolicy.isCustomCapable("mode/custom")).toBe(false)
    expect(ProductModePolicy.isCustomCapable("custom-mode")).toBe(false)
    expect(
      ProductModePolicy.isEventPayloadSupported({ sessionID: "ses_chat" }, undefined, (sessionID) =>
        sessionID === "ses_chat" ? "chat" : undefined,
      ),
    ).toBe(true)
  })
})
