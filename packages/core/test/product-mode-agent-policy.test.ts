import { describe, expect, test } from "bun:test"
import {
  checkPrimaryAgent,
  checkCommandAllowed,
  resolvePrimaryAgent,
  CHAT_ORCHESTRATOR,
  WORK_ORCHESTRATOR,
} from "../src/product-mode-agent-policy"


describe("resolvePrimaryAgent", () => {
  test("defaults chat mode to chat-orchestrator", () => {
    expect(resolvePrimaryAgent("chat")).toBe(CHAT_ORCHESTRATOR)
  })

  test("defaults work mode to work-orchestrator", () => {
    expect(resolvePrimaryAgent("work")).toBe(WORK_ORCHESTRATOR)
  })

  test("preserves an explicit agent for policy validation", () => {
    expect(resolvePrimaryAgent("chat", "build")).toBe("build")
  })
})

describe("checkPrimaryAgent", () => {
  test("allows chat-orchestrator in chat mode", () => {
    const r = checkPrimaryAgent("chat", CHAT_ORCHESTRATOR)
    expect(r.allowed).toBe(true)
  })

  test("rejects an implicit default agent in chat mode", () => {
    const r = checkPrimaryAgent("chat", undefined)
    expect(r.allowed).toBe(false)
    if (!r.allowed && r.error._tag === "AgentNotAllowedError") expect(r.error.agent).toBeUndefined()
  })

  test("rejects build agent in chat mode", () => {
    const r = checkPrimaryAgent("chat", "build")
    expect(r.allowed).toBe(false)
    if (!r.allowed) expect(r.error._tag).toBe("AgentNotAllowedError")
  })

  test("rejects meta agent in chat mode", () => {
    const r = checkPrimaryAgent("chat", "meta")
    expect(r.allowed).toBe(false)
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

  test("allows work-orchestrator in work mode", () => {
    const r = checkPrimaryAgent("work", WORK_ORCHESTRATOR)
    expect(r.allowed).toBe(true)
  })

  test("rejects implicit default agent in work mode", () => {
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
