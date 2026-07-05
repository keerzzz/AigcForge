# AigcForge Execution Protocol

> **Role**: Senior full-stack engineering
> **Scope**: Code style, branching, Effect coding, Schema, testing — applies repo-wide
> **Nature**: Entry point for code conventions. Package-level `AGENTS.md` files strengthen (never relax) these rules. Architecture lives in `ARCHITECTURE.md`; UI design in `DESIGN.md`.

## Branch And Commit

The default branch is `main`. Use `main` or `origin/main` for diffs.

Use a short branch name of at most three words, separated by hyphens. Do not use slashes or type prefixes such as `feat/` or `fix/`.

Examples: `session-recovery`, `fix-scroll-state`, `regenerate-sdk`.

Use conventional commit-style messages and PR titles: `type(scope): summary`.

Valid types are `feat`, `fix`, `docs`, `chore`, `refactor`, and `test`. Scopes are optional; use the affected package or area when helpful, e.g. `core`, `aigcfroge`, `tui`, `app`, `desktop`, `sdk`, or `plugin`.

Examples: `fix(tui): simplify thinking toggle styling`, `docs: update contributing guide`, `chore(sdk): regenerate types`.

To regenerate the JavaScript SDK, run `./packages/sdk/js/script/build.ts`.

## Style Guide

### General Principles

- Keep things in one function unless composable or reusable.
- Do not extract single-use helpers preemptively. Inline the logic at the call site unless the helper is reused, hides a genuinely complex boundary, or has a clear independent name that improves the caller.
- Use `try`/`catch` only at effectful boundaries (external API, file, network, subprocess, JSON parsing). Do not wrap synchronous control flow in `try`; at Effect boundaries prefer `Effect.try` or `Effect.catchTag`.
- Avoid `else` statements. Prefer early returns. `else` after a guard return is always wrong.
- Avoid the `any` type. Use `unknown` and narrow with type guards, or `Schema.Defect` at Effect defect boundaries.
- Use Bun APIs when possible, like `Bun.file()`. Prefer them in scripts and non-Effect entrypoints; Effect-scoped code uses `FileSystem` / `HttpClient` services instead of `node:fs` / `fetch`.
- Rely on type inference when possible; avoid explicit type annotations or interfaces unless necessary for exports or clarity.
- Prefer functional array methods (flatMap, filter, map) over for loops; use type guards on filter to maintain type inference downstream.

Reduce total variable count by inlining when a value is only used once.

```ts
// Good
const journal = await Bun.file(path.join(dir, "journal.json")).json()

// Bad
const journalPath = path.join(dir, "journal.json")
const journal = await Bun.file(journalPath).json()
```

### Destructuring

Avoid unnecessary destructuring. Use dot notation to preserve context.

```ts
// Good
obj.a
obj.b

// Bad
const { a, b } = obj
```

### Imports

- **Self-export is the global default.** A new module exposes a namespace via `export * as Foo from "./foo"` at the bottom of the file, and consumers import it by name: `import { Foo } from "@/foo/foo"`, then reference `Foo.Service`, `Foo.layer`. This is mandatory in `packages/aigcfroge` (see its `AGENTS.md`); prefer it everywhere.
- **Never `export namespace`.** It is non-standard ESM, breaks tree-shaking, and breaks the Node native TypeScript runner. Use the self-export pattern instead.
- **Never alias imports.** `import { foo as bar }` is forbidden. The only exception is resolving a genuine same-name collision (e.g. `Config` from `effect` vs `node:config`, `Tool` from `ai` vs the internal `Tool`), and the alias must be commented with the reason.
- **Never use star imports.** `import * as Foo from "..."` is forbidden. The only exception is `effect` submodule namespaces (`import * as Stream from "effect/Stream"`, `import * as … from "effect/unstable/…"`), which are an ecosystem idiom and do not conflict with the self-export pattern.
- **Barrel `index.ts` is package-autonomous.** The default is to avoid it; a single-namespace directory may use `export * as Foo from "."`. Whether multi-sibling barrels are allowed is decided by each package's `AGENTS.md` — `packages/aigcfroge` forbids them; `packages/llm` allows them for `schema/` and `route/`.
- Prefer dynamic imports for heavy modules that are only needed in selected code paths, especially in startup-sensitive entrypoints. Destructure dynamic import bindings near the top of the narrowest scope that needs them so they read like normal imports. Avoid inline chains such as `await import("./module").then((mod) => mod.value())` or `(await import("./module")).value()`. Keep branch-specific imports inside the branch that needs them to preserve lazy loading.

> **Tech-debt disclosure:** the existing tree carries ~249 legacy star imports and ~123 legacy alias imports accumulated before this rule was enforced. New code MUST follow this section; do not propagate the legacy style.

### Variables

Prefer `const` over `let`. Use ternaries or early returns instead of reassignment.

```ts
// Good
const foo = condition ? 1 : 2

// Bad
let foo
if (condition) foo = 1
else foo = 2
```

### Control Flow

Avoid `else` statements. Prefer early returns.

```ts
// Good
function foo() {
  if (condition) return 1
  return 2
}

// Bad
function foo() {
  if (condition) return 1
  else return 2
}
```

### Complex Logic

When a function has several validation branches or supporting details, make the main function read as the happy path and move supporting details into small helpers below it.

```ts
// Good
export function loadThing(input: unknown) {
  const config = requireConfig(input)
  const metadata = readMetadata(input)
  return createThing({ config, metadata })
}

function requireConfig(input: unknown) {
  ...
}
```

- Keep helpers close to the code they support, below the main export when that improves readability.
- Do not over-abstract simple expressions into many single-use helpers; extract only when it names a real concept like `requireConfig` or `readMetadata`.
- Do not return `Effect` from helpers unless they actually perform effectful work. Synchronous parsing, validation, and option building should stay synchronous.
- Prefer Effect schema helpers such as `Schema.decodeUnknownOption` over manual `JSON.parse` wrapped in `Effect.try` when parsing untrusted JSON. `Schema.UnknownFromJsonString` is the preferred variant when the input shape is known; `Schema.fromJsonString` is the LLM-layer variant.
- Add comments for non-obvious constraints and surprising behavior, not for obvious assignments or control flow.

### Schema Definitions (Drizzle)

Use snake_case for field names so column names don't need to be redefined as strings.

```ts
// Good
const table = sqliteTable("session", {
  id: text().primaryKey(),
  project_id: text().notNull(),
  created_at: integer().notNull(),
})

// Bad
const table = sqliteTable("session", {
  id: text("id").primaryKey(),
  projectID: text("project_id").notNull(),
  createdAt: integer("created_at").notNull(),
})
```

## Effect Coding

Enforced across all Effect-touching packages. Detail lives in `.aigcfroge/skills/effect/SKILL.md`; package-level `AGENTS.md` files add local strengthening.

- Compose with `Effect.gen(function* () {})`. Name traced effects with `Effect.fn("Domain.method")`; use `Effect.fnUntraced` for internal helpers.
- Prefer `Effect.void` over `Effect.succeed(undefined)`.
- Fail with `yield* new MyError(...)` (a `Schema.TaggedErrorClass`), not `Effect.fail(new MyError(...))`.
- Never `Effect.fork` or `forkDaemon`. Use `Effect.forkIn(scope)` for supervised fibers.
- Prefer Effect services over raw APIs: `HttpClient.HttpClient` over `fetch`, `FileSystem` over `node:fs`, `ChildProcess` over `node:child_process`, `Stream.Stream` over ad hoc async generators.
- Use `DateTime.nowAsDate` for current time inside `Effect.gen`.
- Use `Effect.cached` to deduplicate shared services.
- At native/external callback boundaries, bridge into Effect via `EffectBridge`.

## Schema

- Multi-field records: `Schema.Class<T>("Name")({...})`.
- Single branded values: `Schema.brand`.
- Errors: `Schema.TaggedErrorClass`. Use `Schema.Defect` instead of `unknown` for defect payloads.
- See `.aigcfroge/skills/database/SKILL.md` for schema, migration, and custom column-type conventions.

## Testing

- Avoid mocks as much as possible; you shouldn't be using `globalThis.*` at all unless it's the only option.
- Test actual implementation; do not duplicate logic into tests.
- Tests cannot run from repo root (guard: `do-not-run-tests-from-root`); run from package dirs like `packages/aigcfroge`. Per-package commands: `bun --cwd packages/<name> test --timeout 30000`.
- Use `testEffect(...)` from `test/lib/effect.ts` instead of hand-writing a runtime. Prefer `Layer.mock` over `Layer.succeed(Service, Service.of({...}))` full stubs.
- Never wait for concurrent fibers with `Effect.sleep(N)` or `setTimeout`. Use readiness signals: `pollWithTimeout`, `awaitWithTimeout`, `llm.wait(n)`, `SessionStatus.Service.get(sessionID)`, `BackgroundJob.wait({ id, timeout })`, Bus+Latch, or `Deferred.await(...).pipe(Effect.timeoutOrElse(...))`.
- The three test modes are `it.effect` (TestClock + TestConsole), `it.live` (real OS), `it.instance` (scoped tmpdir + instance). See `packages/aigcfroge/test/AGENTS.md` for fixtures and the full pattern.

## Type Checking

- Run `bun typecheck` (routes to `bun turbo typecheck`) from the repo root, or `bun --cwd packages/<name> typecheck` for a single package. Never invoke `tsc` directly.
- Every package's `typecheck` script uses `tsgo --noEmit` (the `@typescript/native-preview` binary). `app` and `desktop` use `tsgo -b` (project-references build) instead of `--noEmit`.
- `function`, `script`, `storybook`, and `web` have no `typecheck` script and are excluded from `bun turbo typecheck`.
- The `.husky/pre-push` hook runs `bun typecheck` before push; it is not a pre-commit hook.

## V2 Session Core

These are architectural invariants. The full subsystem picture lives in `ARCHITECTURE.md` §4.1; terminology and relationship invariants live in `CONTEXT.md`. Symbols span two packages — implementations live in `packages/core/src`, consumers in `packages/aigcfroge/src`.

- Keep durable prompt admission separate from model execution. `SessionV2.prompt(...)` admits one durable `session_input` row before scheduling advisory `SessionExecution.wake(sessionID)` unless `resume: false` requests admit-only behavior. The serialized runner promotes admitted inputs into visible user messages at safe boundaries.
- Reusing a Session ID adopts the existing Session. Reusing a prompt message ID reconciles an exact retry only when Session, prompt, and delivery mode match; conflicting reuse fails. Historical projected prompts lazily synthesize promoted inbox records during exact retry.
- Keep `SessionExecution` process-global and Session-ID based. Its local implementation owns the process-local Session coordinator and discovers placement through `SessionStore` plus `LocationServiceMap.get(session.location)` only when a drain starts; no layer should take a Session ID. V2 interruption targets the active process-local ownership chain for that Session; idle or missing interruption is a no-op.
- Keep `SessionRunner`, model resolution, tool registry, permissions, and filesystem Location-scoped. Omitted `Location.workspaceID` means implicit-local placement; explicit workspace identity remains reserved for future placement semantics.
- Preserve one explicit `llm.stream(request)` call per provider turn and reload projected history before durable continuation. Do not bridge through legacy `SessionPrompt.loop(...)` or delegate orchestration to an in-memory tool loop.
- Keep local Session drains process-local until clustering is implemented. `SessionRunCoordinator` joins explicit same-Session resumes, coalesces prompt wakeups, and allows different Sessions to run concurrently. Advisory wakes drain eligible durable inbox rows only; post-crash continuation recovery requires a separate explicit design before it may retry provider work. A drain has no durable identity or transcript boundary.
- Keep delivery vocabulary explicit. Prompts steer by default and promote at the next safe provider-turn boundary while the current drain requires continuation. An explicit `queue` input remains pending until the Session would otherwise become idle; promote one queued input at that boundary, then reevaluate continuation before promoting another. Promoting any new user input resets the selected agent's provider-turn allowance; a batch of steers resets it once.
- Keep EventV2 replay owner claims separate from clustered Session execution ownership.
- Keep the System Context algebra, registry, and built-ins in `packages/core/src/system-context`; keep Context Source producers with their observed domains, and keep Session History selection plus Context Epoch persistence Session-owned.
