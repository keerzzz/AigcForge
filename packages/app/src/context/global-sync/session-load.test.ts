import { describe, expect, test } from "bun:test"
import { Binary } from "@aigcfroge/core/util/binary"
import type { Session } from "@aigcfroge/sdk/v2/client"
import { mergeModeSessions } from "./session-load"

const session = (input: { id: string; parentID?: string; mode?: string; title?: string }) =>
  ({
    id: input.id,
    parentID: input.parentID,
    mode: input.mode,
    title: input.title,
    time: { created: 1 },
  }) as Session

describe("mergeModeSessions", () => {
  test("keeps merged sessions sorted by id so Binary.search can upsert without duplicating", () => {
    // Regression: chat-mode loads retained coding/child sessions (ids sorting after the
    // fetched chat ids) without re-sorting. The next session.updated event then missed
    // the existing row in Binary.search and inserted a second copy into the sidebar list.
    const retained = [session({ id: "ses_c", mode: "coding" }), session({ id: "ses_d", parentID: "ses_c" })]
    const fetched = [session({ id: "ses_a", mode: "chat" }), session({ id: "ses_b", mode: "chat" })]

    const merged = mergeModeSessions(retained, fetched)
    expect(merged.map((x) => x.id)).toEqual(["ses_a", "ses_b", "ses_c", "ses_d"])

    const update = session({ id: "ses_b", mode: "chat", title: "renamed" })
    const result = Binary.search(merged, update.id, (s) => s.id)
    expect(result.found).toBe(true)
    expect(merged[result.index]?.id).toBe("ses_b")
  })

  test("dedupes by id with the fetched copy winning", () => {
    const retained = [session({ id: "ses_a", mode: "chat", title: "stale" })]
    const fetched = [session({ id: "ses_a", mode: "chat", title: "fresh" })]

    const merged = mergeModeSessions(retained, fetched)
    expect(merged).toHaveLength(1)
    expect(merged[0]?.title).toBe("fresh")
  })
})
