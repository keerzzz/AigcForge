# ADR-15 ModeWorkspace 实施计划（TDD 全流程）

> 状态：**Implemented**（2026-07-29，合入 main @ `0105b3649`）
> 依据：[ADR-15](../architecture/adr/ADR-15-mode-workspace-main-area-slot.md)（Accepted 2026-07-19）、[CLAUDE.md](../../CLAUDE.md)、[AGENTS.md](../../AGENTS.md)、[ARCHITECTURE.md](../../ARCHITECTURE.md)、[DESIGN.md](../../DESIGN.md)
> 前置：M1-M7 全部合并到 main（最新 commit `59630f8ea`）
> 范围：`packages/app`（ModeWorkspace / Home / mode-surfaces / session-side-panel / secondary-sidebar）+ `packages/ui`（如新增组件）
> 分支：`adr-15-modeworkspace`（从 main 切出）
> **本文件为自包含实施手册，可供其他 agent 独立执行。**

---

## 0. 背景与目标

### 0.1 当前状态

`ModeRoute`（[app.tsx:543-557](packages/app/src/app.tsx#L543)）渲染 `<Home />`，`Home`（[home.tsx](packages/app/src/pages/home.tsx)）是 1430 行的单体组件，内部通过 render-all + `display:none` 切换 chat/coding 两个模式：

```text
home.tsx (1430行单体)
├── ChatSidebar（display:none 切换）
├── HomeProjectColumn（display:none 切换）
├── AssetWorkbenchTable（chat 主区）
├── HomeSessionSearch + session list（coding 主区）
└── mode.currentMode 响应式控制 display
```

存在问题：

- **无 ModeWorkspace 组件**：Home 耦合了所有模式的渲染逻辑
- **slot 切换闪烁**：display:none 避免了 remount，但 chat AssetWorkbench 的 `createResource` 在 `/mode/:mode` 首次进入时仍会重建
- **sessionLoad queryKey 含 mode**（[home.tsx:193](packages/app/src/pages/home.tsx#L193)）：切模式时 queryKey 变化触发重取，session 列表闪烁
- **Home 伪四区**：`HomeModeCards` 已删除（M2 Step 2），但 Home 仍是独立 `/` 路由目标

### 0.2 目标

8 步 TDD（原 7 步 + 验收步）：

| Step | 内容                                                            | 治什么                       |
| ---- | --------------------------------------------------------------- | ---------------------------- |
| 1    | ModeRoute 渲染 ModeWorkspace + `setCurrentMode` 迁 createEffect | 消除 redirect 导致的 remount |
| 2    | `/` 重定向到 `/mode/<persistedMode>`                            | 落地 ADR-12 §4 重定向语义    |
| 3    | ModeSwitcher 确认                                               | 回归确认 no-op               |
| 4    | slot 不 remount（上提 resource）                                | 治闪烁根因                   |
| 5    | Home 并入 ModeWorkspace + Chat 主区=资产工作台                  | 架构对齐 ADR-15              |
| 6    | secondary-sidebar-route 确认                                    | 回归确认 no-op               |
| 7    | sessionLoad queryKey + queryFn 去 mode                          | 治第二闪烁源                 |
| 8    | 验收（typecheck + test + lint + a11y + i18n）                   | 全量门禁                     |

### 0.3 非目标

- 不改 Core/schema/server/SDK —— 纯 App UI 改动
- 不做 Work/Assistant slot 实现（各自 PRD）
- 不做窄屏改进（A5，延后单独一期）
- 不做 i18n 18 locale parity（A4，延后单独一期）

---

## 1. 五层代码追踪（执行前必读）

### L1 UI 组件层

| 文件                                                    | 行        | 关键内容                                                                     |
| ------------------------------------------------------- | --------- | ---------------------------------------------------------------------------- |
| `packages/app/src/pages/home.tsx`                       | 1430      | 单体 Home，ChatSidebar/HomeProjectColumn/AssetWorkbench/sessionList 全部内写 |
| `packages/app/src/pages/home.tsx`                       | 638-665   | ADR-15 §4 方案1: display:none 切换 sidebar                                   |
| `packages/app/src/pages/home.tsx`                       | 672-682   | ADR-15 §4 方案1: display:none 切换主区                                       |
| `packages/app/src/pages/home.tsx`                       | 192-199   | sessionLoad queryKey 含 `mode.currentMode`                                   |
| `packages/app/src/components/mode-surfaces.tsx`         | 20-23     | `ModeSurface = { Sidebar, RightPanel }`，无 `Main` 字段                      |
| `packages/app/src/components/mode-surfaces.tsx`         | 321-341   | `MODE_SURFACES` 表，surface="chat/coding/work/assistant"                     |
| `packages/app/src/components/secondary-sidebar.tsx`     | 664       | `<Dynamic>` 渲染 SecondarySidebar slot（违禁 ADR-15 §4）                     |
| `packages/app/src/pages/session/session-side-panel.tsx` | 480       | `<Dynamic>` 渲染右栏 slot（违禁 ADR-15 §4）                                  |
| `packages/app/src/pages/session.tsx`                    | 1793-1794 | MessageTimeline 渲染，actions={revert, handoff}                              |

### L2 页面与上下文层

| 文件                                          | 行      | 关键内容                                                         |
| --------------------------------------------- | ------- | ---------------------------------------------------------------- | -------- | ------ | ------------ |
| `packages/app/src/app.tsx`                    | 543-557 | ModeRoute 渲染 `<Home />`，setCurrentMode 在 createEffect        |
| `packages/app/src/app.tsx`                    | 560-563 | HomeRedirect: `/` → `/mode/<persistedMode>`                      |
| `packages/app/src/context/mode.tsx`           | 41-43   | `ModeSurfaceSlot = "chat"                                        | "coding" | "work" | "assistant"` |
| `packages/app/src/context/mode.tsx`           | 61-66   | `modeDraft(mode)` = `{ mode, agent: resolvePrimaryAgent(mode) }` |
| `packages/app/src/context/chat-feature.tsx`   | 全文件  | ChatFeatureID 7 种类别 + persist                                 |
| `packages/app/src/context/chat-workspace.tsx` | 全文件  | AssetWorkbenchTable 筛选项持久化 + DirtyDraftGuard               |

### L3 路由层

| 文件                                | 行      | 关键内容                                                   |
| ----------------------------------- | ------- | ---------------------------------------------------------- |
| `packages/app/src/app.tsx`          | 565-575 | Routes 定义: `/` → HomeRedirect, `/mode/:mode` → ModeRoute |
| `packages/app/src/pages/layout.tsx` | 77      | ChatFeatureProvider 挂载位置                               |
| `packages/app/src/pages/layout.tsx` | 567     | layout 级 loadSessions 不传 mode                           |

### L4 数据查询层

| 文件                                       | 行      | 关键内容                                           |
| ------------------------------------------ | ------- | -------------------------------------------------- |
| `packages/app/src/pages/home.tsx`          | 192-199 | sessionLoad useQuery，queryKey 含 mode.currentMode |
| `packages/app/src/pages/home.tsx`          | 210-221 | records memo 按 mode 过滤                          |
| `packages/app/src/context/server-sync.tsx` | 255-311 | loadSessions 写入 directory 级 store，跨 mode 累积 |

### L5 SDK/API层

| 文件                                    | 行        | 关键内容                                       |
| --------------------------------------- | --------- | ---------------------------------------------- |
| `packages/sdk/js/src/v2/gen/sdk.gen.ts` | 3407-4291 | 7 类 Asset client（list/content/apply/delete） |
| 各 HTTP handler                         | —         | Chat 相关 7 组 list/content/apply/delete 端点  |

**关键发现**：

- `sessionLoad` 的 `loadSessions` 写入的是 directory 级 store（非 mode-scoped），所以 queryKey 去掉 mode 后不会空数据
- `<Dynamic>` 在 home.tsx 已被替换为 display:none，但 secondary-sidebar.tsx:664 和 session-side-panel.tsx:480 仍用 `<Dynamic>`

---

## 2. TDD 工作流总则

### 每步强制流程

```
Step A 认知加载：精读本计划全文 + 本步上下游代码 + CLAUDE.md（每次执行前重新阅读全文）
Step B 写测试：先写测试并确认按预期失败（红）
Step C 写实现：最小功能代码使测试通过（绿）
Step D 命令验证：bun run lint + 受影响包 typecheck + 受影响包 test
Step E 复查结论：按 CLAUDE.md §改完即审 模板输出
Step F 再次认知：重新阅读 CLAUDE.md + 本计划 + 本步关联的协议文档（ARCHITECTURE.md §4.10、ADR-15、DESIGN.md）
全部通过 → 进入下一步；任何失败 → 修复后重走 Step D-F
```

### 测试规范

- 单包：`bun --cwd packages/app test --timeout 30000`
- UI 组件测试：`@solidjs/testing-library`（已安装）
- Effect 测试：`testEffect()`（`packages/aigcfroge/test/lib/effect.ts`）
- typecheck：`bun --cwd packages/app typecheck`（tsgo -b）
- lint：`bun run lint`（oxlint）

### 门禁

| 门禁             | 要求                                       |
| ---------------- | ------------------------------------------ |
| Catch Everything | 新增 Effect 边界必须兜底                   |
| No Null Pointer  | 外部输入、DOM ref 先判空                   |
| Security First   | 路径/URL 先校验再使用                      |
| No Cheating      | 无 `as any`/`@ts-ignore`，类型逃逸必须注释 |
| Reusability      | 新增前先查 owner module                    |
| Clean Logs       | 不输出敏感值                               |

---

## 3. 实施步骤

### Step 1: ModeRoute 渲染 ModeWorkspace + setCurrentMode 迁 createEffect

**改动文件**：

- `packages/app/src/pages/mode-workspace.tsx`（新增）
- `packages/app/src/app.tsx`（修改 ModeRoute）

**红（测试）**：

```ts
// packages/app/test/mode-route.test.tsx（新增）
describe("ModeRoute", () => {
  it("renders ModeWorkspace without redirecting /mode/chat", () => {
    // /mode/chat 渲染 ModeWorkspace（DOM 含 data-mode-workspace），URL 停留 /mode/chat
  })
  it("updates currentMode on /mode/chat -> /mode/coding param change", () => {
    // 同路由 param 切换时 currentMode 变 "coding"，不触发 redirect
  })
})
```

**绿**：

1. 新建 `packages/app/src/pages/mode-workspace.tsx`：
   ```tsx
   export function ModeWorkspace() {
     return <div data-mode-workspace>{/* Step 5 前只做壳 */}</div>
   }
   ```
2. 修改 `app.tsx` ModeRoute（line 556）：
   ```tsx
   // Before:
   return (
     <Show when={selected()} fallback={<Navigate href="/" />}>
       <Home />
     </Show>
   )
   // After:
   return (
     <Show when={selected()} fallback={<Navigate href="/" />}>
       <ModeWorkspace />
     </Show>
   )
   ```

**重构**：确认 `setCurrentMode` 在 createEffect 中（line 551-554 已正确实现）。

**验证**：

```bash
bun --cwd packages/app test --timeout 30000
bun --cwd packages/app typecheck
bun run lint
```

**复查结论模板**：

```text
复查结论:
- Step: 1
- 影响文件: packages/app/src/app.tsx, packages/app/src/pages/mode-workspace.tsx (new)
- 命中 skills: -
- 安全门禁: PASS（无新 Effect 边界/路径操作）
- 工程门禁: PASS（无 as any/重复造轮子）
- 已运行命令: bun test + bun typecheck + bun lint
- 剩余风险: 无
```

**Step F 再次认知**：重新阅读 CLAUDE.md、ADR-15 §1/§3、ARCHITECTURE.md §4.10。

---

### Step 2: `/` 重定向到 `/mode/<persistedMode>`

**改动文件**：

- `packages/app/src/app.tsx`（确认 HomeRedirect 已有）

**红（测试）**：

```ts
it("redirects / to /mode/<persistedMode>", () => {
  // 访问 / → 重定向到 /mode/coding（默认 persisted mode）
})
```

**绿**：确认 `HomeRedirect`（line 560-563）已正确实现，无需改动。

**验证**：同上。

**Step F 再次认知**：重新阅读 CLAUDE.md、ADR-12 §4。

---

### Step 3: ModeSwitcher 确认（回归 no-op）

**改动文件**：无

**红（测试）**：

```ts
it("ModeSwitcher navigates to /mode/:mode on click", () => {
  // 确认现有 ModeSwitcher 行为
})
```

**绿**：确认 `mode-switcher.tsx:36` 已 `navigate(item.href)`，无需改动。

**验证**：同上。

**Step F 再次认知**：重新阅读 CLAUDE.md、DESIGN.md §Product Mode Switching。

---

### Step 4: slot 不 remount（上提 resource）

**核心问题**：当前 home.tsx 用 `display:none` 避免了 remount（ADR-15 §4 方案1），但 AssetWorkbench 的 `createResource` 仍在 Home 组件内。Step 5 将把 Home 拆入 ModeWorkspace slot 后，方案1 不再可用——因为 slot 组件是不同函数，display:none 无法跨组件。

**Step 4 要做的事**：把 asset 相关 `createResource` 从 Home/Component 上提到 `ModeWorkspace` 级 provider，使 slot 组件内仅消费（无独立的 createResource）。

**上提不等于 eager 拉取**：ModeWorkspace provider 持有 `createResource` 调用，但通过 `createMemo` 按当前 mode 惰性触发——只在 `mode.currentMode === "chat"` 时才实际 fetch asset 数据。非 chat slot 的 createResource 不会被触发，避免 4× eager 拉取。slot 组件内通过 context accessor 消费，不自己调 `createResource`。

**改动文件**：

- `packages/app/src/pages/mode-workspace.tsx`（扩展）
- `packages/app/src/pages/home.tsx`（提取 resource 创建逻辑）
- `packages/app/src/components/secondary-sidebar.tsx`（替换 Dynamic）
- `packages/app/src/pages/session/session-side-panel.tsx`（替换 Dynamic）

**红（测试）**：

```ts
it("mode slot switch does not re-fetch asset list", () => {
  // 切 /mode/chat → /mode/coding → /mode/chat
  // createResource spy 验证 promptAsset.list call count = 1
})
it("secondary-sidebar slot does not remount on mode switch", () => {
  // SecondarySidebar slot 组件 onMount 不重新执行
})
it("session-side-panel right panel slot does not remount on mode switch", () => {
  // RightPanel slot 组件 onMount 不重新执行
})
```

**绿**：

1. 扩展 `ModeWorkspace` 为 provider：用 `createContext` 提供跨 slot 的 asset resource 访问器
2. 替换 `secondary-sidebar.tsx:664` 的 `<Dynamic>` → render-all + display:none（与 home.tsx 一致）
3. 替换 `session-side-panel.tsx:480` 的 `<Dynamic>` → render-all + display:none（与 home.tsx 一致）

**关键代码修改**：

```tsx
// mode-workspace.tsx
const AssetResourceCtx = createContext<{ assetCount: () => number }>()

function ModeWorkspaceShell(props: ParentProps) {
  // 每种 asset 的 fetch 在这里做，结果通过 context 下发
  // slot 内只 createMemo/accessor 消费
  return <AssetResourceCtx.Provider value={{...}}>{props.children}</AssetResourceCtx.Provider>
}
```

**验证**：

```bash
bun --cwd packages/app test --timeout 30000
bun --cwd packages/app typecheck
bun run lint
```

**Step F 再次认知**：重新阅读 CLAUDE.md、ADR-15 §4（slot 不 remount 两方案）、ARCHITECTURE.md §4.10。

---

### Step 5: Home 并入 ModeWorkspace + Chat 主区=资产工作台

**这是最核心的一步。** 把 home.tsx 的渲染逻辑拆入 ModeWorkspace，Home 组件删除或大幅瘦身。

**改动文件**：

- `packages/app/src/pages/mode-workspace.tsx`（扩展为主外壳）
- `packages/app/src/pages/home.tsx`（拆解，保留为 Coding slot 组件）
- `packages/app/src/components/mode-surfaces.tsx`（ModeSurface 加 `Main` 字段）
- `packages/app/src/components/mode-surfaces.tsx`（MODE_SURFACES 注册 Chat AssetWorkbenchTable 为 Main slot）

**红（测试）**：

```ts
it("/mode/chat main area renders AssetWorkbenchTable", () => {
  // 主区渲染资产工作台（含 AssetWorkbenchTable DOM 标识）
})
it("HomeModeCards are removed from DOM", () => {
  // HomeModeCards 不再存在于 DOM
})
it("/mode/coding main area renders session list (regression)", () => {
  // Coding 主区仍为会话列表（不破）
})
it("ModeSwitcher is the only mode entry point", () => {
  // 无独立 / 首页，ModeSwitcher 是唯一模式入口
})
```

**绿**：

1. `ModeSurface` 扩展：

   ```ts
   export type ModeSurface = {
     Sidebar: Component
     RightPanel: Component
     Main: Component // NEW
   }
   ```

2. `MODE_SURFACES` 注册：

   ```ts
   const MODE_SURFACES: Record<ModeSurfaceSlot, ModeSurface> = {
     chat: {
       Sidebar: ChatFeatureSidebar, // Step 5 后 feature 树在 SecondarySidebar
       RightPanel: ChatRightPanel,
       Main: ChatAssetWorkbenchMain, // NEW: AssetWorkbenchTable wrapper
     },
     coding: {
       Sidebar: HomeProjectColumn,
       RightPanel: SessionSidePanel,
       Main: CodingSessionListMain, // NEW: session list + search wrapper
     },
     // work/assistant: placeholder
   }
   ```

3. `ModeWorkspace` 渲染：

   ```tsx
   function ModeWorkspace() {
     const mode = useMode()
     const surface = () => modeSurface(mode.currentMode)
     return (
       <div data-mode-workspace class="...">
         <div class="grid grid-cols-[280px_minmax(0,720px)] ...">
           <div>{/* render-all + display:none for Sidebar */}</div>
           <div>{/* render-all + display:none for Main */}</div>
         </div>
       </div>
     )
   }
   ```

4. `home.tsx` 拆解：
   - `ChatSidebar` → 保留为 `ChatFeatureSidebar`（抽到 mode-surfaces）
   - `HomeProjectColumn` → 保留为 Coding Sidebar
   - AssetWorkbench 相关 → 抽为 `ChatAssetWorkbenchMain`（独立组件）
   - Session list 相关 → 抽为 `CodingSessionListMain`（独立组件，移自 home.tsx:700-728）
   - `Home` 组件删除或退化为空壳
   - **Provider 迁移**：`ChatWorkspaceProvider`（[chat-workspace.tsx](packages/app/src/context/chat-workspace.tsx)）当前在 `layout.tsx:77` 挂载，需确认其包装 `ChatAssetWorkbenchMain` 组件（非整个 ModeWorkspace）。若 Provider 已在 layout 层级，子组件皆可消费，无需迁移。

**重构**：

- 删除 `Home` 组件（若已无逻辑）
- `mode-surfaces.tsx` 的 MODE_SURFACES 加 Main
- 确认 `HomeRedirect` 仍在 app.tsx 路由中

**验证**：

```bash
bun --cwd packages/app test --timeout 30000
bun --cwd packages/app typecheck
bun run lint
```

**回归测试**：在浏览器打开 `/mode/chat` 和 `/mode/coding`，确认：

- Chat 主区 = AssetWorkbenchTable
- Coding 主区 = session list
- ModeSwitcher 功能正常
- SecondarySidebar 功能正常

**Step F 再次认知**：重新阅读 CLAUDE.md、ADR-15 全文、ADR-12、DESIGN.md §Product Mode Switching、ARCHITECTURE.md §4.10。

---

### Step 6: secondary-sidebar-route 确认（回归 no-op）

**改动文件**：无（`secondarySidebarAvailable` 在 `/mode/*` 已返 true）

**红（测试）**：

```ts
it("secondary sidebar is available on /mode/chat", () => {
  // /mode/chat 时 SecondarySidebar 显示
})
```

**绿**：确认 `secondarySidebarAvailable` 对 `/mode/:mode` 全返 true，无需改动。

**验证**：同上。

**Step F 再次认知**：重新阅读 CLAUDE.md（含所有门禁）。

---

### Step 7: sessionLoad queryKey + queryFn 去 mode

**核心问题**：`home.tsx:192-199` 的 sessionLoad queryKey 含 `mode.currentMode`，切模式时 queryKey 变化触发重取。Step 5 后 sessionLoad 逻辑在 `CodingSessionListMain` 组件内，需修改 queryKey。

**改动文件**：

- `packages/app/src/pages/home.tsx`（或 `CodingSessionListMain` 组件所在文件）

**红（测试）**：

```ts
it("sessionLoad queryKey does not contain mode.currentMode after step 7", () => {
  // queryKey 不含 mode.currentMode
  // 切模式 sessionLoad 不重取（spy 验证 call count 不变）
})
it("records memo filters by mode correctly after queryKey change", () => {
  // 切 chat → records 只显示 chat session
  // 切 coding → records 只显示 coding session
})
```

**绿**：

1. 修改 queryKey：

   ```ts
   // Before:
   queryKey: ["home", "sessions", mode.currentMode, state.selection.server, ...projectDirectories()]
   // After:
   queryKey: ["home", "sessions", state.selection.server, ...projectDirectories()]
   ```

2. 修改 `loadSessions` 调用：

   ```ts
   // Before:
   loadSessions(directory, { limit: HOME_SESSION_LIMIT, mode: mode.currentMode })
   // After:
   loadSessions(directory, { limit: HOME_SESSION_LIMIT })
   // 服务端拉全量（或按需拉取，由 loadSessions 内部决定）
   ```

3. 确认 `records` memo（home.tsx:210-221）已按 mode 过滤（保留现有逻辑）

**重构**：

- 确认 directory 级 store 累积逻辑（`server-sync.tsx:255-311`）不受影响
- 可选 `keepPreviousData` 兜底切换时的短暂空白

**验证**：

```bash
bun --cwd packages/app test --timeout 30000
bun --cwd packages/app typecheck
bun run lint
```

**Step F 再次认知**：重新阅读 CLAUDE.md、ARCHITECTURE.md §4.10、ADR-14 §4。

---

### Step 8: 全量验收

**改动文件**：无（确认状态）

**验收清单**：

```bash
# 1. 类型检查
bun --cwd packages/app typecheck

# 2. 测试
bun --cwd packages/app test --timeout 30000

# 3. Lint
bun run lint

# 4. 手动验收（浏览器）
# - /mode/chat → 主区 AssetWorkbenchTable
# - /mode/coding → 主区 session list
# - 模式切换无闪烁
# - URL /mode/:mode 可分享、刷新保留
# - ModeSwitcher 功能正常
# - SecondarySidebar 正常折叠/展开
# - 右栏 chat/coding 均正常
```

**DESIGN.md 合规**：

- 稳定尺寸无位移（Layout 不变）
- v2 token（无硬编码颜色）
- 明暗主题（CSS 变量自适应）
- 键盘 focus（Tab 序不受影响）
- 中英文溢出（truncate + title）

**复查结论**：

```text
复查结论:
- Step: 8 全量验收
- 影响文件: 见各 Step
- 命中 skills: frontend-theming（v2 token）、effect（无新 Effect 代码）
- 安全门禁: PASS
- 工程门禁: PASS
- 已运行命令: bun typecheck + bun test + bun lint
- 剩余风险: 窄屏行为（延后 A5）、i18n parity（延后 A4）
```

---

## 4. 依赖图与执行顺序

```text
Step 1 (ModeRoute renders ModeWorkspace)
  ↓
Step 2 (/ redirect to /mode/:mode) [可能无改动]
  ↓
Step 3 (ModeSwitcher confirm) [no-op]
  ↓
Step 4 (slot 不 remount：上提 resource + 替换 Dynamic)
  ↓
Step 5 (Home 并入 ModeWorkspace + Chat 主区=资产工作台)
  ↓
Step 6 (secondary-sidebar-route confirm) [no-op]
  ↓
Step 7 (sessionLoad queryKey + queryFn 去 mode)
  ↓
Step 8 (全量验收)
```

每步独立可提交（commit message: `feat(adr-15): Step N - <description>`）。

---

## 5. 风险与回滚

| 风险                                        | 缓解                                                                                  |
| ------------------------------------------- | ------------------------------------------------------------------------------------- |
| Step 5 Home 拆解打破 Coding session list    | 全模式回归测试                                                                        |
| Step 4 resource 上提影响其他模式            | 只上提 chat asset 相关 resource                                                       |
| Step 7 queryKey 去 mode 后 session 列表混乱 | `records` memo 已按 mode 过滤                                                         |
| Step 5 后右栏 ChatRightPanel 不工作         | session 页右栏不走 ModeWorkspace（session.tsx 独立渲染 session-side-panel），不受影响 |

**回滚**：每 Step 独立 commit，可 `git revert <step-commit>`。全量回滚：`git revert Step1..Step7`。

---

## 6. 不在本文范围的已知债务（后续计划）

- A1：SessionSidePanel per-slot 重构（右栏统一为纯空壳双区框架）
- A4：i18n 18 locale parity 扩 key
- A5：窄屏去硬编码 768px，引用 v2 断点 token
- 消费路径分组（PRD §9.4）
- ChatFeaturePanel 删除（M3 Phase 6）
