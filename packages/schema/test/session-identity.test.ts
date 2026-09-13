import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { SessionIdentity } from "../src/session-identity"
import { WorkflowAsset } from "../src/workflow-asset"

const hex64 = "a1".repeat(32)
// Brand the fixtures through the real schemas: `toEqual` checks the expected side
// against the decoded type, so plain strings would not typecheck there.
const revision = Schema.decodeSync(WorkflowAsset.Revision)(hex64)
const reasonPending = Schema.decodeSync(SessionIdentity.ReasonCode)("work-preset-revision-pending")

const common = {
  sessionID: "ses_identity_projection",
  mode: "work",
  location: { directory: "/tmp/aigcfroge-identity" },
  projectID: "proj_identity",
  agent: "build",
  model: { providerID: "aigcfroge", modelID: "test-model" },
  permission: { declaredTier: "propose", effect: "ask" },
  capability: { health: "ready", reasons: [] },
}

describe("SessionIdentity.Identity", () => {
  test("decodes a full work identity with a workflow-sourced contract revision", () => {
    const identity = Schema.decodeUnknownSync(SessionIdentity.Identity)({
      ...common,
      detail: {
        status: "ready",
        detail: {
          source: "work",
          contract: { source: "workflow", revision: hex64 },
          artifact: { status: "missing" },
        },
      },
    })
    expect(identity.mode).toBe("work")
    if (identity.detail.status === "ready" && identity.detail.detail.source === "work") {
      expect(identity.detail.detail.contract).toEqual({ source: "workflow", revision })
    } else {
      throw new Error("expected a ready work detail")
    }
  })

  test("decodes a preset-sourced contract whose revision is unsupported pending S9A", () => {
    const identity = Schema.decodeUnknownSync(SessionIdentity.Identity)({
      ...common,
      capability: {
        health: "degraded",
        reasons: [{ code: "work-preset-revision-pending", severity: "warning" }],
      },
      detail: {
        status: "ready",
        detail: {
          source: "work",
          contract: { source: "preset", revision: { status: "unsupported", reason: "work-preset-revision-pending" } },
          artifact: { status: "ready", value: hex64 },
        },
      },
    })
    if (identity.detail.status === "ready" && identity.detail.detail.source === "work") {
      expect(identity.detail.detail.contract).toEqual({
        source: "preset",
        revision: { status: "unsupported", reason: reasonPending },
      })
    } else {
      throw new Error("expected a ready work detail")
    }
  })

  test("decodes a preset-sourced contract whose revision is ready (S9A forward compatibility)", () => {
    const identity = Schema.decodeUnknownSync(SessionIdentity.Identity)({
      ...common,
      detail: {
        status: "ready",
        detail: {
          source: "work",
          contract: { source: "preset", revision: { status: "ready", revision: hex64 } },
          artifact: { status: "missing" },
        },
      },
    })
    if (identity.detail.status === "ready" && identity.detail.detail.source === "work") {
      expect(identity.detail.detail.contract).toEqual({ source: "preset", revision: { status: "ready", revision } })
    } else {
      throw new Error("expected a ready work detail")
    }
  })

  test("decodes an ad-hoc work contract without a revision", () => {
    const identity = Schema.decodeUnknownSync(SessionIdentity.Identity)({
      ...common,
      detail: {
        status: "ready",
        detail: { source: "work", contract: { source: "ad-hoc" }, artifact: { status: "missing" } },
      },
    })
    if (identity.detail.status === "ready" && identity.detail.detail.source === "work") {
      expect(identity.detail.detail.contract).toEqual({ source: "ad-hoc" })
    } else {
      throw new Error("expected a ready work detail")
    }
  })

  test("rejects a work contract revision that is not a 64-hex digest", () => {
    expect(() =>
      Schema.decodeUnknownSync(SessionIdentity.Identity)({
        ...common,
        detail: {
          status: "ready",
          detail: {
            source: "work",
            contract: { source: "workflow", revision: "not-a-digest" },
            artifact: { status: "missing" },
          },
        },
      }),
    ).toThrow()
  })

  test("decodes a historical session whose mode detail is missing as typed missing, not fake ready", () => {
    const identity = Schema.decodeUnknownSync(SessionIdentity.Identity)({
      ...common,
      capability: {
        health: "degraded",
        reasons: [{ code: "mode-detail-not-projected", severity: "info" }],
      },
      detail: { status: "missing", reason: "mode-detail-not-projected" },
    })
    expect(identity.detail.status).toBe("missing")
    expect(identity.capability.health).toBe("degraded")
  })

  test("rejects a mode detail whose source does not match the identity mode", () => {
    expect(() =>
      Schema.decodeUnknownSync(SessionIdentity.Identity)({
        ...common,
        mode: "work",
        detail: { status: "ready", detail: { source: "chat", assetCounts: [{ kind: "prompt", count: 1 }] } },
      }),
    ).toThrow()
  })

  test("decodes all five mode details", () => {
    const samples = [
      {
        mode: "coding",
        detail: {
          status: "ready",
          detail: {
            source: "coding",
            vcs: {
              branch: { status: "ready", value: "main" },
              worktree: { status: "ready", value: "/tmp/aigcfroge-identity" },
            },
          },
        },
      },
      {
        mode: "chat",
        detail: {
          status: "ready",
          detail: {
            source: "chat",
            assetCounts: [
              { kind: "prompt", count: 3 },
              { kind: "workflow", count: 0 },
            ],
          },
        },
      },
      {
        mode: "assistant",
        capability: {
          health: "degraded",
          reasons: [
            { code: "assistant-memory-m2-pending", severity: "info" },
            { code: "assistant-kb-m2-pending", severity: "info" },
          ],
        },
        detail: {
          status: "ready",
          detail: {
            source: "assistant",
            scope: { kind: "project", projectID: "proj_identity" },
            reminders: { health: "ready", reasons: [] },
            memory: { health: "degraded", reasons: [{ code: "assistant-memory-m2-pending", severity: "info" }] },
            knowledge: { health: "degraded", reasons: [{ code: "assistant-kb-m2-pending", severity: "info" }] },
          },
        },
      },
      {
        mode: "custom",
        detail: {
          status: "ready",
          detail: { source: "custom", snapshot: { digest: hex64 }, policy: { health: "ready", reasons: [] } },
        },
      },
      {
        mode: "coding",
        detail: {
          status: "ready",
          detail: {
            source: "coding",
            vcs: { branch: { status: "missing" }, worktree: { status: "missing" } },
          },
        },
      },
    ]
    for (const sample of samples) {
      const identity = Schema.decodeUnknownSync(SessionIdentity.Identity)({ ...common, ...sample })
      expect(identity.detail.status).toBe("ready")
    }
  })

  test("assistant personal scope decodes without a project", () => {
    const identity = Schema.decodeUnknownSync(SessionIdentity.Identity)({
      ...common,
      mode: "assistant",
      capability: {
        health: "degraded",
        reasons: [
          { code: "assistant-memory-m2-pending", severity: "info" },
          { code: "assistant-kb-m2-pending", severity: "info" },
        ],
      },
      detail: {
        status: "ready",
        detail: {
          source: "assistant",
          scope: { kind: "personal" },
          reminders: { health: "ready", reasons: [] },
          memory: { health: "degraded", reasons: [{ code: "assistant-memory-m2-pending", severity: "info" }] },
          knowledge: { health: "degraded", reasons: [{ code: "assistant-kb-m2-pending", severity: "info" }] },
        },
      },
    })
    if (identity.detail.status === "ready" && identity.detail.detail.source === "assistant") {
      expect(identity.detail.detail.scope).toEqual({ kind: "personal" })
      expect(identity.capability.health).toBe("degraded")
    } else {
      throw new Error("expected a ready assistant detail")
    }
  })

  test("custom projection carries the snapshot digest only — instruction-like fields are dropped by round-trip", () => {
    const input = {
      ...common,
      mode: "custom",
      detail: {
        status: "ready",
        detail: {
          source: "custom",
          snapshot: { digest: hex64, instruction: "secret prompt body" },
          policy: { health: "ready", reasons: [] },
        },
      },
    }
    const decoded = Schema.decodeUnknownSync(SessionIdentity.Identity)(input)
    const encoded = Schema.encodeUnknownSync(SessionIdentity.Identity)(decoded)
    if (encoded.detail.status === "ready" && encoded.detail.detail.source === "custom") {
      expect(encoded.detail.detail.snapshot).toEqual({ digest: hex64 })
      expect(JSON.stringify(encoded)).not.toContain("secret prompt body")
    } else {
      throw new Error("expected a ready custom detail")
    }
  })

  test("reason codes reject localized text and accept stable kebab codes", () => {
    expect(() => Schema.decodeUnknownSync(SessionIdentity.Reason)({ code: "权限不足", severity: "warning" })).toThrow()
    expect(() => Schema.decodeUnknownSync(SessionIdentity.Reason)({ code: "Not Kebab", severity: "warning" })).toThrow()
    const reason = Schema.decodeUnknownSync(SessionIdentity.Reason)({
      code: "custom-mode-disabled",
      severity: "warning",
    })
    expect(reason.code).toBe(SessionIdentity.ReasonCodes.customModeDisabled)
    for (const value of Object.values(SessionIdentity.ReasonCodes)) {
      expect(Schema.decodeSync(SessionIdentity.ReasonCode)(value)).toBe(value)
    }
  })

  test("old consumers ignore unknown fields — the round-trip drops them", () => {
    const input = {
      ...common,
      futureField: "something-new",
      capability: {
        health: "degraded",
        reasons: [{ code: "mode-detail-not-projected", severity: "info" }],
      },
      detail: { status: "missing", reason: "mode-detail-not-projected" },
    }
    const decoded = Schema.decodeUnknownSync(SessionIdentity.Identity)(input)
    const encoded = Schema.encodeUnknownSync(SessionIdentity.Identity)(decoded)
    expect(encoded).not.toHaveProperty("futureField")
  })

  test("rejects a ready capability over a missing mode detail (aggregation rule)", () => {
    expect(() =>
      Schema.decodeUnknownSync(SessionIdentity.Identity)({
        ...common,
        detail: { status: "missing", reason: "mode-detail-not-projected" },
      }),
    ).toThrow()
  })

  test("rejects a ready capability over an unsupported preset contract revision", () => {
    expect(() =>
      Schema.decodeUnknownSync(SessionIdentity.Identity)({
        ...common,
        detail: {
          status: "ready",
          detail: {
            source: "work",
            contract: { source: "preset", revision: { status: "unsupported", reason: "work-preset-revision-pending" } },
            artifact: { status: "missing" },
          },
        },
      }),
    ).toThrow()
  })

  test("rejects ready and unfoldable capabilities over degraded assistant memory", () => {
    const detail = {
      status: "ready",
      detail: {
        source: "assistant",
        scope: { kind: "personal" },
        reminders: { health: "ready", reasons: [] },
        memory: { health: "degraded", reasons: [{ code: "assistant-memory-m2-pending", severity: "info" }] },
        knowledge: { health: "ready", reasons: [] },
      },
    }
    expect(() => Schema.decodeUnknownSync(SessionIdentity.Identity)({ ...common, mode: "assistant", detail })).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(SessionIdentity.Identity)({
        ...common,
        mode: "assistant",
        capability: { health: "degraded", reasons: [{ code: "assistant-kb-m2-pending", severity: "info" }] },
        detail,
      }),
    ).toThrow()
  })

  test("requires a blocked floor when a contributing capability is blocked", () => {
    const detail = {
      status: "ready",
      detail: {
        source: "assistant",
        scope: { kind: "personal" },
        reminders: { health: "blocked", reasons: [{ code: "assistant-reminders-unavailable", severity: "critical" }] },
        memory: { health: "ready", reasons: [] },
        knowledge: { health: "ready", reasons: [] },
      },
    }
    expect(() =>
      Schema.decodeUnknownSync(SessionIdentity.Identity)({
        ...common,
        mode: "assistant",
        capability: {
          health: "degraded",
          reasons: [{ code: "assistant-reminders-unavailable", severity: "critical" }],
        },
        detail,
      }),
    ).toThrow()
    const identity = Schema.decodeUnknownSync(SessionIdentity.Identity)({
      ...common,
      mode: "assistant",
      capability: { health: "blocked", reasons: [{ code: "assistant-reminders-unavailable", severity: "critical" }] },
      detail,
    })
    expect(identity.capability.health).toBe("blocked")
  })

  test("allows a policy-blocked capability without any non-ready contributor (one-directional rule)", () => {
    const identity = Schema.decodeUnknownSync(SessionIdentity.Identity)({
      ...common,
      mode: "custom",
      capability: { health: "blocked", reasons: [{ code: "custom-mode-disabled", severity: "warning" }] },
      detail: {
        status: "ready",
        detail: { source: "custom", snapshot: { digest: hex64 }, policy: { health: "ready", reasons: [] } },
      },
    })
    expect(identity.capability.health).toBe("blocked")
  })

  test("keeps a coding session ready when VCS datums are missing — identity facts do not degrade", () => {
    const identity = Schema.decodeUnknownSync(SessionIdentity.Identity)({
      ...common,
      mode: "coding",
      detail: {
        status: "ready",
        detail: { source: "coding", vcs: { branch: { status: "missing" }, worktree: { status: "missing" } } },
      },
    })
    expect(identity.capability.health).toBe("ready")
  })
})
