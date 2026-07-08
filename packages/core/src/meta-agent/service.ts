export * as MetaAgentService from "./service"

import { and, eq, inArray, sql } from "drizzle-orm"
import { Context, DateTime, Effect, Layer } from "effect"
import { Database } from "../database/database"
import { MetaAgent } from "@aigcfroge/schema/meta-agent"
import { AgentV2 } from "../agent"
import { ModelV2 } from "../model"
import { ProviderV2 } from "../provider"
import { SessionSchema } from "../session/schema"
import { MetaAgentTable, MetaAgentSessionTable, MetaAgentStepTable } from "./sql"

/**
 * Input for creating a new meta agent configuration.
 */
export interface CreateInput {
  readonly title: string
  readonly agent: string
  readonly model: { id: string; providerID: string; variant?: string }
}

/**
 * A session attached to a meta agent, with its role.
 */
export interface AttachedSession {
  readonly sessionID: SessionSchema.ID
  readonly role: "orchestrator" | "worker" | "tool"
  readonly effort?: string
  readonly tokensUsed?: number
  readonly resultSummary?: string
}

export interface Interface {
  readonly create: (input: CreateInput) => Effect.Effect<MetaAgent.Info>
  readonly get: (id: MetaAgent.ID) => Effect.Effect<MetaAgent.Info | undefined>
  readonly list: () => Effect.Effect<MetaAgent.Info[]>
  readonly sessions: (metaID: MetaAgent.ID) => Effect.Effect<AttachedSession[]>
  readonly stats: (metaID: MetaAgent.ID) => Effect.Effect<{
    totalSessions: number
    totalTokens: number
    stepCount: number
  }>
  readonly attach: (input: {
    metaID: MetaAgent.ID
    sessionID: SessionSchema.ID
    role?: "orchestrator" | "worker" | "tool"
    effort?: string
  }) => Effect.Effect<void>
  readonly detach: (input: { metaID: MetaAgent.ID; sessionID: SessionSchema.ID }) => Effect.Effect<void>
  readonly remove: (id: MetaAgent.ID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/MetaAgentService") {}

function rowToInfo(row: typeof MetaAgentTable.$inferSelect): MetaAgent.Info {
  return MetaAgent.Info.make({
    id: MetaAgent.ID.make(row.id),
    title: row.title,
    agent: AgentV2.ID.make(row.agent),
    model: ModelV2.Ref.make({
      id: ModelV2.ID.make(row.model.id),
      providerID: ProviderV2.ID.make(row.model.providerID),
      variant: ModelV2.VariantID.make(row.model.variant ?? "default"),
    }),
    time: {
      created: DateTime.makeUnsafe(row.time_created),
      updated: DateTime.makeUnsafe(row.time_updated),
      archived: row.time_archived ? DateTime.makeUnsafe(row.time_archived) : undefined,
    },
  })
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service

    const create = Effect.fn("MetaAgentService.create")(function* (input: CreateInput) {
      const id = MetaAgent.ID.descending()
      const now = yield* DateTime.now
      const info = MetaAgent.Info.make({
        id,
        title: input.title,
        agent: AgentV2.ID.make(input.agent),
        model: ModelV2.Ref.make({
          id: ModelV2.ID.make(input.model.id),
          providerID: ProviderV2.ID.make(input.model.providerID),
          variant: ModelV2.VariantID.make(input.model.variant ?? "default"),
        }),
        time: { created: now, updated: now },
      })
      yield* db
        .insert(MetaAgentTable)
        .values({
          id,
          title: input.title,
          agent: input.agent,
          model: {
            id: input.model.id,
            providerID: input.model.providerID,
            variant: input.model.variant ?? "default",
          },
          time_created: DateTime.toEpochMillis(now),
          time_updated: DateTime.toEpochMillis(now),
        })
        .pipe(Effect.orDie)
      return info
    })

    const get = Effect.fn("MetaAgentService.get")(function* (id: MetaAgent.ID) {
      const row = yield* db.select().from(MetaAgentTable).where(eq(MetaAgentTable.id, id)).get().pipe(Effect.orDie)
      return row ? rowToInfo(row) : undefined
    })

    const list = Effect.fn("MetaAgentService.list")(function* () {
      const rows = yield* db.select().from(MetaAgentTable).orderBy(MetaAgentTable.time_created).all().pipe(Effect.orDie)
      return rows.map(rowToInfo)
    })

    const sessions = Effect.fn("MetaAgentService.sessions")(function* (metaID: MetaAgent.ID) {
      const rows = yield* db
        .select()
        .from(MetaAgentSessionTable)
        .where(eq(MetaAgentSessionTable.meta_agent_id, metaID))
        .all()
        .pipe(Effect.orDie)
      return rows.map(
        (r): AttachedSession => ({
          sessionID: SessionSchema.ID.make(r.session_id),
          role: r.role,
          effort: r.effort ?? undefined,
          tokensUsed: r.tokens_used ?? undefined,
          resultSummary: r.result_summary ?? undefined,
        }),
      )
    })

    const stats = Effect.fn("MetaAgentService.stats")(function* (metaID: MetaAgent.ID) {
      const sessionRows = yield* db
        .select()
        .from(MetaAgentSessionTable)
        .where(eq(MetaAgentSessionTable.meta_agent_id, metaID))
        .all()
        .pipe(Effect.orDie)
      const sessionIDs = sessionRows.map((r) => r.session_id)
      const stepCount =
        sessionIDs.length > 0
          ? yield* db
              .select({ count: sql<number>`COUNT(*)` })
              .from(MetaAgentStepTable)
              .where(inArray(MetaAgentStepTable.meta_agent_session_id, sessionIDs))
              .get()
              .pipe(Effect.orDie)
          : { count: 0 }
      return {
        totalSessions: sessionRows.length,
        totalTokens: sessionRows.reduce((sum, r) => sum + (r.tokens_used ?? 0), 0),
        stepCount: Number(stepCount?.count ?? 0),
      }
    })

    const attach = Effect.fn("MetaAgentService.attach")(function* (input: {
      metaID: MetaAgent.ID
      sessionID: SessionSchema.ID
      role?: "orchestrator" | "worker" | "tool"
      effort?: string
    }) {
      const now = yield* DateTime.now
      yield* db
        .insert(MetaAgentSessionTable)
        .values({
          meta_agent_id: input.metaID,
          session_id: input.sessionID,
          role: input.role ?? "worker",
          effort: input.effort ?? null,
          time_created: DateTime.toEpochMillis(now),
        })
        .pipe(Effect.orDie)
    })

    const detach = Effect.fn("MetaAgentService.detach")(function* (input: {
      metaID: MetaAgent.ID
      sessionID: SessionSchema.ID
    }) {
      yield* db
        .delete(MetaAgentSessionTable)
        .where(
          and(
            eq(MetaAgentSessionTable.meta_agent_id, input.metaID),
            eq(MetaAgentSessionTable.session_id, input.sessionID),
          ),
        )
        .pipe(Effect.orDie)
    })

    const remove = Effect.fn("MetaAgentService.remove")(function* (id: MetaAgent.ID) {
      yield* db.delete(MetaAgentTable).where(eq(MetaAgentTable.id, id)).pipe(Effect.orDie)
    })

    return Service.of({ create, get, list, sessions, stats, attach, detach, remove })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Database.defaultLayer))
