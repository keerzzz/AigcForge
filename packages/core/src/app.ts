export * as App from "./app.js"

import { Context, Layer } from "effect"
import { makeGlobalNode } from "@omnixa/util/effect/app-node"

export interface Info {
  readonly name: string
  readonly version: string
  readonly channel: string
}

export const Metadata = Context.Reference<Info>("@omnixa/App", {
  defaultValue: () => make(),
})

export function make(input: Partial<Info> = {}): Info {
  return {
    name: input.name ?? "omnixa",
    version: input.version ?? "unknown",
    channel: input.channel ?? "unknown",
  }
}

export function useragent(app: Info) {
  return `omnixa/${app.channel}/${app.version}/${app.name}`
}

export const layer = (input?: Partial<Info>) => Layer.succeed(Metadata, make(input))

export const configured = (input?: Partial<Info>) =>
  makeGlobalNode({ service: Metadata, layer: layer(input), deps: [] })

export const node = configured()
