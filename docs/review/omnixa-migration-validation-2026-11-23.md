# Omnixa migration validation — 2026-11-23

## Reviewed migration freeze

This matrix records the source frozen at `2026-11-23T14:21:04Z`, before the submission lint repairs described below. The Stage 4 package and screenshots belong to that freeze.

Final owning-package receipts cover **23 packages and 24 full suites: 17,911 pass / 429 skip / 0 fail**. The **15 related App E2E passes** are recorded separately. Totals include one selected final full suite per owner; App unit and browser suites have separate rows.

Commands below run from `packages/<owner>` with the repository Bun launcher (Bun 1.4.2). The SHA-256 column identifies each selected receipt's original complete log.

| Owner / suite   | Command                                     | Pass / Skip / Fail | Basis      | Receipt log SHA-256                                                |
| --------------- | ------------------------------------------- | -----------------: | ---------- | ------------------------------------------------------------------ |
| ai              | `../../script/bun run test`                 |      1792 / 28 / 0 | Reused     | `e01249c0a192cbe6dd169191a6ef4786959c521aa44e41a0c9120f34d108c396` |
| app / browser   | `../../script/bun run test:browser`         |        170 / 0 / 0 | Review run | `9b80bef26d85503fe270ad9bf5e04508028966a11875a54ae54ae94b5942442f` |
| app / unit      | `../../script/bun run test:unit`            |        826 / 0 / 0 | Review run | `23dd6469441e56aad1db0e1cf2a34dc794fe2042ca58b50d5ef0b5d7a37f01fb` |
| cli             | `../../script/bun run test`                 |        376 / 9 / 0 | Review run | `b449d8f91a39d321a8d2331dc03bc7c0c1203ae6d603f8c0373debdee6b3eb47` |
| client          | `../../script/bun run test`                 |       375 / 22 / 0 | Reused     | `451df6ab4bcd47f093425834053f927aa102da8d7d686a9a0257edccfdd8b5f3` |
| codemode        | `../../script/bun run test`                 |       1398 / 0 / 0 | Reused     | `d3cdb541d3a88ea4d62f736ea0f95d7355330a22b4f68e41d261a965c4b00d9c` |
| core            | `../../script/bun run test --timeout 30000` |     8638 / 365 / 0 | Review run | `11f2b98e5cfdfad11b6dbee5983a180252989564a88569f595184c1a8786f7ce` |
| desktop         | `../../script/bun run test`                 |        123 / 1 / 0 | Review run | `348d61f29cb59c3cf37ef643c494f7b2c30e18acc1392ab63ab45c64b6b545df` |
| gui-extensions  | `../../script/bun run test`                 |        442 / 1 / 0 | Review run | `84f59a8b251229695e9fb3a0cdb39be3b9cd3c94cbe4d5c10e893ca0c6dd43d3` |
| http-recorder   | `../../script/bun run test`                 |         53 / 0 / 0 | Reused     | `31c6d61dd478e487718c1ff4fe55392a1a05effd0e11c09512ed6a41d3a08ccd` |
| httpapi-codegen | `../../script/bun run test`                 |        124 / 0 / 0 | Reused     | `4e0a7a6d93938de6547672effb4b6941e91e7f0dcc374bf648875e5be2f20caa` |
| latex           | `../../script/bun run test`                 |        123 / 0 / 0 | Reused     | `a7ea030b98160284761f380ab36414c5939f68ebb70622463ff087422258371b` |
| merman          | `../../script/bun run test`                 |        505 / 0 / 0 | Reused     | `ac84a02f1408969230d6a9a329b5158e1eaf05d78d7ddf5e4d054e7eb2d5eb42` |
| plugin          | `../../script/bun run test`                 |          9 / 0 / 0 | Reused     | `16e1a65586c167ecf961e7aee1f8d00cf3b58681d6d8e721c97d9d4447dba339` |
| plugin-browser  | `../../script/bun run test`                 |         44 / 0 / 0 | Reused     | `796d41598dc46a409a0641b4a8cd957bf3e13d9bd9863852d4486984295ec64a` |
| schema          | `../../script/bun run test`                 |        488 / 0 / 0 | Reused     | `40aafff52ee48a1b83247cf422aa8e649de80cbaa3ba2fa06d92c3d0b97e033e` |
| script          | `../../script/bun run test`                 |         79 / 0 / 0 | Review run | `f4be71318b72a45801f6097251e4cd0f994d85a7a4cb2aea26a540ab61915fca` |
| server          | `../../script/bun run test`                 |        254 / 1 / 0 | Reused     | `63e8c0a8839408b23cf2ffadaa5dd72f49f295447cab7d7712f998bf1dd45d65` |
| session-ui      | `../../script/bun run test`                 |        256 / 0 / 0 | Reused     | `7d88c2930551c652003217dee76fd3588dfbcc262d47daed2721f9f6088c3e4d` |
| simulation      | `../../script/bun run test`                 |         47 / 0 / 0 | Reused     | `ccd9a791490e186a71c251ac0c8502dc8181d83daa78a4acd74ff5e9d9761e67` |
| theme           | `../../script/bun run test`                 |          2 / 0 / 0 | Reused     | `4f0dc21fe88b6b2d9c1963a40f0da8a07cedbd378c358a9c7a89b70d65f1cafe` |
| tui             | `../../script/bun run test`                 |       1544 / 2 / 0 | Review run | `bbb2054a7af32d6ca29f809139f260426fdfbc6768f705a6e5a5f48c74173f29` |
| ui              | `../../script/bun run test`                 |        148 / 0 / 0 | Review run | `b79053ececcbb7cd84b4fa245a5fba265da9dd25ef1c91c8841f1b60c348b4c4` |
| util            | `../../script/bun run test`                 |         95 / 0 / 0 | Reused     | `f74105baba1c7e532bfe4f17122b34d45e861aaf6c4997245240b19e8a765af7` |

The 15 reused package receipts retain their original log, exit code and counts. Their complete owning inventories (1,836 files), plus 24 common root manifest/configuration/launcher/patch inputs, match the historical and final review freezes. Reuse establishes owning-input consistency; it does not assert unchanged transitive Core implementation. The other eight package owners use nine current full-suite receipts.

Core's later keeper formatting is connected to its green source by deterministic canonical byte equivalence. CLI's non-owning GUI keeper change is independently covered by the final 442-pass GUI suite. Directed subsets, retries and superseded full suites are retained in the evidence ledger rather than added to the totals.

Protocol and Storybook are the remaining two package owners:

| Owner / check        | Command and cwd                                             | Result                                                                         | Receipt log SHA-256                                                |
| -------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Protocol generation  | `../../script/bun run check:generated`, `packages/protocol` | exit 0; reused receipt and 88 owning inputs match                              | `b53b62748400740d3735dd75b585c11f94a8abac8d26759cfec2b9e061bea038` |
| Storybook            | No declared test/typecheck entry                            | No test count assigned                                                         | —                                                                  |
| Root canonical check | `./script/bun run check`, repository root                   | exit 0; lint, formatting, assertion, AST, SDK docs and 24 type tasks completed | `e03b29701abcd7b2e588cfc1fed47553a40ea7769b16080eb5c2adb9a1075dfb` |

Related built App E2E: **15 pass / 0 skip / 0 fail**. From `packages/app`, the selected regression and model-selection cases used workers=1 and retries=0. `EVIDENCE_DIR` denotes the private output folder in this portable spelling of the recorded command:

```bash
../../script/bun run test:e2e:built e2e/regression/settings.spec.ts e2e/regression/whats-new.spec.ts e2e/user-story/model-selection-flow.spec.ts --project=chromium --workers=1 --retries=0 --reporter=line --output="$EVIDENCE_DIR/app-e2e-artifacts" --grep "providers:|What's New:|a rejected update check|creates a session in a new project"
```

E2E receipt log SHA-256: `c9b2f145bbdd1f74c9b42baae0e17fe10f6fe3c39e0ffeeb2f4b1d2f9e008a00`.

Stage 4 completed production **Linux amd64 0.0.9** acceptance: isolated real `dpkg` installation, two packaged Desktop launches, bundled CLI/server identity, authenticated API, complete SSE events, renderer PTY ticket/replay, and persisted session/window/language state. CLI display version was `omnixa v0.0.9`; Desktop and API versions were `0.0.9`.

The accepted `.deb` SHA-256 is `ef20e8017dd14c4e8bfcee4977ffc7c8af5fece7433c7ce3befe5c52d867f064`. Bundled CLI, built CLI and the running server executable share SHA-256 `33c96c998adaa29c59c7f5be27ad97ecd4039052416dc634e915e4eb2514e059`.

Stage 4 does not include live model-provider calls, actual remote SSH, Windows WSL, other-platform packaging/signing or online publication. Those retain their platform receipts and `V2-R01-RELEASE` follow-up requirements in `docs/technical-debt.md`. This matrix records the completed local Linux engineering acceptance.

## Submission follow-up — 2026-11-24 (Asia/Shanghai)

The submission repairs the original 22 added-line lint diagnostics and the contract checks found during follow-up. Schema preserves branded literal durable-event versions with the existing positive-integer constraints; Protocol and the generated Effect client share the authoritative SessionLogItem type. Markdown parsing and streaming use one registered-language check and the existing named-language loader. Native window-state text, builtin theme modes and typed wire fixtures are checked at their existing boundaries. The original twelve type-only repairs retain byte-identical output evidence from the actual Bun compiler.

The selected follow-up receipts below were run serially in isolated owning-package directories: **12,194 pass / 399 skip / 0 fail**. These results cover the final submission repairs and remain separate from the historical migration total above. Complete Core and CLI runs replace their contained keepers; directed retries and private diagnostics are not added to this total.

| Owner / suite                              | Command from owning package                                                                                                                                                                             | Pass / Skip / Fail | Complete log SHA-256                                               |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -----------------: | ------------------------------------------------------------------ |
| app / app-browser-lint-final               | `../../script/bun run test:browser`                                                                                                                                                                     |        170 / 0 / 0 | `1d7c6d0e35ff4d7a61fe5f2a4f311bb097a7c6901c968d2bb29813fb30e3549b` |
| app / app-unit-lint-final                  | `../../script/bun run test:unit`                                                                                                                                                                        |        826 / 0 / 0 | `9423526764476306f0d9a8cc66d9425b61c8fa578bdad752fa7811d75c8da866` |
| app / app-wire-fixture-keeper              | `../../script/bun test ./e2e/performance/timeline-stability/fixture.test.ts`                                                                                                                            |          5 / 0 / 0 | `9d6f4ee9cb2d62ccf5fc48d2c66c173e60690e6794ae6c160c9950386d247f8b` |
| cli / cli-version-consumption-full         | `../../script/bun run test --timeout 30000`                                                                                                                                                             |        376 / 9 / 0 | `8314852d4dabb1eb343525d0e87220ed2a005ed7a2e63073cdc67ab7ee947bbf` |
| client / client-version-consumption-full   | `../../script/bun run test`                                                                                                                                                                             |       375 / 22 / 0 | `cf395eb736b4b2f269ceb34b32b3e7b6904528567a920be44d07cf4d29e1032a` |
| core / core-version-consumption-final      | `../../script/bun run test --timeout 30000`                                                                                                                                                             |     8638 / 365 / 0 | `0a6d5f3a1c68c768042ffc3f30ba22702bf0997e5f7877f1df4187ee1f56c5d7` |
| desktop / desktop-lint-full                | `../../script/bun run test`                                                                                                                                                                             |        125 / 1 / 0 | `b5789583e905eb3f5c2c28f285a98e52e4283098505cd7912c71e36cdd6f8b64` |
| gui-extensions / gui-lint-full             | `../../script/bun run test`                                                                                                                                                                             |        442 / 1 / 0 | `fab38d5e6297d5a531f7fee6dbcb76d64bb362e385316f5536169659793d11bf` |
| schema / schema-payload-literal-full-final | `../../script/bun run test`                                                                                                                                                                             |        489 / 0 / 0 | `f6919392bee59f2e1070a0b88772068eca72ac4758a58ee75b240566c058b127` |
| server / server-version-consumption-final  | `../../script/bun run test --timeout 30000`                                                                                                                                                             |        254 / 1 / 0 | `29147f5ab8b9439f8d66f4889e1c911b82a20057570e13f7073752e485f737f6` |
| session-ui / session-ui-language-full      | `../../script/bun run test`                                                                                                                                                                             |        256 / 0 / 0 | `330f29d6ebada52ab75864cd9966874f5b48b21a0c54bc7ad2c84494439feb2a` |
| tui / tui-theme-notifications-keeper       | `../../script/bun run test test/theme.test.ts test/theme/v2 test/mini/theme.test.ts test/component/terminal-pane-theme.test.ts test/cli/tui/theme-mode.test.tsx test/cli/cmd/tui/notifications.test.ts` |         90 / 0 / 0 | `3ee9bcbba99d630b74314ef70c5b9a11ffaf5f2617a50f9dc58429fd2670b1ac` |
| ui / ui-lint-full                          | `../../script/bun run test`                                                                                                                                                                             |        148 / 0 / 0 | `b4eb27c27f6de2f9f7eeafa05bae163a117daec17423096abea889ab6f00aa41` |

Real Markdown Worker browser suite: **29 passed**, workers=1 and retries=0. It covers registered names, aliases, unknown languages and inherited object-key names in parse, streaming and completion. Complete log SHA-256: `19d90f055dec1cee01d207e5a6f4bcee2308330c4c247169cbfd23c5a7d2c4b3`.

Fresh production-build App E2E: **15 passed**, workers=1 and retries=0, using the selected regression and model-selection scenarios recorded above. This run rebuilt the current source. Complete log SHA-256: `3809f2dd491ff46eed3a00c113c518d6758186d1096fa1824042040d32c99250`.

The first follow-up Core run recorded one 5000ms process-cleanup timeout. A controlled slow-start reproduction exposed the readiness race; the original run did not record the exact blocking phase. The existing keeper now registers the real child signal handler before readiness and advances TestClock by the original 250ms after readiness, preserving actual SIGTERM cleanup and the 5000ms test limit. The final complete Core run passed.

The first follow-up Server run recorded two failures expecting 400 and receiving 404. Adjacent watcher records show directory lengths of 114/115 characters, compared with historical lengths of 98/99; the original failing request URLs were not captured. The pinned router rejects decoded parameters over 100 characters, and a same-isolation-root router probe plus the isolated keepers confirmed this boundary. The two keepers use the same directory’s short root as the invalid Session ID, preserving their actual Location query and every original assertion. Router, authentication and placement code retain their bytes; the final complete Server run passed. Original failures, controlled probes and successful reruns retain separate receipts.

The first canonical check failed on restricted Reflect.apply in the added negative constructor keeper. The keeper now invokes definition.make(wrong) directly, with an explicit @ts-expect-error for intentionally invalid input. Schema owning typecheck and its complete 489-test suite passed; lint rules retain their bytes. The successful canonical check below supersedes that failed run.

The next canonical check exposed eight Core type errors because Event.Payload<D> discarded the definition's known version. Its existing durable type now retains D["durable"]["version"]; Bus matchers and the Workflow publisher preserve that type at their existing call sites. These three source edits produced byte-identical compiled output relative to their intake. The Plan fixture uses the canonical AgentSelected version codec and retains the actual numeric value 1. Four affected Core test files passed **137 tests** (log SHA-256 `667d275220b058cc68818b303de2765bf341cdc8919c5aae0f87c3ea8b00cc2d`); the Workflow keeper then passed **2 tests** (log SHA-256 `a716f09076f9aa0669ea44344403b32e33323cb52429fd2d2d877b7a778f8dc8`). These contained keepers and compiler comparisons connect the later repairs to the selected full Core result and are not added to the total. The interrupted forced Core check has no completion credit; the subsequent forced owning check passed.

| Contract / gate                                    | Owning cwd and command                                                                      | Result | Complete log SHA-256                                               |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------ |
| Schema owning types and negative constructor input | `packages/schema`: `GOMAXPROCS=2 GOMEMLIMIT=3GiB ../../script/bun run typecheck`            | exit 0 | `ae47736bb2a9401aa9743893f2f64b9a605e65a99d78cd991a8021e0f7722d87` |
| Core owning types with a forced rebuild            | `packages/core`: `GOMAXPROCS=2 GOMEMLIMIT=3GiB ../../script/bun run typecheck --force`      | exit 0 | `4f03daae1998c85fd4db42affbe16e98fd60ee63c92e9cbd29349528febfe644` |
| Client formal generation                           | `packages/client`: `../../script/bun run generate`                                          | exit 0 | `669f6f21dd85b213958bef91fe6ac15f2851f309f5f3eda8197ee0a85a2643b8` |
| Client owning types                                | `packages/client`: `GOMAXPROCS=2 GOMEMLIMIT=3GiB ../../script/bun run typecheck`            | exit 0 | `ae47736bb2a9401aa9743893f2f64b9a605e65a99d78cd991a8021e0f7722d87` |
| Protocol owning types                              | `packages/protocol`: `../../script/bun run typecheck`                                       | exit 0 | `ae47736bb2a9401aa9743893f2f64b9a605e65a99d78cd991a8021e0f7722d87` |
| Protocol generated contract                        | `packages/protocol`: `../../script/bun run check:generated`                                 | exit 0 | `b53b62748400740d3735dd75b585c11f94a8abac8d26759cfec2b9e061bea038` |
| App E2E types                                      | `packages/app`: `../../script/bun run typecheck:e2e`                                        | exit 0 | `639662b16a8949b8806db38c87e0b25e79ca257224fe15c2194472352dc57577` |
| Root canonical lint and types                      | `repository root`: `GOMAXPROCS=2 GOMEMLIMIT=3GiB ./script/bun run check`                    | exit 0 | `164e01832f1ece15d31d6e60bcc1b75836f8eb4a55d1ab98be923f4395ff3dc7` |
| Incremental lint against origin/main               | `repository root`: `GOMAXPROCS=2 GOMEMLIMIT=3GiB ./script/bun run lint:changed origin/main` | exit 0 | `611bdedcca239ef172b69d4424e1f4dbc35454cca2aa64126c50b96c4ca9a014` |

Client generation changed the Effect API’s SessionLogItem owner reference; the other eleven generated files retained their bytes. Generated files were changed only through the formal generator. The Stage 4 Desktop package and screenshots above were built before these submission repairs; their installation result remains attached to the historical source freeze. The final submission has current-source package, browser, generation, lint and type receipts.
