# Custom Mode M0 Remediation Re-review

> Date: 2026-08-18
> Branch: `custom-governance`
> Baseline: `main@a4ffba0b3d22bae564f6616f0f84fe8ead8342fc`
> Working tree at intake: 97 entries
> Previous review: `AigcForge_CUSTOM_M0_INDEPENDENT_ACCEPTANCE_2026-08-18.md`
> Verdict: **REJECT / PARTIAL REMEDIATION**

## 1. Executive Summary

The remediation closes important portions of the prior review, including generic root Session creation, the base Custom agent/command/CLI policy, discriminated Composition input schemas, typed refs, Candidate name/description consistency, DeleteResult wire shape, Agent bridge production registration, and App/SDK Custom Profile branches.

It does not close all ten items. Dynamic re-review reproduced a legacy fork that creates a new Custom Session without a Snapshot, a ProfileInput that substitutes different agents while retaining the stored Profile revision, nested Profile paths being silently flattened, and SSE predicates admitting Session events that carry only `sessionID`. The V2 old-client matrix also remains incomplete and currently returns undeclared HTTP 500 responses on tested historical Custom operations.

**Recommendation:** do not approve M0 and do not start M1.

## 2. Prior Finding Status

| Prior item                        | Status      | Re-review result                                                                                       |
| --------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------ |
| HIGH-1 generic Custom creation    | **Partial** | Root V1/V2 create is blocked, but legacy fork still creates Custom without Snapshot                    |
| HIGH-2 legacy execution semantics | **Partial** | Agent/command/CLI policy rejects Custom; orphan Custom operation coverage remains incomplete           |
| MEDIUM-1 Composition fail-open    | **Partial** | Typed refs/consumer checks improved; ProfileInput does not resolve stored Profile as truth             |
| MEDIUM-2 untrusted freeze         | **Partial** | Freeze re-resolves input, but tool facts are not ToolRegistrationFingerprint/ToolCatalogDigest         |
| MEDIUM-3 Agent/Skill bridge       | **Partial** | Agent bridge is wired; composition-local Skill catalog remains test-only                               |
| MEDIUM-4 Profile identity         | **Partial** | Name/description equality added; relativePath still flattened with `basename`                          |
| MEDIUM-5 Profile delete           | **Partial** | DeleteResult/absence checks added; reload failure is not compensated and rollback errors are swallowed |
| MEDIUM-6 client isolation         | **Open**    | Legacy coverage improved; V2 operations and most Session SSE events are not correctly isolated         |
| LOW-1 AssetKind registry          | **Open**    | Registry is wired, but pre-registered owner directories are wrong                                      |
| LOW-2 App/SDK branches            | **Closed**  | Custom Profile dispatch and regenerated SDK are present                                                |

## 3. Blocking Findings

### HIGH-1: Legacy fork still creates an orphan Custom Session

**Evidence**:

- Generic V1 and V2 create now call `ProductModePolicy.assertCreationSupported`.
- `packages/aigcfroge/src/session/session.ts:752` implements `Session.fork` with direct `createNext(...)` and does not call the creation policy.
- `packages/aigcfroge/src/server/routes/instance/httpapi/handlers/session.ts:573` checks client capability, then invokes that fork for the V1 runtime.

**Dynamic reproduction**:

1. Create a Chat Session.
2. Simulate a historical Custom row by updating its mode in the database.
3. Send `POST /session/:id/fork` with `x-aigcfroge-capabilities: product-mode-custom-v1`.
4. Server returns HTTP 200 and creates a new Session with `mode="custom"`, `agent="meta"`, and no Snapshot.

**Impact**: The original highest-severity invariant remains bypassable through a public derived-creation path. Blocking only root create is insufficient because fork copies the forbidden mode into `createNext`.

**Required action**: Route every Session creation path through one policy owner. M0 must reject legacy/V2 fork of Custom until atomic Snapshot inheritance exists. Add V1/V2 fork tests for both capable and old clients.

### HIGH-2: Capable-client SSE isolation cannot classify most Session events

**Evidence**:

- `ProductModePolicy.isEventPayloadSupported` checks only shallow `data.mode`, `data.info.mode`, and `data.session.mode`.
- Most V2 Session events in `packages/core/src/session/event.ts` carry `sessionID` and operation data, not the Session mode.
- Instance/global/V2 event handlers call the shallow predicate without resolving Session ownership/mode.

**Dynamic reproduction**:

```text
isEventPayloadSupported({ sessionID: "ses_custom" })                   -> true
isEventPayloadSupported({ sessionID: "ses_custom", messageID: "m" }) -> true
isEventPayloadSupported({ sessionID: "ses_custom", info: { mode: "custom" } }) -> false
```

**Impact**: Old clients still receive Custom prompt/tool/shell/step/context events after the initial mode-bearing event is filtered. This violates the explicit old-client event isolation gate and can expose payloads the client cannot safely decode or associate.

**Required action**: Event filtering must resolve `sessionID -> mode` through a stable Session read model/cache, or events must carry a trusted mode classification envelope. Add real instance/global/V2 SSE tests with mode-less Custom Session events.

### MEDIUM-1: V2 capability isolation is applied only to list/get

**Evidence**:

- `packages/server/src/handlers/session.ts` filters V2 list and get.
- V2 switchAgent, switchModel, prompt, context, children, interrupt, shell, skill, share, and fork handlers do not inspect the capability header.
- Their endpoint contracts do not declare a Custom unsupported error.

**Dynamic reproduction**: Requests to historical Custom V2 children/fork without capability returned HTTP 500 `UnknownError`, not 404 or a typed unsupported response. This is accidental failure, not policy enforcement.

**Required action**: Introduce shared V2 request middleware/helper that loads the Session and enforces client capability for every Session-scoped endpoint. Tests must cover read, mutation, prompt admission, interrupt, share, and fork.

### MEDIUM-2: ProfileInput validates revision but trusts client-supplied composition content

**Evidence**:

- `packages/schema/src/composition.ts:110` requires profile path/revision but also accepts agents, bindings, presentation, and capabilities from the client.
- `packages/core/src/composition-resolver.ts:46` verifies only that the stored Profile exists and its revision matches.
- Resolution then uses `input.agents` and `input.bindings`, not `profileOpt.value.profile`.

**Dynamic reproduction**: A stored Profile at revision R referenced `agent-a`. A ProfileInput using the same path and R but supplying `agent-b` returned `valid=true`, selected `agent-b`, and produced no diagnostics.

**Impact**: Profile identity/revision does not authenticate the composition being planned or frozen. Audit provenance says Profile A while runtime facts come from client input B.

**Required action**: ProfileInput should carry only Profile identity plus allowed request metadata. Resolver must derive the composition from stored Profile content, or compare every supplied field exactly and reject mismatches.

### MEDIUM-3: Freeze tool fingerprint is still not the approved security contract

**Evidence**:

- `packages/core/src/composition-resolver.ts:447` derives `toolNames` from `plan.skills`.
- It hashes a comma-joined sorted Skill-name list and stores it as one `fingerprint`.
- The approved contract requires per-tool fingerprints with placement, name, normalized definition/schema digest, and installationVersion, plus a separate aggregate ToolCatalogDigest.

**Impact**: The Snapshot labels Skill names as tool identity, cannot detect tool schema/executor installation drift, and cannot support the required provider-turn revalidation.

**Required action**: Keep this as an explicitly non-security placeholder or implement the typed fingerprint/catalog contracts from ToolRegistry registrations. Do not claim MEDIUM-2 closed based on the current hash.

### MEDIUM-4: Profile relativePath remains silently flattened

**Evidence**:

- `CustomProfileService.propose` and `apply` validate `candidate.relativePath`, then call `path.basename`.
- The path layer and plan support nested relative paths.

**Dynamic reproduction**: Applying `relativePath="nested/nested-profile.yaml"` reported `nested-profile.yaml`, wrote the file at the owner root, and did not create the nested path.

**Impact**: The service mutates a different identity from the typed Candidate and can collide with another root asset. The prior three-identity finding is only partially closed.

**Required action**: Preserve the normalized relative path through target resolution, lock key, registry lookup, readback, and response. Alternatively forbid nested paths in Schema and path tests.

### MEDIUM-5: Delete compensation still fails the transaction contract

**Evidence**:

- `rollbackDelete` catches rollback write failures, logs them, and ignores them instead of returning `RollbackFailedError`.
- If `registry.reload()` fails after deletion, the effect maps directly to `WriteFailedError`; `rollbackDelete` is not called in that branch.
- No failure-injection test covers reload/readback/rollback failure.
- `referencingProfiles` only checks whether another Profile's **agent relativePath equals the Profile file path**, which does not model references to Profiles and will ordinarily be empty.

**Impact**: A failed delete transaction can leave the file removed and registry stale while reporting only a generic error. The returned reference summary does not represent the intended reverse-reference graph.

**Required action**: Reuse the proven asset delete compensation pattern, propagate rollback failure, and define what entities can reference a Profile. Add injected reload failure, rollback success/failure, and real reverse-reference tests.

## 4. Non-blocking Findings

### LOW-1: AssetKind pre-registration uses incorrect owner directories

Runtime evidence:

```text
mcp            -> .aigcfroge/mcp       (canonical: .aigcfroge/mcps)
custom-profile -> .aigcfroge/profiles  (canonical: .aigcfroge/custom-profiles)
```

The test asserts only IDs, not ownerDir. Use constants instead of repeated path literals and assert all eight mappings.

### LOW-2: Composition-local Skill catalog is still dead production code

`createCompositionSkillCatalog` has no production caller. Runner and SkillGuidance continue using Location-wide `SkillV2.Service.list()`. AgentAssetBridge is now registered, but AgentV2's watcher subscribes only to `.agent.md`; AgentAsset watcher reload does not explicitly trigger AgentV2.reload, so the required watcher-driven candidate update still lacks evidence.

### LOW-3: Capability aliases weaken the negotiated contract

`isCustomCapable` accepts undocumented aliases `mode/custom` and `custom-mode` in addition to the approved `product-mode-custom-v1`. Tests predominantly use the alias. This expands compatibility semantics without an ADR/SDK contract and can make accidental headers unlock Custom visibility.

## 5. Verification

| Check             | Result                            |
| ----------------- | --------------------------------- |
| Schema focused    | 20 pass, 0 fail                   |
| Core focused      | 64 pass, 0 fail                   |
| AigcForge focused | 11 pass, 0 fail                   |
| App unit suite    | 895 pass, 0 fail                  |
| Full typecheck    | 15/15 successful                  |
| Full lint         | 2831 files, 0 errors, 36 warnings |
| Incremental lint  | pass, 70 files / 6118 added lines |

The reported "0 warnings" is true only for the incremental gate. Full lint still reports 36 warnings. Passing focused tests do not cover the reproduced fork, ProfileInput substitution, nested path, ownerDir, or mode-less SSE cases.

## 6. Final Decision

**M0 remediation is not accepted. Do not start M1.**

Minimum blocking rework:

1. Close all root and derived Custom creation paths, including V1/V2 fork.
2. Apply capable-client checks to every V2 Session endpoint and resolve mode for every Session SSE event.
3. Make stored Profile content the ProfileInput truth source.
4. Replace the Skill-name hash with the approved Tool fingerprint/catalog contracts or explicitly defer freeze security facts.
5. Preserve or explicitly prohibit nested Profile paths.
6. Implement and failure-test real delete compensation and reverse references.
7. Correct AssetKind owner directories and test them.
8. Wire the composition-local Skill catalog and watcher behavior, or mark that Phase D slice incomplete.

This report is the only file added by the re-review; implementation files were not modified.
