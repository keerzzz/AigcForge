import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Database } from "@aigcfroge/core/database/database"
import { FSUtil } from "@aigcfroge/core/fs-util"
import { KBService } from "@aigcfroge/core/session/kb-service"
import { KBNote } from "@aigcfroge/schema/kb-note"
import { testEffect } from "./lib/effect"


const it = testEffect(
  KBService.layer.pipe(
    Layer.provideMerge(Database.defaultLayer),
    Layer.provideMerge(FSUtil.defaultLayer),
  ),
)

// Real temp dirs exercise the file mirror; FSUtil.defaultLayer backs onto the
// node filesystem.
const base = () => `${process.env.TMPDIR ?? "/tmp"}/aigcfroge-kb-${Math.random().toString(36).slice(2)}`



describe("KBService", () => {
  it.effect("creates a note, writes its .md file, and resolves its wikilinks", () =>
    Effect.gen(function* () {
      const kb = yield* KBService.Service
      const dir = base()
      const meeting = yield* kb.create({
        title: "Meeting",
        content: "Discussed [[Roadmap]] and [[Budget]].",
        scope: "project",
        tags: ["work"],
        baseDir: dir,
      })
      yield* kb.create({
        title: "Roadmap",
        content: "Q3 goals.",
        scope: "project",
        baseDir: dir,
      })

      // The .md file is written under <base>/.aigcfroge/knowledge-base/.
      const fs = yield* FSUtil.Service
      expect(yield* fs.existsSafe(`${dir}/.aigcfroge/knowledge-base/Meeting.md`)).toBe(true)
      expect(yield* fs.readFileStringSafe(`${dir}/.aigcfroge/knowledge-base/Meeting.md`)).toBe(
        "Discussed [[Roadmap]] and [[Budget]].",
      )

      // [[Roadmap]] resolves once the target exists; [[Budget]] stays dangling.
      const links = yield* kb.linksFrom(meeting.id)
      const roadmap = links.find((l) => l.targetTitle === "Roadmap")
      expect(roadmap?.dangling).toBe(false)
      const budget = links.find((l) => l.targetTitle === "Budget")
      expect(budget?.dangling).toBe(true)
    }),
  )

  it.effect("listDangling reports only unresolved links", () =>
    Effect.gen(function* () {
      const kb = yield* KBService.Service
      const dir = base()
      yield* kb.create({ title: "A", content: "[[B]] and [[C]]", scope: "project", baseDir: dir })
      yield* kb.create({ title: "B", content: "resolved", scope: "project", baseDir: dir })

      const dangling = yield* kb.listDangling()
      expect(dangling.map((d) => d.targetTitle)).toEqual(["C"])
      expect(yield* kb.countDangling()).toBe(1)
    }),
  )

  it.effect("derives backlinks from single-sided edges", () =>
    Effect.gen(function* () {
      const kb = yield* KBService.Service
      const dir = base()
      yield* kb.create({ title: "Alpha", content: "links to [[Omega]]", scope: "project", baseDir: dir })
      yield* kb.create({ title: "Beta", content: "also links to [[Omega]]", scope: "project", baseDir: dir })
      const omega = yield* kb.create({ title: "Omega", content: "hub", scope: "project", baseDir: dir })

      const backlinks = yield* kb.backlinks(omega.id)
      expect(backlinks.map((n) => n.title).sort()).toEqual(["Alpha", "Beta"])
    }),
  )

  it.effect("rejects a duplicate title in the same scope", () =>
    Effect.gen(function* () {
      const kb = yield* KBService.Service
      const dir = base()
      yield* kb.create({ title: "Duplicate", content: "first", scope: "global", baseDir: dir })
      const exit = yield* kb
        .create({ title: "Duplicate", content: "second", scope: "global", baseDir: dir })
        .pipe(Effect.exit)
      expect(exit._tag).toBe("Failure")
    }),
  )

  it.effect("searches Chinese phrases via FTS5 unicode61 + LIKE fallback", () =>
    Effect.gen(function* () {
      const kb = yield* KBService.Service
      const dir = base()
      yield* kb.create({ title: "项目计划", content: "Q3 目标与里程碑安排", scope: "project", baseDir: dir })
      yield* kb.create({ title: "项目回顾", content: "Q3 复盘总结", scope: "project", baseDir: dir })
      yield* kb.create({ title: "English note", content: "release planning notes", scope: "project", baseDir: dir })

      // Exact Chinese phrase: LIKE fallback keeps the match exact.
      const chinese = yield* kb.search("项目计划", { scope: "project" })
      expect(chinese.map((n) => n.title)).toContain("项目计划")

      // Word-level English: FTS5 unicode61 matches.
      const english = yield* kb.search("planning", { scope: "project" })
      expect(english.map((n) => n.title)).toContain("English note")
    }),
  )

  it.effect("update rewrites links and re-syncs dangling state", () =>
    Effect.gen(function* () {
      const kb = yield* KBService.Service
      const dir = base()
      const created = yield* kb.create({ title: "A", content: "[[Old]]", scope: "project", baseDir: dir })
      expect((yield* kb.linksFrom(created.id))[0]?.dangling).toBe(true)

      yield* kb.create({ title: "Old", content: "now exists", scope: "project", baseDir: dir })
      yield* kb.update({ id: created.id, content: "[[Old]] again" })
      expect((yield* kb.linksFrom(created.id))[0]?.dangling).toBe(false)
    }),
  )
})

describe("KBService syncFromDirectory", () => {
  it.effect("imports .md files as notes (file is the content source of truth)", () =>
    Effect.gen(function* () {
      const kb = yield* KBService.Service
      const fs = yield* FSUtil.Service
      const dir = base()
      yield* fs.ensureDir(dir).pipe(Effect.orDie)
      yield* fs.writeWithDirs(`${dir}/Imported.md`, "Hello [[World]]").pipe(Effect.orDie)
      yield* fs.writeWithDirs(`${dir}/World.md`, "exists").pipe(Effect.orDie)

      const synced = yield* kb.syncFromDirectory(dir, "global")
      expect(synced).toBe(2)

      const notes = yield* kb.list({ scope: "global" })
      expect(notes.map((n) => n.title).sort()).toEqual(["Imported", "World"])
      // The imported [[World]] link resolves (write-time dangling resolution).
      const imported = notes.find((n) => n.title === "Imported")!
      const links = yield* kb.linksFrom(imported.id)
      expect(links.find((l) => l.targetTitle === "World")?.dangling).toBe(false)
    }),
  )
})
