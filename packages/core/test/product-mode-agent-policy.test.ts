import { describe, expect, test } from "bun:test"
import {
  checkPrimaryAgent,
  checkCommandAllowed,
  checkCliDelegationAllowed,
  resolvePrimaryAgent,
  META,
  CHAT_ORCHESTRATOR,
  WORK_ORCHESTRATOR,
  ASSISTANT_ORCHESTRATOR,
} from "../src/product-mode-agent-policy"

describe("resolvePrimaryAgent", () => {
  test("defaults chat/work/coding to meta; assistant to assistant-orchestrator (2026-08-11 + plan §3.3)", () => {
    expect(resolvePrimaryAgent("chat")).toBe(META)
    expect(resolvePrimaryAgent("work")).toBe(META)
    expect(resolvePrimaryAgent("coding")).toBe(META)
    expect(resolvePrimaryAgent("assistant")).toBe(ASSISTANT_ORCHESTRATOR)
  })

  test("preserves an explicit agent for policy validation", () => {
    expect(resolvePrimaryAgent("chat", "build")).toBe("build")
  })
})

describe("checkPrimaryAgent", () => {
  test("allows meta in chat mode (default primary)", () => {
    const r = checkPrimaryAgent("chat", META)
    expect(r.allowed).toBe(true)
  })

  test("allows chat-orchestrator in chat mode (delegation target)", () => {
    const r = checkPrimaryAgent("chat", CHAT_ORCHESTRATOR)
    expect(r.allowed).toBe(true)
  })

  test("allows meta in work mode (default primary)", () => {
    const r = checkPrimaryAgent("work", META)
    expect(r.allowed).toBe(true)
  })

  test("allows work-orchestrator in work mode (delegation target)", () => {
    const r = checkPrimaryAgent("work", WORK_ORCHESTRATOR)
    expect(r.allowed).toBe(true)
  })

  test("rejects an implicit undefined agent in chat mode", () => {
    const r = checkPrimaryAgent("chat", undefined)
    expect(r.allowed).toBe(false)
    if (!r.allowed && r.error._tag === "AgentNotAllowedError") expect(r.error.agent).toBeUndefined()
  })

  test("rejects build agent in chat mode", () => {
    const r = checkPrimaryAgent("chat", "build")
    expect(r.allowed).toBe(false)
    if (!r.allowed) expect(r.error._tag).toBe("AgentNotAllowedError")
  })

  test("rejects chat-orchestrator in coding mode", () => {
    const r = checkPrimaryAgent("coding", CHAT_ORCHESTRATOR)
    expect(r.allowed).toBe(false)
    if (!r.allowed) expect(r.error._tag).toBe("AgentNotAllowedError")
  })

  test("rejects chat-orchestrator in work mode", () => {
    const r = checkPrimaryAgent("work", CHAT_ORCHESTRATOR)
    expect(r.allowed).toBe(false)
  })

  test("rejects chat-orchestrator in assistant mode", () => {
    const r = checkPrimaryAgent("assistant", CHAT_ORCHESTRATOR)
    expect(r.allowed).toBe(false)
  })

  test("allows meta in assistant mode (explicit choice)", () => {
    const r = checkPrimaryAgent("assistant", META)
    expect(r.allowed).toBe(true)
  })

  test("allows assistant-orchestrator in assistant mode (fail-closed primary, plan §3.3)", () => {
    const r = checkPrimaryAgent("assistant", ASSISTANT_ORCHESTRATOR)
    expect(r.allowed).toBe(true)
  })

  test("rejects assistant-orchestrator outside assistant mode", () => {
    const r = checkPrimaryAgent("coding", ASSISTANT_ORCHESTRATOR)
    expect(r.allowed).toBe(false)
    if (!r.allowed) expect(r.error._tag).toBe("AgentNotAllowedError")
  })

  test("rejects implicit undefined agent in work mode", () => {
    const r = checkPrimaryAgent("work", undefined)
    expect(r.allowed).toBe(false)
    if (!r.allowed) expect(r.error._tag).toBe("AgentNotAllowedError")
  })

  test("rejects build agent in work mode", () => {
    const r = checkPrimaryAgent("work", "build")
    expect(r.allowed).toBe(false)
    if (!r.allowed) expect(r.error._tag).toBe("AgentNotAllowedError")
  })

  test("rejects work-orchestrator in coding mode", () => {
    const r = checkPrimaryAgent("coding", WORK_ORCHESTRATOR)
    expect(r.allowed).toBe(false)
    if (!r.allowed) expect(r.error._tag).toBe("AgentNotAllowedError")
  })

  test("allows build in coding mode", () => {
    const r = checkPrimaryAgent("coding", "build")
    expect(r.allowed).toBe(true)
  })
})

describe("checkCommandAllowed", () => {
  test("denies command in chat mode", () => {
    const r = checkCommandAllowed("chat")
    expect(r.allowed).toBe(false)
    if (!r.allowed) expect(r.error._tag).toBe("CommandDeniedError")
  })

  test("denies command in work mode", () => {
    const r = checkCommandAllowed("work")
    expect(r.allowed).toBe(false)
    if (!r.allowed) expect(r.error._tag).toBe("CommandDeniedError")
  })

  test("allows command in coding mode", () => {
    const r = checkCommandAllowed("coding")
    expect(r.allowed).toBe(true)
  })
})

describe("checkCliDelegationAllowed", () => {
  test("denies external CLI delegation in chat mode", () => {
    const r = checkCliDelegationAllowed("chat", "full")
    expect(r.allowed).toBe(false)
    if (!r.allowed) {
      expect(r.error._tag).toBe("CommandDeniedError")
      expect(r.error.message).toContain("propose_")
    }
  })

  test("allows external CLI delegation in coding mode at every tier", () => {
    expect(checkCliDelegationAllowed("coding", "propose").allowed).toBe(true)
    expect(checkCliDelegationAllowed("coding", "full").allowed).toBe(true)
  })

  test("work and assistant modes allow external CLI only at full", () => {
    for (const mode of ["work", "assistant"] as const) {
      expect(checkCliDelegationAllowed(mode, "propose").allowed).toBe(false)
      expect(checkCliDelegationAllowed(mode, "full").allowed).toBe(true)
    }
  })

  test("chat denies external CLI at every tier", () => {
    expect(checkCliDelegationAllowed("chat", "propose").allowed).toBe(false)
    expect(checkCliDelegationAllowed("chat", "full").allowed).toBe(false)
  })

  test("unknown mode is fail-safe denied (plan §2.4)", () => {
    expect(checkCliDelegationAllowed("something-else", "full").allowed).toBe(false)
    expect(checkCliDelegationAllowed("something-else", "propose").allowed).toBe(false)
  })
})
