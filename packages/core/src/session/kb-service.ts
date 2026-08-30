export * as KBService from "./kb-service"

import path from "path"
import { and, asc, desc, eq, like, or, sql } from "drizzle-orm"
import { Cause, Context, Effect, Layer, Schema } from "effect"
import { KBNote } from "@aigcfroge/schema/kb-note"
import { Database } from "../database/database"
import { LayerNode } from "../effect/layer-node"
import { FSUtil } from "../fs-util"
import { FileMutation } from "../file-mutation"
import { KeyedMutex } from "../effect/keyed-mutex"
import { EventV2 } from "../event"
import { Global } from "../global"
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

const FTS_MAYBE =
  "CREATE VIRTUAL TABLE IF NOT EXISTS kb_note_fts USING fts5(note_id UNINDEXED, title, content, tokenize = 'unicode61')"

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

export class SyncDirectoryError extends Schema.TaggedErrorClass<SyncDirectoryError>()("KBService.SyncDirectoryError", {
  message: Schema.String,
}) {}

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
  readonly list: (options?: {
    readonly scope?: KBNote.NoteScope
    readonly limit?: number
  }) => Effect.Effect<ReadonlyArray<KBNote.Note>>
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
  readonly search: (
    query: string,
    options?: { readonly scope?: KBNote.NoteScope; readonly limit?: number },
  ) => Effect.Effect<ReadonlyArray<KBNote.Note>>
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
  readonly syncFromDirectory: (dir: string, scope: KBNote.NoteScope) => Effect.Effect<number, SyncDirectoryError>
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/KBService") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const fs = yield* FSUtil.Service
    const fileMutation = yield* FileMutation.Service
    const events = yield* EventV2.Service
    // FileMutation 的锁没有暴露在 Service 上（file-mutation.ts:92 的 locks 是内部的），
    // 而「查重 + 写」必须在同一个临界区里，所以这里只能自带一把。后果要说清：
    // 它序列化的是 KB 自己的写，**不覆盖** write/edit/apply-patch 工具对同一个
    // .md 的写（那些走 FileMutation 内部的锁）。要真正单 owner，需要 FileMutation
    // 提供「在锁内跑调用方前置检查」的组合子 —— 直接把 writeAtomic 包进外层同键锁
    // 会重入死锁（KeyedMutex 非重入）。见 docs/technical-debt.md。
    const kbLocks = KeyedMutex.makeUnsafe<string>()
    yield* db.run(sql.raw(FTS_MAYBE)).pipe(Effect.orDie)

    const ensureFts = Effect.fn("KBService.ensureFts")(function* (noteID: string, title: string, content: string) {
      yield* db.run(sql`DELETE FROM kb_note_fts WHERE note_id = ${noteID}`).pipe(Effect.orDie)
      yield* db
        .run(sql`INSERT INTO kb_note_fts (note_id, title, content) VALUES (${noteID}, ${title}, ${content})`)
        .pipe(Effect.orDie)
    })

    const removeFts = Effect.fn("KBService.removeFts")(function* (noteID: string) {
      yield* db.run(sql`DELETE FROM kb_note_fts WHERE note_id = ${noteID}`).pipe(Effect.orDie)
    })

    // Scope-aware title index (review MAJOR #4): the unique key is
    // (scope, title), so the same title may exist in both scopes. Resolution
    // prefers the source note's OWN scope and only falls back across scopes
    // when the title is unambiguous — otherwise [[Foo]] could silently bind to
    // a note in the wrong scope.
    const buildTitleIndex = (notes: (typeof KBNoteTable.$inferSelect)[]) => {
      const byTitle = new Map<string, Array<{ scope: KBNote.NoteScope; id: KBNote.NoteID }>>()
      const scopeById = new Map<KBNote.NoteID, KBNote.NoteScope>()
      const aliasesByNote = new Map<KBNote.NoteID, readonly string[]>()
      for (const note of notes) {
        scopeById.set(note.id, note.scope)
        if (note.aliases) aliasesByNote.set(note.id, note.aliases)
        const list = byTitle.get(note.title) ?? []
        list.push({ scope: note.scope, id: note.id })
        byTitle.set(note.title, list)
      }
      return { byTitle, scopeById, aliasesByNote }
    }

    const resolveInScope = (
      title: string,
      scope: KBNote.NoteScope | undefined,
      index: ReturnType<typeof buildTitleIndex>,
    ): KBNote.NoteID | undefined => {
      const candidates = index.byTitle.get(title)
      if (candidates && candidates.length > 0) {
        if (scope !== undefined) {
          const same = candidates.find((c) => c.scope === scope)
          if (same) return same.id
        }
        // One candidate binds regardless of scope; two candidates (one per
        // scope) with no matching scope stay unresolved rather than guessing.
        if (candidates.length === 1) return candidates[0].id
        return undefined
      }
      for (const [noteID, aliases] of index.aliasesByNote) {
        if (aliases.includes(title) && (scope === undefined || index.scopeById.get(noteID) === scope)) return noteID
      }
      return undefined
    }

    /**
     * A title (or alias) just became real: resolve every dangling edge that
     * points at it. Called after create/update so links resolve as targets
     * appear (PRD §7.4 dangling = target does not exist, evaluated at write).
     * Each edge resolves against its own source note's scope.
     */
    const resolveDanglingFor = Effect.fn("KBService.resolveDanglingFor")(function* (title: string) {
      const notes = yield* db.select().from(KBNoteTable).all().pipe(Effect.orDie)
      const index = buildTitleIndex(notes)
      const dangling = yield* db
        .select()
        .from(KBLinkTable)
        .where(and(eq(KBLinkTable.dangling, true), eq(KBLinkTable.target_title, title)))
        .all()
        .pipe(Effect.orDie)
      for (const edge of dangling) {
        const target = resolveInScope(title, index.scopeById.get(edge.source_note_id), index)
        if (!target) continue
        yield* db
          .update(KBLinkTable)
          .set({ target_note_id: target, dangling: false })
          .where(and(eq(KBLinkTable.id, edge.id), eq(KBLinkTable.dangling, true)))
          .run()
          .pipe(Effect.orDie)
      }
    })

    /**
     * Re-resolve every incoming edge that currently points at `id` after its
     * identity (title or aliases) changed: an edge's literal `[[target]]` no
     * longer matches the renamed note, so it must either re-bind to a new
     * target or go dangling — otherwise a rename leaves stale non-dangling
     * edges (review MAJOR).
     */
    const reresolveIncoming = Effect.fn("KBService.reresolveIncoming")(function* (id: KBNote.NoteID) {
      const notes = yield* db.select().from(KBNoteTable).all().pipe(Effect.orDie)
      const index = buildTitleIndex(notes)
      const incoming = yield* db
        .select()
        .from(KBLinkTable)
        .where(eq(KBLinkTable.target_note_id, id))
        .all()
        .pipe(Effect.orDie)
      for (const edge of incoming) {
        const target = resolveInScope(edge.target_title, index.scopeById.get(edge.source_note_id), index)
        yield* db
          .update(KBLinkTable)
          .set({ target_note_id: target ?? null, dangling: target === undefined })
          .where(eq(KBLinkTable.id, edge.id))
          .run()
          .pipe(Effect.orDie)
      }
    })

    /** Rewrite the note's kb_link edges from its current content. */
    const syncLinks = Effect.fn("KBService.syncLinks")(function* (
      id: KBNote.NoteID,
      content: string,
      scope: KBNote.NoteScope,
    ) {
      yield* db.delete(KBLinkTable).where(eq(KBLinkTable.source_note_id, id)).run().pipe(Effect.orDie)
      const titles = KBLink.extractWikilinks(content)
      if (titles.length === 0) return
      const notes = yield* db.select().from(KBNoteTable).all().pipe(Effect.orDie)
      const index = buildTitleIndex(notes)
      for (const title of titles) {
        const target = resolveInScope(title, scope, index)
        yield* db
          .run(
            sql`INSERT INTO kb_link (source_note_id, target_note_id, target_title, link_type, dangling, time_created) VALUES (${id}, ${target ?? null}, ${title}, 'reference', ${target === undefined}, ${Date.now()})`,
          )
          .pipe(Effect.orDie)
      }
    })

    // ADR-14 §2: global notes live in <config>/knowledge-base/, project notes
    // in <directory>/.aigcfroge/knowledge-base/ — the `.md` file is the
    // content source of truth. Every mirror path is resolved and asserted to
    // stay inside its knowledge-base directory (FSUtil.contains): a title
    // that slipped past schema validation is a programming error — die loudly
    // (Clean Logs: no title in the message).
    const mirrorDir = (baseDir: string, scope: KBNote.NoteScope) =>
      scope === "global" ? `${baseDir}/knowledge-base` : `${baseDir}/.aigcfroge/knowledge-base`

    const create = Effect.fn("KBService.create")(
      (input: {
        readonly title: string
        readonly content: string
        readonly scope: KBNote.NoteScope
        readonly tags?: readonly string[]
        readonly aliases?: readonly string[]
        readonly format?: KBNote.NoteFormat
        readonly baseDir?: string
      }) =>
        Effect.gen(function* () {
          // Both entries (tool input, HTTP payload) schema-gate the title; check
          // again BEFORE any write so a direct caller cannot leave a dirty row
          // that poisons list/get via toNote validation (review hardening).
          if (Schema.decodeUnknownOption(KBNote.Title)(input.title)._tag === "None") {
            return yield* Effect.die(new Error(`Invalid note title: ${JSON.stringify(input.title)}`))
          }
          const id = KBNote.NoteID.create()
          const now = Date.now()
          if (input.baseDir) {
            const dir = mirrorDir(input.baseDir, input.scope)
            const absolute = path.resolve(dir, `${input.title}.md`)
            if (!FSUtil.contains(dir, absolute)) {
              return yield* Effect.die(new Error("Note title escapes the knowledge-base directory"))
            }
            const target: FileMutation.Target = { canonical: absolute, resource: `${input.title}.md` }
            // Serialize per-target: check DB duplicate and file existence inside the lock
            // BEFORE the file write so a duplicate DB row does not clobber the existing .md.
            yield* kbLocks.withLock(absolute)(
              Effect.uninterruptible(
                // oxlint-disable-next-line typescript/consistent-return -- Effect.gen with early returns via Effect.die is intentional
                Effect.gen(function* () {
                  const existing = yield* db
                    .select()
                    .from(KBNoteTable)
                    .where(and(eq(KBNoteTable.scope, input.scope), eq(KBNoteTable.title, input.title)))
                    .get()
                    .pipe(Effect.orDie)
                  if (existing) {
                    return yield* Effect.die(
                      new Error(`A note with this title already exists in scope "${input.scope}"`),
                    )
                  }
                  const fileExists = yield* fs.exists(absolute).pipe(Effect.orDie)
                  if (fileExists) {
                    return yield* Effect.die(new Error("A mirror file already exists for this title"))
                  }
                  yield* fileMutation.writeAtomic({ target, content: input.content }).pipe(Effect.orDie)
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
                }),
              ),
            )
          } else {
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
          }
          yield* ensureFts(id, input.title, input.content)
          yield* syncLinks(id, input.content, input.scope)
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

    const list = Effect.fn("KBService.list")(
      (options?: { readonly scope?: KBNote.NoteScope; readonly limit?: number }) =>
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

    const update = Effect.fn("KBService.update")(
      (input: {
        readonly id: KBNote.NoteID
        readonly title?: string
        readonly content?: string
        readonly tags?: readonly string[]
        readonly aliases?: readonly string[]
        readonly baseDir?: string
      }) =>
        Effect.gen(function* () {
          const prior = yield* db
            .select()
            .from(KBNoteTable)
            .where(eq(KBNoteTable.id, input.id))
            .get()
            .pipe(Effect.orDie)
          if (!prior) return undefined
          if (input.title !== undefined && Schema.decodeUnknownOption(KBNote.Title)(input.title)._tag === "None") {
            return yield* Effect.die(new Error(`Invalid note title: ${JSON.stringify(input.title)}`))
          }
          const title = input.title ?? prior.title
          const content = input.content ?? prior.content
          if (input.baseDir) {
            const dir = mirrorDir(input.baseDir, prior.scope)
            const newAbsolute = path.resolve(dir, `${title}.md`)
            if (!FSUtil.contains(dir, newAbsolute)) {
              return yield* Effect.die(new Error("Note title escapes the knowledge-base directory"))
            }
            if (input.title !== undefined && input.title !== prior.title) {
              const oldAbsolute = path.resolve(dir, `${prior.title}.md`)
              if (!FSUtil.contains(dir, oldAbsolute)) {
                return yield* Effect.die(new Error("Note title escapes the knowledge-base directory"))
              }
              const newTarget: FileMutation.Target = { canonical: newAbsolute, resource: `${title}.md` }
              const oldTarget: FileMutation.Target = { canonical: oldAbsolute, resource: `${prior.title}.md` }
              // Rename: write new mirror first, then remove old, both inside locks.
              // Lock both paths in sorted order to avoid deadlock; check duplicate/title
              // inside the lock so a concurrent create/rename cannot slip between check and write.
              const keys = [oldAbsolute, newAbsolute].sort()
              const doRename = Effect.uninterruptible(
                // oxlint-disable-next-line typescript/consistent-return -- Effect.gen with early returns via Effect.die is intentional
                Effect.gen(function* () {
                  const duplicate = yield* db
                    .select()
                    .from(KBNoteTable)
                    .where(and(eq(KBNoteTable.scope, prior.scope), eq(KBNoteTable.title, title)))
                    .get()
                    .pipe(Effect.orDie)
                  if (duplicate && duplicate.id !== input.id) {
                    return yield* Effect.die(
                      new Error(`A note with this title already exists in scope "${prior.scope}"`),
                    )
                  }
                  const newExists = yield* fs.exists(newAbsolute).pipe(Effect.orDie)
                  if (newExists) {
                    return yield* Effect.die(new Error("A mirror file already exists for the target title"))
                  }
                  yield* fileMutation.writeAtomic({ target: newTarget, content }).pipe(Effect.orDie)
                  yield* fileMutation.remove({ target: oldTarget }).pipe(
                    Effect.catch((error) =>
                      Effect.logWarning("failed to remove stale note mirror after rename", {
                        noteID: input.id,
                        error,
                      }),
                    ),
                  )
                  yield* db
                    .update(KBNoteTable)
                    .set({
                      title,
                      ...(input.content !== undefined ? { content } : {}),
                      ...(input.tags !== undefined ? { tags: [...input.tags] } : {}),
                      ...(input.aliases !== undefined ? { aliases: [...input.aliases] } : {}),
                      time_updated: Date.now(),
                    })
                    .where(eq(KBNoteTable.id, input.id))
                    .run()
                    .pipe(Effect.orDie)
                }),
              )
              // Acquire both locks in order
              if (keys[0] === keys[1]) {
                yield* kbLocks.withLock(keys[0])(doRename)
              } else {
                yield* kbLocks.withLock(keys[0])(kbLocks.withLock(keys[1])(doRename))
              }
            } else {
              // Content update or metadata update without rename
              const target: FileMutation.Target = { canonical: newAbsolute, resource: `${title}.md` }
              yield* kbLocks.withLock(newAbsolute)(
                Effect.uninterruptible(
                  Effect.gen(function* () {
                    yield* fileMutation.writeAtomic({ target, content }).pipe(Effect.orDie)
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
                  }),
                ),
              )
            }
          } else {
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
          }
          yield* ensureFts(input.id, title, content)
          yield* syncLinks(input.id, content, prior.scope)
          if (input.title !== undefined) yield* resolveDanglingFor(input.title)
          if (input.aliases !== undefined) for (const alias of input.aliases) yield* resolveDanglingFor(alias)
          // A rename/alias change invalidates incoming edges that resolved to the
          // old identity: re-resolve them against the current index so they point
          // at the new target or go dangling (review MAJOR).
          if (input.title !== undefined || input.aliases !== undefined) yield* reresolveIncoming(input.id)
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
          const dir = mirrorDir(input.baseDir, prior.scope)
          const absolute = path.resolve(dir, `${prior.title}.md`)
          if (!FSUtil.contains(dir, absolute)) {
            return yield* Effect.die(new Error("Note title escapes the knowledge-base directory"))
          }
          // Same standard as the rename path: FileMutation under the per-path
          // lock. A missing/unwritable mirror downgrades to a warning instead of
          // failing the delete — the DB row is already gone and
          // syncFromDirectory reconciles leftovers.
          const target: FileMutation.Target = { canonical: absolute, resource: `${prior.title}.md` }
          yield* kbLocks.withLock(absolute)(
            fileMutation
              .remove({ target })
              .pipe(
                Effect.catch((error) =>
                  Effect.logWarning("failed to remove note mirror on delete", { noteID: input.id, error }),
                ),
              ),
          )
        }
        yield* events.publish(Event.NoteRemoved, { noteID: input.id })
      }),
    )

    const search = Effect.fn("KBService.search")(
      (query: string, options?: { readonly scope?: KBNote.NoteScope; readonly limit?: number }) =>
        Effect.gen(function* () {
          yield* events.publish(Event.KBSearched, {})
          const limit = options?.limit ?? 20
          // FTS5 (unicode61) first: word-level for Latin. unicode61 tokenizes a
          // CJK run as a single token, so partial CJK phrases cannot match FTS —
          // the LIKE fallback below carries those (plan P3).
          // A MATCH syntax error (e.g. an unquoted `"` in the query) must degrade
          // to the LIKE fallback — never a 500 (review MAJOR #4).
          const ftsRows = yield* db
            .all<{
              note_id: KBNote.NoteID
            }>(sql`SELECT note_id FROM kb_note_fts WHERE kb_note_fts MATCH ${query} ORDER BY rank LIMIT ${limit}`)
            .pipe(
              Effect.catchCause((cause: Cause.Cause<unknown>) => {
                // Degrade ONLY FTS5 query syntax errors (bad user input) to the
                // LIKE fallback; a real DB failure (locked/corrupt) stays fatal
                // instead of silently returning empty results. The SQLite
                // message is nested inside the drizzle wrapper's cause chain.
                const rendered = Cause.pretty(cause)
                if (rendered.includes("syntax error") || rendered.includes("unterminated string"))
                  return Effect.succeed([])
                return Effect.failCause(cause)
              }),
              Effect.orDie,
            )
          const notes: (typeof KBNoteTable.$inferSelect)[] = []
          for (const row of ftsRows) {
            const note = yield* db
              .select()
              .from(KBNoteTable)
              .where(eq(KBNoteTable.id, row.note_id))
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
        const rows = yield* db
          .select()
          .from(KBLinkTable)
          .where(eq(KBLinkTable.source_note_id, id))
          .all()
          .pipe(Effect.orDie)
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
          const note = yield* db
            .select()
            .from(KBNoteTable)
            .where(eq(KBNoteTable.id, row.source_note_id))
            .get()
            .pipe(Effect.orDie)
          if (note) notes.push(toNote(note))
        }
        return notes
      }),
    )

    const listDangling = Effect.fn("KBService.listDangling")(() =>
      Effect.gen(function* () {
        const rows = yield* db.select().from(KBLinkTable).where(eq(KBLinkTable.dangling, true)).all().pipe(Effect.orDie)
        const result: KBNote.DanglingLink[] = []
        for (const row of rows) {
          const source = yield* db
            .select()
            .from(KBNoteTable)
            .where(eq(KBNoteTable.id, row.source_note_id))
            .get()
            .pipe(Effect.orDie)
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
        // One file whose stem is not a valid note title (e.g. `.md` → empty,
        // `..md` → `..`) must not abort the whole directory sync: import the
        // rest and skip the broken file (review MINOR).
        const importOne = Effect.fn("KBService.syncImportOne")((file: { name: string; type: string }) =>
          Effect.gen(function* () {
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
                yield* syncLinks(existing.id, content, scope)
              }
            } else {
              yield* create({ title, content, scope, tags: [], baseDir: undefined })
            }
            return 1
          }),
        )
        let synced = 0
        let skipped = 0
        for (const file of files) {
          const imported = yield* importOne(file).pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("skipping un-importable note file", { file: file.name, cause }).pipe(Effect.as(0)),
            ),
          )
          synced += imported
          if (imported === 0) skipped++
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
        // Deletion guard (review hardening): a directory without any .md file
        // must never wipe the index — a wrong or emptied path would otherwise
        // delete every note in the scope.
        if (files.length === 0 && existingNotes.length > 0) {
          return yield* new SyncDirectoryError({
            message: `Refusing to sync "${dir}" (scope "${scope}"): no .md files found but the index holds ${existingNotes.length} note(s) — likely a wrong or emptied directory`,
          })
        }
        // Only reconcile deletions when every file imported cleanly: a skipped
        // file means the directory listing isn't fully trustworthy, and the
        // absence-based deletion could drop notes the file system still owns.
        if (skipped === 0) {
          const fileTitles = new Set(files.map((file) => file.name.slice(0, -3)))
          for (const note of existingNotes) {
            if (!fileTitles.has(note.title)) {
              yield* remove({ id: note.id, baseDir: undefined })
            }
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

    return Service.of({
      create,
      get,
      list,
      update,
      remove,
      search,
      linksFrom,
      backlinks,
      listDangling,
      countDangling,
      syncFromDirectory,
    })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Database.defaultLayer),
  Layer.provide(EventV2.defaultLayer),
  Layer.provide(FSUtil.defaultLayer),
  Layer.provide(FileMutation.layer.pipe(Layer.provide(FSUtil.defaultLayer))),
)
export const node = LayerNode.make(layer.pipe(Layer.provide(FileMutation.layer)), [
  Database.node,
  FSUtil.node,
  EventV2.node,
])

// 收敛兜底（不是正确性依赖）：把磁盘上的 .md 重新导入索引，弥补历史遗留的半状态。
// 必须 forkIn(scope) —— Layer.effectDiscard 的 effect 跑在 layer 构建期，直接 await
// 会让服务端启动阻塞在一次文件系统扫描上。
// **已知局限**：只扫 global 目录。project 作用域的镜像在 <directory>/.aigcfroge/
// knowledge-base 下，启动时并不存在「当前项目」这一概念（目录由每个 Location 决定），
// 所以 project 侧的收敛需要挂在 Location 建立时而非进程启动时，属独立改动。
export const startupLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const kb = yield* Service
    const fs = yield* FSUtil.Service
    const scope = yield* Effect.scope
    const globalDir = `${Global.Path.config}/knowledge-base`
    yield* Effect.gen(function* () {
      const exists = yield* fs.exists(globalDir).pipe(Effect.catch(() => Effect.succeed(false)))
      if (!exists) return
      yield* kb.syncFromDirectory(globalDir, "global")
    }).pipe(
      Effect.catchCause((cause) => Effect.logWarning("knowledge base startup sync failed", { cause })),
      Effect.forkIn(scope),
    )
  }),
)
export const startupNode = LayerNode.make(startupLayer, [node, FSUtil.node])
