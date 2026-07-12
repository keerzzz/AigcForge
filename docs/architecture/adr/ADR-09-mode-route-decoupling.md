# ADR-09: Mode Route Decoupling

> Status: Accepted
> Extended by: [ADR-11 Product Mode State and Session Classification](ADR-11-product-mode-session-classification.md)
> Amended by: [ADR-12 Product Mode Entry Routing](ADR-12-product-mode-entry-routing.md)

## Context

At the time of this decision, the desktop app had one implemented mode: CODING. CHAT, WORK, ASSISTANT, Mode Switcher, and Status Bar were planned surfaces only. The historical PRD (`docs/prd/desktop-mode-switcher-layout.md`) remains reference material.

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

The Mode Switcher owns UI mode state separately from Session identity:

```text
currentMode
Session.mode (durable classification, not route identity)
```

At decision time, CODING was the only implemented Mode. ADR-11 now defines the shared Session-classification contract. ADR-12 adds `/mode/:mode` module entry routes while preserving this ADR's core rule that Session and Draft routes do not encode Product Mode.

## Consequences

- Deep links continue to resolve a Session without needing mode migration.
- Tabs and `sessionPlacement` remain keyed by server and Session identity, not by planned UI mode.
- Product Mode persistence and Session classification are defined by ADR-11.
- Shareable module-entry URLs are defined by ADR-12 and intentionally remain separate from work-item URLs.
