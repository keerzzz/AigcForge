import { describe, expect } from "bun:test"
import { Effect, Layer, Stream } from "effect"
import os from "os"
import path from "path"
import { Config } from "../src/config"
import { location } from "./fixture/location"
import { NodeFileSystem } from "@effect/platform-node"
import { Document, Info } from "@aigcfroge/schema/config"
import { ConfigMeta } from "../src/config/meta"
import { CorrectionStore } from "../src/session/correction-store"
import { FSUtil } from "@aigcfroge/util/fs-util"
import { AppNodeBuilder } from "../src/effect/app-node-builder"
import { LayerNode } from "@aigcfroge/util/effect/layer-node"
import { Location } from "../src/location"
import { Permission } from "../src/permission"
import { ReferenceChecker } from "../src/session/reference-checker"
import { Ripgrep } from "../src/ripgrep"
import { Session } from "../src/session"
import { AbsolutePath } from "../src/schema"
import { Bus } from "../src/bus"
import { Database } from "../src/database/database"
import { ProjectTable } from "../src/project/sql"
import { SessionEvent } from "../src/session/event"
import { SessionProjector } from "../src/session/projector"
import { SessionStore } from "../src/session/store"
import { Project } from "@aigcfroge/schema/project"
import { it } from "./lib/effect"

const fsLayer = FSUtil.layer.pipe(Layer.provide(NodeFileSystem.layer))
const ripgrepLayerAt = (directory: string) =>
  AppNodeBuilder.build(LayerNode.group([Ripgrep.node, Location.node]), [
    Location.node.replace(
      Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(directory) }))),
    ),
  ])

const sessionID = Session.ID.make("ses_reference_checker")

const configLayer = (meta: { enabled?: boolean; timeout_ms?: number } = {}) =>
  Layer.succeed(
    Config.Service,
    Config.Service.of({
      changes: () => Stream.empty,
      entries: () =>
        Effect.succeed([
          new Document({
            type: "document",
            info: Info.make({
              meta: ConfigMeta.Info.make({ reference_check: ConfigMeta.ReferenceCheck.make(meta) }),
            }),
          }),
        ]),
    }),
  )

const mockRipgrep = Layer.mock(Ripgrep.Service, {
  grep: () => Effect.fail(new Ripgrep.Error({ message: "ripgrep unavailable" })),
  find: () => Effect.fail(new Ripgrep.Error({ message: "ripgrep unavailable" })),
  glob: () => Effect.fail(new Ripgrep.Error({ message: "ripgrep unavailable" })),
})

const locationLayer = (directory: string) =>
  Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(directory) })))

const sessionLayerAt = (directory: string) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const database = yield* Database.Service
      const bus = yield* Bus.Service
      yield* database.db
        .insert(ProjectTable)
        .values({ id: Project.ID.global, worktree: AbsolutePath.make(directory), sandboxes: [] })
        .run()
        .pipe(Effect.orDie)
      yield* bus.publish(SessionEvent.Created, {
        sessionID,
        projectID: Project.ID.global,
        location: { directory: AbsolutePath.make(directory) },
        slug: "reference-checker",
        version: "test",
      })
    }),
  ).pipe(
    Layer.provideMerge(
      AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node, SessionProjector.node, SessionStore.node]), [
        Bus.node.replace(Bus.configured({ persist: true })),
      ]),
    ),
  )

// Builds the checker layer rooted at `directory` (the fixture tmpdir).
const layerAt = (
  directory: string,
  meta: { enabled?: boolean; timeout_ms?: number } = {},
  ripgrep?: Layer.Layer<Ripgrep.Service>,
) =>
  ReferenceChecker.layer.pipe(
    Layer.provideMerge(
      CorrectionStore.layer.pipe(Layer.provide(Layer.mergeAll(configLayer(meta), sessionLayerAt(directory)))),
    ),
    Layer.provide(ripgrep ?? ripgrepLayerAt(directory)),
    Layer.provide(fsLayer),
    Layer.provide(configLayer(meta)),
    Layer.provide(locationLayer(directory)),
    Layer.provide(Layer.mock(Permission.Service, { assert: () => Effect.void })),
  )

// Creates a tmpdir with the given fixture files and returns [tmpDir, layer].
const withFixture = (
  files: Record<string, string>,
  meta: { enabled?: boolean; timeout_ms?: number } = {},
  ripgrep?: Layer.Layer<Ripgrep.Service>,
) =>
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const tmpDir = yield* fs.makeTempDirectory({ directory: os.tmpdir(), prefix: "aigcfroge-refcheck-" })
    for (const [name, content] of Object.entries(files)) {
      yield* fs.writeWithDirs(path.join(tmpDir, name), content)
    }
    return [tmpDir, layerAt(tmpDir, meta, ripgrep)] as const
  }).pipe(Effect.provide(fsLayer))

const runCheck = (input: Parameters<ReferenceChecker.Interface["check"]>[0]) =>
  Effect.gen(function* () {
    const checker = yield* ReferenceChecker.Service
    return yield* checker.check(input)
  })

describe("ReferenceChecker", () => {
  it.live("reports a dangling markdown link", () =>
    withFixture({ "guide.md": "See [target](./missing.md) for details.\n" }).pipe(
      Effect.flatMap(([, layer]) => runCheck({ sessionID, files: ["guide.md"] }).pipe(Effect.provide(layer))),
      Effect.map((warning) => {
        expect(warning).toContain("[引用检查]")
        expect(warning).toContain("./missing.md")
      }),
    ),
  )

  it.live("does not report when the markdown link target exists", () =>
    withFixture({ "guide.md": "See [target](./exists.md) for details.\n", "exists.md": "present\n" }).pipe(
      Effect.flatMap(([, layer]) => runCheck({ sessionID, files: ["guide.md"] }).pipe(Effect.provide(layer))),
      Effect.map((warning) => {
        expect(warning).toContain("已检查")
      }),
    ),
  )

  it.live("reports a dangling import in a TypeScript file", () =>
    withFixture({ "src/worker.ts": 'import { X } from "./missing"\n' }).pipe(
      Effect.flatMap(([, layer]) => runCheck({ sessionID, files: ["src/worker.ts"] }).pipe(Effect.provide(layer))),
      Effect.map((warning) => {
        expect(warning).toContain("./missing")
      }),
    ),
  )

  it.live("resolves extensionless imports against existing files", () =>
    withFixture({ "src/worker.ts": 'import { X } from "./util"\n', "src/util.ts": "export const X = 1\n" }).pipe(
      Effect.flatMap(([, layer]) => runCheck({ sessionID, files: ["src/worker.ts"] }).pipe(Effect.provide(layer))),
      Effect.map((warning) => {
        expect(warning).toContain("已检查")
      }),
    ),
  )

  it.live("does not scan for read or grep tools", () =>
    withFixture({ "guide.md": "See [target](./missing.md) for details.\n" }).pipe(
      Effect.flatMap(([, layer]) =>
        Effect.all([runCheck({ sessionID, files: [] }), runCheck({ sessionID, files: [] })]).pipe(
          Effect.provide(layer),
        ),
      ),
      Effect.map(([readWarning, grepWarning]) => {
        expect(readWarning).toBe("")
        expect(grepWarning).toBe("")
      }),
    ),
  )

  it.live("writes the dangling reference into the CorrectionStore", () =>
    withFixture({ "guide.md": "See [target](./missing.md) for details.\n" }).pipe(
      Effect.flatMap(([, layer]) =>
        Effect.gen(function* () {
          const checker = yield* ReferenceChecker.Service
          yield* checker.check({ sessionID, files: ["guide.md"] })
          const store = yield* CorrectionStore.Service
          return yield* store.facts(sessionID)
        }).pipe(Effect.provide(layer)),
      ),
      Effect.map((facts) => {
        expect(facts.length).toBeGreaterThan(0)
        expect(facts[0]).toEqual({ key: "ref:./missing.md", correct: "./missing.md 不存在" })
      }),
    ),
  )

  it.live("skips instead of blocking when the scan times out", () =>
    withFixture(
      { "guide.md": "See [target](./missing.md) for details.\n" },
      { timeout_ms: 1 },
      Layer.mock(Ripgrep.Service, { grep: () => Effect.never }),
    ).pipe(
      Effect.flatMap(([, layer]) => runCheck({ sessionID, files: ["guide.md"] }).pipe(Effect.provide(layer))),
      Effect.map((warning) => {
        expect(warning).toContain("超时")
      }),
    ),
  )
})

describe("ReferenceChecker config", () => {
  it.live("MC04a review rejects default declaration names as named exports", () =>
    withFixture({
      "src/function.ts": "export default function hidden() {}\nexport const named = 1\n",
      "src/class.ts": "export default class Hidden {}\nexport const separate = 2\n",
      "src/consumer.ts":
        "import fn, { hidden, named } from './function'\nimport Klass, { Hidden, separate } from './class'\n",
    }).pipe(
      Effect.flatMap(([, layer]) => runCheck({ sessionID, files: ["src/consumer.ts"] }).pipe(Effect.provide(layer))),
      Effect.map((warning) => {
        expect(warning).toContain("./function#hidden")
        expect(warning).toContain("./class#Hidden")
        expect(warning).not.toContain("#default")
        expect(warning).not.toContain("#named")
        expect(warning).not.toContain("#separate")
      }),
    ),
  )

  it.live("checks explicit symbols in direct reverse imports using emitted JS paths", () =>
    withFixture({
      "src/target.ts": "export const present = 1\n",
      "src/consumer.ts": "import { missing } from './target.js'\nexport const result = missing\n",
    }).pipe(
      Effect.flatMap(([, layer]) => runCheck({ sessionID, files: ["src/target.ts"] }).pipe(Effect.provide(layer))),
      Effect.map((warning) => {
        expect(warning).toContain("./target.js#missing")
        expect(warning).toContain("src/consumer.ts")
      }),
    ),
  )

  it.live("retains CommonJS file checks and does not invent missing exports behind star reexports", () =>
    withFixture({
      "src/target.ts": "export * from './implementation'\n",
      "src/implementation.ts": "export const present = 1\n",
      "src/consumer.ts": "import { present } from './target'\nconst absent = require('./absent')\n",
    }).pipe(
      Effect.flatMap(([, layer]) => runCheck({ sessionID, files: ["src/consumer.ts"] }).pipe(Effect.provide(layer))),
      Effect.map((warning) => {
        expect(warning).toContain("./absent")
        expect(warning).not.toContain("./target#present")
        expect(warning).toContain("复杂导出")
      }),
    ),
  )

  it.live("skips without blocking when ripgrep is unavailable", () =>
    withFixture({ "guide.md": "See [target](./missing.md) for details.\n" }, {}, mockRipgrep).pipe(
      Effect.flatMap(([, layer]) => runCheck({ sessionID, files: ["guide.md"] }).pipe(Effect.provide(layer))),
      Effect.map((warning) => {
        expect(warning).toContain("不可用")
      }),
    ),
  )

  it.live("does not scan when disabled", () =>
    withFixture({ "guide.md": "See [target](./missing.md) for details.\n" }, { enabled: false }).pipe(
      Effect.flatMap(([, layer]) => runCheck({ sessionID, files: ["guide.md"] }).pipe(Effect.provide(layer))),
      Effect.map((warning) => {
        expect(warning).toBe("")
      }),
    ),
  )
})
