import { describe, expect, test } from "bun:test"
import { ServerConnection } from "@/context/server"
import { ServerScope } from "@/utils/server-scope"
import { assistantQueryKey } from "./assistant-query"

describe("assistantQueryKey", () => {
  test("scopes assistant data by server", () => {
    const remote = ServerScope.fromServerKey(ServerConnection.Key.make("https://remote.example"))
    expect(assistantQueryKey(ServerScope.local, "pending")).toEqual([ServerScope.local, "assistant", "pending"])
    expect(assistantQueryKey(remote, "pending")).not.toEqual(assistantQueryKey(ServerScope.local, "pending"))
  })

  test("preserves resource-specific key parts", () => {
    expect(assistantQueryKey(ServerScope.local, "kb-backlinks", "note-1")).toEqual([
      ServerScope.local,
      "assistant",
      "kb-backlinks",
      "note-1",
    ])
  })
})
