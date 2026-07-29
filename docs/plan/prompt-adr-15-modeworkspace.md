你是 AigcForge 仓库（/media/keer/办公/aigcfroge）的高级全栈工程师。在 `adr-15-modeworkspace` 分支上执行 ADR-15 ModeWorkspace 实施计划。计划全文见 `docs/plan/adr-15-modeworkspace-implementation.md`。

---

## 0. 认知加载（写任何代码前必须精读）

按顺序读完以下文件：

```
CLAUDE.md              （根目录 — 第一性原理、八荣八耻、四大拒绝、门禁、改完即审流程）
AGENTS.md              （根目录 — 分支提交、Effect/Schema/测试规范、代码风格）
ARCHITECTURE.md        （根目录 §2/§3/§4.10 — 系统全景、包拓扑、Product Mode）
DESIGN.md              （根目录 — 产品性格、v2 token、布局、模式切换）
.aigcfroge/skills/frontend-theming/SKILL.md  （v2 token 强制）
.aigcfroge/skills/effect/SKILL.md            （Effect v4 编码规范）
docs/architecture/adr/ADR-15-mode-workspace-main-area-slot.md     （Accepted 2026-07-19）
docs/architecture/adr/ADR-12-product-mode-entry-routing.md        （§4 重定向语义）
docs/plan/adr-15-modeworkspace-implementation.md                  （本计划全文，571 行）
```

读完才能在 `adr-15-modeworkspace` 分支上开始写代码。

---

## 1. 目标

把 `home.tsx`（1430 行单体，`ModeRoute` → `<Home />`）重构为：

```text
ModeRoute → ModeWorkspace（共享外壳）
  ├── Sidebar slot：render-all + display:none（ChatFeatureSidebar / HomeProjectColumn）
  ├── Main slot：render-all + display:none（AssetWorkbenchTable / session list）
  └── slot 切换不 remount、sessionLoad 切换不重取
```

**范围**：`packages/app` only — 纯 UI 重构，0 个 Core/schema/server/SDK 修改。

---

## 2. 五层代码验证（执行前 grep 确认）

```bash
# L1 UI 组件
grep -n "Show.*Home\|Dynamic\|display.*none" packages/app/src/pages/home.tsx | head -30
grep -n "Dynamic" packages/app/src/pages/session/session-side-panel.tsx  # 确认 line 480
grep -n "Dynamic" packages/app/src/components/secondary-sidebar.tsx       # 确认 line 664
grep -n "ModeSurface\|MODE_SURFACES" packages/app/src/components/mode-surfaces.tsx | head -20

# L2 路由/上下文
grep -n "ModeRoute\|HomeRedirect" packages/app/src/app.tsx | head -10
grep -n "modeDraft\|ModeSurfaceSlot" packages/app/src/context/mode.tsx | head -10

# L4 数据查询
grep -n "queryKey.*mode\|loadSessions" packages/app/src/pages/home.tsx | head -10
```

**关键发现**：
- `app.tsx:556` 当前：`<Show when={selected()}><Home /></Show>`
- `home.tsx:193` queryKey 含 `mode.currentMode` → 切模式触发 session 列表重取
- `mode-surfaces.tsx:20-23`：`ModeSurface = { Sidebar, RightPanel }` — **没有 `Main` 字段**
- `secondary-sidebar.tsx:664` 和 `session-side-panel.tsx:480` 仍用 `<Dynamic>`（ADR-15 §4 禁用）
- `server-sync.tsx:255-311`：sessionLoad 写入 directory 级 store（跨 mode 累积），queryKey 去 mode 不会空数据

---

## 3. TDD 强制循环（每 Step 必走）

```
1. 精读本 Step 的红/绿/重构 + 关联代码文件
2. 红：先写测试，运行确认失败
3. 绿：最小实现使测试通过
4. 重构：清理，测试保持绿
5. 命令验证：bun run lint + bun --cwd packages/app typecheck + bun --cwd packages/app test --timeout 30000
6. 按 CLAUDE.md §改完即审 输出复查结论
7. 重新阅读 CLAUDE.md 全文 + ADR-15 全文
全部通过后 git commit，进入下一步。
```

---

## 4. 实施步骤

### Step 1 — ModeRoute 渲染 ModeWorkspace

**测试**：`packages/app/test/mode-route.test.tsx`（新增）— `/mode/chat` DOM 含 `data-mode-workspace`，URL 停留 `/mode/chat`；切 `/mode/coding` 时 currentMode 变 "coding" 不 redirect

**实现**：
- `packages/app/src/pages/mode-workspace.tsx`（新建）— 空壳 `<div data-mode-workspace>`
- `packages/app/src/app.tsx:556` — `<Home />` → `<ModeWorkspace />`

**验证**：`bun --cwd packages/app test --timeout 30000 && bun --cwd packages/app typecheck && bun run lint`

**复查**：重新阅读 CLAUDE.md + ADR-15 §1/§3 + ARCHITECTURE.md §4.10

---

### Step 2 — `/` 重定向确认（no-op）

**测试**：`packages/app/test/mode-route.test.tsx` 扩展 — 访问 `/` → redirect `/mode/<persistedMode>`

**实现**：确认 `app.tsx:560-563` `HomeRedirect` 已有正确实现，无需改动

**复查**：重新阅读 CLAUDE.md + ADR-12 §4

---

### Step 3 — ModeSwitcher 回归确认（no-op）

**测试**：确认 `mode-switcher.tsx:36` 已 `navigate(item.href)`

**实现**：无需改动

**复查**：重新阅读 CLAUDE.md + DESIGN.md §Product Mode Switching

---

### Step 4 — slot 不 remount（上提 resource + 替换 Dynamic）

**测试**：
- 切 /mode/chat→/mode/coding→/mode/chat，`createResource` spy 验证 asset.list call count = 1
- SecondarySidebar slot 组件 onMount 不重新执行
- RightPanel slot 组件 onMount 不重新执行

**实现**：
- `mode-workspace.tsx`：用 `createContext` 做 provider，持有 asset `createResource`，通过 `createMemo` 按 `mode.currentMode` 惰性触发——只在 chat 时才实际 fetch。slot 内仅消费 context accessor，不自己调 `createResource`
- `secondary-sidebar.tsx:664`：`<Dynamic>` → render-all + display:none
- `session-side-panel.tsx:480`：`<Dynamic>` → render-all + display:none

**验证**同上

**复查**：重新阅读 CLAUDE.md + ADR-15 §4 全文

---

### Step 5 — Home 并入 ModeWorkspace + Chat 主区=资产工作台

**测试**：
- `/mode/chat` 主区 = AssetWorkbenchTable（DOM 标识）
- `HomeModeCards` 已从 DOM 消失
- `/mode/coding` 主区 = session list（回归不破）
- ModeSwitcher 是唯一模式入口

**实现**：
1. `mode-surfaces.tsx` — `ModeSurface` 加 `Main: Component` 字段
2. `MODE_SURFACES` 注册 — `chat: { Sidebar: ChatFeatureSidebar, RightPanel: ChatRightPanel, Main: ChatAssetWorkbenchMain }` / `coding: { Sidebar: HomeProjectColumn, RightPanel: SessionSidePanel, Main: CodingSessionListMain }`
3. `ModeWorkspace` — render-all + display:none 切换 Sidebar + Main slot
4. `home.tsx` 拆解 — `ChatSidebar`→保留为 ChatFeatureSidebar、`HomeProjectColumn`→保留、AssetWorkbench→抽为 `ChatAssetWorkbenchMain`、Session list→抽为 `CodingSessionListMain`、`Home` 组件删除。`ChatWorkspaceProvider` 已在 layout.tsx 级挂载，子组件直接消费

**回归**：浏览器确认 Chat 主区 = AssetWorkbench、Coding 主区 = session list、ModeSwitcher 正常、SecondarySidebar 正常、右栏 chat/coding 均正常

**复查**：重新阅读 CLAUDE.md + ADR-15 全文 + ADR-12 + DESIGN.md §Product Mode Switching

---

### Step 6 — secondary-sidebar-route 确认（no-op）

**测试**：`/mode/chat` 时 secondarySidebar 可见

**实现**：确认 `secondarySidebarAvailable` 对 `/mode/*` 全返 true，无需改动

**复查**：重新阅读 CLAUDE.md 所有门禁

---

### Step 7 — sessionLoad queryKey + queryFn 去 mode

**测试**：
- sessionLoad queryKey 不含 `mode.currentMode`（spy 验证不重取）
- records memo 切 chat 只显示 chat session、切 coding 只显示 coding session

**实现**：
- `home.tsx:193`（或 `CodingSessionListMain`）— queryKey 去掉 `mode.currentMode`
- `loadSessions` 调用去掉 `mode` 入参
- 确认 `records` memo 保留按 mode 过滤逻辑
- 可选 `keepPreviousData` 兜底

**验证**同上

**复查**：重新阅读 CLAUDE.md + ARCHITECTURE.md §4.10 + ADR-14 §4

---

### Step 8 — 全量验收

```bash
bun --cwd packages/app typecheck
bun --cwd packages/app test --timeout 30000
bun run lint
```

浏览器：
- /mode/chat → AssetWorkbenchTable 主区
- /mode/coding → session list 主区
- 模式切换无闪烁
- URL /mode/:mode 可分享、刷新保留
- ModeSwitcher/SecondarySidebar/右栏 均正常

---

## 5. 回滚与安全

每 Step 独立 commit（`feat(adr-15): Step N — <description>`），可 `git revert` 单步回滚。

**DESIGN.md 合规**：稳定尺寸无位移 / v2 token / 明暗主题 CSS 变量自适应 / 键盘 focus / 中英文溢出 truncate

**已知延后**（不在本期范围）：窄屏 768px 硬编码（A5）、i18n 18 locale parity（A4）、SessionSidePanel per-slot 重构（A1）、消费路径分组（PRD §9.4）、ChatFeaturePanel 删除（M3 Phase 6）

---

## 6. 强制规则

- 每 Step 完成后必须重新阅读 CLAUDE.md 全文
- 每 Step 完成后必须跑 `bun typecheck + bun test + bun lint`
- 测试必须先写（红）再实现（绿）
- 禁止 as any / @ts-ignore / 改无关文件
- 阻塞问题：先向用户报告现状和已试方案，请求决策
