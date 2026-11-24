export * as SessionProviderContext from "./provider-context.js"

import { Message, type LLMRequest } from "@omnixa/ai"
import { Endpoint } from "@omnixa/ai/route"
import { SessionProviderContext } from "@omnixa/schema/session-provider-context"
import { Predicate, Schema } from "effect"
import { isDeepStrictEqual } from "node:util"
import { Hash } from "@omnixa/util/hash"
import type { SessionMessage } from "./message.js"
import type { SessionRunnerModel } from "./runner/model.js"

export type Provenance = SessionProviderContext.Provenance
export const Info = SessionProviderContext.Info
export type Info = SessionProviderContext.Info

const messages = Schema.toCodecJson(Schema.Array(Message))

/** No guessed endpoints. Dynamic URL builders cannot establish a durable deployment identity here. */
export function provenance(
  resolved: Pick<SessionRunnerModel.Resolved, "model" | "ref" | "connection">,
  sentURL?: string,
  request?: Pick<LLMRequest, "http">,
): Provenance | undefined {
  const model = resolved.model
  const endpoint = model.route.endpoint
  if (sentURL === undefined && (!endpoint.baseURL || typeof endpoint.path !== "string")) return undefined
  const url =
    sentURL === undefined
      ? Endpoint.render(
          {
            baseURL: endpoint.baseURL,
            path: typeof endpoint.path === "string" ? endpoint.path : "",
            query: endpoint.query,
          },
          { request: undefined, body: undefined },
        )
      : URL.parse(sentURL)
  if (!url) return undefined
  if (sentURL === undefined)
    Object.entries(request?.http?.query ?? {}).forEach(([key, value]) => url.searchParams.set(key, value))
  // The original WebSocket transport maps HTTP URLs to WS URLs for this same route.
  if (url.protocol === "wss:") url.protocol = "https:"
  if (url.protocol === "ws:") url.protocol = "http:"
  url.searchParams.sort()
  const proof = {
    providerID: resolved.ref.providerID,
    provider: model.provider,
    modelID: model.id,
    route: model.route.id,
    protocol: model.route.protocol,
    endpoint: Hash.sha256(url.toString()),
    ...(resolved.connection === undefined ? {} : { connection: resolved.connection }),
  }
  return { ...proof, deployment: Hash.sha256(JSON.stringify(proof)) }
}

export const compatible = (source: Provenance, target: Provenance | undefined) =>
  source.deployment !== undefined &&
  target?.deployment !== undefined &&
  isDeepStrictEqual({ ...source, connection: source.connection }, { ...target, connection: target.connection })

/** A completed compaction that installed a native replacement window instead of a local summary. */
export const isCheckpoint = (
  message: SessionMessage.Info,
): message is SessionMessage.CompactionCompleted & { readonly providerContext: Info } =>
  message.type === "compaction" && message.status === "completed" && message.providerContext !== undefined

/** Stores the canonical replacement, not a local summary or transport continuation.
 * Provider and attachment metadata can contain optional undefined entries, which the Schema JSON
 * codec rejects, so use JSON's omission semantics; `Media.Asset.toJSON` keeps binary media as base64.
 */
export const encode = (provenance: Provenance, replacement: ReadonlyArray<Message>): Info => ({
  version: 1,
  provenance,
  messages: Schema.decodeSync(Schema.fromJsonString(Schema.Json))(JSON.stringify(replacement)),
})

export const decode = (context: Info) => Schema.decodeUnknownSync(messages)(upgradeLegacyMedia(context.messages))
export const validate = (context: Info) => Schema.decodeUnknownEffect(messages)(upgradeLegacyMedia(context.messages))

/**
 * Before 2.0.15, version-1 checkpoints stored mediaType/data directly on media parts. Core only built
 * those parts from prompt attachments, whose data the Prompt schema guarantees is base64.
 */
function upgradeLegacyMedia(input: Info["messages"]) {
  if (!Array.isArray(input)) return input
  return input.map((message: unknown) => {
    if (!Predicate.isObject(message) || !Array.isArray(message.content)) return message
    return {
      ...message,
      content: message.content.map((part: unknown) => {
        if (
          !Predicate.isObject(part) ||
          part.type !== "media" ||
          part.media !== undefined ||
          typeof part.mediaType !== "string" ||
          typeof part.data !== "string"
        )
          return part
        const { mediaType, data, ...rest } = part
        return { ...rest, media: { source: { type: "base64", data, mediaType } } }
      }),
    }
  })
}
