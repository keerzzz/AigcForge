# GitHub integration

The legacy composite action is retired, and its implementation and dedicated release package have been removed. Its GitHub App authentication path used an unpublished token-exchange service, and its legacy CLI command is absent from V2.

The current source-based review entrypoint is [review.yml](../.github/workflows/review.yml). It invokes [the V2 CLI](../packages/cli/src/index.ts) with `run --standalone` and a configured generic provider. The workflow uses the repository’s existing Secrets and owner/member authorization.

Desktop release automation remains in [publish.yml](../.github/workflows/publish.yml), targeting [keerzzz/AigcForge](https://github.com/keerzzz/AigcForge).
