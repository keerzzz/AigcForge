export * as KBService from "./kb-service"

import path from "path"
import { and, asc, desc, eq, like, or, sql } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { KBNote } from "@aigcfroge/schema/kb-note"
import { Database } from "../database/database"
import { LayerNode } from "../effect/layer-node"
import { FSUtil } from "../fs-util"
import { EventV2 } from "../event"
import { KBLink } from "../kb/link"
import { KBLinkTable, KBNoteTable } from "./kb.sql"

// Telemetry (plan §3.8.4): lifecycle markers WITHOUT content.
export const Event = {
  NoteCreated: EventV2.define({
    type: "assistant_note_created",
    schema: { noteID: KBNote.NoteID },
  }),
  NoteRemoved: EventV2.define({
    type: "assistant_note_removed",
    schema: { noteID: KBNote.NoteID },
  }),
  KBSearched: EventV2.define({
    type: "assistant_kb_searched",
    schema: {},
  }),
}

/**
 * Knowledge base service (PRD §7.4): typed boundary over kb_note/kb_link +
 * the FTS5 index. Writes scan [[wikilinks]], upsert kb_link edges with
 * mechanical dangling detection, and mirror the note to its `.md` file (the
 * content source of truth, ADR-14 §2). Backlinks are derived from the
 * single-sided source edges — never double-written.
 */

const FTS_MAYBE = "CREATE VIRTUAL TABLE IF NOT EXISTS kb_note_fts USING fts5(note_id UNINDEXED, title, content, tokenize = 'unicode61')"

const toNote = (row: typeof KBNoteTable.$inferSelect): KBNote.Note =>
  new KBNote.Note({
    id: row.id,
    title: row.title,
    content: row.content,
    scope: row.scope,
    tags: row.tags,
    ...(row.aliases ? { aliases: row.aliases } : {}),
    format: row.format,
    createdAt: row.time_created,
    updatedAt: row.time_updated,
  })

const toLink = (row: typeof KBLinkTable.$inferSelect): KBNote.Link =>
  new KBNote.Link({
    sourceNoteID: row.source_note_id,
    ...(row.target_note_id ? { targetNoteID: row.target_note_id } : {}),
    targetTitle: row.target_title,
    linkType: row.link_type,
    dangling: row.dangling,
  })

export interface Interface {
  readonly create: (input: {
    readonly title: string
    readonly content: string
    readonly scope: KBNote.NoteScope
    readonly tags?: readonly string[]
    readonly aliases?: readonly string[]
    readonly format?: KBNote.NoteFormat
    readonly baseDir?: string
  }) => Effect.Effect<KBNote.Note>
  readonly get: (id: KBNote.NoteID) => Effect.Effect<KBNote.Note | undefined>
  readonly list: (options?: { readonly scope?: KBNote.NoteScope; readonly limit?: number }) => Effect.Effect<ReadonlyArray<KBNote.Note>>
  readonly update: (input: {
    readonly id: KBNote.NoteID
    readonly title?: string
    readonly content?: string
    readonly tags?: readonly string[]
    readonly aliases?: readonly string[]
    readonly baseDir?: string
  }) => Effect.Effect<KBNote.Note | undefined>
  readonly remove: (input: { readonly id: KBNote.NoteID; readonly baseDir?: string }) => Effect.Effect<void>
  /**
   * Full-text search (PRD §7.4 / plan P3): FTS5 unicode61 first; exact Chinese
   * phrases fall back to LIKE on title/content so CJK matching stays exact.
   */
  readonly search: (query: string, options?: { readonly scope?: KBNote.NoteScope; readonly limit?: number }) => Effect.Effect<ReadonlyArray<KBNote.Note>>
  /** Edges leaving a note (its outgoing [[links]]). */
  readonly linksFrom: (id: KBNote.NoteID) => Effect.Effect<ReadonlyArray<KBNote.Link>>
  /** Backlinks: notes that link TO the given note (single-sided + derived). */
  readonly backlinks: (id: KBNote.NoteID) => Effect.Effect<ReadonlyArray<KBNote.Note>>
  readonly listDangling: () => Effect.Effect<ReadonlyArray<KBNote.DanglingLink>>
  readonly countDangling: () => Effect.Effect<number>
  /**
   * Rebuild the index from the `.md` files in a knowledge-base directory
   * (file = content source of truth, ADR-14 §2). Used by the file watcher
   * and on first open; notes whose file disappeared are removed.
   */
  readonly syncFromDirectory: (dir: string, scope: KBNote.NoteScope) => Effect.Effect<number>
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/KBService") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const fs = yield* FSUtil.Service
    const events = yield* EventV2.Service
    yield* db.run(sql.raw(FTS_MAYBE)).pipe(Effect.orDie)

    const ensureFts = Effect.fn("KBService.ensureFts")(function* (noteID: string, title: string, content: string) {
      yield* db.run(sql`DELETE FROM kb_note_fts WHERE note_id = ${noteID}`).pipe(Effect.orDie)
      yield* db.run(sql`INSERT INTO kb_note_fts (note_id, title, content) VALUES (${noteID}, ${title}, ${content})`).pipe(Effect.orDie)
    })

    const removeFts = Effect.fn("KBService.removeFts")(function* (noteID: string) {
      yield* db.run(sql`DELETE FROM kb_note_fts WHERE note_id = ${noteID}`).pipe(Effect.orDie)
    })

    /**
     * A title (or alias) just became real: resolve every dangling edge that
     * points at it. Called after create/update so links resolve as targets
     * appear (PRD §7.4 dangling = target does not exist, evaluated at write).
     */
    const resolveDanglingFor = Effect.fn("KBService.resolveDanglingFor")(function* (title: string) {
      const notes = yield* db.select().from(KBNoteTable).all().pipe(Effect.orDie)
      const notesByTitle = new Map(notes.map((n) => [n.title, n.id]))
      const aliasesByNote = new Map(notes.flatMap((n) => (n.aliases ? [[n.id, n.aliases] as const] : [])))
      const target = KBLink.resolveTitle(title, notesByTitle, aliasesByNote)
      if (!target) return
      yield* db
        .update(KBLinkTable)
        .set({ target_note_id: target as KBNote.NoteID, dangling: false })
        .where(and(eq(KBLinkTable.dangling, true), eq(KBLinkTable.target_title, title)))
        .run()
        .pipe(Effect.orDie)
    })

    /** Rewrite the note's kb_link edges from its current content. */
    const syncLinks = Effect.fn("KBService.syncLinks")(function* (id: KBNote.NoteID, content: string) {
      yield* db.delete(KBLinkTable).where(eq(KBLinkTable.source_note_id, id)).run().pipe(Effect.orDie)
      const titles = KBLink.extractWikilinks(content)
      if (titles.length === 0) return
      const notes = yield* db.select().from(KBNoteTable).all().pipe(Effect.orDie)
      const notesByTitle = new Map(notes.map((n) => [n.title, n.id]))
      const aliasesByNote = new Map(notes.flatMap((n) => (n.aliases ? [[n.id, n.aliases] as const] : [])))
      for (const title of titles) {
        const target = KBLink.resolveTitle(title, notesByTitle, aliasesByNote)
        yield* db
          .run(sql`INSERT INTO kb_link (source_note_id, target_note_id, target_title, link_type, dangling, time_created) VALUES (${id}, ${target ?? null}, ${title}, 'reference', ${target === undefined}, ${Date.now()})`)
          .pipe(Effect.orDie)
      }
    })

    const writeFile = Effect.fn("KBService.writeFile")(function* (
      baseDir: string | undefined,
      scope: KBNote.NoteScope,
      title: string,
      content: string,
    ) {
      if (!baseDir) return
      // ADR-14 §2: global notes live in <config>/knowledge-base/, project notes
      // in <directory>/.aigcfroge/knowledge-base/ — the `.md` file is the
      // content source of truth.
      const dir = scope === "global" ? `${baseDir}/knowledge-base` : `${baseDir}/.aigcfroge/knowledge-base`
      yield* fs.ensureDir(dir).pipe(Effect.orDie)
      // Path-traversal guard (review BLOCKER#1): resolve the target and assert
      // it stays inside the knowledge-base directory — a title that slipped
      // past schema validation must not write an arbitrary `.md` outside it.
      const absolute = path.resolve(dir, `${title}.md`)
      if (!FSUtil.contains(dir, absolute)) {
        // Defense-in-depth assertion: schema validation already rejects such
        // titles; a title reaching here is a programming error — die loudly.
        return yield* Effect.die(new Error(`Note title "${title}" escapes the knowledge-base directory`))
      }
      yield* fs.writeWithDirs(absolute, content).pipe(Effect.orDie)
    })

    const create = Effect.fn("KBService.create")((input: {
      readonly title: string
      readonly content: string
      readonly scope: KBNote.NoteScope
      readonly tags?: readonly string[]
      readonly aliases?: readonly string[]
      readonly format?: KBNote.NoteFormat
      readonly baseDir?: string
    }) =>
      Effect.gen(function* () {
        const id = KBNote.NoteID.create()
        const now = Date.now()
        yield* db
          .insert(KBNoteTable)
          .values({
            id,
            title: input.title,
            content: input.content,
            scope: input.scope,
            tags: [...(input.tags ?? [])],
            ...(input.aliases ? { aliases: [...input.aliases] } : {}),
            format: input.format ?? "note",
            time_created: now,
            time_updated: now,
          })
          .run()
          .pipe(Effect.orDie)
        yield* ensureFts(id, input.title, input.content)
        yield* syncLinks(id, input.content)
        yield* writeFile(input.baseDir, input.scope, input.title, input.content)
        // A new title/alias resolves previously dangling edges pointing at it.
        yield* resolveDanglingFor(input.title)
        for (const alias of input.aliases ?? []) yield* resolveDanglingFor(alias)
        yield* events.publish(Event.NoteCreated, { noteID: id })
        const row = yield* db.select().from(KBNoteTable).where(eq(KBNoteTable.id, id)).get().pipe(Effect.orDie)
        if (!row) return yield* Effect.die(new Error("created note row vanished"))
        return toNote(row)
      }),
    )

    const get = Effect.fn("KBService.get")((id: KBNote.NoteID) =>
      Effect.gen(function* () {
        const row = yield* db.select().from(KBNoteTable).where(eq(KBNoteTable.id, id)).get().pipe(Effect.orDie)
        return row ? toNote(row) : undefined
      }),
    )

    const list = Effect.fn("KBService.list")((options?: { readonly scope?: KBNote.NoteScope; readonly limit?: number }) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select()
          .from(KBNoteTable)
          .where(options?.scope ? eq(KBNoteTable.scope, options.scope) : undefined)
          .orderBy(desc(KBNoteTable.time_updated))
          .limit(options?.limit ?? 100)
          .all()
          .pipe(Effect.orDie)
        return rows.map(toNote)
      }),
    )

    const update = Effect.fn("KBService.update")((input: {
      readonly id: KBNote.NoteID
      readonly title?: string
      readonly content?: string
      readonly tags?: readonly string[]
      readonly aliases?: readonly string[]
      readonly baseDir?: string
    }) =>
      Effect.gen(function* () {
        const prior = yield* db.select().from(KBNoteTable).where(eq(KBNoteTable.id, input.id)).get().pipe(Effect.orDie)
        if (!prior) return undefined
        const title = input.title ?? prior.title
        const content = input.content ?? prior.content
        yield* db
          .update(KBNoteTable)
          .set({
            ...(input.title !== undefined ? { title } : {}),
            ...(input.content !== undefined ? { content } : {}),
            ...(input.tags !== undefined ? { tags: [...input.tags] } : {}),
            ...(input.aliases !== undefined ? { aliases: [...input.aliases] } : {}),
            time_updated: Date.now(),
          })
          .where(eq(KBNoteTable.id, input.id))
          .run()
          .pipe(Effect.orDie)
        yield* ensureFts(input.id, title, content)
        yield* syncLinks(input.id, content)
        if (input.title !== undefined) yield* resolveDanglingFor(input.title)
        if (input.aliases !== undefined) for (const alias of input.aliases) yield* resolveDanglingFor(alias)
        // Keep the `.md` mirror in sync (review MAJOR #6): a renamed title
        // removes the old file, and the new content overwrites the note file —
        // otherwise the next syncFromDirectory would revert the edit.
        if (input.baseDir) {
          const dir = prior.scope === "global" ? `${input.baseDir}/knowledge-base` : `${input.baseDir}/.aigcfroge/knowledge-base`
          yield* fs.ensureDir(dir).pipe(Effect.orDie)
          if (input.title !== undefined && input.title !== prior.title) {
            yield* Effect.tryPromise(() => Bun.file(`${dir}/${prior.title}.md`).delete()).pipe(Effect.catch(() => Effect.void))
          }
          const absolute = path.resolve(dir, `${title}.md`)
          if (!FSUtil.contains(dir, absolute)) {
            return yield* Effect.die(new Error(`Note title "${title}" escapes the knowledge-base directory`))
          }
          yield* fs.writeWithDirs(absolute, content).pipe(Effect.orDie)
        }
        const row = yield* db.select().from(KBNoteTable).where(eq(KBNoteTable.id, input.id)).get().pipe(Effect.orDie)
        return row ? toNote(row) : undefined
      }),
    )

    const remove = Effect.fn("KBService.remove")((input: { readonly id: KBNote.NoteID; readonly baseDir?: string }) =>
      Effect.gen(function* () {
        const prior = yield* db.select().from(KBNoteTable).where(eq(KBNoteTable.id, input.id)).get().pipe(Effect.orDie)
        yield* removeFts(input.id)
        yield* db.delete(KBNoteTable).where(eq(KBNoteTable.id, input.id)).run().pipe(Effect.orDie)
        // Incoming links pointing at the removed note become dangling again
        // (review MAJOR #6): the edge stays, the target reference is cleared.
        yield* db
          .update(KBLinkTable)
          .set({ target_note_id: null, dangling: true })
          .where(eq(KBLinkTable.target_note_id, input.id))
          .run()
          .pipe(Effect.orDie)
        if (input.baseDir && prior) {
          const dir = prior.scope === "global" ? `${input.baseDir}/knowledge-base` : `${input.baseDir}/.aigcfroge/knowledge-base`
          yield* Effect.tryPromise(() => Bun.file(`${dir}/${prior.title}.md`).delete()).pipe(Effect.catch(() => Effect.void))
        }
        yield* events.publish(Event.NoteRemoved, { noteID: input.id })
      }),
    )

    const search = Effect.fn("KBService.search")((query: string, options?: { readonly scope?: KBNote.NoteScope; readonly limit?: number }) =>
      Effect.gen(function* () {
        yield* events.publish(Event.KBSearched, {})
        const limit = options?.limit ?? 20
        // FTS5 (unicode61) first: word-level for Latin, character-level for CJK.
        // A MATCH syntax error (e.g. an unquoted `"` in the query) must degrade
        // to the LIKE fallback — never a 500 (review MAJOR #4).
        const ftsRows = yield* db
          .all<{ note_id: string }>(sql`SELECT note_id FROM kb_note_fts WHERE kb_note_fts MATCH ${query} ORDER BY rank LIMIT ${limit}`)
          .pipe(Effect.catch(() => Effect.succeed([])))
        const notes: typeof KBNoteTable.$inferSelect[] = []
        for (const row of ftsRows) {
          const note = yield* db
            .select()
            .from(KBNoteTable)
            .where(eq(KBNoteTable.id, row.note_id as KBNote.NoteID))
            .get()
            .pipe(Effect.orDie)
          if (note && (!options?.scope || note.scope === options.scope)) notes.push(note)
        }
        if (notes.length >= limit) return notes.map(toNote)
        // LIKE fallback (plan P3): exact substring match for CJK phrases that
        // FTS5 unicode61 cannot express (e.g. "项目计划" as a phrase).
        const likeRows = yield* db
          .select()
          .from(KBNoteTable)
          .where(
            and(
              options?.scope ? eq(KBNoteTable.scope, options.scope) : undefined,
              or(like(KBNoteTable.title, `%${query}%`), like(KBNoteTable.content, `%${query}%`)),
            ),
          )
          .orderBy(desc(KBNoteTable.time_updated))
          .limit(limit - notes.length)
          .all()
          .pipe(Effect.orDie)
        const seen = new Set(notes.map((n) => n.id))
        for (const row of likeRows) {
          if (!seen.has(row.id)) notes.push(row)
        }
        return notes.map(toNote)
      }),
    )

    const linksFrom = Effect.fn("KBService.linksFrom")((id: KBNote.NoteID) =>
      Effect.gen(function* () {
        const rows = yield* db.select().from(KBLinkTable).where(eq(KBLinkTable.source_note_id, id)).all().pipe(Effect.orDie)
        return rows.map(toLink)
      }),
    )

    const backlinks = Effect.fn("KBService.backlinks")((id: KBNote.NoteID) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select()
          .from(KBLinkTable)
          .where(eq(KBLinkTable.target_note_id, id))
          .orderBy(asc(KBLinkTable.time_created))
          .all()
          .pipe(Effect.orDie)
        const notes: KBNote.Note[] = []
        for (const row of rows) {
          const note = yield* db.select().from(KBNoteTable).where(eq(KBNoteTable.id, row.source_note_id)).get().pipe(Effect.orDie)
          if (note) notes.push(toNote(note))
        }
        return notes
      }),
    )

    const listDangling = Effect.fn("KBService.listDangling")(() =>
      Effect.gen(function* () {
        const rows = yield* db
          .select()
          .from(KBLinkTable)
          .where(eq(KBLinkTable.dangling, true))
          .all()
          .pipe(Effect.orDie)
        const result: KBNote.DanglingLink[] = []
        for (const row of rows) {
          const source = yield* db.select().from(KBNoteTable).where(eq(KBNoteTable.id, row.source_note_id)).get().pipe(Effect.orDie)
          if (!source) continue
          result.push(
            new KBNote.DanglingLink({
              sourceNoteID: source.id,
              sourceTitle: source.title,
              targetTitle: row.target_title,
            }),
          )
        }
        return result
      }),
    )

    const syncFromDirectory = Effect.fn("KBService.syncFromDirectory")((dir: string, scope: KBNote.NoteScope) =>
      Effect.gen(function* () {
        const entries = yield* fs.readDirectoryEntries(dir).pipe(Effect.orDie)
        const files = entries.filter((e) => e.type === "file" && e.name.endsWith(".md"))
        let synced = 0
        for (const file of files) {
          const title = file.name.slice(0, -3)
          const content = (yield* fs.readFileStringSafe(`${dir}/${file.name}`).pipe(Effect.orDie)) ?? ""
          const existing = yield* db
            .select()
            .from(KBNoteTable)
            .where(and(eq(KBNoteTable.scope, scope), eq(KBNoteTable.title, title)))
            .get()
            .pipe(Effect.orDie)
          if (existing) {
            if (existing.content !== content) {
              yield* db
                .update(KBNoteTable)
                .set({ content, time_updated: Date.now() })
                .where(eq(KBNoteTable.id, existing.id))
                .run()
                .pipe(Effect.orDie)
              yield* ensureFts(existing.id, title, content)
              yield* syncLinks(existing.id, content)
            }
          } else {
            yield* create({ title, content, scope, tags: [], baseDir: undefined })
          }
          synced++
        }
        // Notes whose `.md` file disappeared are removed from the index
        // (review MINOR: the doc contract said so but nothing implemented it —
        // the file is the content source of truth, so its absence deletes).
        const existingNotes = yield* db
          .select()
          .from(KBNoteTable)
          .where(eq(KBNoteTable.scope, scope))
          .all()
          .pipe(Effect.orDie)
        const fileTitles = new Set(files.map((file) => file.name.slice(0, -3)))
        for (const note of existingNotes) {
          if (!fileTitles.has(note.title)) {
            yield* remove({ id: note.id, baseDir: undefined })
          }
        }
        return synced
      }),
    )

    const countDangling = Effect.fn("KBService.countDangling")(() =>
      Effect.gen(function* () {
        const rows = yield* db
          .select({ id: KBLinkTable.id })
          .from(KBLinkTable)
          .where(eq(KBLinkTable.dangling, true))
          .all()
          .pipe(Effect.orDie)
        return rows.length
      }),
    )

    return Service.of({ create, get, list, update, remove, search, linksFrom, backlinks, listDangling, countDangling, syncFromDirectory })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Database.defaultLayer))
export const node = LayerNode.make(layer, [Database.node, FSUtil.node, EventV2.node])
