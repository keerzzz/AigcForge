# Upstream

- Source: https://github.com/dmmulroy/anti-slop, `skills/install-anti-slop/assets/anti-slop`
- Commit: `c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b` (skill folder tree `89044d21c75a367eac1ddbaf208e650b1a7d5820`)
- Installed with the `install-anti-slop` skill's `scripts/install.mjs`.

## Installed paths

- `script/oxlint/anti-slop/index.ts`: generic rules, registered as the `anti-slop` plugin.
- `script/oxlint/anti-slop/effect/index.ts`: Effect rules, registered as the `anti-slop-effect` plugin.
- `script/oxlint/anti-slop/vendor/eslint-stylistic/`: vendored padding-line logic with its own `LICENSE` and `UPSTREAM.md`.

## Deviations

- Lives under `script/oxlint/` rather than `tools/oxlint/`, next to the repository's other lint tooling in `script/`.
- `.oxlintrc.json` enables the rules only for the GUI packages: `app`, `desktop`, `gui-extensions`, `ui` and `session-ui`. The Effect rules skip `ui`, which has no direct `effect` dependency.
- The rules run at `warn`, not `error`, while existing findings are fixed package by package.

## Main integration policy (2026-11-18)

- The default main policy gates its six existing incrementally gated lint rules only on added lines across JavaScript and TypeScript; it also checks added Markdown commands. Renames retain their actual added-line diff.
- GUI anti-slop diagnostics remain warnings and are inventoried independently. They are not promoted to a whole-file error by `script/lint-changed.ts`. SDK import and reflection restrictions remain errors.
- The previous 685-diagnostic inventory is bound to 1,164 GUI files against upstream `4617210822bdbb31e5749751afbfb4584ccedac8`; it is not the diagnostic count for the current main comparison (2,188 selected GUI files before executing lint).
- Main type-aware rules and the current V2 SDK/AST contracts are retained together. A green inventory or a warning does not prove a product behavior; owning tests and type checks grant their respective evidence.
