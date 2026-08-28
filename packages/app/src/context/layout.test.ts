import { describe, expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { base64Encode } from "@aigcfroge/core/util/encode"
import { ServerConnection } from "./server"
import { createSessionKeyReader, currentRoute, ensureSessionKey, pruneSessionKeys } from "./layout-helpers"

describe("layout session-key helpers", () => {
  test("couples touch and scroll seed in order", () => {
    const calls: string[] = []
    const result = ensureSessionKey(
      "dir/a",
      (key) => calls.push(`touch:${key}`),
      (key) => calls.push(`seed:${key}`),
    )

    expect(result).toBe("dir/a")
    expect(calls).toEqual(["touch:dir/a", "seed:dir/a"])
  })

  test("reads dynamic accessor keys lazily", () => {
    const seen: string[] = []

    createRoot((dispose) => {
      const [key, setKey] = createSignal("dir/one")
      const read = createSessionKeyReader(key, (value) => seen.push(value))

      expect(read()).toBe("dir/one")
      setKey("dir/two")
      expect(read()).toBe("dir/two")

      dispose()
    })

    expect(seen).toEqual(["dir/one", "dir/two"])
  })
})

describe("pruneSessionKeys", () => {
  test("keeps active key and drops lowest-used keys", () => {
    const drop = pruneSessionKeys({
      keep: "k4",
      max: 3,
      used: new Map([
        ["k1", 1],
        ["k2", 2],
        ["k3", 3],
        ["k4", 4],
      ]),
      view: ["k1", "k2", "k4"],
      tabs: ["k1", "k3", "k4"],
    })

    expect(drop).toEqual(["k1"])
    expect(drop.includes("k4")).toBe(false)
  })

  test("does not prune without keep key", () => {
    const drop = pruneSessionKeys({
      keep: undefined,
      max: 1,
      used: new Map([
        ["k1", 1],
        ["k2", 2],
      ]),
      view: ["k1"],
      tabs: ["k2"],
    })

    expect(drop).toEqual([])
  })
})

/**
 * `home` is the titlebar's pressed state and the branch `tabs.toggleHome` reads
 * to choose between restoring a recent tab and navigating to `/`. Anything that
 * reports `home` while the user is elsewhere leaves the button lit on a route it
 * refuses to leave, so the boundary between `home` and `other` is behaviour, not
 * bookkeeping.
 */
describe("currentRoute", () => {
  const dir = base64Encode("/home/luke/repos/amazon")

  test("classifies only the root path as home", () => {
    expect(currentRoute("/", "")).toEqual({ type: "home" })
    expect(currentRoute("", "")).toEqual({ type: "home" })
  })

  test("does not classify mode routes as home", () => {
    // ADR-16 §4 keeps `/mode/:mode` authoritative and separate from `/`. Before
    // ADR-16 `/` redirected here, so reporting these as home was once correct.
    for (const mode of ["chat", "coding", "work", "assistant", "custom"]) {
      expect(currentRoute(`/mode/${mode}`, "")).toEqual({ type: "other" })
    }
  })

  test("classifies a draft route only when it carries a draftId", () => {
    expect(currentRoute("/new-session", "?draftId=drf_1")).toEqual({ type: "draft", draftID: "drf_1" })
    expect(currentRoute("/new-session", "")).toEqual({ type: "other" })
  })

  test("classifies canonical and directory session routes", () => {
    expect(currentRoute(`/server/${base64Encode("https://debian.example")}/session/ses_1`, "")).toEqual({
      type: "session",
      sessionId: "ses_1",
      server: ServerConnection.Key.make("https://debian.example"),
    })
    expect(currentRoute(`/${dir}/session/ses_2`, "")).toEqual({ type: "session", sessionId: "ses_2" })
    expect(currentRoute(`/${dir}/session`, "")).toEqual({
      type: "dir-new-sesssion",
      dir: "/home/luke/repos/amazon",
      dirBase64: dir,
    })
  })

  test("classifies unrecognized paths as other, not home", () => {
    expect(currentRoute(`/${dir}/review`, "")).toEqual({ type: "other" })
    expect(currentRoute("/nope/at/all", "")).toEqual({ type: "other" })
  })
})
