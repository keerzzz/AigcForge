import { SessionV2 } from "@aigcfroge/core/session"
import { SessionShareV2 } from "@aigcfroge/core/session/share-v2"
import { DateTime, Effect, Option, Schema } from "effect"
import { HttpServerRequest } from "effect/unstable/http"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { ProductModePolicy } from "@aigcfroge/core/product-mode-policy"
import { Api } from "../api"
import { SessionsCursor } from "../groups/session"
import {
  ConflictError,
  InvalidCursorError,
  InvalidRequestError,
  ServiceUnavailableError,
  SessionNotFoundError,
  UnsupportedProductModeError,
  UnknownError,
  CompositionResolveError,
} from "../errors"
import { AbsolutePath } from "@aigcfroge/core/schema"

const DefaultSessionsLimit = 50

export const SessionHandler = HttpApiBuilder.group(Api, "server.session", (handlers) =>
  Effect.gen(function* () {
    const session = yield* SessionV2.Service
    const share = yield* SessionShareV2.Service

    const requireSessionAndCapability = (sessionID: string, capabilitiesHeader?: string | null) =>
      Effect.gen(function* () {
        const idOpt = Schema.decodeUnknownOption(SessionV2.SessionSchema.ID)(sessionID)
        if (Option.isNone(idOpt)) {
          return yield* Effect.fail(
            new SessionNotFoundError({
              sessionID,
              message: `Session not found: ${sessionID}`,
            }),
          )
        }
        const info = yield* session.get(idOpt.value).pipe(
          Effect.catchTag("Session.NotFoundError", (error) =>
            Effect.fail(
              new SessionNotFoundError({
                sessionID: error.sessionID,
                message: `Session not found: ${error.sessionID}`,
              }),
            ),
          ),
        )
        if (!ProductModePolicy.isSessionSupported(info, capabilitiesHeader)) {
          return yield* Effect.fail(
            new SessionNotFoundError({
              sessionID,
              message: `Session not found: ${sessionID}`,
            }),
          )
        }
        return info
      })

    const requireRuntimeSession = (sessionID: string, capabilitiesHeader?: string | null) =>
      requireSessionAndCapability(sessionID, capabilitiesHeader).pipe(
        Effect.flatMap((info) =>
          ProductModePolicy.assertRuntimeSupported(info.mode).pipe(
            Effect.map(() => info),
            Effect.mapError(
              (error) => new UnsupportedProductModeError({ mode: error.mode, message: error.message }),
            ),
          ),
        ),
      )

    const requireRuntimeControlSession = (
      sessionID: string,
      operation: string,
      capabilitiesHeader?: string | null,
    ) =>
      Effect.gen(function* () {
        const info = yield* requireRuntimeSession(sessionID, capabilitiesHeader)
        if (info.mode === "custom") {
          return yield* new UnsupportedProductModeError({
            mode: info.mode,
            message: `Mode "${info.mode}" does not support session.${operation} in Custom Mode M1.`,
          })
        }
        return info
      })

    return handlers
      .handle(
        "session.list",
        Effect.fn(function* (ctx) {
          const req = yield* HttpServerRequest.HttpServerRequest
          const capabilitiesHeader = req.headers[ProductModePolicy.CAPABILITIES_HEADER]
          const query =
            ctx.query.cursor !== undefined
              ? yield* SessionsCursor.parse(ctx.query.cursor).pipe(
                  Effect.mapError(() => new InvalidCursorError({ message: "Invalid cursor" })),
                )
              : ctx.query
          const rawSessions = yield* session.list({
            ...query,
            workspaceID: query.workspace,
            mode: query.mode,
            limit: ctx.query.limit ?? DefaultSessionsLimit,
          })
          const sessions = ProductModePolicy.filterSupportedSessions(rawSessions, capabilitiesHeader)
          const first = sessions[0]
          const last = sessions.at(-1)
          return {
            data: sessions,
            cursor: {
              previous: first
                ? SessionsCursor.make({
                    ...query,
                    anchor: {
                      id: first.id,
                      time: DateTime.toEpochMillis(first.time.created),
                      direction: "previous",
                    },
                  })
                : undefined,
              next: last
                ? SessionsCursor.make({
                    ...query,
                    anchor: {
                      id: last.id,
                      time: DateTime.toEpochMillis(last.time.created),
                      direction: "next",
                    },
                  })
                : undefined,
            },
          }
        }),
      )
      .handle(
        "session.create",
        Effect.fn(function* (ctx) {
          yield* ProductModePolicy.assertCreationSupported(ctx.payload.mode)
          return {
            data: yield* session
              .create({
                id: ctx.payload.id,
                parentID: ctx.payload.parentID,
                mode: ctx.payload.mode,
                agent: ctx.payload.agent,
                model: ctx.payload.model,
                location: ctx.payload.location ?? { directory: AbsolutePath.make(process.cwd()) },
              })
              .pipe(
                Effect.catchTag("Session.PromptConflictError", (err) =>
                  Effect.fail(
                    new ConflictError({
                      message: `Conflicting session or composition snapshot for session ${err.sessionID}`,
                    }),
                  ),
                ),
                Effect.catchTag("SessionComposition.AgentDelegationForbiddenError", (err) =>
                  Effect.fail(
                    new InvalidRequestError({
                      message: `Agent ${err.agentID} is not allowed in session ${err.sessionID} (allowed: ${err.allowedAgentID ?? "none"})`,
                    }),
                  ),
                ),
                Effect.catchTag("SessionComposition.SnapshotNotFoundError", (err) =>
                  Effect.fail(
                    new InvalidRequestError({
                      message: `Missing composition snapshot for custom parent session ${err.sessionID}`,
                    }),
                  ),
                ),
                Effect.catchTag("SessionComposition.SnapshotDecodeError", (err) =>
                  Effect.fail(
                    new InvalidRequestError({
                      message: `Failed to decode composition snapshot for session ${err.sessionID}: ${err.details}`,
                    }),
                  ),
                ),
              ),
          }
        }),
      )
      .handle(
        "session.custom",
        Effect.fn(function* (ctx) {
          if (!ProductModePolicy.isCustomModeEnabled()) {
            return yield* new InvalidRequestError({
              message: ProductModePolicy.CUSTOM_MODE_DISABLED_MESSAGE,
            })
          }
          // MEDIUM-1: symmetric with the instance custom-composition/start gate —
          // creating custom sessions requires the custom capability header.
          const req = yield* HttpServerRequest.HttpServerRequest
          if (!ProductModePolicy.isCustomCapable(req.headers[ProductModePolicy.CAPABILITIES_HEADER])) {
            return yield* new InvalidRequestError({
              message: `Custom mode requires capability header '${ProductModePolicy.CAPABILITIES_HEADER}: ${ProductModePolicy.CAPABILITY_CUSTOM_V1}'`,
            })
          }
          const result = yield* session
            .createCustom({
              id: ctx.payload.id,
              composition: ctx.payload.composition,
              expectedPlanDigest: ctx.payload.expectedPlanDigest,
              location: ctx.payload.location ?? { directory: AbsolutePath.make(process.cwd()) },
              title: ctx.payload.title,
            })
            .pipe(
              Effect.catchTag("Composition.ResolveError", (err) =>
                Effect.fail(
                  new CompositionResolveError({
                    code: err.code,
                    message: err.message,
                    diagnostics: err.diagnostics,
                  }),
                ),
              ),
              Effect.catchTag("Session.PromptConflictError", (err) =>
                Effect.fail(
                  new ConflictError({
                    message: `Prompt conflict in session ${err.sessionID}`,
                  }),
                ),
              ),
              Effect.catchTag("SessionComposition.SnapshotAlreadyExistsError", (err) =>
                Effect.fail(
                  new ConflictError({
                    message: `Snapshot already exists for session ${err.sessionID}`,
                  }),
                ),
              ),
              Effect.catchTag("SessionComposition.SnapshotDecodeError", (err) =>
                Effect.fail(
                  new InvalidRequestError({
                    message: `Failed to decode snapshot for session ${err.sessionID}: ${err.details}`,
                  }),
                ),
              ),
            )
          return {
            data: result.session,
            snapshot: result.snapshot,
          }
        }),
      )
      .handle(
        "session.get",
        Effect.fn(function* (ctx) {
          const req = yield* HttpServerRequest.HttpServerRequest
          const capabilitiesHeader = req.headers[ProductModePolicy.CAPABILITIES_HEADER]
          const info = yield* requireSessionAndCapability(ctx.params.sessionID, capabilitiesHeader)
          return {
            data: info,
          }
        }),
      )
      .handle(
        "session.switchAgent",
        Effect.fn(function* (ctx) {
          const req = yield* HttpServerRequest.HttpServerRequest
          const capabilitiesHeader = req.headers[ProductModePolicy.CAPABILITIES_HEADER]
          yield* requireRuntimeControlSession(ctx.params.sessionID, "switchAgent", capabilitiesHeader)
          yield* session.switchAgent({ sessionID: ctx.params.sessionID, agent: ctx.payload.agent }).pipe(
            Effect.catchTag("Session.NotFoundError", (error) =>
              Effect.fail(
                new SessionNotFoundError({
                  sessionID: error.sessionID,
                  message: `Session not found: ${error.sessionID}`,
                }),
              ),
            ),
          )
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "session.switchModel",
        Effect.fn(function* (ctx) {
          const req = yield* HttpServerRequest.HttpServerRequest
          const capabilitiesHeader = req.headers[ProductModePolicy.CAPABILITIES_HEADER]
          yield* requireRuntimeControlSession(ctx.params.sessionID, "switchModel", capabilitiesHeader)
          yield* session.switchModel({ sessionID: ctx.params.sessionID, model: ctx.payload.model }).pipe(
            Effect.catchTag("Session.NotFoundError", (error) =>
              Effect.fail(
                new SessionNotFoundError({
                  sessionID: error.sessionID,
                  message: `Session not found: ${error.sessionID}`,
                }),
              ),
            ),
          )
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "session.prompt",
        Effect.fn(function* (ctx) {
          const req = yield* HttpServerRequest.HttpServerRequest
          const capabilitiesHeader = req.headers[ProductModePolicy.CAPABILITIES_HEADER]
          yield* requireRuntimeSession(ctx.params.sessionID, capabilitiesHeader)
          return {
            data: yield* session
              .prompt({
                sessionID: ctx.params.sessionID,
                id: ctx.payload.id,
                prompt: ctx.payload.prompt,
                delivery: ctx.payload.delivery,
                resume: ctx.payload.resume,
              })
              .pipe(
                Effect.catchTag("Session.NotFoundError", (error) =>
                  Effect.fail(
                    new SessionNotFoundError({
                      sessionID: error.sessionID,
                      message: `Session not found: ${error.sessionID}`,
                    }),
                  ),
                ),
                Effect.catchTag("Session.PromptConflictError", (error) =>
                  Effect.fail(
                    new ConflictError({
                      message: `Prompt message ID conflicts with an existing durable record: ${error.messageID}`,
                      resource: error.messageID,
                    }),
                  ),
                ),
                Effect.catchTag("SessionComposition.SnapshotNotFoundError", (error) =>
                  Effect.fail(
                    new SessionNotFoundError({
                      sessionID: error.sessionID,
                      message: `Snapshot not found for custom session: ${error.sessionID}`,
                    }),
                  ),
                ),
                Effect.catchTag("SessionComposition.SnapshotDecodeError", (error) =>
                  Effect.fail(
                    new InvalidRequestError({
                      message: `Invalid custom session snapshot: ${error.sessionID}`,
                    }),
                  ),
                ),
              ),
          }
        }),
      )
      .handle(
        "session.compact",
        Effect.fn(function* (ctx) {
          const req = yield* HttpServerRequest.HttpServerRequest
          const capabilitiesHeader = req.headers[ProductModePolicy.CAPABILITIES_HEADER]
          yield* requireRuntimeControlSession(ctx.params.sessionID, "compact", capabilitiesHeader)
          yield* session.compact({ sessionID: ctx.params.sessionID }).pipe(
            Effect.catchTag("Session.NotFoundError", (error) =>
              Effect.fail(
                new SessionNotFoundError({
                  sessionID: error.sessionID,
                  message: `Session not found: ${error.sessionID}`,
                }),
              ),
            ),
            Effect.catchTag("Session.OperationUnavailableError", (error) =>
              Effect.fail(
                new ServiceUnavailableError({
                  message: `Session ${error.operation} is not available yet`,
                  service: `session.${error.operation}`,
                }),
              ),
            ),
          )
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "session.wait",
        Effect.fn(function* (ctx) {
          const req = yield* HttpServerRequest.HttpServerRequest
          const capabilitiesHeader = req.headers[ProductModePolicy.CAPABILITIES_HEADER]
          yield* requireRuntimeControlSession(ctx.params.sessionID, "wait", capabilitiesHeader)
          yield* session.wait(ctx.params.sessionID).pipe(
            Effect.catchTag("Session.NotFoundError", (error) =>
              Effect.fail(
                new SessionNotFoundError({
                  sessionID: error.sessionID,
                  message: `Session not found: ${error.sessionID}`,
                }),
              ),
            ),
            Effect.catchTag("Session.OperationUnavailableError", (error) =>
              Effect.fail(
                new ServiceUnavailableError({
                  message: `Session ${error.operation} is not available yet`,
                  service: `session.${error.operation}`,
                }),
              ),
            ),
          )
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "session.context",
        Effect.fn(function* (ctx) {
          const req = yield* HttpServerRequest.HttpServerRequest
          const capabilitiesHeader = req.headers[ProductModePolicy.CAPABILITIES_HEADER]
          yield* requireRuntimeSession(ctx.params.sessionID, capabilitiesHeader)
          return {
            data: yield* session.context(ctx.params.sessionID).pipe(
              Effect.catchTag("Session.NotFoundError", (error) =>
                Effect.fail(
                  new SessionNotFoundError({
                    sessionID: error.sessionID,
                    message: `Session not found: ${error.sessionID}`,
                  }),
                ),
              ),
              Effect.catchTag("Session.MessageDecodeError", (error) => {
                const ref = `err_${crypto.randomUUID().slice(0, 8)}`
                return Effect.logError("failed to decode session message").pipe(
                  Effect.annotateLogs({ ref, sessionID: error.sessionID, messageID: error.messageID }),
                  Effect.andThen(
                    Effect.fail(
                      new UnknownError({
                        message: "Unexpected server error. Check server logs for details.",
                        ref,
                      }),
                    ),
                  ),
                )
              }),
            ),
          }
        }),
      )
      .handle(
        "session.children",
        Effect.fn(function* (ctx) {
          const req = yield* HttpServerRequest.HttpServerRequest
          const capabilitiesHeader = req.headers[ProductModePolicy.CAPABILITIES_HEADER]
          yield* requireRuntimeSession(ctx.params.sessionID, capabilitiesHeader)
          return {
            data: yield* session.children(ctx.params.sessionID).pipe(
              Effect.catchTag("Session.NotFoundError", (error) =>
                Effect.fail(
                  new SessionNotFoundError({
                    sessionID: error.sessionID,
                    message: `Session not found: ${error.sessionID}`,
                  }),
                ),
              ),
            ),
          }
        }),
      )
      .handle(
        "session.interrupt",
        Effect.fn(function* (ctx) {
          const req = yield* HttpServerRequest.HttpServerRequest
          const capabilitiesHeader = req.headers[ProductModePolicy.CAPABILITIES_HEADER]
          yield* requireRuntimeControlSession(ctx.params.sessionID, "interrupt", capabilitiesHeader)
          yield* session.interrupt(ctx.params.sessionID)
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "session.shell",
        Effect.fn(function* (ctx) {
          const req = yield* HttpServerRequest.HttpServerRequest
          const capabilitiesHeader = req.headers[ProductModePolicy.CAPABILITIES_HEADER]
          yield* requireRuntimeSession(ctx.params.sessionID, capabilitiesHeader)
          return {
            data: yield* session
              .shell({
                sessionID: ctx.params.sessionID,
                id: ctx.payload.id,
                command: ctx.payload.command,
                resume: ctx.payload.resume,
              })
              .pipe(
                Effect.catchTag("Session.NotFoundError", (error) =>
                  Effect.fail(
                    new SessionNotFoundError({
                      sessionID: error.sessionID,
                      message: `Session not found: ${error.sessionID}`,
                    }),
                  ),
                ),
                Effect.catchTag("Session.PromptConflictError", (error) =>
                  Effect.fail(
                    new ConflictError({
                      message: `Shell message ID conflicts with an existing durable record: ${error.messageID}`,
                      resource: error.messageID,
                    }),
                  ),
                ),
                Effect.catchTag("SessionComposition.SnapshotNotFoundError", (error) =>
                  Effect.fail(
                    new SessionNotFoundError({
                      sessionID: error.sessionID,
                      message: `Snapshot not found for custom session: ${error.sessionID}`,
                    }),
                  ),
                ),
                Effect.catchTag("SessionComposition.SnapshotDecodeError", (error) =>
                  Effect.fail(
                    new InvalidRequestError({
                      message: `Invalid custom session snapshot: ${error.sessionID}`,
                    }),
                  ),
                ),
              ),
          }
        }),
      )
      .handle(
        "session.skill",
        Effect.fn(function* (ctx) {
          const req = yield* HttpServerRequest.HttpServerRequest
          const capabilitiesHeader = req.headers[ProductModePolicy.CAPABILITIES_HEADER]
          yield* requireRuntimeSession(ctx.params.sessionID, capabilitiesHeader)
          return {
            data: yield* session
              .skill({
                sessionID: ctx.params.sessionID,
                id: ctx.payload.id,
                skill: ctx.payload.skill,
                resume: ctx.payload.resume,
              })
              .pipe(
                Effect.catchTag("Session.NotFoundError", (error) =>
                  Effect.fail(
                    new SessionNotFoundError({
                      sessionID: error.sessionID,
                      message: `Session not found: ${error.sessionID}`,
                    }),
                  ),
                ),
                Effect.catchTag("Session.PromptConflictError", (error) =>
                  Effect.fail(
                    new ConflictError({
                      message: `Skill message ID conflicts with an existing durable record: ${error.messageID}`,
                      resource: error.messageID,
                    }),
                  ),
                ),
                Effect.catchTag("SessionComposition.SnapshotNotFoundError", (error) =>
                  Effect.fail(
                    new SessionNotFoundError({
                      sessionID: error.sessionID,
                      message: `Snapshot not found for custom session: ${error.sessionID}`,
                    }),
                  ),
                ),
                Effect.catchTag("SessionComposition.SnapshotDecodeError", (error) =>
                  Effect.fail(
                    new InvalidRequestError({
                      message: `Invalid custom session snapshot: ${error.sessionID}`,
                    }),
                  ),
                ),
              ),
          }
        }),
      )
      .handle(
        "session.share",
        Effect.fn(function* (ctx) {
          const req = yield* HttpServerRequest.HttpServerRequest
          const capabilitiesHeader = req.headers[ProductModePolicy.CAPABILITIES_HEADER]
          yield* requireRuntimeControlSession(ctx.params.sessionID, "share", capabilitiesHeader)
          yield* share
            .share({
              sourceSessionID: ctx.params.sessionID,
              targetSessionID: ctx.payload.targetSessionID,
              scope: ctx.payload.scope,
              trigger: ctx.payload.trigger,
            })
            .pipe(
              Effect.catchTag("Session.NotFoundError", (error) =>
                Effect.fail(
                  new SessionNotFoundError({
                    sessionID: error.sessionID,
                    message: `Session not found: ${error.sessionID}`,
                  }),
                ),
              ),
            )
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle("session.fork", function (ctx) {
        return Effect.gen(function* () {
          const req = yield* HttpServerRequest.HttpServerRequest
          const capabilitiesHeader = req.headers[ProductModePolicy.CAPABILITIES_HEADER]
          const parent = yield* requireSessionAndCapability(ctx.params.sessionID, capabilitiesHeader)
          // MEDIUM-5: the creation gate exists to block generic ROOT creation of
          // custom sessions; fork is not root creation. A custom parent routes to
          // V2 create({parentID}), which copies the frozen snapshot (orphan custom
          // parents fail typed below: SnapshotNotFound -> InvalidRequestError).
          if (parent.mode !== "custom") {
            yield* ProductModePolicy.assertCreationSupported(parent.mode)
          }
          const child = yield* session.create({
            location: parent.location,
            parentID: parent.id,
            mode: parent.mode,
          })
          yield* share.share({
            sourceSessionID: ctx.params.sessionID,
            targetSessionID: child.id,
            scope: "full",
            trigger: true,
          })
          return { sessionID: child.id }
        }).pipe(
          Effect.catchTag("Session.NotFoundError", (error) =>
            Effect.fail(
              new SessionNotFoundError({
                sessionID: error.sessionID,
                message: `Session not found: ${error.sessionID}`,
              }),
            ),
          ),
          Effect.catchTag("UnsupportedProductModeError", (error) =>
            Effect.fail(
              new UnsupportedProductModeError({
                mode: error.mode,
                message: error.message,
              }),
            ),
          ),
          Effect.catchTag("Session.PromptConflictError", (error) =>
            Effect.fail(
              new InvalidRequestError({
                message: `Conflicting composition snapshot for session ${error.sessionID}`,
              }),
            ),
          ),
          Effect.catchTag("SessionComposition.AgentDelegationForbiddenError", (error) =>
            Effect.fail(
              new InvalidRequestError({
                message: `Agent ${error.agentID} is not allowed in session ${error.sessionID} (allowed: ${error.allowedAgentID ?? "none"})`,
              }),
            ),
          ),
          Effect.catchTag("SessionComposition.SnapshotNotFoundError", (error) =>
            Effect.fail(
              new InvalidRequestError({
                message: `Missing composition snapshot for custom parent session ${error.sessionID}`,
              }),
            ),
          ),
          Effect.catchTag("SessionComposition.SnapshotDecodeError", (error) =>
            Effect.fail(
              new InvalidRequestError({
                message: `Failed to decode composition snapshot for session ${error.sessionID}: ${error.details}`,
              }),
            ),
          ),
        )
      })
  }),
)
