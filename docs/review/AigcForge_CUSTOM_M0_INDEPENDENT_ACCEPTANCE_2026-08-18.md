# Custom Mode M0 Phase A-F Independent Acceptance Review

> Date: 2026-08-18
> Branch: `custom-governance`
> Baseline: `main@a4ffba0b3d22bae564f6616f0f84fe8ead8342fc`
> Reviewed scope: 75 pre-existing working-tree entries (43 tracked changes + 32 untracked files); this report is the only additional file
> Strategy: focused differential review with deep analysis of Session creation, Profile mutation, and Composition resolution
> Verdict: **REJECT / CHANGES REQUESTED**

## 1. Executive Summary

| Severity | Count |
| --- | ---: |
| Critical | 0 |
| High | 2 |
| Medium | 6 |
| Low | 2 |

The M0 implementation is not accepted and must not proceed to M1. The most important M0 invariant is currently false: both legacy and V2 Session creation accept `mode: "custom"` and persist a Session without an immutable composition Snapshot. A real `POST /session` request returned HTTP 200 and created a Custom Session on the legacy path.

The focused and package tests largely pass, but the added tests do not exercise the blocking contract cases. Several reported deliverables are isolated helpers or schemas without production wiring, and Phase C/E acceptance cases are absent.

## 2. Findings

### HIGH-1: Existing Session creation paths admit Custom Sessions without a Snapshot

**Evidence**:

- `packages/schema/src/product-mode.ts:5` expands the shared input enum to include `custom`.
- `packages/aigcfroge/src/session/session.ts:717` accepts that enum and creates the V1 Session without a Custom-mode guard.
- `packages/core/src/session.ts:199` does the same for V2.
- `packages/aigcfroge/src/server/routes/instance/httpapi/handlers/session.ts:388` forwards legacy create payloads directly to `shareSvc.create`.
- `packages/server/src/handlers/session.ts:69` forwards V2 create payloads directly to `session.create`.
- The approved M0 plan explicitly requires all generic V1/V2 create paths to reject `custom` until M1 atomically creates Session + Snapshot (`docs/plan/prompt-custom-mode-m0-composition-platform.md:153`).

**Reproduction**:

```text
POST /session
{"mode":"custom","title":"M0 bypass"}

HTTP 200
{"mode":"custom","agent":"meta", ...}
```

`POST /api/session` also returned HTTP 200 and subsequent V2 list returned the created `custom` Session.

**Impact**: An authenticated/API-capable caller can bypass the intended M1 lifecycle owner and create a Custom Session with no `session_composition_snapshot`, no composition allowlist, and no Custom runtime policy. This is reachable through public HTTP contracts and core callers.

**Blast radius**: ProductMode is referenced at 270 sites across 37 files; Session create calls occur in 28 files. The fix belongs in a single creation-policy owner used by V1 and V2, with HTTP translation at both API surfaces.

**Required action**: Fail closed for root `mode=custom` in every generic create owner. Only the future atomic Custom start transaction may bypass that guard. Add V1/V2 HTTP and direct service tests proving rejection with and without the capability header.

### HIGH-2: A bypassed Custom Session enters legacy execution semantics

**Evidence**:

- `packages/core/src/product-mode-agent-policy.ts:80` treats Custom as an ordinary "other" mode and allows `meta`.
- `packages/core/src/product-mode-agent-policy.ts:136` allows shell/command for every mode except Chat and Work.
- `packages/aigcfroge/src/session/prompt.ts:517` and `:1571` enforce that permissive policy before legacy shell/command execution.
- `packages/aigcfroge/src/server/routes/instance/httpapi/handlers/session.ts:705` explicitly keeps sync prompt/command/shell on V1.

**Attack sequence**:

1. Create a Session with `POST /session {"mode":"custom"}`.
2. Access it with `x-aigcfroge-capabilities: product-mode-custom-v1`.
3. Submit legacy prompt, command, or shell operations.
4. Execution proceeds without Composition Snapshot, Custom ceiling, tool fingerprint, or allowlist validation.

**Impact**: The Custom label activates neither Custom isolation nor M1 runtime invariants. Existing permission checks still apply, so this is not an unauthenticated RCE claim, but it defeats the architecture's mode-specific security boundary.

**Required action**: In addition to HIGH-1, make runtime policy fail closed for any historical/orphan Custom Session lacking a valid Snapshot. Read capability is not execution authorization.

### MEDIUM-1: Composition input and Resolver fail open on invalid source, refs, and bindings

**Evidence**:

- `packages/schema/src/composition.ts:79` models `source`, `profilePath`, and `profileRevision` as independent fields. `source="profile"` does not require profile identity/revision.
- `packages/schema/src/composition.ts:84` uses `Schema.Record(Schema.String, Binding)` instead of the defined `Consumer` key grammar.
- `AssetRef` uses one broad kind union, so `agents[]` accepts Prompt/Skill refs and `Binding.prompts[]` accepts Agent refs.
- `packages/core/src/composition-resolver.ts:52` never checks `agentRef.kind`.
- `packages/core/src/composition-resolver.ts:106` recognizes three undocumented binding aliases, ignores all unrecognized/unconnected bindings, and still computes `valid=true`.

**Reproduction**: A `source="profile"` input with no profile path/revision and binding key `not-a-consumer` returned `{ valid: true, diagnostics: [] }` for a valid agent.

**Impact**: Plan digest and validity do not prove that the requested profile or binding graph was actually resolved. A client can receive a green Plan after parts of its composition were silently dropped.

**Required action**: Use discriminated temporary/profile input schemas, kind-specific refs per field, Consumer-constrained bindings, and explicit diagnostics for missing/stale profile, bad consumer, duplicate/unconnected asset, and missing selected-agent binding.

### MEDIUM-2: `freeze(plan)` trusts stale caller data and emits placeholder security facts

**Evidence**:

- `packages/core/src/composition-resolver.ts:326` accepts a precomputed `Composition.Plan` rather than trusted freeze input.
- It does not reject `plan.valid=false`, recompute the Plan/digest, or re-read Agent/Skill revisions.
- Missing Prompt content becomes an empty string at `:334-340` instead of failing closed.
- Tool identity is hardcoded to `fingerprint: "default"` and an empty catalog at `:351-354`.
- The approved contract requires freeze to re-read registries and capability facts and never trust a client Plan (`docs/plan/custom-mode-composition-platform-implementation.md:268`).

**Impact**: If M1 consumes this already-exposed internal interface, a stale or forged Plan can become a Snapshot candidate and dependency drift is hidden.

**Required action**: Replace the interface with trusted `FreezeInput`, re-resolve atomically, reject invalid/missing/stale facts, and model separate per-tool fingerprints plus aggregate catalog digest. Until implemented, do not claim Snapshot/freeze contract complete.

### MEDIUM-3: Agent/Skill bridge deliverables are not wired into Location production composition

**Evidence**:

- `registerAgentAssetTransform` is referenced only by its unit test; `packages/core/src/location-layer.ts:93` still constructs only `AgentV2.fileLayer`.
- `createCompositionSkillCatalog` is referenced only by its unit test; Resolver and Skill guidance never consume it.
- `packages/core/src/session/runner/llm.ts:131` and `packages/core/src/skill/guidance.ts:42` continue using Location-wide `SkillV2.Service`.
- No watcher test proves AgentAsset reload replays the transform.

**Impact**: Phase D's runtime bridge exists as dead production code. The completion report's D1/D2 claim is overstated.

**Required action**: Wire the Agent transform into the Location-scoped Agent lifecycle, add readiness-based watcher tests, and expose a real composition-local Skill catalog seam consumed by Resolver fixtures. M0 need not connect Runner, but it must provide a production caller.

### MEDIUM-4: Custom Profile Candidate has three conflicting identities

**Evidence**:

- `packages/schema/src/custom-profile.ts:66` carries top-level `name`, `description`, and `relativePath` alongside a nested Profile containing its own name/description.
- `packages/core/src/custom-profile-service.ts:198` ignores `candidate.relativePath` and derives a filename from top-level name.
- It serializes nested Profile name/description without checking equality.

**Reproduction**:

```text
candidate.name         = path-name
candidate.relativePath = ignored/target.yaml
candidate.profile.name = content-name

Result: path-name.yaml containing name: content-name
```

The returned `Info` had name `content-name`, while the resource path was `path-name.yaml`; the requested nested path was never used.

**Impact**: Resource identity, registry name, and CAS target diverge. Follow-up propose/find/update operations can address different logical assets.

**Required action**: Define one canonical identity. Either remove duplicate Candidate fields and derive summary from Profile, or validate exact normalized equality and honor a validated relative path.

### MEDIUM-5: Profile delete is not the required reversible transaction and returns no references

**Evidence**:

- `packages/core/src/custom-profile-service.ts:342` removes the file, then maps reload failure to `WriteFailedError` without restoring prior bytes.
- Unlike the reused Agent transaction at `packages/core/src/agent-asset-service.ts:352`, it has no delete rollback or post-reload absence check.
- `delete` returns `void`; the HTTP response is `Schema.Void`.
- Phase C requires rollback success/failure tests and a reverse-reference summary (`docs/plan/custom-mode-m0-composition-foundation.md:128` and `:136`).

**Impact**: A reload failure can leave the file deleted while returning an error and leaving in-memory state stale. Callers cannot warn about referencing profiles before/after deletion.

**Required action**: Reuse the proven delete compensation pattern, verify absence after reload, return typed reverse references, and add injected reload/readback/rollback tests.

### MEDIUM-6: Capable-client filtering covers only part of the public surface

**Evidence**:

- The legacy list, get, and children handlers use `ProductModePolicy`, but several declared endpoints do not call `requireSession`; `packages/aigcfroge/src/server/routes/instance/httpapi/handlers/session.ts:419` deletes directly.
- `packages/server/src/handlers/session.ts:25` and `:84` expose V2 list/get without inspecting the capability header.
- Instance, global, and V2 event streams forward Session events without capability filtering (`packages/aigcfroge/src/server/routes/instance/httpapi/handlers/event.ts:23`, `handlers/global.ts:47`, and `packages/server/src/handlers/event.ts:17`).
- M0 requires legacy, V2, global list/event, children/fork/readback coverage (`docs/plan/custom-mode-m0-composition-foundation.md:94` and `:101`).

**Reproduction**: After creating the orphan Custom Session from HIGH-1, `DELETE /session/:id` without a capability header returned HTTP 200. V2 `GET /api/session` also returned the Custom Session without negotiation.

**Impact**: Old clients can receive undecodable Custom values through V2/event surfaces and can perform destructive operations through unguarded legacy endpoints. Declaring `UnsupportedProductModeError` in the endpoint schema does not enforce it when the handler never checks the Session.

**Required action**: Centralize request capability policy as middleware/service logic shared by every Session read/mutation surface and event projection. Add matrix tests for all legacy and V2 endpoints plus instance/global/V2 event streams.

### LOW-1: AssetKind registration is test-only

`AssetKind.Service.register` has no production callers, and `AssetKind.layer` is not part of Location composition. `custom-profile` was added to the wire enum but not registered as the eighth runtime AssetKind owner. Either wire the registry and all kinds, or revise the M0 claim so this is not presented as completed owner registration.

### LOW-2: New diff adds lint warnings and non-exhaustive App fallbacks

Full lint reports 48 warnings, including new warnings in Custom handlers/tests. More importantly, `packages/app/src/components/chat/asset-insert.ts:7`, `:18`, and `:96` accept the expanded `AssetKindId` but silently route `custom-profile` to Prompt/default or empty behavior. The implementation narrowed only `prompt-asset-candidate.ts`, not all AssetKind consumers as required by the plan.

## 3. Verification Results

| Check | Independent result |
| --- | --- |
| Schema tests | 89 pass, 0 fail |
| Core tests | 1912 pass, 2 skip, 0 fail |
| AigcForge focused Custom tests | 8 pass, 0 fail |
| AigcForge full tests | 3199 pass, 22 skip, 1 todo, 1 transient fail; failed ws-pool test passed on immediate isolated rerun |
| App unit tests | 895 pass, 0 fail |
| Package typechecks | Schema/Core/AigcForge/App pass |
| Full typecheck | 15/15 successful |
| HTTP coverage | 275 pass, 0 fail |
| HTTP auth | 275 pass, 0 fail |
| HTTP effect | 274 pass, 1 unrelated task-seed failure |
| Incremental lint | pass, 49 files / 5253 added lines |
| Full lint | 2830 files, 0 errors, 48 warnings |
| Protocol references | 32/32 pass |
| `git diff --check main` | pass |

The passing tests do not invalidate the findings. Direct adversarial executions demonstrated behavior that the current test suite does not assert: both Session create APIs accept Custom, invalid Profile binding input resolves valid, and Candidate identity fields diverge.

## 4. Required Acceptance Gates

Before re-review:

1. Block generic V1/V2 Custom Session creation at the shared owners and add direct service + both HTTP contract tests.
2. Fail closed when accessing/executing orphan Custom Sessions without a valid Snapshot.
3. Make CompositionInput discriminated and Resolver validate every ref, binding, source, revision, and connection.
4. Redesign `freeze` to re-resolve trusted inputs; remove placeholder tool facts.
5. Wire Agent/Skill bridge seams into production Location composition.
6. Restore full Profile delete rollback/readback and return reverse references.
7. Resolve Candidate identity and relative-path semantics.
8. Wire or de-scope runtime AssetKind registration and update all App AssetKind consumers exhaustively.
9. Apply capable-client filtering to all legacy/V2 Session operations and event streams.
10. Add the missing negative/failure-injection tests, then rerun the final M0 matrix.

## 5. Methodology And Limits

- Reviewed the complete 75-entry working-tree scope against `main`.
- Deep-traced V1/V2 Session create and legacy execution paths, Profile path/CAS/delete flow, Resolver/freeze, HTTP handlers, Location layers, Agent/Skill consumers, tests, and generated SDK contracts.
- Used Git history/blame for ProductMode creation and asset transaction patterns.
- Performed concrete HTTP and service-level adversarial reproductions.
- Did not modify implementation code. This report is the only file added by the independent review.
- Confidence: high for the blocking findings and analyzed M0 paths; medium for unrelated repository-wide behavior outside the changed surface.

## 6. Final Decision

**M0 Phase A-F is not accepted. Do not start M1, commit, push, or open a delivery PR as completed M0.**

The implementation can be re-reviewed after all High and Medium findings are closed with behavior tests. Existing green typecheck/lint/coverage results are useful baseline evidence, but they are not sufficient to override the reproduced contract violations.
