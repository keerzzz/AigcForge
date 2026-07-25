export * as AssetKind from "./asset-kind"

import { Context, Effect, Layer, Schema } from "effect"
import { Asset } from "@aigcfroge/schema/asset"

export interface AssetKindDef<K extends Asset.AssetKindId = Asset.AssetKindId> {
  readonly id: K
  readonly schema: {
    readonly Summary: Schema.Schema<any>
    readonly Info: Schema.Schema<any>
  }
  readonly ownerDir: string
}

export interface AssetKindRegistryInterface {
  readonly register: (def: AssetKindDef) => Effect.Effect<void, Asset.AssetError>
  readonly resolve: (kind: string) => Effect.Effect<AssetKindDef, Asset.AssetError>
  readonly list: () => ReadonlyArray<Asset.AssetKindId>
}

export class Service extends Context.Service<Service, AssetKindRegistryInterface>()(
  "@aigcfroge/v2/AssetKindRegistry",
) {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const kinds = new Map<string, AssetKindDef>()

    const register = Effect.fn("AssetKindRegistry.register")(function* (def: AssetKindDef) {
      kinds.set(def.id, def)
    })

    const resolve = Effect.fn("AssetKindRegistry.resolve")(function* (kind: string) {
      const def = kinds.get(kind)
      if (!def) {
        return yield* new Asset.AssetError({
          kind,
          reason: "unknown_kind",
          message: `Unknown asset kind: ${kind}`,
        })
      }
      return def
    })

    const list = () => Array.from(kinds.keys()) as Asset.AssetKindId[]

    return Service.of({ register, resolve, list } satisfies AssetKindRegistryInterface)
  }),
)
