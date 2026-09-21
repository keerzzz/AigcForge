import { describe, expect, test } from "bun:test"
import { withoutParams } from "./url-params"

// Regression guard for the S4 #4 finding: a cleanup built as `${search}${hash}`
// collapses to a bare `#hash` once the search empties, and the router resolves
// that against the origin root — sending the user to `/` instead of the session.
describe("url param cleanup", () => {
  test("keeps the path when only a hash remains", () => {
    expect(withoutParams({ pathname: "/server/k/session/s", search: "?insert=x", hash: "#anchor" }, ["insert"])).toBe(
      "/server/k/session/s#anchor",
    )
  })

  test("keeps unrelated params and their order", () => {
    expect(
      withoutParams({ pathname: "/p", search: "?insert=x&keep=1&insertKind=prompt", hash: "" }, [
        "insert",
        "insertKind",
      ]),
    ).toBe("/p?keep=1")
  })

  test("drops everything when the search is only the cleaned params", () => {
    expect(withoutParams({ pathname: "/new-session", search: "?prompt=hello", hash: "" }, ["prompt"])).toBe(
      "/new-session",
    )
    expect(withoutParams({ pathname: "/new-session", search: "?prompt=hello", hash: "#anchor" }, ["prompt"])).toBe(
      "/new-session#anchor",
    )
  })

  test("is a no-op when nothing matches", () => {
    expect(withoutParams({ pathname: "/p", search: "?keep=1", hash: "#a" }, ["absent"])).toBe("/p?keep=1#a")
  })
})
