import type { ProviderApi } from "@aigcfroge/client/effect/api"
import type { Model } from "@aigcfroge/schema/model"
import type { Provider } from "@aigcfroge/schema/provider"
import type { Connection } from "@aigcfroge/schema/connection"
import type { ModelSource } from "@aigcfroge/schema/model-source"
import type { ConnectionInfo } from "@aigcfroge/client"
import type { Effect, Types } from "effect"
import type { Transform } from "./registration.js"

/** Provider metadata and immutable source definitions, including inactive providers. */
export interface ProviderRecord {
  readonly provider: Provider.Info
  readonly models: ReadonlyMap<string, Model.Info>
  readonly sourceConnection?: ConnectionInfo
}

export interface ProviderEditor {
  readonly scope?: { readonly providerID: Provider.ID; readonly connection: ModelSource.ConnectionRef }
  connection(integrationID: string): Connection.Info | undefined
  list(): readonly ProviderRecord[]
  get(providerID: string): ProviderRecord | undefined
  /** A discovered account-specific inventory can be bound to the connection that produced it. */
  add(input: { info: Provider.Info; models: readonly Model.Info[]; sourceConnection?: ConnectionInfo }): void
  update(providerID: string, update: (provider: Types.DeepMutable<Provider.Info>) => void): void
  remove(providerID: string): void
  readonly models: {
    set(providerID: string, models: readonly Model.Info[]): void
    /** Updates an owned copy of a source definition. */
    update(providerID: string, modelID: string, update: (model: Types.DeepMutable<Model.Info>) => void): void
    remove(providerID: string, modelID: string): void
  }
}

export interface ProviderDomain extends ProviderApi<unknown> {
  readonly transform: Transform<ProviderEditor>
  readonly reload: () => Effect.Effect<void>
}
