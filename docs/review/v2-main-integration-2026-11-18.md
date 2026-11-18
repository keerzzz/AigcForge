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

The prior GUI lint inventory against the upstream snapshot reported 685 diagnostics in 181 of 1,164 selected files. Static selection against main covers 2,188 files; its complete diagnostic count has not been measured. Prior successful checks of a smaller changed-file range do not close this complete migration inventory. Review credit for the original staged increment is not full-history migration credit. The PR's scope must be recalculated against main.

Default WIP is mapped to current V2 owners. V2 already has one App query provider; its Home HTTP index is separate from Client Data messages. The prior eleven root-snapshot rules are not all equivalent to V2's live index contract. New-session refresh, URL cleanup, actual DOM retention and the six preserved residuals remain in the [technical-debt ledger](../technical-debt.md).

The root version remains `2.0.26`; no first-release seed is approved by this integration. Fourteen full-package publishing entrypoints are absent in V2, so the desktop workflow offers its implemented desktop route. Full npm publishing, platform installers, installed-database upgrades and real-provider acceptance require their own remaining checks. Main's automatic desktop publication is enabled remotely; the final merge/publication boundary requires requester confirmation after the integration is reviewable.
