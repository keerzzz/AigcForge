export * as McpScope from "./mcp-scope"

import { Schema } from "effect"
import { Composition } from "./composition"
import { AbsolutePath } from "./schema"
import { containsSecret } from "./credential-scan"

// Decode-time bounds: every string and collection field fails closed at the
// boundary instead of admitting oversized payloads (the workflow-asset lesson
// — graph invariants must not wait for freeze-time validation).
export const MAX_SERVER_NAME = 128
export const MAX_RELATIVE_PATH = 512
export const MAX_URL_LENGTH = 2048
export const MAX_COMMAND_ENTRIES = 32
export const MAX_COMMAND_ARG_LENGTH = 4096
export const MAX_SESSION_ID_LENGTH = 256
export const MAX_GRANT_ID_LENGTH = 128
export const MAX_GRANT_ACTION_LENGTH = 128
export const MAX_RESOURCE_LENGTH = 1024
export const MAX_GRANT_RESOURCES = 32

// Effect strips unknown object keys by default, which would silently swallow
// secret-bearing fields. The canonical decoders below bake strict excess-key
// rejection so bindings and grants fail closed at their single sanctioned
// entry points; raw `decodeUnknownSync` without these options is not the
// contract surface.
const strictOptions = { errors: "all", onExcessProperty: "error" } as const

/** Connection health is shared with composition Plan projections. */
export const McpConnectionHealth = Composition.McpConnectionHealth
export type McpConnectionHealth = Composition.McpConnectionHealth

const bounded = (max: number) =>
  Schema.String.pipe(Schema.check(Schema.isMinLength(1)), Schema.check(Schema.isMaxLength(max)))

/** Location-relative asset reference; absolute paths could address another tree. */
const RelativeAssetPath = bounded(MAX_RELATIVE_PATH).pipe(
  Schema.check(
    Schema.makeFilter<string>((input) => !input.startsWith("/"), {
      message: "MCP binding refs are location-relative; absolute paths cannot address another tree",
    }),
  ),
)

/** Opaque reference to a Credential-service entry; never carries material. */
export const CredentialRef = Schema.String.pipe(
  Schema.check(Schema.isStartsWith("cred_")),
  Schema.check(Schema.isMaxLength(MAX_GRANT_ID_LENGTH)),
  Schema.brand("McpScope.CredentialRef"),
)
export type CredentialRef = typeof CredentialRef.Type

/**
 * Frozen identity facts of one MCP server binding: which asset revision this
 * consumer binds, how it connects, and which opaque credential it may resolve.
 * Secrets, executors, and health belong to the connection owner, not here.
 */
export class McpServerBinding extends Schema.Class<McpServerBinding>("McpScope.McpServerBinding")({
  serverName: bounded(MAX_SERVER_NAME),
  ref: Schema.Struct({
    relativePath: RelativeAssetPath,
    revision: Composition.Revision,
  }),
  transport: Schema.Literals(["stdio", "remote"]),
  command: Schema.optional(
    Schema.Array(bounded(MAX_COMMAND_ARG_LENGTH)).pipe(
      Schema.check(
        Schema.makeFilter<ReadonlyArray<string>>((input) => input.length <= MAX_COMMAND_ENTRIES, {
          message: `MCP command must have at most ${MAX_COMMAND_ENTRIES} entries`,
        }),
      ),
    ),
  ),
  url: Schema.optional(
    bounded(MAX_URL_LENGTH).pipe(
      Schema.check(
        Schema.makeFilter<string>((input) => input.startsWith("http://") || input.startsWith("https://"), {
          message: "MCP remote url must be http(s)",
        }),
      ),
    ),
  ),
  credentialRef: Schema.optional(CredentialRef),
}) {}

/** Grant horizon: once consumes exactly one approval; session/location bind to owner identity. */
export const GrantScope = Schema.Union([
  Schema.Struct({ level: Schema.Literal("once") }),
  Schema.Struct({
    level: Schema.Literal("session"),
    sessionID: Schema.String.pipe(
      Schema.check(Schema.isStartsWith("ses_")),
      Schema.check(Schema.isMaxLength(MAX_SESSION_ID_LENGTH)),
    ),
  }),
  Schema.Struct({ level: Schema.Literal("location") }),
]).annotate({ identifier: "McpScope.GrantScope" })
export type GrantScope = typeof GrantScope.Type

/**
 * One user-granted approval. Grants only ever allow; deny stays the policy
 * rulesets' territory. Agent/revision/expiry/revocation are typed data so the
 * store can enforce them, while the leaf permission assert remains the final
 * authorization boundary.
 */
export class ScopedGrant extends Schema.Class<ScopedGrant>("McpScope.ScopedGrant")({
  id: Schema.String.pipe(
    Schema.check(Schema.isStartsWith("grt_")),
    Schema.check(Schema.isMaxLength(MAX_GRANT_ID_LENGTH)),
  ),
  scope: GrantScope,
  action: bounded(MAX_GRANT_ACTION_LENGTH),
  resources: Schema.Array(bounded(MAX_RESOURCE_LENGTH)).pipe(
    Schema.check(
      Schema.makeFilter<ReadonlyArray<string>>((input) => input.length <= MAX_GRANT_RESOURCES, {
        message: `A grant covers at most ${MAX_GRANT_RESOURCES} resources`,
      }),
    ),
  ),
  effect: Schema.Literal("allow"),
  agent: Schema.optional(bounded(MAX_GRANT_ACTION_LENGTH)),
  revision: Schema.optional(Composition.Revision),
  issuedAt: Schema.Finite,
  expiresAt: Schema.optional(Schema.Finite),
  revokedAt: Schema.optional(Schema.Finite),
}) {}

/**
 * One Location-scoped credential binding (ADR-21 §2.2 v1.2). Only the opaque
 * ref is stored; material never enters Snapshot/event/log. `workspaceID` is
 * `""` (empty sentinel) when the Location has no workspace — the DB column
 * is `NOT NULL` so `UNIQUE(directory, workspace_id, server_name)` actually
 * enforces uniqueness for the common workspace-less case. The sentinel
 * conversion is centralized here (and mirrored only in the binding store's
 * single codec), never scattered at call sites.
 */
export class McpCredentialBinding extends Schema.Class<McpCredentialBinding>("McpScope.McpCredentialBinding")({
  id: Schema.String.pipe(
    Schema.check(Schema.isStartsWith("mcb_")),
    Schema.check(Schema.isMaxLength(MAX_GRANT_ID_LENGTH)),
  ),
  directory: AbsolutePath,
  workspaceID: Schema.String,
  serverName: bounded(MAX_SERVER_NAME),
  credentialRef: CredentialRef,
  bindingRevision: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(1))),
  revokedAt: Schema.optional(Schema.Finite),
  timeCreated: Schema.Finite,
  timeUpdated: Schema.Finite,
}) {}

/** Single-point sentinel codec for `workspaceID` (ADR-21 §2.2 v1.2). */
export const normalizeWorkspaceId = (id: string | undefined): string => id ?? ""
export const denormalizeWorkspaceId = (id: string): string | undefined => (id === "" ? undefined : id)

const decodeBindingStrict = Schema.decodeUnknownSync(McpServerBinding, strictOptions)
const decodeGrantStrict = Schema.decodeUnknownSync(ScopedGrant, strictOptions)
const decodeGrantScopeStrict = Schema.decodeUnknownSync(GrantScope, strictOptions)

/** Canonical binding decode: rejects excess keys, then enforces transport shape and secret redaction. */
export const decodeBinding = (input: unknown): McpServerBinding => {
  const binding = decodeBindingStrict(input)
  if (binding.transport === "stdio" && (binding.command === undefined || binding.command.length === 0))
    throw new Error(`MCP stdio binding '${binding.serverName}' requires command`)
  if (binding.transport === "remote" && binding.url === undefined)
    throw new Error(`MCP remote binding '${binding.serverName}' requires url`)
  const checkSecret = (value: string, label: string) => {
    if (containsSecret(value))
      throw new Error(`MCP binding '${binding.serverName}' ${label} contains secret-like material`)
  }
  if (binding.command) for (const entry of binding.command) checkSecret(entry, "command")
  if (binding.url) checkSecret(binding.url, "url")
  return binding
}

/** Canonical grant decode: rejects excess keys, then enforces expiry ordering. */
export const decodeGrant = (input: unknown): ScopedGrant => {
  const grant = decodeGrantStrict(input)
  if (grant.expiresAt !== undefined && grant.expiresAt <= grant.issuedAt)
    throw new Error(`Grant '${grant.id}' expires before or at issuance`)
  return grant
}

/** Canonical scope decode: rejects unknown levels and smuggled identity fields. */
export const decodeGrantScope = (input: unknown): GrantScope => decodeGrantScopeStrict(input)
