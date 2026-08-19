# ADR-11: Product Mode State and Session Classification

> Status: Accepted for implementation; entry-navigation behavior amended by ADR-12
> Date: 2026-07-12
> Extends: [ADR-09 Mode Route Decoupling](ADR-09-mode-route-decoupling.md)
> Amended by: [ADR-12 Product Mode Entry Routing](ADR-12-product-mode-entry-routing.md)
> Amended/superseded by implementation gate: [ADR-17 Custom Mode Composition Platform](ADR-17-custom-mode-composition-platform.md) defines the five-value design contract (`chat | coding | work | assistant | custom`) and capable-client negotiation. Until M0 Phase B lands, this ADR's four-value contract remains active and authoritative in production runtime.

## Context

The App now exposes Chat, Coding, Work, and Assistant selectors, but Product Mode exists only as persisted UI state. Sessions, the HTTP API, the SDK, and synchronization caches do not carry that classification.

An earlier implementation used `activeSessionId[mode]` to resume or create a Session whenever a Home mode card was clicked. This couples a module selector to Session lifecycle and creates a second source of truth for work identity. ADR-12 later reintroduces navigation only for module entry routes (`/mode/:mode`), not for recent-session restoration or Draft creation.

The repository also has an unrelated Agent field named `mode` with values `primary`, `subagent`, and `all`. That field describes execution role and cannot represent Product Mode.

## Decision

### 1. Product Mode is a separate domain

Define a canonical Product Mode with exactly four values:

```text
chat | coding | work | assistant
```

Product Mode must not reuse or derive from Agent execution mode or Assistant Message mode.

### 2. Mode switching does not mutate work

ADR-12 permits Home cards and the global icon rail to navigate to `/mode/:mode`. Mode entry remains free of Session-lifecycle side effects.

It does not:

- create a Draft or Session;
- select a Tab;
- mutate the current Draft or Session;
- change the selected Agent.

Session routes remain unchanged and do not encode Product Mode, preserving ADR-09.

### 3. Session classification is durable and immutable

Every Session has one required Product Mode.

- A root Session receives the Mode frozen on its Draft.
- A child Session inherits its parent Mode.
- A fork inherits its source Session Mode.
- Existing rows and legacy encoded events decode as Coding.
- A created Session is not reclassified by later UI Mode changes.

An explicit reclassification use case, if needed, requires a separate command and ADR because it affects trees, caches, search, notifications, and audit history.

### 4. Projects and Workspaces are shared

Product Mode partitions Sessions, not Projects or Workspaces. Project navigation remains stable across Mode switches; Session descendants, search results, load-more state, and unread summaries are mode-aware.

### 5. Remove the recent-session second source of truth

Remove `activeSessionId[mode]` and its App/submit write paths. Session identity remains owned by routes, tabs, and Session placement. Product Mode owns filtering only.

### 6. Compatibility defaults to Coding

The database column is additive and non-null with a Coding default. Public create input keeps Mode optional for older clients, while Session responses always expose a Mode. Historical event schemas use a decoding default so replay remains valid.

## Consequences

### Positive

- Mode entry is predictable and never creates or restores work implicitly.
- Session lists can be filtered consistently across Home, Sidebar, API, and SDK.
- Product Mode and Agent permission semantics cannot accidentally contaminate each other.
- Deep links, tabs, and Session placement remain backward compatible.
- Removing `activeSessionId` eliminates a stale, client-only identity map.

### Trade-offs

- Global Mode entry intentionally leaves the current work route; Tabs and persisted composer state remain available for return.
- Mode-aware loading needs cache keys and retention per `(directory, mode)` while preserving one Session entity set.
- Historical Sessions are classified as Coding even if users previously treated them conceptually as another module.
- Dedicated Chat, Work, and Assistant runtime behavior remains separate from the completed switching/classification framework.

### Technical Debt Rejected

- Inferring Product Mode from Agent or Message fields.
- Filtering only in Home while Sidebar/API remain unscoped.
- Reading `currentMode` at first submit instead of freezing Draft Mode.
- Replacing a directory Session store with one mode-filtered response.
- Encoding Mode in URLs to simplify restoration.

## Implementation Reference

See [`docs/plan/mode-module-switching-completion.md`](../../plan/mode-module-switching-completion.md).

## Amendment by ADR-17 (Accepted for M0/M1 implementation; runtime not yet landed)

With ADR-17 accepted for M0/M1 implementation by user-authorized AI-agent delegation:

1. **Domain Expansion**: `ProductMode` expands from four values to five: `chat | coding | work | assistant | custom`.
2. **Compatibility & Non-Fallback**: Historical rows and omitted create inputs continue decoding as `coding`. However, `custom` mode is never defaulted or fallen back to `coding`. Old clients that do not support `custom` receive a typed unsupported error.
3. **Root Orchestration**: A `custom` root Session is durably bound to `meta`, with exactly one user Agent as an authorized delegation target frozen in the immutable `session_composition_snapshot`.
4. **Active Baseline**: Until M0 Phase B lands, the 4-value contract in §Decision 1 remains the authoritative production standard.
