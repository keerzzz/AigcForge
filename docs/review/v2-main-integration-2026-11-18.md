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

## Unit fixtures and remaining E2E blockers on c5b7ac8

CI run `44340743218` completed on `c5b7ac8543ec10485acf82c3d67cca22e0aa9036`. The PR is mergeable, but required checks still block integration. Its review-thread query returned no unresolved threads. Linux unit logs record 171 failures and three unhandled errors. Windows logs record 31 failures, including six Server and 25 Core failures; Core has no final package tally in that log.

The production correction is in Core's Model owner. A credential change can reconstruct provider metadata without changing the merged model. After merging complete model information, the owner compares values and reuses an unchanged model from the current scope's previous inventory. It preserves unchanged inventory identities while refreshing catalog data. Default-model and configured-group changes still publish updates. Existing catalog keepers now assert inventory identity and default-model notifications.

The other unit corrections align existing fixtures with current owners: real Agent services and builtin provenance, durable Session preparation, parent rows required by SQLite foreign keys, Core filesystem errors, typed live Activity events, completed Shell metadata, current model fields and tool inventories. Compact removes its unused old service graph. MCP markers use the platform temporary directory; Server alias fixtures retain their final dot through `path.sep`. The YAML runtime probe builds separate Bun and Node targets and uses the existing external `jsonc-parser` dependency. Linux CI installs ripgrep before unit execution, as Windows already does. An isolated cold PATH reproduced the missing-ripgrep failure; adding the real executable passed the original 11-case keeper without permitting test downloads.

| Focused keeper                                            | Recorded result                                                                 |
| --------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Model catalog, plugin and group                           | 24/0, 6/0 and 13/0                                                              |
| Skill, Command, Compact, Generate and Namespace           | 9/0, 11/0, 3/0, 4/0 and 4/0                                                     |
| Wait, Log, View, unloaded Remove and Move                 | 1/0, 5/0, 4/0, 1/0 and 23/0                                                     |
| Subagent, Instructions and Config compaction              | 3/0, 7/0 and 1/0                                                                |
| Models, Delegation protocol and Shell completion metadata | 16/0, 7/0 and 2/0                                                               |
| Activity, YAML dual runtime and MCP                       | 4/0, 1/0 and 48/0                                                               |
| Server platform aliases                                   | Five cases passed across four single-file runs                                  |
| Location provider isolation                               | 1/0, seven expectations; both Locations retain exact builtin inventory coverage |
| MC04b L0 and MC06 cold SDK clones with declared budgets   | 2/0, 189 expectations, using the default package command                        |
| MC07 external governance and no-code-change               | 1/0 with 122 expectations, and 7/0 with 186 expectations                        |

These runs use one package and one local test process at a time. Overlapping keeper runs are not summed into a suite total. Six existing long integration declarations and one Server snapshot declaration receive explicit 30-second test budgets. The L0 and cold SDK cases previously failed under Bun's five-second default and passed in 15.03 and 17.62 seconds with the explicit budget. MC07 now waits for the actual parent drain to become idle before checking request counts and persisted results. The retained diagnostics showed a running parent and completed child write at the old two-second request-count gate. Parent consumption, revision/CAS, governance and permission assertions remain.

Local verification now uses a 1 GiB cgroup, zero swap and one CPU quota. Full Core typechecks, Storybook builds and browser environments are assigned to hosted CI after repeated local resource failures. Raw failures and successful focused runs remain separately stored under `/home/keer/.codex/outputs/2026-11-18/v2-main-integration/validation/`. Independent review receipts are also retained outside the repository.

E2E remains open. Linux production E2E reports 59 failed, five flaky and 570 passed tests; Linux Session UI components report 137 passed. Windows production E2E reached its 50-minute step budget without a final tally. Its 47 emitted diagnostics are not a final failure count. Both platforms' App component jobs failed the same four timeline cases in their shared Storybook setup.

Two fixture corrections address observed E2E setup failures. The timeline component setup uses the actual `aigcforge-composer-flow--mixed-attachments` Storybook ID, confirmed against the generated story index. The shared mock API now handles `agent-asset.content` through the existing Protocol query and configured asset inventory. Its real HTTP adapter returned 404 before the correction, 200 for an existing asset afterward, and 400 for an absent asset. These checks do not yet establish browser acceptance of those scenarios.

The local four-case timeline browser attempt did not finish Storybook compilation within the resource limit and ended with signal 143. The recorded cgroup observation had zero `oom` and `oom_kill` events; the termination sender is unknown. All identified owned processes ended and port 16006 was released. Remaining browser investigations use saved logs and bounded trace reads. They include keyboard focus versus scrollbar visibility, obsolete session-source card selectors versus the current Attach session picker, missing palette actions, workflow revision rendering and timeline geometry/streaming failures. Required CI and these actual acceptance blockers must close before the authorized main merge.

Original hosted logs and failure classifications are preserved in `/home/keer/.codex/outputs/2026-11-18/v2-main-integration/hosted-ci-3eebd/`; `e2e-c5b7-original-log-preservation.json` records their identities. The earlier quality job ended with runner shutdown and signal 143 without lint-rule diagnostics or hosted OOM evidence. Its unchanged gate will run on the next commit.

The final correction pass formatted each package serially and confirmed identical TypeScript syntax trees for all 30 source/test files. Scoped syntax lint reports zero errors in Core, Server and App; Core retains six unchanged string-escape warnings. This scoped lint disables type awareness to fit the local resource budget. App E2E typecheck then ended with SIGTERM/143 without type diagnostics; its sender is unknown and the check remains incomplete. The existing hosted quality job runs this package check. Complete typed lint and canonical checks remain required in CI.

Independent review caught a content-fixture gap after the initial HTTP status probe: Agent summaries lack the config and source required by AgentAsset.Info. The mock inventory now requires complete Info as well as summary metadata, and both existing inventories provide it. A probe extracts the actual custom-profile fixture declarations and passes them through the real mock HTTP adapter and consumer Schema. The old HEAD fixture fails with Missing key config; both current root and worker assets return 200 and decode fully, with the same path/revision/content; an absent asset still returns 400.

Eight source-attachment scenarios now follow the production Attach session → Open sessions picker. The shared harness asserts one candidate, its exact title and the full server plus Session data-key before clicking; original history, draft, request identity, late-reply and zero-mutation assertions remain. The affected App files pass scoped syntax lint and default Playwright collection: 222 scenarios in six files. Collection validates harness loading, not browser outcomes; those scenarios remain assigned to required hosted E2E.

The mobile scrollbar investigation reads a bounded prefix of one hosted retry trace using confirmed HTTP 206 ranges. Its complete inner event files pass size/CRC checks; the outer ZIP remains partial. In the nested Pixel 7 failure, the DOM has one visible vertical thumb with dragging=false, and the Shell scroll region remains focused after the explicit keyboard setup. ScrollView hover mode intentionally includes focus. Three keeper boundaries now release that keyboard focus before the existing hidden-thumb assertions, covering two nested, six navigation-handoff and eight Home scenarios. Original touch-release order, anchor measurements and exact geometry assertions remain. This correction changes the fixture precondition; all 16 browser outcomes still require hosted E2E.
