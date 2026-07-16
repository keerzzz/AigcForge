import { Effect } from "effect"
import { Credential } from "../../credential"

/**
 * Module-level seam for resolving provider API-key credentials from the
 * application layer (aigcfroge `Auth.Service` / auth.json) into the V2
 * `SessionRunnerModel.resolve` credential lookup.
 *
 * Why a seam (not a Layer Service): `SessionRunnerModel` is provided inside
 * `LocationServiceMap` (core), which cannot depend on aigcfroge's `Auth.Service`.
 * The aigcfroge composition root calls `register()` once at startup to install
 * a resolver that reads auth.json. Same pattern as `TaskDriver`.
 *
 * Without this seam, V2 `SessionRunnerModel.resolve` only checks core
 * `Integration.Service` (DB `CredentialTable`), which does not contain the
 * user's provider API keys (those live in auth.json). The LLM request then
 * goes out with `Auth.none` -> 401 API_KEY_REQUIRED.
 */
export type CredentialResolver = (
  providerID: string,
) => Effect.Effect<Credential.Value | undefined, never, unknown>

let resolver: CredentialResolver | undefined = undefined

export const register = (fn: CredentialResolver): void => {
  resolver = fn
}

export const getCredential = (providerID: string): Effect.Effect<Credential.Value | undefined, never, unknown> =>
  resolver ? resolver(providerID) : Effect.succeed(undefined)
