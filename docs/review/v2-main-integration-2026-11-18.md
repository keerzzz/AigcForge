# V2 integration into main

The integration target is `main`. The proposal to create a remote default `v2` branch was cancelled by the requester. PR #142 remains the delivery vehicle.

## Source and workspace preservation

- Remote base: `d11d3c7c16f0bcf318a0197bfb647c3cf81b06fd`.
- Delivery source before this integration: `928377ca374b85f4e1080b3ee836d4bb75c0fdfb`.
- Default checkout before this integration: `edbe67383d830aa40269ddf453c7f5617c940b46`.
- The default checkout has nine modified tracked files and five untracked files. All 14 files were copied, archived and checked against their original SHA-256 values. Its HEAD and Git status were unchanged by the backup.
- Backup receipt: `/home/keer/.codex/outputs/2026-11-18/v2-main-integration/default-worktree-backup-v1/receipt.json`.
- Neither `main` nor the delivery source tracks `docs/review/evidence/**`. The existing evidence archives and their independent receipts remain outside the PR.

## Resulting workflow

The main workflow surface and PR policies are retained: team membership, issue labels, two-hour compliance policy, Git hooks and disabled Nix/notification workflows. V2-only upstream deployment and agent workflows are removed. The Bun setup retains V2's package-manager version and patched dependency handling.

CI uses GitHub-hosted runners, the existing required contexts and main's incrementally guarded semantic lint policy. GUI anti-slop warnings remain an independent inventory rather than an extra whole-file failure policy. Quality, Linux/Windows unit tests and Linux/Windows E2E feed the `Lint, Test, and Typecheck` aggregate. Every dependency must succeed. Linux unit work executes once, rather than twice. Unit and E2E retain main's existing platform time budgets. Generated Client, workerd, codemode and component checks use actual V2 owners.

The desktop controller retains main's source-bound version PR, Draft, artifact verification and publication route. Its bundled CLI comes from the same source SHA. CLI binary packages use the `cli-*` directory and package prefix already consumed by the desktop packager and CLI publisher; the executable remains `aigcfroge`. Stable/beta desktop update feeds use the existing GitHub repositories.

Manual review uses the V2 source CLI with `--standalone`. The previous permission environment variable has no V2 consumer; the rules now enter through the existing inline configuration normalization boundary. Project configuration is disabled for this workflow. An unsupported legacy provider key fails before model execution. Manual release notes use one V2 prompt with the existing bilingual template and deterministic changelog input. Client generation follows Protocol generation.

## Review scope

The complete comparison with `main` contains 9,183 paths: 5,137 additions, 1,159 modifications and 2,887 deletions, with rename detection disabled. The [complete file index](v2-main-integration-2026-11-18.json) includes its own path. Review with `git diff --no-renames origin/main v2-delivery`; GitHub's capped file API cannot supply the entire migration. Raw evidence archives and build outputs are excluded.

## Verification and remaining acceptance

Local validation uses one package at a time. One accidental overlap between CLI and Desktop typechecks was corrected by terminating Desktop; its SIGTERM receipt remains recorded. Cross-package incremental lint reached the 3 GiB memory limit and ended with SIGTERM before returning diagnostics. The signal sender is unknown. Local checks then used scoped package configurations; complete migration checks remain assigned to hosted CI.

| Check                                           | Observed result                                                                                   |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Release controller and metadata                 | 47 pass, 0 fail, 92 expectations                                                                  |
| Script typecheck                                | Exit 0 after adding the async DOM stream library; the initial missing-library failure is retained |
| Client event/read and concurrent rename keepers | 2 pass, 0 fail                                                                                    |
| Desktop packaging keepers                       | 7 pass, 0 fail, 140 expectations                                                                  |
| CLI typecheck                                   | Exit 0; 198 seconds; no replay after reboot                                                       |
| Desktop changed-script typecheck                | Exit 0 through the Script check with a scoped configuration and a 3 GiB process limit             |
| Home session index                              | 9 pass, 0 fail, 21 expectations                                                                   |
| Permission configuration normalization          | 1 pass, 0 fail                                                                                    |
| Remaining checks and current PR CI              | Pending completion in the integration receipt                                                     |

The prior GUI lint inventory against the upstream snapshot reported 685 diagnostics in 181 of 1,164 selected files. Static selection against main covers 2,188 files; its complete diagnostic count has not been measured separately. Hosted quality on `cb7007a0c95d4a39d0ff5fdacbecd82db9f424ce` checked 5,327 files and reported 7,184 warnings with zero errors. Those totals cover the root lint inventory, not just the selected GUI files. Prior successful checks of a smaller changed-file range do not close this complete migration inventory. Review credit for the original staged increment is not full-history migration credit.

## CI corrections after the integration commit

The first completed jobs in CI run `44319104616` identified four concrete failures. Storybook run `44319104205` identified a fifth dependency failure. The corrections retain the test commands and required contexts.

| Observed failure                                                                       | Correction and executable evidence                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Linux unit stopped at 43 Effect simplification diagnostics                             | Use the existing `Effect.orElseSucceed`, `Effect.mapError` and `Stream.mapError` operators and remove three identity Schema pipes. The original gate now exits 0. Core's eight affected keeper files pass 158 tests with 714 expectations; Server's MCP asset keeper passes three tests with 55 expectations.                                                                                       |
| SDK guide verification found a stale Pairing source block                              | Synchronize the existing README block with the production Pairing module. SDK docs verification exits 0: 158 declarations, 710 members, 198 parameters and 16 guide blocks.                                                                                                                                                                                                                         |
| Playwright 1.59.1 rejected the Linux runner's Ubuntu 26.04 before downloading Chromium | Pin only the E2E Linux runner to the supported `ubuntu-24.04`. The locked Playwright host and browser registry mappings confirm support; hosted E2E must verify browser installation and the retained tests.                                                                                                                                                                                        |
| Windows unit's prerequisite Schema declaration build reported TS7056 on ConfigV1.Info  | Apply the existing `Schema.revealCodec` identity function to expose the decoded, encoded and service types without serializing the full nested Struct helper type. The actual Schema declaration build exits 0; the seven-case runtime comparison preserves the AST, decoding and schema object identity. Schema's full suite passes 487 tests with 1,995 expectations; Protocol typecheck exits 0. |

Storybook's Pairing mock could not resolve its direct `@tanstack/solid-query` import. Storybook now declares the same `5.91.4` version already used by App and GUI extensions. Bun regenerates only the workspace dependency entry in the lockfile, with no package-version changes; frozen offline installation passes. The actual Vite production resolver and imported exports verify the original mock's QueryClient/QueryClientProvider and transitive query-core dependency.

The Effect replacements preserve typed-failure handling and lazy fallback evaluation. Existing defect handling and rollback effects remain in place. The three LSP Schema pipe removals preserve the actual AST and all nine sampled decoding outcomes. ConfigV1's static type no longer exposes Struct-specific `fields` and `mapFields`; the repository's consumers do not use those helpers. Public wire contracts and HttpApi definitions are unchanged.

Core's full package typecheck did not complete locally. Its command was `tsgo -b tsconfig.json tsconfig.tests.json`. The kernel log at 22:29:20 local time records a memory-cgroup OOM that killed `tsgo` PID 87032 in the same transient scope as `core-ci-typecheck-final`; the runner log records SIGTERM. Complete Core type validation remains assigned to hosted CI rather than another local 3 GiB attempt. This observed cause applies to this Core attempt; the earlier cross-package lint interruption still has an unknown signal sender.

The local Storybook production build completed transformation of 5,617 modules, then aborted after exhausting its configured 2 GiB JavaScript heap, inside the single-core 3 GiB scope. The resolver check verifies the reported dependency failure's correction; full Storybook build success remains assigned to hosted CI. The aborted build receipt and its raw heap diagnostics are retained.

The Core and Server keeper results, Schema declaration build and tests, and Protocol typecheck are bound to the unchanged 17-file correction patch, SHA-256 `73160a6f043e5fa6438cabd22f84f87c6c5ca7dee9317b31d3cdb4914b9ce743`, on top of `cb7007a0c95d4a39d0ff5fdacbecd82db9f424ce`. SDK docs and the Effect gate ran before the ConfigV1 correction; their verified owning inputs remain unchanged. The review document is updated separately. Receipts and raw logs are under `/home/keer/.codex/outputs/2026-11-18/v2-main-integration/validation/`, `ci-effect-simplifications/`, `ci-schema-emit/`, `ci-e2e-triage/` and `restart-review/`.

Fresh hosted CI and the remaining migration acceptance are still pending. The original Core process tests do not directly cover the modified Core process module, and PluginBridge and InstructionContext have no dedicated keepers for these branches; the scoped test totals are not per-branch coverage claims.

## Subsequent declaration corrections

Hosted CI on `3eebd1fc5b71faa651eb01aaf67c649f0cf1c419` passed Storybook, root lint, all 24 package typechecks and App E2E types. Linux unit then exposed Core's TypeScript 5.8 declaration error TS2322: the verification response branch could include external outputs whose schemas do not declare `verification`. The verification route already excludes external, Workflow, background and root-dispatch execution. The branch now selects the existing internal `sessionID` and `output` fields. Its actual source branch reproduces TS2322 before the correction and has no diagnostics afterwards against canonical Tool.Result and retained public declarations. The existing single-file MC04b suite passes 14 tests with 207 expectations under a single-core 1 GiB limit.

Windows unit exposed Protocol TS7056 on `makeSessionGroup`. The private PublicSessionInfo now uses the existing `Schema.revealCodec` identity function; its endpoint names, middleware parameters and wire schema remain intact. TypeScript 5.8 declaration emission for the actual failing source file reproduces TS7056 before the change and emits successfully with zero diagnostics afterwards. A local full Protocol build exhausted its configured 1 GiB JavaScript heap inside a 1.5 GiB single-core scope, so complete package declaration builds remain assigned to hosted CI.

The complete OpenAPI document remains byte-identical across this change: 328 paths, SHA-256 `73df143e75593a491fd49986929d0e1d70a21801ac50dc4ee748a896aff29364`. Formal Client generation exits 0; all 11 tracked generated files retain their bytes and modes. Core and Protocol source changes introduce no new wire fields or generated-client edits.

The quality job's incremental lint ended with SIGTERM/143 after the runner reported a shutdown signal. It returned no rule diagnostics; the hosted log provides no OOM evidence. The original gate is retained for the next CI run. Raw failures, focused declaration checks and contract/generation receipts are indexed under `/home/keer/.codex/outputs/2026-11-18/v2-main-integration/hosted-ci-3eebd/` and `validation/`.

Default WIP is mapped to current V2 owners. V2 already has one App query provider; its Home HTTP index is separate from Client Data messages. The prior eleven root-snapshot rules are not all equivalent to V2's live index contract. New-session refresh, URL cleanup, actual DOM retention and the six preserved residuals remain in the [technical-debt ledger](../technical-debt.md).

The requester has authorized merging PR #142 into remote `main` after blocking review and required CI issues are cleared, then synchronizing the corresponding local `main` while preserving existing WIP. The root version remains `2.0.26`; the latest published release is `v0.0.8`. The existing desktop controller therefore skips candidate generation for an ordinary main merge because the source version is ahead of the latest release. The remote desktop automation variable remains `publish`; only a validated version-candidate PR enters automatic desktop publication. Creating a new release seed is outside the authorized Git integration.

Fourteen full-package publishing entrypoints are absent in V2, so the desktop workflow offers its implemented desktop route. Full npm publishing, platform installers, installed-database upgrades and real-provider acceptance retain their separate checks and authorization boundaries. The existing acceptance ledger records the planned WIP consumer cases and six preserved residuals.
