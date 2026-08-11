import { describe, expect, test } from "bun:test"
import {
  checkPrimaryAgent,
  checkCommandAllowed,
  resolvePrimaryAgent,
  META,
  CHAT_ORCHESTRATOR,
  WORK_ORCHESTRATOR,
} from "../src/product-mode-agent-policy"


describe("resolvePrimaryAgent", () => {
  test("defaults every mode to meta (2026-08-11 decision)", () => {
    expect(resolvePrimaryAgent("chat")).toBe(META)
    expect(resolvePrimaryAgent("work")).toBe(META)
    expect(resolvePrimaryAgent("coding")).toBe(META)
    expect(resolvePrimaryAgent("assistant")).toBe(META)
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
