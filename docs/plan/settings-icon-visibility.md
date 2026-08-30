# Titlebar Icons Visibility Settings Implementation Plan

> **Status**: PLANNED
> **Branch**: settings-icon-visibility
> **Target**: dev
> **Plan Reference**: docs/plan/settings-icon-visibility.md
> **Execution Protocol**: CLAUDE.md, AGENTS.md, DESIGN.md

---

## 1. Overview & Motives

This plan outlines the design and implementation for showing and hiding the titlebar/header action icons (left secondary sidebar toggle, service status popover, and right review panel toggle) via user settings.
Currently, the service status indicator (`StatusPopoverV2`) and file search button (`showSearch`) already have visibility settings (`settings.visibility.status`, `settings.visibility.search`).
We will introduce two new settings:

1. **Left Secondary Sidebar Toggle Button** (controlling the visibility of the sidebar toggle button on the left).
2. **Right Inspector/Review Panel Toggle Button** (controlling the visibility of the review panel toggle button on the right).

These settings will be persisted under the existing `settings.v3` store, exposed through the setting interface, and rendered in the general settings tab under the "Advanced" section.

---

## 2. Design Decisions & Alignment

| #   | Decision                                                         | Rationale                                                                                                            | Protocol Alignment                               |
| --- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| 1   | Extend `settings.v3` Schema                                      | Keep all user preferences centralized in `useSettings` context to auto-persist settings across app restarts.         | AGENTS.md (Centralized config/settings)          |
| 2   | Use `<Show>` wrappers with HSR (High-Speed Reactivity)           | SolidJS `<Show>` component efficiently mounts/unmounts DOM nodes dynamically without triggering full layout reflows. | DESIGN.md (Layout stability, no layout shifting) |
| 3   | Group under "Advanced" section in settings UI                    | Centralizes visibility switches (File Tree, Search, Status, Custom Agents, and new Sidebar Toggles).                 | DESIGN.md (Clean, compact developer interface)   |
| 4   | Fully support english (`en.ts`) & Chinese (`zh.ts`) dictionaries | All labels and descriptions must be translated without any hardcoded text.                                           | DESIGN.md (i18n first)                           |

---

## 3. Proposed Changes

### Component 1: settings.tsx (Settings Schema & Context)

Expose visibility settings and setters in `packages/app/src/context/settings.tsx`.

#### [MODIFY] [settings.tsx](file:///media/keer/办公/aigcfroge/packages/app/src/context/settings.tsx)

1. Update `Settings` interface:
   ```typescript
   export interface Settings {
     general: {
       ...
       showLeftSidebarToggle: boolean
       showRightSidebarToggle: boolean
     }
     ...
   }
   ```
2. Update `defaultSettings` values:
   ```typescript
   const defaultSettings: Settings = {
     general: {
       ...
       showLeftSidebarToggle: true, // Default to show for UX discoverability
       showRightSidebarToggle: true, // Default to show for UX discoverability
     },
     ...
   }
   ```
3. Expose signals and setter methods inside `SettingsProvider` init:
   ```typescript
   const showLeftSidebarToggle = withFallback(
     () => store.general?.showLeftSidebarToggle,
     defaultSettings.general.showLeftSidebarToggle,
   )
   const showRightSidebarToggle = withFallback(
     () => store.general?.showRightSidebarToggle,
     defaultSettings.general.showRightSidebarToggle,
   )
   ```
4. Return accessors and setters:
   ```typescript
   general: {
     ...
     showLeftSidebarToggle,
     setShowLeftSidebarToggle(value: boolean) {
       setStore("general", "showLeftSidebarToggle", value)
     },
     showRightSidebarToggle,
     setShowRightSidebarToggle(value: boolean) {
       setStore("general", "showRightSidebarToggle", value)
     },
   },
   visibility: {
     fileTree: showFileTree,
     search: showSearch,
     status: showStatus,
     customAgents: showCustomAgents,
     leftSidebarToggle: showLeftSidebarToggle,
     rightSidebarToggle: showRightSidebarToggle,
   }
   ```

---

### Component 2: Titlebar & Session Header (Render Consumption)

#### [MODIFY] [titlebar.tsx](file:///media/keer/办公/aigcfroge/packages/app/src/components/titlebar.tsx)

Wrap the secondary sidebar toggle button with `<Show>` using the new visibility flag.

```tsx
<Show when={settings.visibility.leftSidebarToggle()}>
  <TooltipV2
    value={language.t(mode.secondarySidebarOpen ? "sidebar.secondary.hide" : "sidebar.secondary.show")}
    placement="bottom"
    gutter={8}
  >
    <IconButtonV2
      variant="ghost-muted"
      size="large"
      class="titlebar-icon mr-1 !w-9 shrink-0"
      state={mode.secondarySidebarOpen ? "pressed" : undefined}
      icon={<IconV2 name="sidebar-right" />}
      aria-label={language.t(mode.secondarySidebarOpen ? "sidebar.secondary.hide" : "sidebar.secondary.show")}
      onClick={() => mode.toggleSecondarySidebar()}
    />
  </TooltipV2>
</Show>
```

#### [MODIFY] [session-header.tsx](file:///media/keer/办公/aigcfroge/packages/app/src/components/session/session-header.tsx)

Update actions visibility calculation inside `v2ActionsState`:

```typescript
const v2ActionsState = createMemo<SessionHeaderV2ActionsState>(() => ({
  statusVisible: status(),
  statusLabel: language.t("status.popover.trigger"),
  reviewLabel: language.t("command.review.toggle"),
  reviewKeybind: command.keybind("review.toggle"),
  reviewVisible: isDesktop() && settings.visibility.rightSidebarToggle(),
  reviewOpened: view().reviewPanel.opened(),
  onReviewToggle: () => view().reviewPanel.toggle(),
}))
```

---

### Component 3: Settings UI (General Settings Page)

#### [MODIFY] [general.tsx](file:///media/keer/办公/aigcfroge/packages/app/src/components/settings-v2/general.tsx)

Introduce new switches to toggle secondary sidebar and review panel button visibilities in the `AdvancedSection`.

```tsx
        <SettingsRowV2
          title={language.t("settings.general.row.showLeftSidebarToggle.title")}
          description={language.t("settings.general.row.showLeftSidebarToggle.description")}
        >
          <div data-action="settings-show-left-sidebar-toggle">
            <Switch
              checked={settings.general.showLeftSidebarToggle()}
              onChange={(checked) => settings.general.setShowLeftSidebarToggle(checked)}
            />
          </div>
        </SettingsRowV2>

        <SettingsRowV2
          title={language.t("settings.general.row.showRightSidebarToggle.title")}
          description={language.t("settings.general.row.showRightSidebarToggle.description")}
        >
          <div data-action="settings-show-right-sidebar-toggle">
            <Switch
              checked={settings.general.showRightSidebarToggle()}
              onChange={(checked) => settings.general.setShowRightSidebarToggle(checked)}
            />
          </div>
        </SettingsRowV2>
```

---

### Component 4: i18n Translations

#### [MODIFY] [en.ts](file:///media/keer/办公/aigcfroge/packages/app/src/i18n/en.ts)

Add English definitions:

```typescript
  "settings.general.row.showLeftSidebarToggle.title": "Left sidebar toggle button",
  "settings.general.row.showLeftSidebarToggle.description": "Show the secondary left sidebar toggle button in the title bar",
  "settings.general.row.showRightSidebarToggle.title": "Right sidebar toggle button",
  "settings.general.row.showRightSidebarToggle.description": "Show the review panel toggle button in the title bar",
```

#### [MODIFY] [zh.ts](file:///media/keer/办公/aigcfroge/packages/app/src/i18n/zh.ts)

Add Chinese definitions:

```typescript
  "settings.general.row.showLeftSidebarToggle.title": "左侧边栏切换按钮",
  "settings.general.row.showLeftSidebarToggle.description": "在标题栏中显示左侧次级边栏切换按钮",
  "settings.general.row.showRightSidebarToggle.title": "右侧边栏切换按钮",
  "settings.general.row.showRightSidebarToggle.description": "在标题栏中显示右侧代码审查面板切换按钮",
```

---

## 4. Verification Plan

### 4.1 Automated Gates

Ensure all types and tests pass cleanly:

```bash
# Typecheck packages
bun --cwd packages/app typecheck
bun --cwd packages/ui typecheck

# Lint checks
bun run lint

# Test execution
bun --cwd packages/app test --timeout 30000
```

### 4.2 Manual / UI Verification

1. Open settings window (General Tab -> Advanced Section).
2. Toggle the "Left sidebar toggle button" switch:
   - Verify the secondary sidebar button disappears/re-appears in the titlebar.
   - Verify there is no layout shifting.
3. Toggle the "Right sidebar toggle button" switch:
   - Verify the review panel button disappears/re-appears in the header actions portal.
4. Toggle "Server status" and "Search files" switches to confirm they work harmoniously with the new settings.
5. Reload/restart application to ensure the visibility preferences are correctly loaded from `localStorage`.
