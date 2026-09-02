import { describe, expect, test } from "bun:test"
import { customDraftKey } from "@/context/custom-draft-location"
import { ServerConnection } from "@/context/server"
import { ServerScope } from "@/utils/server-scope"

const local = ServerScope.local
const remote = ServerScope.fromServerKey(ServerConnection.Key.make("https://build.example"))

describe("customDraftKey", () => {
  test("separates the same directory on two different servers", () => {
    // The old key was the directory alone, so these two collapsed into one draft.
    expect(customDraftKey({ scope: local, directory: "/repo" })).not.toBe(
      customDraftKey({ scope: remote, directory: "/repo" }),
    )
  })

  test("separates two directories on the same server", () => {
    expect(customDraftKey({ scope: local, directory: "/a" })).not.toBe(
      customDraftKey({ scope: local, directory: "/b" })!,
    )
  })

  test("normalizes directory spellings that name the same path", () => {
    expect(customDraftKey({ scope: local, directory: "/repo/" })).toBe(
      customDraftKey({ scope: local, directory: "/repo" })!,
    )
    expect(customDraftKey({ scope: local, directory: "C:\\work" })).toBe(
      customDraftKey({ scope: local, directory: "C:/work" })!,
    )
  })

  test("refuses to key an unknown directory", () => {
    // All three mount sites pass `directory() ?? ""`. Returning a key here is what
    // let a not-yet-ready SDK pin the store under an empty Location forever.
    expect(customDraftKey({ scope: local, directory: "" })).toBeUndefined()
    expect(customDraftKey({ scope: local, directory: "///" })).toBe("local\u0000/")
  })

  test("is stable for the same Location", () => {
    expect(customDraftKey({ scope: local, directory: "/repo" })).toBe(
      customDraftKey({ scope: local, directory: "/repo" })!,
    )
  })
})
