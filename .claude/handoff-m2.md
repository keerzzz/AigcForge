# M2 实施启动提示词

你作为 AigcForge 高级全栈工程师，需实施 Chat M2：Asset Studio 资产工作室。

M1 已全部闭环（commit `e0700c19f`，分支 `chat-m1-closure`），包括 Phase A-F 核心代码 + flag gate + E2E 测试 + V2 smoke 测试。

## 必读文档（首读）

1. **CLAUDE.md** — 八荣八耻、改完即审 7 步、极致减法、门禁
2. **AGENTS.md** — Effect 编码、Schema、测试规范、自导出模式
3. **DESIGN.md** — v2 Token、UI 性格、a11y、i18n
4. `docs/plan/chat-asset-studio-m2.md` — M2 实施计划（审批通过版）
5. `docs/prd/chat-mode-creation-layer.md` — PRD v4.5
6. `.aigcfroge/skills/effect/SKILL.md` — Effect 编码指南
7. `.aigcfroge/skills/frontend-theming/SKILL.md` — v2 token 指南
8. `packages/app/AGENTS.md` + `packages/aigcfroge/AGENTS.md`

## M2 实施步骤（严格按序，不允许跳过）

每步 TDD：先写测试（红）→ 最小实现（绿）→ 重构（清理）

每步完成后执行**改完即审流程**：
```
1. git diff -- <files>
2. 匹配 Skills（effect / frontend-theming）
3. 安全复查（Catch Everything / No Null Pointer / Security First）
4. 整洁复查（No Cheating / Reusability / Clean Logs）
5. 数据流追踪（每个 Effect Layer 已 provide）
6. 命令验证（typecheck + test + lint）
7. 输出复查结论
```

**下一个小节的先决条件：上一个 Step 全部验证通过。**

### 实施顺序

| Step | 内容 | 包 |
|------|------|----|
| **0** | listInvalid 数据源（core/schema/httpapi）| schema + core + aigcfroge |
| **1** | AssetWorkbench 4 列表格（新增）| app |
| **2** | ChatRightPanel 简化为 Detail Inspector | app |
| **3** | 功能树移除 + ADR-15 slot 合规 | app（删 chat-feature.ts + home.tsx `<Dynamic>` 改 render-all）|
| **4** | Insert 流程 + SessionSelectorPopover | app |
| **5** | 路由状态保持 + Dirty Draft + Provider 提到 Router 外 | app（chat-workspace.tsx 新增）|
| **6** | 全链路集成测试 | app |

### 关键约束（审批定论）

- **不引入** `@solidjs/testing-library`，沿用 `bun:test` + `happydom` preload
- **不做** AssetKind 框架泛化、全局资产写入、外部导入、会话捕获、命令开闸
- 🔴 **坏文件标记** 数据源来自 Step 0 listInvalid，不存在先降级
- **Dirty Draft**：solid-router 无 `beforeRouteLeave`，用 `createEffect` + 确认 Modal
- **ADR-15 合规**：`home.tsx:461` `<Dynamic>` → `render-all + display:none`
- **ChatWorkspaceProvider** 必须挂 Router 之上（app.tsx router 层之外）
- **新组件必须用 v2 token**（`--v2-*`，遵循 frontend-theming skill）
- **新 Effect 代码**：`Effect.gen(function*(){})` + `Effect.fn("Name")` + `Schema.TaggedErrorClass`（遵循 effect skill）

开始 Step 0。
