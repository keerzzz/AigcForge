import { describe, expect, test } from "bun:test"
import { checkPrimaryAgent, checkCommandAllowed, CHAT_ORCHESTRATOR } from "../src/product-mode-agent-policy"

describe("checkPrimaryAgent", () => {
  test("allows chat-orchestrator in chat mode", () => {
    const r = checkPrimaryAgent("chat", CHAT_ORCHESTRATOR)
    expect(r.allowed).toBe(true)
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

  test("allows command in coding mode", () => {
    const r = checkCommandAllowed("coding")
    expect(r.allowed).toBe(true)
  })

  test("allows command in work mode", () => {
    const r = checkCommandAllowed("work")
    expect(r.allowed).toBe(true)
  })
})
