export * as ToolPermissionFailure from "./permission-failure"

import { ToolFailure } from "@aigcfroge/llm"
import { GrantEvent } from "../grant/event"
import { PermissionV2 } from "../permission"

/**
 * One place where a permission outcome becomes the text the model and the user read.
 *
 * `permission.assert` can fail with any member of `PermissionV2.Error`, but `Tool.make`
 * only allows `ToolFailure` out of `execute`, so every leaf has to flatten the error
 * channel. Leaves used to do that with `Effect.mapError(() => new ToolFailure(...))`,
 * which discards the error without looking at it — a denial, an unanswered request, an
 * expired request, a revision conflict and a genuine crash all settled as the same
 * sentence, so nobody could tell "you were not allowed to do that" from "that broke".
 *
 * Two leaves had already grown their own `DeniedError` branch (`taskschedule.ts`,
 * `question.ts`) and both only covered that one member. This module is the merge of those
 * copies, extended to the whole union.
 *
 * Recoverable and operational outcomes are deliberately worded apart. A denial or a
 * correction is something the model can respond to by choosing differently. An expired
 * request or a lost revision race is not: nobody decided anything, so those must not read
 * as a refusal. They stay `ToolFailure` rather than becoming defects, because the turn
 * should keep its shape instead of crashing — but the sentence says what actually happened.
 */
export function translate(action: string, error: unknown): ToolFailure | undefined {
  if (error instanceof PermissionV2.DeniedError) return new ToolFailure({ message: `Permission denied: ${action}` })
  if (error instanceof PermissionV2.CorrectedError)
    return new ToolFailure({ message: `Permission denied: ${action} — ${error.feedback}` })
  if (error instanceof PermissionV2.RejectedError)
    // Two different events share this class, and only one of them is nobody answering.
    // `permission.ts:280` sets `no_responder` when there was no one to ask; `:352` raises a
    // bare `RejectedError` when a person answered and the answer was no, with no note
    // attached. Reporting that second case as unanswered tells the model the opposite of
    // what happened, and V1 words it as a refusal for the same reason.
    return new ToolFailure({
      message:
        error.reason === "no_responder"
          ? `Permission request for ${action} had no one to answer it`
          : `Permission denied: ${action} — the user refused this call`,
    })
  if (error instanceof PermissionV2.AskExpiredError)
    return new ToolFailure({
      message: `Permission request for ${action} expired after ${error.ttlMs}ms without an answer`,
    })
  if (error instanceof GrantEvent.CommitRejected)
    return new ToolFailure({
      message: `Permission state for ${action} changed while the request was open; retry the tool call`,
    })
  return undefined
}

/**
 * The common leaf operator: keep a `ToolFailure` the leaf raised itself, translate a
 * permission outcome, and fall back to the leaf's own sentence for infrastructure
 * failures. Interrupts and defects never reach here — they are not in the error channel —
 * so they stay visible as themselves.
 */
export const toToolFailure =
  (action: string, fallback: string) =>
  (error: unknown): ToolFailure => {
    if (error instanceof ToolFailure) return error
    return translate(action, error) ?? new ToolFailure({ message: fallback })
  }
