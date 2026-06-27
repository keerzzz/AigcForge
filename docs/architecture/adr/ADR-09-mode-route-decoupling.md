# ADR-09: Mode Route Decoupling

## Context

The current desktop app has one implemented mode: CODING. CHAT, WORK, ASSISTANT, Mode Switcher, and Status Bar are planned surfaces only. The historical PRD (`docs/prd/desktop-mode-switcher-layout.md`) is reference material and explicitly states that the current codebase does not include multi-mode viewport implementation.

Session routes already encode server and Session identity:

```text
/server/:serverKey/session/:id
```

Adding mode into the URL before the planned mode surfaces exist would force routing, tab restoration, and Session placement semantics to carry an implementation detail that is not yet durable domain state.

## Decision

Do not encode mode in Session routes.

Keep the route shape as:

```text
/server/:serverKey/session/:id
```

The future Mode Switcher will own UI mode state separately from Session identity:

```text
currentMode
activeSessionId[mode]
```

CODING remains the only implemented mode. Planned mode pages may reference this ADR, but implementation work must keep them marked `PLANNED` until the corresponding viewport and state contract exist in code.

## Consequences

- Deep links continue to resolve a Session without needing mode migration.
- Tabs and `sessionPlacement` remain keyed by server and Session identity, not by planned UI mode.
- A future Mode Switcher must define persistence, reset behavior, and keep-alive policy before it becomes current architecture.
- If a future mode requires shareable URLs, it needs a new ADR because that would change routing, tab restoration, and backwards compatibility.
