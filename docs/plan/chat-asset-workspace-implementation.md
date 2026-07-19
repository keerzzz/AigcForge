# Chat 资产工作台实施方案（ADR-15 落地 · TDD）

> 状态：Draft（待实施）
> 依据：[ADR-15](../architecture/adr/ADR-15-mode-workspace-main-area-slot.md)（Accepted 2026-07-19）
> 范围：`packages/app`（ModeRoute / ModeWorkspace / Home / mode-surfaces / secondary-sidebar / session-side-panel）+ `packages/ui`（如新增组件）
> 关联：[plan/mode-module-switching-completion.md](mode-module-switching-completion.md) 末尾 ADR-15 章节
> Owner：App（实现）/ Core（数据契约边界）/ Security（沿用 §8.3.1）

## 1. 目标

落地 ADR-15：

- `ModeRoute` 渲染共享 `ModeWorkspace`（不 redirect），`/mode/:mode` 参数变同路由组件不 remount
- Chat 首页主区 = 资产工作台（资产树 + 编辑/预览 + 新建/导入），会话降为次级，外壳共享
- slot 切换不 remount（治闪烁根因）
- 会话↔资产不落库（ADR-14 §4）

## 2. 实施前置项（进代码前补，对应 App owner P1）

| 项 | 内容 | 产出 |
|---|---|---|
| **A1** | per-slot 重构估算：Coding 会话列表从 Home 自绘抽为 slot（sessionLoad/records/groups 数据流迁移）；资产工作台 home 版 vs session 右栏版组件复用边界（§9.5 仅说复用资产 tab，tree/edit/new 按钮是否复用需定） | 组件拆分图 + 复用清单 |
| **A4** | i18n parity 扩 key：`parity.test.ts` 当前仅查 2 key，promptAsset/assetWorkbench 16 locale fallback en（M1 债务）；扩 `assetWorkbench.*`/`promptAsset.*` 全 18 locale | 扩展的 parity.test.ts |
| **A5** | 窄屏去硬编码 768px（`chat-right-panel.tsx:65` TODO D6），主区移到资产工作台后窄屏行为变化（主区窄屏全宽，非右栏抽屉）；引用 v2 断点 token（DESIGN.md §Tokens 禁硬编码） | token 引用 + 窄屏行为设计 |

### A1 详情页右栏统一到 SessionSidePanel（per-slot 重构，2026-07-19 决策）

**决策**（详情页 UI 讨论，4 项）：

1. **右栏结构统一**：`SessionSidePanel` 改为纯空壳双区框架（A 区 TabsV2 + B 区树），Coding 的 review 面板 + Chat 的资产内容均抽为 slot 注入，完全对称（PRD §9.2"不整体自绘"）。
2. **B 区资产树分组+计数**：按消费路径分组 + 计数（PRD §9.4）；M1 先按 kind 分组（prompt/command/skill/agent/mcp），消费路径分组后续。
3. **上下文 tab 补**：Chat 会话页右栏补"上下文 tab"，原样复用 `SessionContextTab`（PRD §9.2，零成本）。
4. **首页 vs 详情页资产组件复用**：共用 资产树组件 + 资产编辑器（§9.5 textarea）+ 预览组件；首页专有"新建/导入主操作"（主区顶部），详情页专有"候选预览"（当前会话产出）。

**工作量**：

- `session-side-panel.tsx`：coding review 面板抽成 slot，SessionSidePanel 成纯空壳框架（双区 + TabsV2 + B 区树 + resize）
- `mode-surfaces.tsx`：MODE_SURFACES 扩展右栏 slot 内容（Coding: review/context/文件 tab/文件树；Chat: 预览/上下文/资产 tab/资产树）
- `chat-right-panel.tsx`：拆解为 slot 组件（预览 tab content / 资产 tab content / 资产树），不再整体自绘
- 资产树共用组件：抽出（分组+计数 + 未解析区 + 搜索 + 行操作）
- 资产编辑器共用组件：抽出（查看/编辑两态，§9.5 textarea）

**前置**：Step 4（slot 不 remount）+ Step 5（Home 并入）之前完成 A1 组件拆分。

## 3. TDD 工作流总则

每步遵循 **红-绿-重构**：

1. **红**：先写测试，描述期望行为（失败）
2. **绿**：最小实现使测试通过
3. **重构**：清理，保持测试绿

测试规范（CLAUDE.md / AGENTS.md）：

- 单包：`bun --cwd packages/app test --timeout 30000`，**禁止从仓库根执行**（guard: `do-not-run-tests-from-root`）
- Effect 测试：`testEffect()`（`packages/aigcfroge/test/lib/effect.ts`），`Layer.mock` 代替手写 stub
- **禁 `Effect.sleep`** 等待并发 fiber，用 `pollWithTimeout` / `Deferred` / `SessionStatus.Service` / `BackgroundJob.wait({ id, timeout })` / Bus+Latch
- 三模式：`it.effect`（TestClock + TestConsole）/ `it.live`（真实 OS）/ `it.instance`（scoped tmpdir + instance）
- UI 组件测试：`@solidjs/testing-library`，渲染 + 断言；`createResource` spy 验证不重取
- typecheck：`bun --cwd packages/app typecheck`（tsgo）
- lint：`bun run lint`（oxlint，typeAware + suspicious warn）

## 4. 实施步骤（7 步 TDD）

### Step 1: ModeRoute 渲染 ModeWorkspace + setCurrentMode 迁 createEffect

**红**（测试）：

- `/mode/chat` 渲染 `ModeWorkspace`（DOM 含标识），URL 停留 `/mode/chat`，不 redirect 到 `/`
- `/mode/chat` -> `/mode/coding` 时 `currentMode` 变 "coding"（`createEffect` 响应 `params.mode` 变化，**不靠 redirect 重挂**）
- 测试位置：`packages/app/test/app.test.tsx` 或新增 `mode-route.test.tsx`

**绿**：

- `packages/app/src/app.tsx` ModeRoute：`return <ModeWorkspace />`（删 `<Navigate href="/" />`）
- `setCurrentMode` 迁入 `createEffect(() => { if (isMode(params.mode)) mode.setCurrentMode(params.mode) })`，对齐 `app.tsx:201` ResolvedDraftRoute 范式

**重构**：删 redirect 死代码；确认 `ModeWorkspace` 组件抽取位置（`packages/app/src/pages/mode-workspace.tsx` 或 `layout.tsx`）

### Step 2: `/` 重定向到 `/mode/<persistedMode>`

**红**：访问 `/` 重定向到 `/mode/<persistedMode>`（默认 coding）

**绿**：`Routes` 加 `<Route path="/" component={() => <Navigate href={`/mode/${mode.currentMode}`} />} />`

**重构**：确认 `mode.currentMode` persisted 读取（`mode.tsx` 已 persisted）

### Step 3: ModeSwitcher 确认（已符合 ADR-12）

**红**：ModeSwitcher 点击 navigate 到 `/mode/:mode`（确认现状）

**绿**：无改动（`mode-switcher.tsx:36` 已 `navigate(item.href)`）

**重构**：无

### Step 4: slot 不 remount（上提 resource 或 display:none）

**红**：

- 切 `/mode/chat` -> `/mode/coding` 时 `ChatFeatureSidebar` 的 `promptAsset.list` `createResource` **不重取**（call count = 1，spy 验证）
- slot 切换不触发组件 `onMount` 重新执行

**绿**（方案 2 推荐：上提 resource）：

- 把 `assetCount` / `promptAsset.list` `createResource`（`mode-surfaces.tsx:98-102`）从 `ChatFeatureSidebar` 上提到 `ModeWorkspace` 级 provider
- slot 内仅消费 resource（`createMemo` / accessor）
- 或方案 1：render-all + `display:none`（全部 slot 常驻，CSS 切；代价 4× eager 拉取）

**重构**：删 `<Dynamic>` in `home.tsx:475` / `secondary-sidebar.tsx:644` / `session-side-panel.tsx:480`，改 provider 消费或 display toggle

### Step 5: Home 并入 ModeWorkspace + Chat 主区=资产工作台

**红**：

- `/mode/chat` 主区渲染资产工作台（资产树 + 编辑/预览 + 新建/导入）
- `HomeModeCards` 删除（DOM 不含）
- ModeSwitcher 是唯一模式入口
- Coding 主区仍为会话列表（回归不破）

**绿**：

- `ModeWorkspace` 主区 typed slot：`modeSurface(mode).Main`（ModeSurface 新增 `Main` 字段）
- Chat `Main` = 资产工作台组件（资产树 + 编辑/预览，复用 §9.5 资产 tab 机制）
- 删 Home 伪四区（`HomeModeCards` / `HomeProjectColumn` / Dynamic Sidebar），Home 内容并入 ModeWorkspace

**重构**：Home 组件瘦身或删除；`mode-surfaces.tsx` MODE_SURFACES 加 `Main`

### Step 6: secondary-sidebar-route 确认（已 true，no-op）

**红**：`/mode/chat` 时 SecondarySidebar 显示（`secondarySidebarAvailable` 返 true）

**绿**：无改动（`/mode/*` 已返 true），加测试确认

**重构**：无

### Step 7: sessionLoad queryKey + queryFn 去 mode

**红**：

- 切模式 sessionLoad 不重取（queryKey 不含 `mode.currentMode`）
- `records` memo 按 mode 过滤正确（切 chat 显示 chat 会话）
- 不空表（directory 级 store 跨 mode 累积，`server-sync.tsx` loadSessions 写入 directory 级 store）

**绿**：

- `home.tsx:186` queryKey 去掉 `mode.currentMode`
- `home.tsx:190` `loadSessions` 调用去掉 `mode` 入参（服务端拉全量）
- `records` memo（`home.tsx:210-221`）按 mode 过滤（已有）

**重构**：确认 directory 级 store 累积逻辑（`server-sync.tsx:255-311`）；可选 `keepPreviousData` 兜底

## 5. 测试矩阵

| 层 | 测试点 | 工具 | 位置 |
|---|---|---|---|
| 行为 | 模式切换不闪（slot 不 remount + resource 不重取） | `@solidjs/testing-library` + `createResource` spy | `packages/app/test` |
| 行为 | URL `/mode/:mode` 可分享、刷新保留 | `@solidjs/router` testing | |
| 行为 | `setCurrentMode` 响应 params 变（createEffect） | router + mode context mock | |
| 组件 | `ModeWorkspace` 渲染 slot、主区 typed | `@solidjs/testing-library` | |
| 数据 | sessionLoad 不重取（queryKey 去模式） | tanstack-query mock | |
| 集成 | `/mode/chat` -> `/mode/coding` 全链路 | router + testing | |
| a11y | 键盘 focus / ARIA / 对比度 | 手动 + Storybook a11y addon | |
| i18n | 18 locale parity（A4） | 扩展 `parity.test.ts` | `packages/app/src/i18n/` |

## 6. 验收标准

- [ ] 模式切换无闪烁（ModeWorkspace 不 remount + slot 不 remount + queryKey 去 mode）
- [ ] `/mode/chat` 可分享、刷新保留（URL 自带模式）
- [ ] Chat 首页主区 = 资产工作台，会话降为次级，外壳与 Coding 一致
- [ ] i18n 18 locale parity 通过（A4）
- [ ] 窄屏无硬编码 768px，引用 v2 断点 token（A5）
- [ ] `bun --cwd packages/app typecheck` 通过
- [ ] `bun --cwd packages/app test --timeout 30000` 通过
- [ ] `bun run lint` 通过
- [ ] DESIGN.md 合规：稳定尺寸无位移 / 键盘 focus / 明暗主题 / 中英文溢出 / 空加载错误态

## 7. 风险与回滚

- **回滚**：feature flag 控制 ModeRoute 渲染 ModeWorkspace vs 旧 redirect（ADR-15 §灰度思路）
- **风险 1**：会话次级视图形态未定（SecondarySidebar vs 主区 tab）-> Step 5 实施时定（ADR-15 §"明确不决定"已声明）
- **风险 2**：上提 resource 改 ModeWorkspace provider 结构 -> Step 4 评审 provider 边界
- **风险 3**：Home 并入 ModeWorkspace 可能影响 Coding/Work/Assistant -> Step 5 全模式回归测试
- **风险 4**：queryKey 去 mode 后切模式不触发服务端刷新（轻微 staleness，可接受；Core owner 复审已核实 directory 级 store 跨 mode 累积，不空表）

## 8. 实施顺序建议

```
前置项（A1 per-slot 估算 / A4 i18n / A5 窄屏）
  ↓
Step 1-2（ModeRoute 渲染 ModeWorkspace + setCurrentMode createEffect + / 重定向）
  ↓
Step 4（slot 不 remount：上提 resource 或 display:none）-- 治闪烁核心
  ↓
Step 5（Home 并入 ModeWorkspace + Chat 主区=资产工作台）
  ↓
Step 7（sessionLoad queryKey + queryFn 去 mode）-- 治第二闪烁源
  ↓
Step 3 / 6（确认 ModeSwitcher + secondary-sidebar-route，no-op）
  ↓
验收（typecheck / test / lint / a11y / i18n parity）
```

每步独立可提交（小步快跑，CLAUDE.md §盲目修改为耻，以谨慎重构为荣）。Step 1-2 先修闪烁根因（ModeRoute 不 redirect），Step 4-5 落地 Chat 资产工作台，Step 7 收尾 queryKey。
