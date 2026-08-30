# 首页模式卡片就地分流 + chat 功能树联动

## 目标

首页 `/` = 顶部模式卡片（可扩展，后期不止 4 种）+ 下方左右两栏**就地按 currentMode 分流**（不跳 `/mode/:mode`）。

| 模式             | 左侧                        | 右侧                       | 点会话标题                          |
| ---------------- | --------------------------- | -------------------------- | ----------------------------------- |
| coding           | 项目树（保留现有效果）      | 会话列表（关联项目树选中） | 跳 `/server/:k/session/:id`（现有） |
| chat             | 功能树（6 分类 + Location） | 会话列表（按功能分类联动） | 同上                                |
| work / assistant | 占位 PlaceholderSidebar     | 占位                       | —                                   |

## 已确认的产品决策

1. 联动语义：**按功能分类过滤会话**。chat 会话创建时归一个功能分类（默认"提示词"），存入现有 `metadata` JSON 列。功能树选分类 -> 右侧过滤该分类会话。
2. chat Location：**全局默认 + 可加自定义**。默认全局目录（如 `~/.aigcfroge/prompts`），用户可添加自定义物理路径覆盖。
3. `/mode/:mode` 废弃；首页用 `currentMode`（persisted）分流。
4. ModeSwitcher：首页 `/` 隐藏，会话详情页保留。
5. 卡片数据驱动（`MODE_DEFINITIONS` 已是数组）。

## 改动清单

### A. 路由 + 首页就地分流

- `app.tsx`：`/mode/:mode` → 重定向到 `/` 并 `setCurrentMode`（兼容旧深链，不再渲染独立页）。
- `home.tsx`：**去掉 `modeEntry` 双模式**。首页始终显示卡片（顶部）+ 下方按 `currentMode` 分流：
  - 左栏 = `modeSurface(currentMode).Sidebar`（code=项目树 / chat=功能树 / work,assistant=占位）
  - 右栏 = 会话列表（复用现有 `sessionLoad` + `records` + `groups`，按 `currentMode` + 选中项过滤）
  - code 分支保留现有 `HomeProjectColumn` + 联动逻辑不动。
- `layout.tsx`：`ModeSwitcher` 在 `pathname === "/"` 时不渲染。

### B. code 联动（保留）

`selectProject → setSelection(directory) → projectDirectories() → sessionLoad(directory+mode) → records(mode)` 全部不动。

### C. chat 功能树（6 分类 + Location）

- `mode-surfaces.tsx` `ChatFeatureSidebar`：
  - 加"工作流"分类 → 6 分类：提示词/技能/MCP/命令/智能体/工作流。
  - 顶部 Location 选择器（全局默认 + 自定义路径列表）。
  - 选功能分类 → 设置当前 `selectedFeature` → 联动右侧 `records` 过滤。
  - "新建会话"按钮 → `tabs.newDraft({ ..., metadata: { feature: selectedFeature } })`。
- chat Location 列表：新增 persisted store（`context/chat-location.tsx`，复用 `Persist.global`），存用户添加的物理路径 + 全局默认目录标识。与 code `projects` 分开。

### D. metadata 链路打通（chat 联动依赖）

DB `SessionTable.metadata` 列已存在，打通读写（**不加 migration**）：

1. `core/src/session.ts`：`CreateInput` 加 `metadata?: Record<string, unknown>`；`create` 写入 `SessionTable.metadata`（`SessionInfo.make` 补字段或 insert 后 set）。
2. `core/src/session/info.ts`：info 映射加 `metadata`（前端可读）。
3. `aigcfroge/.../handlers/experimental.ts`（或 session-adapter）：create handler 透传 `metadata`（OpenAPI 已定义 request schema）。
4. 前端 `submit.ts` / `tabs.newDraft`：chat 草稿创建时传 `metadata.feature`（默认 `"prompt"`）。
5. `home.tsx` `records()`：chat 模式下追加 `r.session.metadata?.feature === selectedFeature` 过滤；无 feature 的旧 chat 会话视为 `"prompt"`（向后兼容）。

### E. 卡片可扩展

`MODE_DEFINITIONS` 遍历渲染已支持；加模式只加配置项。

### F. work / assistant 占位

`mode-surfaces.tsx` 已有 `PlaceholderSidebar`，保持，后续补。

## 分阶段

1. **P1 骨架**：A（路由 + 首页就地分流 + ModeSwitcher 隐藏）+ F（占位）。保证 code 不回归。
2. **P2 chat 功能树**：C（6 分类 + Location 选择器 + chat Location store）。
3. **P3 chat 联动**：D（metadata 链路打通 + records 过滤 + newDraft 传 feature）。
4. **P4 验证**：app `tsgo -b` + `bun test` + `oxlint`；手测 code/chat 联动 + 会话跳转。

## 影响文件（预估）

- `packages/app/src/app.tsx`、`pages/home.tsx`、`pages/layout.tsx`
- `packages/app/src/components/mode-surfaces.tsx`、`secondary-sidebar.tsx`
- `packages/app/src/context/mode.tsx`、新增 `context/chat-location.tsx`
- `packages/app/src/components/prompt-input/submit.ts`、`context/tabs.tsx`
- `packages/app/src/i18n/{en,zh}.ts`（新增 `chat.feature.workflow` 等）
- `packages/core/src/session.ts`、`session/info.ts`
- `packages/aigcfroge/src/server/routes/instance/httpapi/handlers/experimental.ts`（或 session-adapter）

## 风险

- **metadata 链路**跨 core/httpapi/前端三层，但都接通现有 DB 列，不加 migration，不违反 PRD M1 约束。
- **首页 Home 重构**影响面大：需保证 code 现有项目联动、会话跳转、搜索不回归（P1 后先验 code）。
- **chat Location 独立 store** 是新增轻量持久化，不复用 code projects（语义不同：code 是 git 发现，chat 是用户自定义 + 全局）。
- `records()` 前端过滤依赖 session info 返回 metadata（D-2 打通后可用）；P3 必须在 D-2 之后。
