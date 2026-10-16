import { describe, expect } from "bun:test"
import { SessionV1 } from "@aigcfroge/core/v1/session"
import path from "path"
import { Deferred, Effect, Fiber, FileSystem, Layer, Ref, Stream } from "effect"
import { FetchHttpClient, HttpClient, HttpRouter, HttpServer, HttpServerResponse } from "effect/unstable/http"
import { NodeFileSystem, NodeHttpServer, NodeServices } from "@effect/platform-node"
import { CrossSpawnSpawner } from "@aigcfroge/core/cross-spawn-spawner"
import { FSUtil } from "@aigcfroge/core/fs-util"

import { Instruction } from "../../src/session/instruction"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { Global } from "@aigcfroge/core/global"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { provideInstance, provideTmpdirInstance, testInstanceStoreLayer, tmpdirScoped } from "../fixture/fixture"
import { awaitWithTimeout, testEffect } from "../lib/effect"
import { TestConfig } from "../fixture/config"
import { ProviderV2 } from "@aigcfroge/core/provider"
import { ModelV2 } from "@aigcfroge/core/model"

const it = testEffect(Layer.mergeAll(CrossSpawnSpawner.defaultLayer, NodeFileSystem.layer, testInstanceStoreLayer))
const httpIt = testEffect(Layer.mergeAll(NodeHttpServer.layerTest, NodeServices.layer, testInstanceStoreLayer))

const configLayer = TestConfig.layer()

const instructionLayer = (
  global: Partial<Global.Interface>,
  flags: Partial<RuntimeFlags.Info> = {},
  config = configLayer,
  client = FetchHttpClient.layer,
) =>
  Instruction.layer.pipe(
    Layer.provide(config),
    Layer.provide(FSUtil.defaultLayer),
    Layer.provide(client),
    Layer.provide(Global.layerWith(global)),
    Layer.provide(RuntimeFlags.layer(flags)),
  )

const provideInstruction =
  (
    global: Partial<Global.Interface>,
    flags?: Partial<RuntimeFlags.Info>,
    config = configLayer,
    client = FetchHttpClient.layer,
  ) =>
  <A, E, R>(self: Effect.Effect<A, E, R>) =>
    self.pipe(Effect.provide(instructionLayer(global, flags, config, client)))

const write = (filepath: string, content: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    yield* fs.makeDirectory(path.dirname(filepath), { recursive: true })
    yield* fs.writeFileString(filepath, content)
  })

const writeFiles = (dir: string, files: Record<string, string>) =>
  Effect.all(
    Object.entries(files).map(([file, content]) => write(path.join(dir, file), content)),
    { discard: true },
  )

const withFiles = <A, E, R>(files: Record<string, string>, self: (dir: string) => Effect.Effect<A, E, R>) =>
  provideTmpdirInstance((dir) =>
    Effect.gen(function* () {
      yield* writeFiles(dir, files)
      return yield* self(dir).pipe(provideInstruction({ home: dir, config: dir }))
    }),
  )

const tmpWithFiles = (files: Record<string, string>) =>
  Effect.gen(function* () {
    const dir = yield* tmpdirScoped()
    yield* writeFiles(dir, files)
    return dir
  })

function loaded(filepath: string): SessionV1.WithParts[] {
  const sessionID = SessionID.make("session-loaded-1")
  const messageID = MessageID.make("msg_message-loaded-1")

  return [
    {
      info: {
        id: messageID,
        sessionID,
        role: "user",
        time: { created: 0 },
        agent: "build",
        model: {
          providerID: ProviderV2.ID.make("anthropic"),
          modelID: ModelV2.ID.make("claude-sonnet-4-20250514"),
        },
      },
      parts: [
        {
          id: PartID.make("prt_part-loaded-1"),
          messageID,
          sessionID,
          type: "tool",
          callID: "call-loaded-1",
          tool: "read",
          state: {
            status: "completed",
            input: {},
            output: "done",
            title: "Read",
            metadata: { loaded: [filepath] },
            time: { start: 0, end: 1 },
          },
        },
      ],
    },
  ]
}

describe("Instruction.resolve", () => {
  it.live("returns empty when AGENTS.md is at project root (already in systemPaths)", () =>
    withFiles({ "AGENTS.md": "# Root Instructions", "src/file.ts": "const x = 1" }, (dir) =>
      Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const system = yield* svc.systemPaths()
        expect(system.has(path.join(dir, "AGENTS.md"))).toBe(true)

        const results = yield* svc.resolve([], path.join(dir, "src", "file.ts"), MessageID.make("msg_message-test-1"))
        expect(results).toEqual([])
      }),
    ),
  )

  it.live("returns AGENTS.md from subdirectory (not in systemPaths)", () =>
    withFiles({ "subdir/AGENTS.md": "# Subdir Instructions", "subdir/nested/file.ts": "const x = 1" }, (dir) =>
      Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const system = yield* svc.systemPaths()
        expect(system.has(path.join(dir, "subdir", "AGENTS.md"))).toBe(false)

        const results = yield* svc.resolve(
          [],
          path.join(dir, "subdir", "nested", "file.ts"),
          MessageID.make("msg_message-test-2"),
        )
        expect(results.length).toBe(1)
        expect(results[0].filepath).toBe(path.join(dir, "subdir", "AGENTS.md"))
      }),
    ),
  )

  it.live("doesn't reload AGENTS.md when reading it directly", () =>
    withFiles({ "subdir/AGENTS.md": "# Subdir Instructions", "subdir/nested/file.ts": "const x = 1" }, (dir) =>
      Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const filepath = path.join(dir, "subdir", "AGENTS.md")
        const system = yield* svc.systemPaths()
        expect(system.has(filepath)).toBe(false)

        const results = yield* svc.resolve([], filepath, MessageID.make("msg_message-test-3"))
        expect(results).toEqual([])
      }),
    ),
  )

  it.live("does not reattach the same nearby instructions twice for one message", () =>
    withFiles({ "subdir/AGENTS.md": "# Subdir Instructions", "subdir/nested/file.ts": "const x = 1" }, (dir) =>
      Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const filepath = path.join(dir, "subdir", "nested", "file.ts")
        const id = MessageID.make("msg_message-claim-1")

        const first = yield* svc.resolve([], filepath, id)
        const second = yield* svc.resolve([], filepath, id)

        expect(first).toHaveLength(1)
        expect(first[0].filepath).toBe(path.join(dir, "subdir", "AGENTS.md"))
        expect(second).toEqual([])
      }),
    ),
  )

  it.live("clear allows nearby instructions to be attached again for the same message", () =>
    withFiles({ "subdir/AGENTS.md": "# Subdir Instructions", "subdir/nested/file.ts": "const x = 1" }, (dir) =>
      Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const filepath = path.join(dir, "subdir", "nested", "file.ts")
        const id = MessageID.make("msg_message-claim-2")

        const first = yield* svc.resolve([], filepath, id)
        yield* svc.clear(id)
        const second = yield* svc.resolve([], filepath, id)

        expect(first).toHaveLength(1)
        expect(second).toHaveLength(1)
        expect(second[0].filepath).toBe(path.join(dir, "subdir", "AGENTS.md"))
      }),
    ),
  )

  it.live("skips instructions already reported by prior read metadata", () =>
    withFiles({ "subdir/AGENTS.md": "# Subdir Instructions", "subdir/nested/file.ts": "const x = 1" }, (dir) =>
      Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const agents = path.join(dir, "subdir", "AGENTS.md")
        const filepath = path.join(dir, "subdir", "nested", "file.ts")
        const id = MessageID.make("msg_message-claim-3")

        const results = yield* svc.resolve(loaded(agents), filepath, id)
        expect(results).toEqual([])
      }),
    ),
  )
})

describe("Instruction.system", () => {
  httpIt.live("fetches remote instructions from config URLs via HttpClient", () =>
    Effect.gen(function* () {
      const requests = yield* Ref.make<string[]>([])
      const first = "# Remote α\n请先阅读项目约定。"
      const second = "# Remote β\nCafé et outils 🛠️"
      yield* Layer.mergeAll(
        HttpRouter.add(
          "GET",
          "/first.md",
          Ref.update(requests, (hits) => [...hits, "/first.md"]).pipe(Effect.as(HttpServerResponse.text(first))),
        ),
        HttpRouter.add(
          "GET",
          "/second.md",
          Ref.update(requests, (hits) => [...hits, "/second.md"]).pipe(Effect.as(HttpServerResponse.text(second))),
        ),
      ).pipe(HttpRouter.serve, Layer.build)

      const server = yield* HttpServer.HttpServer
      if (server.address._tag !== "TcpAddress") return yield* Effect.die(new Error("expected TCP test server"))
      const urls = [
        `http://127.0.0.1:${server.address.port}/first.md`,
        `http://127.0.0.1:${server.address.port}/second.md`,
      ]
      const globalTmp = yield* tmpdirScoped()
      const projectTmp = yield* tmpWithFiles({ "AGENTS.md": "# Project Instructions" })

      return yield* Effect.gen(function* () {
        const svc = yield* Instruction.Service
        expect(Array.from(yield* svc.systemPaths())).toEqual([path.join(projectTmp, "AGENTS.md")])
        expect(yield* svc.system()).toEqual([
          `Instructions from: ${path.join(projectTmp, "AGENTS.md")}\n# Project Instructions`,
          `Instructions from: ${urls[0]}\n${first}`,
          `Instructions from: ${urls[1]}\n${second}`,
        ])
        expect((yield* Ref.get(requests)).toSorted()).toEqual(["/first.md", "/second.md"])
      }).pipe(
        provideInstance(projectTmp),
        provideInstruction(
          { home: globalTmp, config: globalTmp },
          {},
          TestConfig.layer({ get: () => Effect.succeed({ instructions: urls }) }),
        ),
      )
    }),
  )

  httpIt.live("omits failed and empty remote instructions while retaining local instructions", () =>
    Effect.gen(function* () {
      const requests = yield* Ref.make<string[]>([])
      yield* Layer.mergeAll(
        HttpRouter.add(
          "GET",
          "/missing.md",
          Ref.update(requests, (hits) => [...hits, "/missing.md"]).pipe(
            Effect.as(HttpServerResponse.text("# Rejected Instructions", { status: 404 })),
          ),
        ),
        HttpRouter.add(
          "GET",
          "/empty.md",
          Ref.update(requests, (hits) => [...hits, "/empty.md"]).pipe(Effect.as(HttpServerResponse.text(""))),
        ),
      ).pipe(HttpRouter.serve, Layer.build)

      const server = yield* HttpServer.HttpServer
      if (server.address._tag !== "TcpAddress") return yield* Effect.die(new Error("expected TCP test server"))
      const urls = [
        `http://127.0.0.1:${server.address.port}/missing.md`,
        `http://127.0.0.1:${server.address.port}/empty.md`,
      ]
      const globalTmp = yield* tmpdirScoped()
      const projectTmp = yield* tmpWithFiles({ "AGENTS.md": "# Project Instructions" })

      return yield* Effect.gen(function* () {
        const svc = yield* Instruction.Service
        expect(yield* svc.system()).toEqual([
          `Instructions from: ${path.join(projectTmp, "AGENTS.md")}\n# Project Instructions`,
        ])
        expect((yield* Ref.get(requests)).toSorted()).toEqual(["/empty.md", "/missing.md"])
      }).pipe(
        provideInstance(projectTmp),
        provideInstruction(
          { home: globalTmp, config: globalTmp },
          {},
          TestConfig.layer({ get: () => Effect.succeed({ instructions: urls }) }),
        ),
      )
    }),
  )

  httpIt.live(
    "omits a remote body stalled after headers within the instruction deadline",
    () =>
      Effect.gen(function* () {
        const headersReceived = yield* Deferred.make<number>()
        yield* HttpRouter.add(
          "GET",
          "/stalled.md",
          HttpServerResponse.stream(
            Stream.concat(Stream.make(new TextEncoder().encode("partial instructions")), Stream.never),
            { contentType: "text/plain; charset=utf-8" },
          ),
        ).pipe(HttpRouter.serve, Layer.build)

        const server = yield* HttpServer.HttpServer
        if (server.address._tag !== "TcpAddress") return yield* Effect.die(new Error("expected TCP test server"))
        const url = `http://127.0.0.1:${server.address.port}/stalled.md`
        const globalTmp = yield* tmpdirScoped()
        const projectTmp = yield* tmpWithFiles({ "AGENTS.md": "# Project Instructions" })
        // layerTest's relative client prepends its base URL even to absolute config URLs.
        const client = (yield* HttpClient.HttpClient.pipe(Effect.provide(FetchHttpClient.layer))).pipe(
          HttpClient.tap((response) => Deferred.succeed(headersReceived, response.status)),
        )

        return yield* Effect.gen(function* () {
          const svc = yield* Instruction.Service
          const fiber = yield* svc.system().pipe(Effect.forkIn(yield* Effect.scope))
          expect(
            yield* awaitWithTimeout(Deferred.await(headersReceived), "instruction response never arrived", "2 seconds"),
          ).toBe(200)
          const rules = yield* awaitWithTimeout(
            Fiber.join(fiber),
            "instruction body exceeded its deadline",
            "8 seconds",
          )
          expect(rules).toEqual([`Instructions from: ${path.join(projectTmp, "AGENTS.md")}\n# Project Instructions`])
        }).pipe(
          provideInstance(projectTmp),
          provideInstruction(
            { home: globalTmp, config: globalTmp },
            {},
            TestConfig.layer({ get: () => Effect.succeed({ instructions: [url] }) }),
            Layer.succeed(HttpClient.HttpClient, client),
          ),
        )
      }),
    15000,
  )

  it.live("loads both project and global AGENTS.md when both exist", () =>
    Effect.gen(function* () {
      const globalTmp = yield* tmpWithFiles({ "AGENTS.md": "# Global Instructions" })
      const projectTmp = yield* tmpWithFiles({ "AGENTS.md": "# Project Instructions" })

      yield* Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const paths = yield* svc.systemPaths()
        expect(paths.has(path.join(projectTmp, "AGENTS.md"))).toBe(true)
        expect(paths.has(path.join(globalTmp, "AGENTS.md"))).toBe(true)

        const rules = yield* svc.system()
        expect(rules).toHaveLength(2)
        expect(rules[0]).toBe(`Instructions from: ${path.join(globalTmp, "AGENTS.md")}\n# Global Instructions`)
        expect(rules[1]).toBe(`Instructions from: ${path.join(projectTmp, "AGENTS.md")}\n# Project Instructions`)
      }).pipe(provideInstance(projectTmp), provideInstruction({ home: globalTmp, config: globalTmp }))
    }),
  )

  it.live("skips project and global CLAUDE.md when Claude Code prompt is disabled", () =>
    Effect.gen(function* () {
      const globalTmp = yield* tmpWithFiles({ ".claude/CLAUDE.md": "# Global Claude" })
      const projectTmp = yield* tmpWithFiles({ "CLAUDE.md": "# Project Claude" })

      yield* Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const paths = yield* svc.systemPaths()
        expect(paths.has(path.join(globalTmp, ".claude", "CLAUDE.md"))).toBe(false)
        expect(paths.has(path.join(projectTmp, "CLAUDE.md"))).toBe(false)
        expect(yield* svc.system()).toEqual([])
      }).pipe(
        provideInstance(projectTmp),
        provideInstruction({ home: globalTmp, config: globalTmp }, { disableClaudeCodePrompt: true }),
      )
    }),
  )
})

describe("Instruction.systemPaths global config", () => {
  it.live("uses Global.Service config AGENTS.md", () =>
    Effect.gen(function* () {
      const globalTmp = yield* tmpWithFiles({ "AGENTS.md": "# Global Instructions" })
      const projectTmp = yield* tmpdirScoped()

      yield* Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const paths = yield* svc.systemPaths()
        expect(paths.has(path.join(globalTmp, "AGENTS.md"))).toBe(true)
      }).pipe(provideInstance(projectTmp), provideInstruction({ home: globalTmp, config: globalTmp }))
    }),
  )
})
