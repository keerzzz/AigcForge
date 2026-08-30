import { afterAll, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import fs from "fs/promises"
import { Database } from "@aigcfroge/core/database/database"
import { EventV2 } from "@aigcfroge/core/event"
import { FileMutation } from "@aigcfroge/core/file-mutation"
import { FSUtil } from "@aigcfroge/core/fs-util"
import { Global } from "@aigcfroge/core/global"
import { KBService } from "@aigcfroge/core/session/kb-service"
import { KBNote } from "@aigcfroge/schema/kb-note"
import { pollWithTimeout, testEffect } from "./lib/effect"

const it = testEffect(
  KBService.layer.pipe(
    Layer.provideMerge(FileMutation.layer),
    Layer.provideMerge(Database.defaultLayer),
    Layer.provideMerge(FSUtil.defaultLayer),
    Layer.provideMerge(EventV2.defaultLayer),
  ),
)

// Real temp dirs exercise the file mirror; FSUtil.defaultLayer backs onto the
// node filesystem. Track created dirs so afterAll can remove them — the tests
// run inside testEffect where `await using` is not available.
const createdDirs: string[] = []
const base = () => {
  const dir = `${process.env.TMPDIR ?? "/tmp"}/aigcfroge-kb-${Math.random().toString(36).slice(2)}`
  createdDirs.push(dir)
  return dir
}
afterAll(() =>
  Promise.all(createdDirs.map((dir) => fs.rm(dir, { recursive: true, force: true }).catch(() => undefined))),
)

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

  it.effect("rename re-resolves incoming edges instead of leaving a stale target", () =>
    Effect.gen(function* () {
      const kb = yield* KBService.Service
      const dir = base()
      const source = yield* kb.create({ title: "Source", content: "links to [[Old]]", scope: "project", baseDir: dir })
      const old = yield* kb.create({ title: "Old", content: "target", scope: "project", baseDir: dir })
      expect((yield* kb.linksFrom(source.id))[0]?.dangling).toBe(false)

      // Rename Old → NewName: [[Old]] no longer matches, so the edge must
      // re-dangle (review MAJOR: previously it stayed resolved to a dead title).
      yield* kb.update({ id: old.id, title: "NewName", baseDir: dir })
      expect((yield* kb.linksFrom(source.id))[0]?.dangling).toBe(true)

      // A new note titled Old re-binds the edge (dangling → resolved).
      yield* kb.create({ title: "Old", content: "back", scope: "project", baseDir: dir })
      expect((yield* kb.linksFrom(source.id))[0]?.dangling).toBe(false)
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

  it.effect("skips un-importable files instead of aborting the whole sync", () =>
    Effect.gen(function* () {
      const kb = yield* KBService.Service
      const fs = yield* FSUtil.Service
      const dir = base()
      yield* fs.ensureDir(dir).pipe(Effect.orDie)
      yield* fs.writeWithDirs(`${dir}/Good.md`, "hello").pipe(Effect.orDie)
      // A filename whose stem is not a valid note title (empty) must be skipped,
      // not abort the import of every other file (review MINOR).
      yield* fs.writeWithDirs(`${dir}/.md`, "junk").pipe(Effect.orDie)

      const synced = yield* kb.syncFromDirectory(dir, "global")
      expect(synced).toBe(1)

      const notes = yield* kb.list({ scope: "global" })
      expect(notes.map((n) => n.title)).toEqual(["Good"])
    }),
  )

  it.effect("removes notes whose .md file disappeared", () =>
    Effect.gen(function* () {
      const kb = yield* KBService.Service
      const fs = yield* FSUtil.Service
      const dir = base()
      yield* fs.writeWithDirs(`${dir}/Stay.md`, "stay").pipe(Effect.orDie)
      yield* fs.writeWithDirs(`${dir}/Gone.md`, "gone").pipe(Effect.orDie)
      yield* kb.syncFromDirectory(dir, "global")
      expect((yield* kb.list({ scope: "global" })).map((n) => n.title).sort()).toEqual(["Gone", "Stay"])

      yield* Effect.tryPromise(() => Bun.file(`${dir}/Gone.md`).delete()).pipe(Effect.orDie)
      yield* kb.syncFromDirectory(dir, "global")
      expect((yield* kb.list({ scope: "global" })).map((n) => n.title)).toEqual(["Stay"])
    }),
  )

  it.effect("refuses an emptied directory that would wipe the index (deletion guard)", () =>
    Effect.gen(function* () {
      const kb = yield* KBService.Service
      const fs = yield* FSUtil.Service
      const dir = base()
      yield* fs.writeWithDirs(`${dir}/Note.md`, "content").pipe(Effect.orDie)
      yield* kb.syncFromDirectory(dir, "global")

      const emptyDir = base()
      yield* fs.ensureDir(emptyDir).pipe(Effect.orDie)
      const exit = yield* kb.syncFromDirectory(emptyDir, "global").pipe(Effect.exit)
      expect(exit._tag).toBe("Failure")
      // The index is untouched after the refused sync.
      expect((yield* kb.list({ scope: "global" })).map((n) => n.title)).toEqual(["Note"])
    }),
  )
})

describe("KBService review hardening", () => {
  it.effect("rejects an invalid title without leaving a dirty row or writing a file", () =>
    Effect.gen(function* () {
      const kb = yield* KBService.Service
      const fs = yield* FSUtil.Service
      const dir = base()
      const exit = yield* kb
        .create({ title: "../../evil", content: "x", scope: "global", baseDir: dir })
        .pipe(Effect.exit)
      expect(exit._tag).toBe("Failure")
      // No dirty row: list still decodes and is empty (a poisoned row would defect here).
      expect(yield* kb.list({ scope: "global" })).toEqual([])
      expect(yield* fs.existsSafe(`${dir}/knowledge-base`)).toBe(false)
    }),
  )

  it.effect("update mirrors a rename to the .md file and removes the old file", () =>
    Effect.gen(function* () {
      const kb = yield* KBService.Service
      const fs = yield* FSUtil.Service
      const dir = base()
      const note = yield* kb.create({ title: "OldName", content: "v1", scope: "project", baseDir: dir })
      yield* kb.update({ id: note.id, title: "NewName", content: "v2", baseDir: dir })
      expect(yield* fs.existsSafe(`${dir}/.aigcfroge/knowledge-base/OldName.md`)).toBe(false)
      expect(yield* fs.readFileStringSafe(`${dir}/.aigcfroge/knowledge-base/NewName.md`)).toBe("v2")
    }),
  )

  it.effect("remove deletes the .md file and marks incoming links dangling", () =>
    Effect.gen(function* () {
      const kb = yield* KBService.Service
      const fs = yield* FSUtil.Service
      const dir = base()
      const source = yield* kb.create({ title: "A", content: "[[B]]", scope: "project", baseDir: dir })
      const target = yield* kb.create({ title: "B", content: "target", scope: "project", baseDir: dir })

      yield* kb.remove({ id: target.id, baseDir: dir })
      expect(yield* fs.existsSafe(`${dir}/.aigcfroge/knowledge-base/B.md`)).toBe(false)
      const link = (yield* kb.linksFrom(source.id))[0]
      expect(link?.dangling).toBe(true)
      expect(link?.targetNoteID).toBeUndefined()
    }),
  )

  it.effect("degrades an FTS5 syntax error to the LIKE fallback instead of failing", () =>
    Effect.gen(function* () {
      const kb = yield* KBService.Service
      const dir = base()
      yield* kb.create({ title: "Odd", content: 'unbalanced " quote note', scope: "project", baseDir: dir })
      const hits = yield* kb.search('unbalanced " quote')
      expect(hits.map((n) => n.title)).toContain("Odd")
    }),
  )

  it.effect("resolves [[title]] within the source note's own scope when both scopes share the title", () =>
    Effect.gen(function* () {
      const kb = yield* KBService.Service
      const dir = base()
      const globalShared = yield* kb.create({
        title: "Shared",
        content: "global version",
        scope: "global",
        baseDir: dir,
      })
      const projectShared = yield* kb.create({
        title: "Shared",
        content: "project version",
        scope: "project",
        baseDir: dir,
      })

      // A project note linking [[Shared]] must bind the PROJECT-scope note, not
      // the global one — the (scope, title) unique key makes both real.
      const projectSource = yield* kb.create({
        title: "ProjectSource",
        content: "see [[Shared]]",
        scope: "project",
        baseDir: dir,
      })
      const projectLink = (yield* kb.linksFrom(projectSource.id))[0]
      expect(projectLink?.dangling).toBe(false)
      expect(projectLink?.targetNoteID).toBe(projectShared.id)

      // The global side binds the global note.
      const globalSource = yield* kb.create({
        title: "GlobalSource",
        content: "see [[Shared]]",
        scope: "global",
        baseDir: dir,
      })
      const globalLink = (yield* kb.linksFrom(globalSource.id))[0]
      expect(globalLink?.dangling).toBe(false)
      expect(globalLink?.targetNoteID).toBe(globalShared.id)
    }),
  )
})

describe("KBService atomicity", () => {
  it.effect("duplicate create leaves the existing .md unchanged", () =>
    Effect.gen(function* () {
      const kb = yield* KBService.Service
      const fs = yield* FSUtil.Service
      const dir = base()
      const first = yield* kb.create({ title: "Note", content: "first", scope: "project", baseDir: dir })
      expect(yield* fs.readFileStringSafe(`${dir}/.aigcfroge/knowledge-base/Note.md`)).toBe("first")
      const exit = yield* kb
        .create({ title: "Note", content: "second", scope: "project", baseDir: dir })
        .pipe(Effect.exit)
      expect(exit._tag).toBe("Failure")
      // The existing note's file must not have been clobbered by the failed create.
      expect(yield* fs.readFileStringSafe(`${dir}/.aigcfroge/knowledge-base/Note.md`)).toBe("first")
      const notes = yield* kb.list({ scope: "project" })
      expect(notes.filter((n) => n.title === "Note")).toHaveLength(1)
      expect(notes.find((n) => n.id === first.id)?.content).toBe("first")
    }),
  )

  it.effect("rename to an existing title fails and leaves both mirrors intact", () =>
    Effect.gen(function* () {
      const kb = yield* KBService.Service
      const fs = yield* FSUtil.Service
      const dir = base()
      const a = yield* kb.create({ title: "A", content: "content A", scope: "project", baseDir: dir })
      const b = yield* kb.create({ title: "B", content: "content B", scope: "project", baseDir: dir })
      const exit = yield* kb.update({ id: a.id, title: "B", baseDir: dir }).pipe(Effect.exit)
      expect(exit._tag).toBe("Failure")
      // Old mirror still there, victim's mirror not clobbered.
      expect(yield* fs.readFileStringSafe(`${dir}/.aigcfroge/knowledge-base/A.md`)).toBe("content A")
      expect(yield* fs.readFileStringSafe(`${dir}/.aigcfroge/knowledge-base/B.md`)).toBe("content B")
      const notes = yield* kb.list({ scope: "project" })
      expect(notes.find((n) => n.id === a.id)?.title).toBe("A")
      expect(notes.find((n) => n.id === b.id)?.title).toBe("B")
    }),
  )

  it.effect("rename onto an occupied target path leaves the old mirror intact", () =>
    Effect.gen(function* () {
      const kb = yield* KBService.Service
      const fs = yield* FSUtil.Service
      const dir = base()
      const note = yield* kb.create({ title: "Old", content: "old content", scope: "project", baseDir: dir })
      // Occupy the target path as a directory: the rename's exists-guard must
      // die before any write is attempted.
      yield* fs.ensureDir(`${dir}/.aigcfroge/knowledge-base/New.md`).pipe(Effect.orDie)
      const exit = yield* kb
        .update({ id: note.id, title: "New", content: "new content", baseDir: dir })
        .pipe(Effect.exit)
      expect(exit._tag).toBe("Failure")
      // Old mirror must still exist; the new target must not have become a file.
      expect(yield* fs.existsSafe(`${dir}/.aigcfroge/knowledge-base/Old.md`)).toBe(true)
      expect(yield* fs.readFileStringSafe(`${dir}/.aigcfroge/knowledge-base/Old.md`)).toBe("old content")
      // Cleanup the directory we created for the failure injection.
      yield* Effect.tryPromise(() =>
        import("fs/promises").then((m) =>
          m.rm(`${dir}/.aigcfroge/knowledge-base/New.md`, { recursive: true, force: true }),
        ),
      ).pipe(Effect.catch(() => Effect.void))
    }),
  )

  it.live("startup sweep imports global mirrors from the config knowledge-base directory", () =>
    Effect.gen(function* () {
      const kb = yield* KBService.Service
      const fs = yield* FSUtil.Service
      const dir = base()
      yield* fs.writeWithDirs(`${dir}/knowledge-base/Boot.md`, "boot content").pipe(Effect.orDie)
      // startupLayer reads Global.Path.config once at layer-build time (the
      // forked sweep captures globalDir then), so swapping it just around the
      // build is race-free. Same mutable-Path pattern as
      // aigcfroge/test/config/config.test.ts.
      const previous = Global.Path.config
      ;(Global.Path as { config: string }).config = dir
      yield* Layer.build(KBService.startupLayer).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            ;(Global.Path as { config: string }).config = previous
          }),
        ),
      )
      const found = yield* pollWithTimeout(
        kb.list({ scope: "global" }).pipe(
          Effect.map((notes) => notes.find((note) => note.title === "Boot")),
          Effect.orDie,
        ),
        "startup sweep did not import the global mirror from the config directory",
      )
      expect(found.content).toBe("boot content")
    }),
  )
})
