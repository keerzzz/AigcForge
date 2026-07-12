# ADR-12: Product Mode Entry Routing and Shared Module Workspace

> Status: Accepted for implementation
> Date: 2026-07-12
> Amends: [ADR-11 Product Mode State and Session Classification](ADR-11-product-mode-session-classification.md)
> Preserves: [ADR-09 Mode Route Decoupling](ADR-09-mode-route-decoupling.md)

## Context

ADR-11 originally defined Product Mode selection as a side-effect-free local filter that never navigates. That model separates Session classification correctly, but it does not provide first-class module destinations for Home cards, the global icon rail, browser history, refresh, or deep links.

Chat, Coding, Work, and Assistant need stable entry destinations while continuing to share Project, Workspace, Session, synchronization, and layout infrastructure. Copying Coding into four route components would create parallel state owners and guarantee drift in loading, empty, error, notification, accessibility, and responsive behavior.

Session routes already have canonical identity and must remain independent from Product Mode.

## Decision

### 1. Add one parameterized Product Mode entry route

```text
/mode/:mode
```

The route parameter must decode as `chat | coding | work | assistant`. Invalid values do not enter the module workspace and use the App's ordinary not-found/fallback behavior.

The four concrete destinations are therefore shareable without four copied route implementations:

```text
/mode/chat
/mode/coding
/mode/work
/mode/assistant
```

### 2. Home cards and the global icon rail are navigation controls

Both surfaces reuse one Mode definition registry and one `modeHref(mode)` helper. Selecting a Mode navigates to its module entry route.

Mode entry navigation must not:

- restore a recent Session;
- create a Draft or Session;
- select a Session Tab;
- mutate Session classification;
- change the selected Agent.

Creating or opening work remains an explicit action inside the module workspace.

### 3. Use one shared ModeRoute and ModeWorkspace

`ModeRoute` owns route decoding and activates the selected Mode. It renders one shared `ModeWorkspace` composition containing reusable Project/Workspace navigation, Mode-scoped Session lists/search/load state, and shared empty/loading/error surfaces.

Mode-specific behavior enters through a typed registry/slot boundary. Coding adapts its existing capabilities into the same boundary; Chat, Work, and Assistant start with the shared Session architecture and replace only their owned content slots as dedicated capabilities arrive.

No Mode may copy the shared workspace implementation into a sibling page.

### 4. Preserve canonical work-item routes

Product Mode is not added to Session or Draft URLs:

```text
/new-session?draftId=...
/server/:serverKey/session/:id
```

- On a Module route, effective Mode comes from the validated route parameter.
- On a Draft route, effective Mode comes from `DraftTab.mode`.
- On a Session route, effective Mode comes from durable `Session.mode`.
- On Home, persisted last Mode is a presentation default only.

The route/work item is authoritative; persisted `currentMode` follows it in one direction and must not redirect it back.

### 5. Keep Product Mode out of Session identity

ADR-09 remains valid. The following route is forbidden:

```text
/mode/:mode/server/:serverKey/session/:id
```

It would duplicate durable `Session.mode`, permit contradictory URLs, and complicate tabs, placement, sharing, and backward compatibility.

## Consequences

### Positive

- Every Product Mode has a refreshable, shareable, browser-history-aware entry point.
- Home cards and the global icon rail have one consistent navigation contract.
- Session and Draft identity remain canonical and backward compatible.
- One shared workspace prevents four implementations from drifting.
- Dedicated Mode capabilities can evolve through typed slots without changing routing.

### Trade-offs

- Selecting a global Mode intentionally leaves the currently rendered Session/Draft route, though its Tab and persisted composer state remain available for return.
- Mode activation now has two representations: the authoritative current route/work item and persisted last Mode. Synchronization must be one-way from authority to persistence to avoid loops.
- Module-route loading and invalid-param behavior require new route and E2E coverage.

### Technical Debt Rejected

- Four copied Mode route components.
- A dynamic route that accepts arbitrary strings without Product Mode decoding.
- Restoring `activeSessionId` to make module entry select recent work.
- Prefixing Session/Draft routes with Product Mode.
- Letting `currentMode` effects navigate implicitly in both directions.

## Implementation Reference

See [`docs/plan/mode-module-switching-completion.md`](../../plan/mode-module-switching-completion.md).
