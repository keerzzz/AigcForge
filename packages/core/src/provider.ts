export * as ProviderV2 from "./provider"

import { Types } from "effect"
import { Provider } from "@aigcfroge/schema/provider"

export const ID = Provider.ID
export type ID = typeof ID.Type

export const AISDK = Provider.AISDK

export const Native = Provider.Native

export const Api = Provider.Api
export type Api = Provider.Api
/**
 * Settings as the config/catalog merge path needs them: writable, still carrying the three
 * named transport deadlines, still open for provider-specific options.
 *
 * A plain `Types.DeepMutable` cannot express this — it rewrites the open record's `unknown`
 * to `{}`, which nothing decoded can be assigned to. Mapping the modifier off keeps the
 * value types exactly as the schema declared them, which is the point: this field used to be
 * `any` here, so core was the layer that threw the contract away.
 */
export type MutableSettings = Provider.Settings

export type MutableApi<T extends Api = Api> = T extends Api
  ? Omit<Types.DeepMutable<T>, "settings"> &
      (undefined extends T["settings"] ? { settings?: MutableSettings } : { settings: MutableSettings })
  : never

export const Request = Provider.Request
export type Request = Provider.Request

export const Info = Provider.Info
export type Info = Provider.Info

export type MutableInfo = Omit<Types.DeepMutable<Info>, "api"> & { api: MutableApi }
