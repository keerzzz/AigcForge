import { describe, expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import {
  createServerProjects,
  migrateCanonicalLocalServerState,
  nextServerAfterRemoval,
  resolveServerList,
  ServerConnection,
} from "./server"
import { ServerScope } from "@/utils/server-scope"

describe("resolveServerList", () => {
  test("lets startup auth_token credentials override a persisted same-url server", () => {
    const list = resolveServerList({
      stored: [{ url: "https://server.example.test" }],
      props: [
        {
          type: "http",
          authToken: true,
          http: {
            url: "https://server.example.test",
            username: "aigcfroge",
            password: "secret",
          },
        },
      ],
    })

    expect(list).toHaveLength(1)
    expect(list[0]?.type).toBe("http")
    expect(list[0]?.http).toEqual({
      url: "https://server.example.test",
      username: "aigcfroge",
      password: "secret",
    })
    expect(list[0]?.type === "http" ? list[0].authToken : false).toBe(true)
    expect(ServerConnection.key(list[0]) as string).toBe("https://server.example.test")
  })

  test("keeps persisted credentials when startup has no auth_token", () => {
    const list = resolveServerList({
      stored: [
        {
          url: "https://server.example.test",
          username: "aigcfroge",
          password: "saved",
        },
      ],
      props: [{ type: "http", http: { url: "https://server.example.test" } }],
    })

    expect(list).toHaveLength(1)
    expect(list[0]?.type).toBe("http")
    expect(list[0]?.http).toEqual({
      url: "https://server.example.test",
      username: "aigcfroge",
      password: "saved",
    })
    expect(list[0]?.type === "http" ? list[0].authToken : true).toBeUndefined()
  })
})

test("treats WSL sidecars as remote server connections", () => {
  expect(
    ServerConnection.local({
      type: "sidecar",
      variant: "wsl",
      distro: "Debian",
      http: { url: "http://127.0.0.1:4097" },
    }),
  ).toBe(false)
  expect(ServerConnection.local({ type: "sidecar", variant: "base", http: { url: "http://127.0.0.1:4096" } })).toBe(
    true,
  )
  expect(ServerConnection.local({ type: "http", http: { url: "http://localhost:4096" } })).toBe(true)
  expect(ServerConnection.local({ type: "http", http: { url: "https://server.example.test" } })).toBe(false)
})

test("active server removal falls back across built-in and persisted servers", () => {
  const local = { type: "sidecar", variant: "base", http: { url: "http://127.0.0.1:4096" } } as const
  const debian = {
    type: "sidecar",
    variant: "wsl",
    distro: "Debian",
    http: { url: "http://127.0.0.1:4097" },
  } as const

  expect(
    nextServerAfterRemoval(
      [local, debian],
      ServerConnection.Key.make("wsl:Debian"),
      ServerConnection.Key.make("sidecar"),
    ),
  ).toBe(ServerConnection.Key.make("sidecar"))
})

describe("createServerProjects", () => {
  test("keeps active and explicit server buckets in one reactive store", () => {
    createRoot((dispose) => {
      const [scope] = createSignal(ServerScope.local)
      const [store, setStore] = createStore({ projects: {}, lastProject: {} })
      const active = createServerProjects({ scope, store, setStore })
      const remote = createServerProjects({ scope: () => "https://debian.example" as ServerScope, store, setStore })

      remote.open("/repo")
      expect(remote.list()).toEqual([{ worktree: "/repo", expanded: true }])
      expect(active.list()).toEqual([])

      const adopted = createServerProjects({ scope: () => "https://debian.example" as ServerScope, store, setStore })
      expect(adopted.list()).toEqual([{ worktree: "/repo", expanded: true }])

      adopted.close("/repo")
      expect(remote.list()).toEqual([])
      dispose()
    })
  })

  /**
   * S8: one directory is one registration, whatever spelling reached the registry.
   *
   * The registry used to compare worktree strings verbatim, so the same directory added as
   * `C:/AigcForge/App` and `C:\AigcForge\App` — the two spellings a native picker and a URL can
   * each hand over — produced two rows, two sidebars entries and two Locations. The comparison
   * now goes through `pathKey`, the spelling normalizer the rest of the app already uses for
   * directory keys. It normalizes separators and a trailing slash; it deliberately does NOT
   * fold case, and it makes no claim about physical identity (two spellings of one inode are a
   * separate, backend-owned question: see `coverage-manifest.json` `path-identity`).
   */
  describe("directory spelling", () => {
    const setup = () => {
      const [store, setStore] = createStore({ projects: {}, lastProject: {} })
      return {
        store,
        local: createServerProjects({ scope: () => ServerScope.local, store, setStore }),
        // The owner's own constructor rather than a cast: `fromServerKey` is what production code
        // goes through to turn a connection key into a scope, and it keeps the brand real.
        remote: createServerProjects({
          scope: () => ServerScope.fromServerKey(ServerConnection.Key.make("https://debian.example")),
          store,
          setStore,
        }),
      }
    }

    test("adds one entry per directory, not one per spelling", () => {
      const { local } = setup()

      local.open("C:/AigcForge/App")
      local.open("C:\\AigcForge\\App")
      local.open("C:/AigcForge/App/")

      expect(local.list()).toEqual([{ worktree: "C:/AigcForge/App", expanded: true }])
    })

    test("closes the registration a different spelling refers to", () => {
      const { local } = setup()

      local.open("C:/AigcForge/App")
      local.open("C:/AigcForge/Other")
      local.close("C:\\AigcForge\\App")

      expect(local.list()).toEqual([{ worktree: "C:/AigcForge/Other", expanded: true }])
    })

    test("applies expand, collapse and reorder to the entry the spelling refers to", () => {
      const { local } = setup()

      local.open("/a")
      local.open("/b")
      expect(local.list().map((project) => project.worktree)).toEqual(["/b", "/a"])

      local.collapse("/a")
      expect(local.list()).toEqual([
        { worktree: "/b", expanded: true },
        { worktree: "/a", expanded: false },
      ])

      local.expand("/a/")
      expect(local.list()[1]).toEqual({ worktree: "/a", expanded: true })

      local.move("/a/", 0)
      expect(local.list().map((project) => project.worktree)).toEqual(["/a", "/b"])
    })

    /**
     * The plan's destructive-delete constraint at the unit level: removing a project removes its
     * registration and nothing else. Closing is not a delete of the directory, of its Sessions,
     * or of the other servers' buckets — and it must not clear `lastProject`, which is what the
     * Home "continue last" affordance reads.
     */
    test("closing a project drops its registration and touches nothing else", () => {
      const { store, local, remote } = setup()

      local.open("/keep")
      local.open("/drop")
      local.touch("/keep")
      remote.open("/remote")

      local.close("/drop")

      expect(store.projects).toEqual({
        local: [{ worktree: "/keep", expanded: true }],
        "https://debian.example": [{ worktree: "/remote", expanded: true }],
      })
      expect(store.lastProject).toEqual({ local: "/keep" })
    })
  })
})

describe("migrateCanonicalLocalServerState", () => {
  test("moves an existing canonical web bucket into local scope", () => {
    expect(
      migrateCanonicalLocalServerState(
        {
          list: [],
          projects: { "https://aigcfroge.example.com": [{ worktree: "/remote", expanded: true }] },
          lastProject: { "https://aigcfroge.example.com": "/remote" },
        },
        ServerConnection.Key.make("https://aigcfroge.example.com"),
      ),
    ).toEqual({
      list: [],
      projects: { local: [{ worktree: "/remote", expanded: true }] },
      lastProject: { local: "/remote" },
    })
  })

  test("preserves existing local state while merging a canonical web bucket", () => {
    expect(
      migrateCanonicalLocalServerState(
        {
          projects: {
            local: [{ worktree: "/local", expanded: false }],
            "https://aigcfroge.example.com": [
              { worktree: "/local", expanded: true },
              { worktree: "/remote", expanded: true },
            ],
          },
          lastProject: { local: "/local", "https://aigcfroge.example.com": "/remote" },
        },
        ServerConnection.Key.make("https://aigcfroge.example.com"),
      ),
    ).toEqual({
      projects: {
        local: [
          { worktree: "/local", expanded: false },
          { worktree: "/remote", expanded: true },
        ],
      },
      lastProject: { local: "/local" },
    })
  })
})

describe("server key namespaces", () => {
  test.each([
    ["sidecar", "sidecar"],
    ["wsl:Ubuntu", "wsl:Ubuntu"],
    ["ssh:Host:22", "ssh:Host:22"],
    ["ssh:User@Host", "ssh:User@Host"],
    ["http://sidecar/", "http://sidecar"],
    ["HTTP://LocalHost:80/", "http://127.0.0.1"],
    ["https://Example.COM:443/", "https://example.com"],
    ["localhost:4096/", "http://127.0.0.1:4096"],
  ])("canonicalizes %s without changing its namespace", (raw, expected) => {
    const key = ServerConnection.canonicalKey(ServerConnection.Key.make(raw))
    expect(key).toBe(ServerConnection.Key.make(expected))
    expect(ServerConnection.canonicalKey(key)).toBe(key)
  })

  test.each([
    ["sidecar", "http://sidecar", false],
    ["sidecar", "SIDECAR", false],
    ["sidecar", "sidecar/", false],
    ["wsl:Ubuntu", "wsl:ubuntu", false],
    ["wsl:Ubuntu", "wsl:Debian", false],
    ["ssh:Host:22", "ssh:host:22", false],
    ["ssh:User@Host", "http://ssh:User@Host", false],
    ["wsl:Ubuntu", "ssh:Ubuntu", false],
    ["http://localhost:4096", "http://127.0.0.1:4096/", true],
    ["https://EXAMPLE.com:443", "https://example.com", true],
    ["http://localhost:4096", "http://127.0.0.1:4097", false],
    ["http://localhost:4096", "https://localhost:4096", false],
    ["http://[::1]:4096", "http://127.0.0.1:4096", false],
    ["not a url", "http://not a url", false],
  ] as const)("compares %s and %s only within their namespace", (a, b, equal) => {
    expect(ServerConnection.sameKey(a, b)).toBe(equal)
    expect(ServerConnection.sameKey(b, a)).toBe(equal)
    expect(ServerConnection.sameKey(a, a)).toBe(true)
    expect(ServerConnection.sameKey(b, b)).toBe(true)
  })

  test.each([
    { type: "sidecar", variant: "base", http: { url: "http://127.0.0.1:4096" } },
    { type: "sidecar", variant: "wsl", distro: "Ubuntu", http: { url: "http://127.0.0.1:4097" } },
    { type: "ssh", host: "User@Host", http: { url: "http://127.0.0.1:4098" } },
    { type: "http", http: { url: "http://localhost:4096/" } },
  ] satisfies ServerConnection.Any[])("preserves a generated $type key through canonicalization", (connection) => {
    const key = ServerConnection.key(connection)
    expect(ServerConnection.canonicalKey(key)).toBe(key)
  })
})
