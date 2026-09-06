import { describe, expect, test } from "bun:test"
import { resolveCommandOptions, upsertCommandRegistration } from "./command"

describe("upsertCommandRegistration", () => {
  test("replaces keyed registrations", () => {
    const one = () => [{ id: "one", title: "One" }]
    const two = () => [{ id: "two", title: "Two" }]

    const next = upsertCommandRegistration([{ key: "layout", options: one }], { key: "layout", options: two })

    expect(next).toHaveLength(1)
    expect(next[0]?.options).toBe(two)
  })

  test("keeps unkeyed registrations additive", () => {
    const one = () => [{ id: "one", title: "One" }]
    const two = () => [{ id: "two", title: "Two" }]

    const next = upsertCommandRegistration([{ options: one }], { options: two })

    expect(next).toHaveLength(2)
    expect(next[0]?.options).toBe(two)
    expect(next[1]?.options).toBe(one)
  })
})

describe("resolveCommandOptions", () => {
  const reg = (...options: Array<{ id: string; title: string; overrides?: boolean }>) => ({
    options: () => options,
  })

  test("the first registration for an id wins, which is the most recent one", () => {
    // `upsertCommandRegistration` prepends, so array order is recency. This is the mechanism
    // that lets a session narrow a global command by mounting later.
    const { options } = resolveCommandOptions([
      reg({ id: "tab.close", title: "close the file tab" }),
      reg({ id: "tab.close", title: "close the window tab" }),
    ])
    expect(options).toHaveLength(1)
    expect(options[0]?.title).toBe("close the file tab")
  })

  test("an undeclared collision is reported", () => {
    const { shadowed } = resolveCommandOptions([reg({ id: "dup", title: "a" }), reg({ id: "dup", title: "b" })])
    expect([...shadowed]).toEqual(["dup"])
  })

  test("a declared override is not reported", () => {
    // The whole point: an intentional narrowing must not look like two owners colliding, or the
    // warning trains people to ignore it.
    const { shadowed, options } = resolveCommandOptions([
      reg({ id: "tab.close", title: "file tab", overrides: true }),
      reg({ id: "tab.close", title: "window tab" }),
    ])
    expect([...shadowed]).toEqual([])
    expect(options[0]?.title).toBe("file tab")
  })

  test("declaring an override does not suppress a third, undeclared collision elsewhere", () => {
    const { shadowed } = resolveCommandOptions([
      reg({ id: "tab.close", title: "file tab", overrides: true }, { id: "other", title: "x" }),
      reg({ id: "tab.close", title: "window tab" }, { id: "other", title: "y" }),
    ])
    expect([...shadowed]).toEqual(["other"])
  })

  test("options keep their registration order across ids", () => {
    const { options } = resolveCommandOptions([reg({ id: "b", title: "B" }), reg({ id: "a", title: "A" })])
    expect(options.map((o) => o.id)).toEqual(["b", "a"])
  })
})
