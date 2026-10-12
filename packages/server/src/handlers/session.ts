import { SessionV2 } from "@aigcfroge/core/session"
import { SessionStore } from "@aigcfroge/core/session/store"
import { SessionShareV2 } from "@aigcfroge/core/session/share-v2"
import { WorkReviewService } from "@aigcfroge/core/session/work-review-service"
import { absurd, Cause, DateTime, Effect, Layer, Option, Schema } from "effect"
import { HttpServerRequest } from "effect/unstable/http"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { SqlError } from "effect/unstable/sql/SqlError"
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core/errors"
import { ProductModePolicy } from "@aigcfroge/core/product-mode-policy"
import { Api } from "../api"
import { SessionsCursor } from "../groups/session"
import {
  ConflictError,
  ForbiddenError,
  InvalidCursorError,
  InvalidRequestError,
  ServiceUnavailableError,
  SessionNotFoundError,
  UnsupportedProductModeError,
  UnknownError,
  WorkReviewUnavailableError,
  CompositionResolveError,
} from "../errors"
import { AbsolutePath } from "@aigcfroge/core/schema"

const DefaultSessionsLimit = 50

export const SessionHandler = HttpApiBuilder.group(Api, "server.session", (handlers) =>
  Effect.gen(function* () {
    const session = yield* SessionV2.Service
    const share = yield* SessionShareV2.Service
    const store = yield* SessionStore.Service

    const requireSessionAndCapability = (
      sessionID: string,
      capabilitiesHeader?: string | null,
      recorded?: SessionV2.Info,
    ) =>
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
        const info =
          recorded ??
          (yield* session.get(idOpt.value).pipe(
            Effect.catchTag("Session.NotFoundError", (error) =>
              Effect.fail(
                new SessionNotFoundError({
                  sessionID: error.sessionID,
                  message: `Session not found: ${error.sessionID}`,
                }),
              ),
            ),
          ))
        if (!ProductModePolicy.isSessionSupported(info, capabilitiesHeader)) {
          // S7: capability missing is a typed unsupported-mode error, not 404.
          // 404 is reserved for sessions that do not exist. A client without
          // the custom capability learns the session exists but that its mode
          // is outside the client's declared capabilities.
          return yield* Effect.fail(
            new UnsupportedProductModeError({
              mode: info.mode,
              message: `Mode "${info.mode}" is not supported by this client's declared capabilities.`,
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
            Effect.mapError((error) => new UnsupportedProductModeError({ mode: error.mode, message: error.message })),
          ),
        ),
      )

    const requireReadableSession = (sessionID: string, capabilitiesHeader?: string | null) =>
      requireSessionAndCapability(sessionID, capabilitiesHeader)

    // The generic reader can defect while decoding stored JSON, before the Review owner runs.
    // Translate only storage/decoding faults; programming defects keep their original cause.
    const requireReviewSession = (sessionID: string, capabilitiesHeader?: string | null) =>
      requireReadableSession(sessionID, capabilitiesHeader).pipe(
        Effect.catchDefect((error) => {
          if (isReviewReadFailure(error)) {
            return new WorkReviewUnavailableError({ message: "Work review storage is unavailable", code: "storage" })
          }
          return Effect.die(error)
        }),
      )

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
          const request = yield* HttpServerRequest.HttpServerRequest
          const capabilities = request.headers[ProductModePolicy.CAPABILITIES_HEADER]
          // Identity lookup must not adopt legacy history as canonical reads do.
          const recorded = ctx.payload.id ? yield* store.get(ctx.payload.id) : undefined
          const source = recorded ?? (ctx.payload.parentID ? yield* store.get(ctx.payload.parentID) : undefined)
          // Existing identity wins over create arguments. Otherwise a child
          // inherits its parent's mode, which must be checked before any write.
          if (source)
            yield* requireSessionAndCapability(source.id, capabilities, source).pipe(
              Effect.catchTag("SessionNotFoundError", (error) => new InvalidRequestError({ message: error.message })),
            )
          if (!recorded) yield* ProductModePolicy.assertCreationSupported(ctx.payload.mode)
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
                Effect.catchTag("AgentNotAllowedError", (err) =>
                  Effect.fail(
                    new InvalidRequestError({
                      message: err.message,
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
            // S7: runtime disabled is a typed disabled error (stable message),
            // matching the admission/control surfaces. Not a generic 400.
            return yield* new UnsupportedProductModeError({
              mode: "custom",
              message: ProductModePolicy.CUSTOM_MODE_DISABLED_MESSAGE,
            })
          }
          // Symmetric with the instance custom-composition/start gate —
          // creating custom sessions requires the custom capability header.
          const req = yield* HttpServerRequest.HttpServerRequest
          if (!ProductModePolicy.isCustomCapable(req.headers[ProductModePolicy.CAPABILITIES_HEADER])) {
            // S7: capability missing is a typed unsupported-mode error, mirroring
            // the per-session capability gate in requireSessionAndCapability.
            return yield* new UnsupportedProductModeError({
              mode: "custom",
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
        "session.workReview.get",
        Effect.fn("SessionHttpApi.workReview.get")(function* (ctx) {
          const request = yield* HttpServerRequest.HttpServerRequest
          yield* requireReviewSession(ctx.params.sessionID, request.headers[ProductModePolicy.CAPABILITIES_HEADER])
          // SessionLocationMiddleware supplies this Session's owner, not a reviewer role.
          const reviews = yield* WorkReviewService.Service
          return {
            data: yield* reviews
              .get(ctx.params.sessionID)
              .pipe(Effect.mapError((error) => workReviewError(error, ctx.params.sessionID))),
          }
        }),
      )
      .handle(
        "session.workReview.transition",
        Effect.fn("SessionHttpApi.workReview.transition")(function* (ctx) {
          const request = yield* HttpServerRequest.HttpServerRequest
          yield* requireReviewSession(ctx.params.sessionID, request.headers[ProductModePolicy.CAPABILITIES_HEADER])
          const reviews = yield* WorkReviewService.Service
          return {
            data: yield* reviews
              .transition(ctx.params.sessionID, ctx.payload)
              .pipe(Effect.mapError((error) => workReviewError(error, ctx.params.sessionID))),
          }
        }),
      )
      .handle(
        "session.switchAgent",
        Effect.fn(function* (ctx) {
          const req = yield* HttpServerRequest.HttpServerRequest
          const capabilitiesHeader = req.headers[ProductModePolicy.CAPABILITIES_HEADER]
          yield* requireRuntimeSession(ctx.params.sessionID, capabilitiesHeader)
          yield* session.switchAgent({ sessionID: ctx.params.sessionID, agent: ctx.payload.agent }).pipe(
            Effect.catchTag("Session.NotFoundError", (error) =>
              Effect.fail(
                new SessionNotFoundError({
                  sessionID: error.sessionID,
                  message: `Session not found: ${error.sessionID}`,
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
            Effect.catchTag("AgentNotAllowedError", (error) =>
              Effect.fail(
                new InvalidRequestError({
                  message: error.message,
                }),
              ),
            ),
            Effect.catchTag("SessionComposition.SnapshotNotFoundError", (error) =>
              Effect.fail(
                new InvalidRequestError({
                  message: `Conflicting composition snapshot for session ${error.sessionID}`,
                }),
              ),
            ),
            Effect.catchTag("SessionComposition.SnapshotDecodeError", () =>
              Effect.fail(
                new InvalidRequestError({
                  message: `Conflicting composition snapshot for session ${ctx.params.sessionID}`,
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
          yield* requireRuntimeSession(ctx.params.sessionID, capabilitiesHeader)
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
              .admitWithSelection({
                sessionID: ctx.params.sessionID,
                id: ctx.payload.id,
                prompt: ctx.payload.prompt,
                delivery: ctx.payload.delivery,
                resume: ctx.payload.resume,
                agent: ctx.payload.agent,
                model: ctx.payload.model,
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
                // Selection rejected by the mode x agent policy, or by the frozen
                // custom pool. The caller asked for it, so say what was wrong
                // rather than collapsing it into a generic failure.
                Effect.catchTag("AgentNotAllowedError", (error) =>
                  Effect.fail(new InvalidRequestError({ message: error.message })),
                ),
                Effect.catchTag("SessionComposition.AgentDelegationForbiddenError", (error) =>
                  Effect.fail(
                    new InvalidRequestError({
                      message: `Agent '${error.agentID}' is not part of the frozen composition pool`,
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
          yield* requireRuntimeSession(ctx.params.sessionID, capabilitiesHeader)
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
          yield* requireRuntimeSession(ctx.params.sessionID, capabilitiesHeader)
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
          yield* requireReadableSession(ctx.params.sessionID, capabilitiesHeader)
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
          yield* requireReadableSession(ctx.params.sessionID, capabilitiesHeader)
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
          yield* requireRuntimeSession(ctx.params.sessionID, capabilitiesHeader)
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
                Effect.catchTag("CommandDeniedError", (error) =>
                  Effect.fail(
                    new InvalidRequestError({
                      message: error.message,
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
        "session.command",
        Effect.fn(function* (ctx) {
          const req = yield* HttpServerRequest.HttpServerRequest
          const capabilitiesHeader = req.headers[ProductModePolicy.CAPABILITIES_HEADER]
          yield* requireRuntimeSession(ctx.params.sessionID, capabilitiesHeader)
          return {
            data: yield* session
              .command({
                sessionID: ctx.params.sessionID,
                id: ctx.payload.id,
                command: ctx.payload.command,
                arguments: ctx.payload.arguments,
                context: ctx.payload.context,
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
                      message: `Command message ID conflicts with an existing durable record: ${error.messageID}`,
                      resource: error.messageID,
                    }),
                  ),
                ),
                Effect.catchTag("Session.CommandUnavailableError", (error) =>
                  Effect.fail(new InvalidRequestError({ message: error.message })),
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
          yield* requireRuntimeSession(ctx.params.sessionID, capabilitiesHeader)
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
          // The creation gate exists to block generic ROOT creation of
          // custom sessions; fork is not root creation. A custom parent routes to
          // V2 create({parentID}), which copies the frozen snapshot (orphan custom
          // parents fail typed below: SnapshotNotFound -> InvalidRequestError).
          if (parent.mode !== "custom") {
            yield* ProductModePolicy.assertCreationSupported(parent.mode)
          }
          const child = yield* session
            .create({
              location: parent.location,
              parentID: parent.id,
              mode: parent.mode,
            })
            .pipe(
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
              Effect.catchTag("AgentNotAllowedError", (error) =>
                Effect.fail(new InvalidRequestError({ message: error.message })),
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
          yield* share.share({
            sourceSessionID: ctx.params.sessionID,
            targetSessionID: child.id,
            scope: "full",
            trigger: false,
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
        )
      })
  }),
).pipe(Layer.provide(SessionStore.defaultLayer))

function workReviewError(error: WorkReviewService.ReviewError, sessionID: SessionV2.ID) {
  // Public errors must never include storage paths, file contents, or raw causes.
  switch (error.code) {
    case "not_found":
      return new SessionNotFoundError({ sessionID, message: "Session not found" })
    case "wrong_scope":
      return new ForbiddenError({ message: "Work review artifact belongs to a different Session or Location" })
    case "wrong_mode":
      return new ForbiddenError({ message: "Work review requires a Work Session" })
    case "invalid_action":
      return new InvalidRequestError({ message: "Invalid work review action", kind: error.code })
    case "illegal_transition":
      return new InvalidRequestError({
        message: "Work review action is not allowed in its current state",
        kind: error.code,
      })
    case "corrupt_review":
      return new InvalidRequestError({ message: "Work review record is corrupt", kind: error.code })
    case "conflict":
      return new ConflictError({
        message: "Work review revision changed; reload before retrying",
        resource: "work-review",
      })
    case "stale_artifact":
      return new ConflictError({
        message: "Work artifact binding changed; reload before retrying",
        resource: "work-artifact",
      })
    case "artifact_unavailable":
      return new ConflictError({ message: "Work artifact is unavailable", resource: "work-artifact" })
    case "storage":
      return new WorkReviewUnavailableError({
        message:
          error.committedRevision === undefined
            ? "Work review storage is unavailable"
            : "Work review was saved but its artifact could not be revalidated; reload before retrying",
        code: "storage",
        committedRevision: error.committedRevision,
      })
    case "notification":
      return new WorkReviewUnavailableError({
        message: "Work review notification failed; reload before retrying",
        code: "notification",
        committedRevision: error.committedRevision,
      })
  }
  return absurd<never>(error.code)
}

function isReviewReadFailure(error: unknown): boolean {
  if (error instanceof SyntaxError || Schema.isSchemaError(error) || error instanceof SqlError) return true
  if (!(error instanceof EffectDrizzleQueryError) || !Cause.isCause(error.cause)) return false
  return (
    error.cause.reasons.length > 0 &&
    error.cause.reasons.every((reason) => Cause.isFailReason(reason) && isReviewReadFailure(reason.error))
  )
}
