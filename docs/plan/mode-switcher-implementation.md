# Global Mode Switcher + Secondary Sidebar Implementation Plan

> 状态：SUPERSEDED
> 取代方案：[`mode-module-switching-completion.md`](mode-module-switching-completion.md)
> 说明：布局与组件历史仍可参考；`activeSessionId`、点击 Mode 自动恢复最近 Session、自动创建 Draft 的设计已由 ADR-11/ADR-12 废止。当前实现见 [`mode-module-switching-completion.md`](mode-module-switching-completion.md)：模式切换导航到 `/mode/:mode`，Mode Route 校验参数并同步 `currentMode`；首页按 Mode 发起服务端过滤查询，且不创建/恢复 Session。

> Historical status: READY — approved 2026-06-27
> Branch: brand-migration-v001
> Target: v0.0.1
> Last updated: 2026-06-28 — supplemented with full code dependency analysis

---

## 0. Code Dependency Map (must understand before writing a single line)

### 0.1 Navigation & Routing

```
Routes (app.tsx:522-529):
  /                            → Home()
  /new-session                 → DraftRoute()
  /server/:serverKey/session/:id → TargetSessionRoute()
  /:dir/session/:id?           → LegacySessionRedirect() — V1 sidebar legacy, DO NOT USE

TargetSessionRoute auto-handles tab management:
  createEffect → tabs.addSessionTab({ server, sessionId })

sessionHref(server, sessionID) → /server/${base64Encode(server)}/session/${sessionID}
                                 ↑ DIRECT new-route navigation — use this everywhere

Navigation rules for SecondarySidebar:
  New session:  tabs.newDraft() → auto-navigates to /new-session?draftId=...
  Open session: navigate(sessionHref(ServerConnection.key(conn), sessionId))
                → TargetSessionRoute → auto-adds tab → DONE, no redirect

SessionItem compatibility:
  SessionItem internally uses <A href="/${slug}/session/${id}"> (legacy format).
  This is locked because SessionItem is shared with V1 sidebar.
  SecondarySidebar MUST NOT rely on SessionItem's internal <A> for navigation.
  Instead: wrap each session row in a click handler that calls
  navigate(sessionHref(serverKey, sessionId)) directly.
```

### 0.2 Component Coupling Analysis

```
SortableWorkspace (sidebar-workspace.tsx:293):
  ├── createSortable() → REQUIRES DragDropProvider + SortableProvider ancestors
  ├── WorkspaceSidebarContext (15 methods)
  ├── Collapsible, DropdownMenu, V1 CSS classes, V1 icons
  └── DO NOT IMPORT INTO SecondarySidebar

LocalWorkspace (sidebar-workspace.tsx:443):
  ├── WorkspaceSidebarContext (same 15 methods)
  ├── WorkspaceSessionList (depends on ctx for SessionItem props)
  └── DO NOT IMPORT INTO SecondarySidebar

SessionItem (sidebar-items.tsx:143) — STANDALONE, CAN BE IMPORTED:
  ├── Internal hooks: useParams, useLayout, useNotification, usePermission, useServerSync
  ├── Required props: session, list, slug, sidebarExpanded, clearHoverProjectSoon,
  │   prefetchSession, archiveSession
  ├── slug = base64Encode(session.directory) — uses legacy route, gets auto-redirected
  └── ✅ REUSABLE — import and provide required props (some as no-ops)

SessionSkeleton (sidebar-items.tsx:316):
  └── ✅ REUSABLE — pure presentational, no context needed

sortedRootSessions (helpers.ts:31):
  └── ✅ REUSABLE — pure function, filters + sorts sessions

displayName (helpers.ts:56):
  └── ✅ REUSABLE — pure function

homeProjectDirectories (helpers.ts:86):
  └── ✅ REUSABLE — converts pick result to directory array

WorkspaceSidebarContext (sidebar-workspace.tsx:35-56):
  └── DO NOT REUSE — 15-method interface, V1 sidebar specific
  └── SecondarySidebar must implement workspace display WITHOUT this context
```

### 0.3 Server/Project/Session Data Flow

```
useServer() → server.current (ServerConnection.Any)
useGlobal() → global.ensureServerCtx(conn)
            → ctx.projects.list() → LocalProject[]
            → ctx.projects.open(directory)
            → ctx.projects.touch(directory)
            → ctx.projects.close(directory)
useServerSync() → serverSync() (Accessor → ServerSync)
               → sync().child(directory, { bootstrap: false })[0] → SessionStore
               → sync().project.loadSessions(directory) → Promise<void>
useTabs() → tabs.newDraft({ server: key, directory }) → creates draft tab, navigates
useDirectoryPicker() → pickDirectory({ server, title, multiple, onSelect })
useNotification() → notification.project.unseenCount(dir)
                 → notification.project.markViewed(dir)
useDialog() → dialog.show(() => <Component />) — for edit project dialog
```

### 0.4 Project Structure (Existing V1 Sidebar Hierarchy)

```
Project
├── worktree (main directory, always present)
│   ├── Session 1
│   ├── Session 2
│   └── Load more...
└── sandbox-1 (optional)
│   ├── Session A
│   └── Load more...
└── sandbox-2 (optional)
    └── ...
```

Each workspace (worktree or sandbox) has its own independent session list.
sessions are NOT flat under the project — they belong to specific directories.

---

## 1. Overview

Add a global left-side mode switcher rail (4 modes) and a secondary sidebar
(project tree, search, new session) to the AigcForge desktop app.

### Layout Target

```
+------------------+----------------------+---------------------------+
| ModeSwitcher     | SecondarySidebar     | Main Content              |
| 64px rail        | w-64 (256px)         | flex-1                    |
| Always visible   | Hidden: /, /new-sess | Home / Session / NewSess  |
+------------------+----------------------+---------------------------+
```

### Mode Definition

| Order | Mode      | Key        | Icon           | Status   |
|-------|-----------|------------|----------------|----------|
| 1      | Chat      | chat       | mode-chat      | PLANNED  |
| 2      | Coding    | coding     | mode-coding    | ACTIVE   |
| 3      | Work      | work       | mode-work      | PLANNED  |
| 4      | Assistant | assistant  | mode-assistant | PLANNED  |

---

## 2. Design Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Mode not in URL | ADR-09, mode is app state only |
| 2 | Persistence key: mode-view (Persist.global) | stores currentMode + activeSessionId map |
| 3 | No secondary sidebar on / and /new-session | Home/draft are independent dashboards |
| 4 | Reuse SessionItem, SessionSkeleton, sortedRootSessions, displayName | existing standalone components/functions |
| 5 | Default mode: coding | current project functionality lives here |
| 6 | Other modes show empty state | Chat/Work/Assistant await meta-agent engine |
| 7 | base64Encode from @aigcfroge/core/util/encode | no hand-written btoa |
| 8 | activeSessionId stores {server, sessionId} | needed for full navigation target |
| 9 | Do NOT import SortableWorkspace/LocalWorkspace | they need WorkspaceSidebarContext + DragDropProvider |
| 10 | Build workspace rendering inline | follow LocalWorkspace pattern but self-contained |
| 11 | Session navigation via SessionItem's legacy route | LegacySessionRedirect auto-redirects to new route |
| 12 | New session: use tabs.newDraft() | starts a draft tab, navigates to /new-session |

---

## 3. Phase 0: Foundation (icons + i18n)

### 0.1 — Add 4 mode icons to packages/ui/src/v2/components/icon.tsx

Add to the `icons` record (line 68, after "outline-dots"):

```ts
"mode-chat": {
  viewBox: "0 0 16 16",
  body: `<path d="M1.5 14.5L3 11.5C1.917 10.167 1.5 8.833 1.5 7.5C1.5 4.167 4.5 1.5 8 1.5C11.5 1.5 14.5 4.167 14.5 7.5C14.5 10.833 11.5 13.5 8 13.5L1.5 14.5Z" stroke="currentColor"/>`,
},
"mode-coding": {
  viewBox: "0 0 16 16",
  body: `<path d="M10 4L14 8L10 12M6 12L2 8L6 4" stroke="currentColor" stroke-linejoin="round"/>`,
},
"mode-work": {
  viewBox: "0 0 16 16",
  body: `<path d="M2.5 3.5H13.5V13.5H2.5V3.5Z" stroke="currentColor"/><path d="M5.5 1.5V4.5M10.5 1.5V4.5" stroke="currentColor"/><path d="M5.5 7.5L7.5 9.5L10.5 6.5" stroke="currentColor" stroke-linejoin="round"/>`,
},
"mode-assistant": {
  viewBox: "0 0 16 16",
  body: `<path d="M8 1.5V3.5M14.5 8H12.5M3.5 8H1.5M12 4L10.5 5.5M4 12L5.5 10.5M12 12L10.5 10.5M4 4L5.5 5.5M8 12.5V14.5" stroke="currentColor" stroke-linejoin="round"/><circle cx="8" cy="8" r="2.5" stroke="currentColor"/>`,
},
```

DO NOT add: search, new-session icons — `magnifying-glass`, `edit`, `folder-add-left` already exist.

### 0.2 — Add i18n keys to packages/app/src/i18n/en.ts

After `"home.sessions.group.older": "Older",` (line ~601):

```ts
"mode.chat": "Chat",
"mode.chat.description": "General conversation and Q&A",
"mode.coding": "Coding",
"mode.coding.description": "Build and edit code projects",
"mode.work": "Work",
"mode.work.description": "Task management and planning",
"mode.assistant": "Assistant",
"mode.assistant.description": "Personal AI assistant",
"mode.switcher": "Mode switcher",
"home.modes.title": "Get started",
"sidebar.secondary.newSession": "New session",
"sidebar.secondary.search": "Search projects",
"sidebar.secondary.projectList": "Project list",
"sidebar.secondary.addProject": "Add project",
"sidebar.secondary.noResults": "No results found",
```

### 0.3 — Mirror to packages/app/src/i18n/zh.ts

Same keys with Chinese translations (same location after "更早").

---

## 4. Phase 1: Mode Context + ModeSwitcher

### 1.1 — Create packages/app/src/context/mode.tsx

Pattern: follow existing `createSimpleContext` from tabs.tsx, global.tsx, etc.

```ts
import { createSimpleContext } from "@aigcfroge/ui/context"
import { createStore } from "solid-js/store"
import { createMemo } from "solid-js"
import { Persist, persisted } from "@/utils/persist"
import type { ServerConnection } from "@/context/server"

export const MODES = ["chat", "coding", "work", "assistant"] as const
export type Mode = (typeof MODES)[number]

type ModePlacement = { server: ServerConnection.Key; sessionId: string }
type ActiveSessionMap = Partial<Record<Mode, ModePlacement>>

export const { use: useMode, provider: ModeProvider } = createSimpleContext({
  name: "Mode",
  init() {
    const [state, setState] = persisted(
      Persist.global("mode-view"),
      createStore({ currentMode: "coding" as Mode, activeSessionId: {} as ActiveSessionMap }),
    )
    return {
      get currentMode() { return state.currentMode },
      setCurrentMode(m: Mode) { setState("currentMode", m) },
      activeSessionId(m: Mode) { return createMemo(() => state.activeSessionId[m]) },
      setActiveSessionId(m: Mode, p: ModePlacement) { setState("activeSessionId", m, p) },
    }
  },
})
```

Protocols:
- No import aliases ✅
- No star imports ✅
- const > let ✅
- No any (use typed createStore) ✅
- Persist.global follows tabs.tsx pattern ✅

### 1.2 — Create packages/app/src/components/mode-switcher.tsx

Uses: IconButtonV2 from @aigcfroge/ui/v2/icon-button-v2, TooltipV2 from @aigcfroge/ui/v2/tooltip-v2, Icon from @aigcfroge/ui/v2/icon.

Props: 64px rail, 4 icon buttons, tooltips, active state.

All CSS: `--v2-*` variables (border, background, icon colors).

ARIA: nav aria-label (i18n), aria-pressed, aria-label per button.

---

## 5. Phase 2: Secondary Sidebar Component

### 5.1 — Create packages/app/src/components/secondary-sidebar.tsx

**IMPORTS — verified exact paths**:
```ts
import { Show, createMemo, For, type Accessor } from "solid-js"
import { createStore, type SetStoreFunction } from "solid-js/store"
import { useParams } from "@solidjs/router"
import type { Session } from "@aigcfroge/sdk/v2/client"
import { getFilename } from "@aigcfroge/core/util/path"
import { base64Encode } from "@aigcfroge/core/util/encode"
import { Icon } from "@aigcfroge/ui/v2/icon"                    // v2 Icon
import { IconButtonV2 } from "@aigcfroge/ui/v2/icon-button-v2"  // v2 IconButton
import { ButtonV2 } from "@aigcfroge/ui/v2/button-v2"           // v2 Button
import { MenuV2 } from "@aigcfroge/ui/v2/menu-v2"               // v2 Menu
import { Collapsible } from "@aigcfroge/ui/collapsible"          // v1 Collapsible (layout-only, no CSS issues)
import { useLanguage } from "@/context/language"
import { useGlobal } from "@/context/global"
import { useTabs } from "@/context/tabs"
import { ServerConnection, useServer } from "@/context/server"
import { useServerSync } from "@/context/server-sync"
import { useDirectoryPicker } from "@/components/directory-picker" // returns useDirectoryPicker()
import { useNotification } from "@/context/notification"
import { useDialog } from "@aigcfroge/ui/context/dialog"         // for dialog.show()
import { displayName, homeProjectDirectories, sortedRootSessions } from "@/pages/layout/helpers"
import { SessionItem, SessionSkeleton } from "@/pages/layout/sidebar-items"
import type { LocalProject } from "@/context/layout"
```

DO NOT import: SortableWorkspace, LocalWorkspace, WorkspaceSidebarContext, DragDropProvider, SortableProvider.

**COMPONENT STRUCTURE**:

```
<aside role="complementary" aria-label=... class="w-64 border-r ...">
  ├── Header: ButtonV2 "New session" + IconButtonV2 search toggle
  ├── Search panel (Show when searchOpen):
  │   ├── Input with magnifying-glass prefix icon
  │   ├── Clear button (xmark-small)
  │   └── Results list (filtered projects by displayName)
  │       ├── Each result: click → navigateToSession(worktree)
  │       └── Empty: "No results found" from i18n
  ├── Section title: "Project list" + IconButtonV2 "Add project" (folder-add-left)
  └── Project list (scrollable, flex-1):
      └── For each project:
          ├── ProjectHeader row:
          │   ├── Name + unseen dot
          │   ├── Hover reveal: IconButtonV2 "New session" (edit icon)
          │   └── Hover reveal: MenuV2 → New session / Edit / Clear / Close
          └── Per-directory workspace collapsible:
              ├── Collapsible.Trigger: chevron + type label + name
              └── Collapsible.Content: WorkspaceSessionList
                  ├── SessionItem for each session (from sortedRootSessions)
                  └── Load more button (when hasMore)
```

**SEARCH PANEL IMPLEMENTATION**:

Follow the home.tsx `HomeSessionSearch` pattern (lines 844-1048):
- Search input with magnifying-glass prefix
- Filter: `displayName(p).toLowerCase().includes(query)`
- Results: role="option" buttons with focus/hover styles
- Keyboard: Escape to close
- Empty state: i18n text

**WORKSPACE RENDERING IMPLEMENTATION**:

Follow the `LocalWorkspace` pattern from sidebar-workspace.tsx:443-485, but:
1. Use v2 Collapsible for expand/collapse
2. Use v2 CSS variables for all styles
3. Each workspace (directory) gets its own independent session list
4. Session list uses `sortedRootSessions(store, sortNow())` to sort
5. Session rendering uses `SessionItem` component (imported from sidebar-items)
6. `loadMore` per workspace (increment limit + call serverSync().project.loadSessions)

**SessionItem PROPS REQUIRED** (from SessionItemProps, sidebar-items.tsx:73-87):
```
session: Session          — required, from sortedRootSessions
list: Session[]           — required, full session list for this workspace
slug: string              — base64Encode(directory) — SessionItem builds <A> href from this
showTooltip: true         — shows tooltip with session title
dense: true               — compact display
sidebarExpanded: () => true              — no sidebar collapse in secondary sidebar
clearHoverProjectSoon: () => {}          — no-op
prefetchSession: () => {}               — no-op (no hover-to-prefetch in secondary sidebar)
archiveSession: async () => {}           — no-op (archive disabled in secondary sidebar)
```

**SESSION NAVIGATION — DIRECT, NO REDIRECT**:

SessionItem renders an `<A href="/${slug}/session/${id}">` internally, which hits
the legacy redirect route. For SecondarySidebar, we override this by wrapping each
SessionItem in a clickable div that calls `navigate(sessionHref(...))` directly:

```tsx
<div
  onClick={(e) => {
    e.preventDefault()
    const conn = server.current
    if (!conn) return
    navigate(sessionHref(ServerConnection.key(conn), session.id))
  }}
>
  <SessionItem
    session={session}
    list={sessions()}
    slug={slug()}
    ...
  />
</div>
```

This intercepts the click, prevents SessionItem's internal `<A>` navigation, and
routes directly to `/server/:key/session/:id` — zero redirect hops.

**NAVIGATION FLOW**:

New session: `tabs.newDraft({ server: ServerConnection.key(conn), directory: worktree })`
  → creates draft tab → auto-navigates to /new-session?draftId=...

Session click: `navigate(sessionHref(ServerConnection.key(conn), session.id))`
  → TargetSessionRoute → auto-adds tab → DONE

**PROJECT HEADER IMPLEMENTATION**:

Follow home.tsx `HomeProjectRow` pattern (lines 759-804):
- Hover-reveal action buttons (opacity-0 → group-hover:opacity-100)
- MenuV2 with items: New session, Edit, Clear notifications, Close
- Active state: highlight when current route has a session in this project

**CSS**: All visual values via v2 CSS variables:
- bg-v2-background-bg-base, border-v2-border-border-base
- text-v2-text-text-base, text-v2-text-text-muted
- bg-v2-overlay-simple-overlay-hover for hover/focus
- bg-v2-background-bg-layer-03 for search input
- [font-weight:NNN] for text weights
- rounded-[6px] / rounded-[8px] for consistent corners

**ACCESSIBILITY**:
- Search button: aria-label, aria-expanded
- Search input: aria-label, role=searchbox
- Results: role=listbox, each result role=option
- Add project: aria-label
- All interactive: keyboard reachable, visible focus ring
- Right rail: role=complementary

**STATES to cover**:
- Default: header + project list with workspaces
- Search open: input + results/empty
- Loading: SessionSkeleton when sessions loading
- Empty projects: "Add project" prompt
- No sessions in workspace: empty workspace (still shows header)

---

## 6. Phase 3: Layout Integration

### 6.1 — Modify packages/app/src/pages/layout.tsx

**Current structure**:
```tsx
import { createEffect, Suspense, type ParentProps } from "solid-js"
import { useNavigate, useParams } from "@solidjs/router"
// ... Titlebar, DebugBar, HelpButton, ToastRegion

export default function Layout(props: ParentProps) {
  // ... effects
  return (
    <div class="relative bg-v2-background-bg-deep flex-1 min-h-0 min-w-0 flex flex-col select-none ...">
      <Titlebar update={update} />
      <main class="flex-1 min-h-0 min-w-0 overflow-x-hidden flex flex-col items-start contain-strict">
        <Suspense>{props.children}</Suspense>
      </main>
      {import.meta.env.DEV && <DebugBar />}
      <HelpButton />
      <ToastRegion v2 />
    </div>
  )
}
```

**New structure**:
```tsx
import { createEffect, Suspense, type ParentProps, Show } from "solid-js"
import { useLocation, useNavigate, useParams } from "@solidjs/router"
// ... existing imports
import { ModeProvider } from "@/context/mode"
import { ModeSwitcher } from "@/components/mode-switcher"
import { SecondarySidebar } from "@/components/secondary-sidebar"

export default function Layout(props: ParentProps) {
  const location = useLocation()
  // ... existing code
  const isHome = () => location.pathname === "/"
  const isNewSession = () => location.pathname === "/new-session"
  const showSecondarySidebar = () => !isHome() && !isNewSession()

  return (
    <ModeProvider>
      <div class="relative ... existing outer classes ...">
        <Titlebar update={update} />
        <div class="flex-1 min-h-0 min-w-0 flex">       {/* ← new horizontal flex */}
          <ModeSwitcher />                                {/* ← always 64px */}
          <Show when={showSecondarySidebar()}>            {/* ← hidden on / and /new-session */}
            <SecondarySidebar />
          </Show>
          <main class="flex-1 min-h-0 min-w-0 overflow-x-hidden flex flex-col items-start contain-strict">
            <Suspense>{props.children}</Suspense>
          </main>
        </div>
        {import.meta.env.DEV && <DebugBar />}
        <HelpButton />
        <ToastRegion v2 />
      </div>
    </ModeProvider>
  )
}
```

**IMPORTANT**: ModeProvider wraps everything. ModeSwitcher is inside its own `<nav>` (already in the component). SecondarySidebar has role=complementary.

---

## 7. Phase 4: Home Page Mode Cards

### 7.1 — Modify packages/app/src/pages/home.tsx

**IMPORTS ADD** (at top of file, with other imports):
```ts
import { useMode, MODES, type Mode } from "@/context/mode"
import { sessionHref } from "@/utils/session-route"
```

**ADD to Home() component** (after `const mode = useMode()`):
```ts
const mode = useMode()

function enterMode(m: Mode) {
  mode.setCurrentMode(m)
  const placement = mode.activeSessionId(m)()
  if (placement) {
    navigate(sessionHref(placement.server, placement.sessionId))
    return
  }
  const conn = focusedServer()
  const project = newSessionProject()
  if (conn && project) {
    openProjectNewSession(conn, project.worktree)
  }
}
```

**ADD to return JSX**:

Insert `<HomeModeCards>` section BEFORE the grid div (`<div class="mx-auto grid ...">`):

```tsx
return (
  <div class="rounded-[10px] ... flex flex-col">
    <div class="shrink-0 px-6 pt-6 lg:pt-12">
      <HomeModeCards mode={mode} language={language} enterMode={enterMode} />
    </div>
    <div class="mx-auto grid ... existing ...">
      ...
    </div>
  </div>
)
```

**ADD HomeModeCards component** (after Home() closing brace, before HomeProjectColumn):

```tsx
function HomeModeCards(props: {
  mode: ReturnType<typeof useMode>
  language: ReturnType<typeof useLanguage>
  enterMode: (m: Mode) => void
}) {
  const MODE_ICONS: Record<Mode, string> = {
    chat: "mode-chat", coding: "mode-coding",
    work: "mode-work", assistant: "mode-assistant",
  }
  return (
    <div class="flex flex-col gap-3">
      <h2 class="text-v2-text-text-base [font-weight:600]">
        {props.language.t("home.modes.title")}
      </h2>
      <div class="grid grid-cols-1 gap-2 lg:grid-cols-2">
        <For each={MODES}>
          {(m) => {
            const active = () => props.mode.currentMode === m
            return (
              <button
                type="button"
                aria-label={props.language.t(`mode.${m}` as const)}
                class="flex cursor-default items-center gap-2.5 rounded-[8px] border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v2-border-border-focus"
                classList={{
                  "bg-v2-background-bg-layer-01 border-v2-border-border-muted hover:bg-v2-overlay-simple-overlay-hover": !active(),
                  "bg-v2-background-bg-layer-01 border-v2-border-border-focus": active(),
                }}
                onClick={() => props.enterMode(m)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault(); props.enterMode(m)
                  }
                }}
              >
                <IconV2 name={MODE_ICONS[m]} size="large" class="shrink-0 text-v2-icon-icon-base" />
                <div class="flex min-w-0 flex-col gap-0.5">
                  <span class="text-v2-text-text-base [font-weight:530]">{props.language.t(`mode.${m}`)}</span>
                  <span class="text-v2-text-text-muted [font-weight:440]">{props.language.t(`mode.${m}.description`)}</span>
                </div>
              </button>
            )
          }}
        </For>
      </div>
    </div>
  )
}
```

**COMPONENT STATES**:
- Default: all 4 cards in 2x2 (desktop) or stack (mobile)
- Hover: bg-v2-overlay-simple-overlay-hover
- Active: border-v2-border-border-focus
- Focus: ring-v2-border-border-focus
- Keyboard: Enter/Space to select

---

## 8. Coding Standards (ALL files must follow)

| Check | Rule |
|-------|------|
| Imports | Exact paths, no aliases (`foo as bar`), no star imports |
| Variables | `const` only (no `let` unless reassignment required) |
| Control flow | Early return, no `else` |
| Types | No `any`, no `@ts-ignore` (except existing in sidebar-workspace) |
| CSS | ALL colors/spacing from `--v2-*` CSS variables, never hardcode |
| Text | ALL user-facing text through `language.t(...)` |
| Functions | Inline single-use logic, extract only when reused |
| Arrays | `flatMap`, `filter`, `map` over for loops |
| Components | Include: default/hover/focus/disabled/loading/empty/error states |
| ARIA | aria-label, keyboard reachable, focus-visible ring |
| Exports | No barrel `index.ts` in sibling dirs, no `export namespace` |

---

## 9. Verification (after each task)

```bash
bun --cwd packages/app typecheck        # must pass
bun --cwd packages/ui typecheck         # must pass
bun run lint                            # no NEW errors
bun --cwd packages/app test --timeout 30000  # must pass
bun --cwd packages/ui test --timeout 30000   # must pass
```

### 复查结论 template:

```
复查结论:
- 影响文件:
- 命中 skills:
- 安全门禁: Catch Everything / No Null Pointer / Security First
- 工程门禁: No Cheating / Reusability / Clean Logs
- 已运行命令:
- 剩余风险:
```

---

## 10. File Manifest

| Action | File | Phase |
|--------|------|-------|
| MODIFY | packages/ui/src/v2/components/icon.tsx | 0.1 |
| MODIFY | packages/app/src/i18n/en.ts | 0.2 |
| MODIFY | packages/app/src/i18n/zh.ts | 0.3 |
| CREATE | packages/app/src/context/mode.tsx | 1.1 |
| CREATE | packages/app/src/components/mode-switcher.tsx | 1.2 |
| CREATE | packages/app/src/components/secondary-sidebar.tsx | 2.1 |
| MODIFY | packages/app/src/pages/layout.tsx | 3.1 |
| MODIFY | packages/app/src/pages/home.tsx | 4.1 |

---

## 11. Known Pitfalls

1. **DO NOT import SortableWorkspace/LocalWorkspace** — they need WorkspaceSidebarContext + DragDropProvider which SecondarySidebar doesn't have
2. **DO NOT create new workspace/session components** — use SessionItem + SessionSkeleton directly
3. **Session navigation MUST be direct** — wrap SessionItem in onClick that calls `navigate(sessionHref(connKey, sessionId))`, not through SessionItem's internal `<A>` legacy route
4. **ServerConnection.key(conn)** is a static method, not a property — use `ServerConnection.key(conn)` not `conn.key`
5. **useServerSync() returns an Accessor** — must call `sync()` not use directly
6. **ButtonV2 icon prop is a string name**, not JSX.Element — use `icon="edit"` not `icon={<Icon name="edit" />}`
7. **IconButtonV2 icon prop is JSX.Element** — use `icon={<Icon name="magnifying-glass" />}`
8. **ButtonV2.variant does not accept "primary"** — use "neutral" or "ghost"
---

## 附录 A：旧代码参考（来自 4fbb42d:layout.tsx）

恢复到 7a4a989 后实施时需要参考以下关键实现：

### WorkspaceSidebarContext（layout.tsx:1968-1995）
```
workspaceExpanded: (directory, local) => store.workspaceExpanded[directory] ?? local
setWorkspaceExpanded: (directory, value) => setStore("workspaceExpanded", directory, value)
showResetWorkspaceDialog: (root, directory) => dialog.show(() => <DialogResetWorkspace />)
showDeleteWorkspaceDialog: (root, directory) => dialog.show(() => <DialogDeleteWorkspace />)
InlineEditor: createInlineEditorController().InlineEditor
其余为 no-op 或简单访问器
```

### toggleProjectWorkspaces（layout.tsx:1442-1451）
```
function toggleProjectWorkspaces(project: LocalProject) {
  const enabled = layout.sidebar.workspaces(project.worktree)()
  if (enabled) { layout.sidebar.toggleWorkspaces(project.worktree); return }
  if (project.vcs !== "git") return
  layout.sidebar.toggleWorkspaces(project.worktree)
}
```
→ 对应新代码的 state: `layout.sidebar.workspaces(directory)()` + `layout.sidebar.setWorkspaces(directory, value)`

### SidebarPanel 工作区列表渲染模式
- workspaces 禁用: `LocalWorkspace` + 上方 "New session" 按钮
- workspaces 启用: `DragDropProvider>DragDropSensors>ConstrainDragXAxis>SortableProvider ids={workspaces()}>For>SortableWorkspace` + 上方 "New workspace" 按钮

### 关键依赖
- `layout.sidebar.workspaces(directory)` / `layout.sidebar.setWorkspaces(directory, value)` — 工作区开关持久化
- `createInlineEditorController()` — 提供 `InlineEditor` 组件（WorkspaceHeader 需要）
- `DragDropProvider + SortableProvider + DragDropSensors + ConstrainDragXAxis` — SortableWorkspace 必需
