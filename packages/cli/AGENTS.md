# CLI and TUI development guide

- Use `@omnixa/client` and the location-scoped data in `packages/tui/src/context/data.tsx` instead of adding dependencies on legacy sync state.
- Preserve established TUI behavior unless the task intentionally changes it.
