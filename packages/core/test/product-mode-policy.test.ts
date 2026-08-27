import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { ProductModePolicy } from "@aigcfroge/core/product-mode-policy"
import { ProductModeAgentPolicy } from "@aigcfroge/core/product-mode-agent-policy"
import { withCustomModeFlag } from "./lib/product-mode"

describe("ProductModePolicy & AgentPolicy Governance", () => {
  test("assertCreationSupported fails closed for custom mode without snapshot", async () => {
    // Scoped rather than assigned: this used to set the flag and never restore
    // it, so every later file in the same bun process ran its custom-mode
    // fail-closed assertions against an enabled switch.
    await withCustomModeFlag("true", async () => {
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
      expect(runtimeRes).toBe("success")
    })
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

/**
 * The rollout gate (M3 Phase G §7.2): custom mode ships off, and turning it on
 * is a deliberate act.
 *
 * Nothing asserted this before. Every other custom-mode test in the repo either
 * sets the flag on or inherits it, so the shipped default — the state a user who
 * has not opted in actually runs — was the one configuration with no coverage.
 * `truthy()` is an allow-list (`"true"` / `"1"` only), which is what makes every
 * other value fail closed; a change to a deny-list would flip that silently and
 * is invisible to a test that only ever sets `"true"`.
 */
describe("custom mode kill switch default (M3 Phase G §7.2)", () => {
  const runtimeVerdict = (mode: string) =>
    Effect.runPromise(
      ProductModePolicy.assertRuntimeSupported(mode).pipe(
        Effect.map(() => "allowed" as const),
        Effect.catchTag("UnsupportedProductModeError", (error) => Effect.succeed(`denied:${error.message}`)),
      ),
    )

  test("is off when the environment says nothing, so custom runtime is denied with the opt-in message", async () => {
    await withCustomModeFlag(undefined, async () => {
      expect(ProductModePolicy.isCustomModeEnabled()).toBe(false)
      expect(await runtimeVerdict("custom")).toBe(`denied:${ProductModePolicy.CUSTOM_MODE_DISABLED_MESSAGE}`)
    })
  })

  test("treats every value outside the allow-list as off", async () => {
    for (const value of ["false", "0", "", "yes", "TRUE ", "enabled"]) {
      await withCustomModeFlag(value, () => {
        expect(ProductModePolicy.isCustomModeEnabled()).toBe(false)
      })
    }
  })

  test("turns on for the documented opt-in values and nothing else", async () => {
    // The positive control. Without it, a guard that returned `false`
    // unconditionally would satisfy every assertion above and silently make
    // custom mode unreachable rather than default-off.
    for (const value of ["true", "TRUE", "True", "1"]) {
      await withCustomModeFlag(value, async () => {
        expect(ProductModePolicy.isCustomModeEnabled()).toBe(true)
        expect(await runtimeVerdict("custom")).toBe("allowed")
      })
    }
  })

  test("leaves the always-on modes untouched by the switch", async () => {
    // The switch must gate custom only; a rollback that also disabled the
    // shipped modes would be an outage, not a rollback.
    await withCustomModeFlag(undefined, async () => {
      for (const mode of ["chat", "coding", "work", "assistant"]) {
        expect(await runtimeVerdict(mode)).toBe("allowed")
      }
    })
  })

  test("restores the ambient flag even when the body throws", async () => {
    // The helper is what makes the assertions above order-independent, so its
    // finally-path is part of the guarantee, not an implementation detail.
    await withCustomModeFlag("true", async () => {
      const before = process.env["AIGCFROGE_CUSTOM_MODE"]
      await expect(
        withCustomModeFlag(undefined, () => {
          throw new Error("boom")
        }),
      ).rejects.toThrow("boom")
      expect(process.env["AIGCFROGE_CUSTOM_MODE"]).toBe(before)
    })
  })
})
