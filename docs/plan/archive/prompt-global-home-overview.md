# 全局聚合首页 · TDD 执行提示词（自包含手册）

> **用途**：粘贴到新对话作为初始 prompt，驱动独立 agent 完整执行 [Global Home Overview 实施计划](global-home-overview.md)（步骤 1–10）。
> **来源**：[实施计划](global-home-overview.md)（范围真源）、[ADR-15](docs/architecture/adr/ADR-15-mode-workspace-main-area-slot.md)（slot 契约）、[ADR-12](docs/architecture/adr/ADR-12-product-mode-entry-routing.md)（路由契约）、[审批记录](global-home-overview.md) §12（有条件通过，A 类已修正、B 类已锁定）
> **分支**：`global-home`（从最新 `main` 切出）
> **完成标准**：计划 §9 测试全绿 + `typecheck` 绿 + `docs/review/` 验收记录 + 汇报清单（§12）

---

<!-- PROMPT START -->

你是 AigcForge 项目（工作目录 `/media/keer/办公/aigcfroge`）的高级全栈工程师。本提示词让你**独立、端到端**执行 [Global Home Overview 实施计划](docs/plan/global-home-overview.md)（步骤 1–10，含 §12 审批约束）。范围真源是那份计划，本提示词是执行手册。

## 0. 强制首读（写任何代码前必须精读；每小节开工前重读对应文档）

**协议文档（按顺序）**：

1. `CLAUDE.md` — 宪法（四绝八耻、四大拒绝、以认真查询为荣、以主动测试为荣、改完即审）
2. `AGENTS.md` — 根规范（分支提交、import 自导出、禁 star/alias import、Effect、Schema、Testing、代码风格）
3. `packages/app/AGENTS.md` — app 包约束（**NEVER restart the app or the server process, EVER**；本地 dev 双起方式；SolidJS createStore 优先）
4. `ARCHITECTURE.md` §4.10 — ModeWorkspace 架构
5. `DESIGN.md` — 产品性格、v2 token（首页 UI 沿用 v2 token 体系）
6. `docs/architecture/adr/ADR-12-product-mode-entry-routing.md` — §2 导航控件契约 / §4 canonical route（**ADR-16 不得违反**）
7. `docs/architecture/adr/ADR-15-mode-workspace-main-area-slot.md` — slot 契约（**首页为独立路由组件，非 ModeWorkspace slot**）
8. `docs/plan/global-home-overview.md` — **本计划全文**（§1 目标 / §2 现状实证 / §5 文件清单 / §6 函数级细节 / §9 测试 / §10 TDD 步骤 / §12 审批记录）

**范式参考代码（读源码，不猜接口）**：9. `packages/app/src/pages/home.tsx` — HomeSessionRow/Search/GroupHeader/HomeProjectRow 组件契约（复用对象）10. `packages/app/src/pages/mode-workspace-slots.tsx:287-305` — openSession 逐行对照（**共享函数迁移模板**）11. `packages/app/src/utils/session-placement.ts` — onSet 签名（**步骤 5 必须改此文件类型与传参**）12. `packages/app/src/pages/home.test.ts` + `packages/app/src/pages/mode-workspace.test.tsx` — 测试风格基准

## 1. 目标（摘自计划 §1.2，产品已确认）

```text
/            → 全局聚合首页（会话列表 + 筛选 + 记忆置顶），不再重定向
/mode/:mode  → 各模式首页（路由不变，coding 入口与 chat/work 一致保留）
顶栏左侧     → 主页 icon 按钮（href /），全局可见
rail         → 纯模式切换，不新增按钮
首页点击会话 → 跳转会话详情页，并同步 currentMode = 会话 mode
```

**范围**：`packages/app` + `packages/ui`（仅 `icon.tsx` 新增 `home` 图标）+ `docs/`（ADR-16 + 验收记录）。**SDK / core / server / DB 零改动**（计划 §3 已实证）。**不解决**会话列表 icon 与项目 icon 的 "C" 差异问题（另立议题）。

## 2. 当前状态（已核实，禁止推翻重查）

- 分支基线：`main` 最新；本任务分支 `global-home`（≤3 词，无类型前缀）
- 计划已审批：**有条件通过**（docs/plan/global-home-overview.md §12）——A-1/A-2/A-3 已修正进正文，B-1/B-2/B-3 决策已锁定，直接按正文执行
- 已实证接口（计划 §2 表格）：`layout.route()` 对 `/` 返回 `{type:"home"}`（app.tsx:126）；`useChatDirectory` 为纯 hook 无 provider 依赖；`sessionPlacement.onSet` 签名 `(server, directory)` 需扩展 leafID（session-placement.ts:9,32）；`ProductMode = "chat"|"coding"|"work"|"assistant"`（types.gen.ts:160）；icon.tsx 无 `home` 图标

## 3. 红线（违反即失败）

1. **不新增第二实现**：会话列表/搜索/项目行全部复用 home.tsx 导出组件；打开会话走共享 `openSessionRecord`（helpers.ts），`CodingSessionListMain.openSession` 迁移后行为逐行一致
2. **不改 SDK/core/server/DB**（计划 §3 分层表）
3. **不动用户正在运行的进程**（packages/app/AGENTS.md：NEVER restart the app or the server process）；手动验收若需 dev server，用独立端口双起（backend `--port 4096` + app `--port 4444`），且**起前确认无冲突、用完即停**；无法验证的手动项如实记录"待审批者代验"，禁止假验收
4. **i18n parity**：新增 key 必须 18 语言全量补齐（parity.test.ts 强制），不得只在 en.ts 添加
5. **lint/typecheck 纪律**：新代码零 warning；禁 `as any`/`@ts-ignore`/无理由非空断言；SDK 边界 cast 用 `// oxlint-disable-next-line ... -- 原因` 豁免并注释

## 4. 五层代码验证（执行前逐条 grep 核对，结果记入最终汇报）

```bash
# L1 UI（复用对象与契约）
grep -n "export function HomeSessionRow\|export function HomeSessionSearch\|export function HomeProjectRow" packages/app/src/pages/home.tsx
grep -n "function openSession\|sessionPlacement.set" packages/app/src/pages/mode-workspace-slots.tsx
grep -n "onSet" packages/app/src/utils/session-placement.ts packages/app/src/context/global.tsx

# L2 路由/外壳
grep -n "HomeRedirect\|path=\"/\"" packages/app/src/app.tsx
grep -n "location.pathname !== \"/\"" packages/app/src/pages/layout.tsx
grep -n "route.type === \"home\"" packages/app/src/components/titlebar.tsx

# L3 SDK（只读验证，不改）
grep -n "type ProductMode" packages/sdk/js/src/v2/gen/types.gen.ts
grep -n "mode?" packages/sdk/js/src/v2/gen/types.gen.ts | head -5

# L4/L5 Core/Server（只读，确认无需改动）
grep -rn "loadSessions" packages/app/src/context/server-sync.ts | head -5
```

## 5. TDD 工作流（每小节强制 RGR 循环）

每步：**R（Red）先写测试并确认失败 → G（Green）最小实现 → R（Refactor）重构**。每小节开工前重读计划 §10 对应行的「协议阅读」列，输出中引用所读文档结论。

| 步骤 | 交付物                                                                                                            | 红绿灯（测试先行）                                                                                                                    |
| ---- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `docs/architecture/adr/ADR-16-global-home-overview.md`（Amends ADR-15，契约见计划 §8）                            | 文档评审（无测试）                                                                                                                    |
| 2    | i18n：en.ts 先加 key → parity 红 → 18 文件补齐 → parity 绿                                                        | `bun --cwd packages/app test --preload ./happydom.ts ./src/i18n`                                                                      |
| 3    | `packages/ui/src/v2/components/icon.tsx` 新增 `home`（16x16 stroke 风格对照 `mode-chat`）                         | 手动（无测试先例）                                                                                                                    |
| 4    | `pages/home-overview-model.ts` + `home-overview-model.test.ts`（countByMode/pinLastActive 全分支）                | 纯函数测试红→绿                                                                                                                       |
| 5    | `utils/session-placement.ts` onSet 扩 leafID + `context/global.tsx` `lastActiveSession`（persisted + onSet 写入） | 8 处 `sessionPlacement.set` 调用点 grep 核对零改动 + typecheck                                                                        |
| 6    | `helpers.ts` `openSessionRecord` + `CodingSessionListMain.openSession` 迁移（含首页 `setCurrentMode` 参数位）     | 迁移后现有测试（home.test.ts / mode-workspace.test.tsx）保持绿                                                                        |
| 7    | `pages/home-overview.tsx`（左筛选列 + 右会话列表 + 置顶组 + `components/session-mode-badge.tsx`）                 | `home-overview.test.tsx` 存在性+导出断言红→绿                                                                                         |
| 8    | `app.tsx` `/` → `<HomeOverview/>`（删 HomeRedirect）+ `titlebar.tsx` V2 分支插主页按钮                            | 手动验收（路由/外壳）                                                                                                                 |
| 9    | `mode-workspace.tsx:140-145` chat 网格 `max-w-[1080px] lg:grid-cols-[280px_minmax(0,960px)]`                      | 手动（样式）                                                                                                                          |
| 10   | 全量验证 + `docs/review/global-home-overview-review.md` 验收记录                                                  | `bun --cwd packages/app test --preload ./happydom.ts ./src`（**首次全量，勿用 --only-failures**）+ `bun --cwd packages/app typecheck` |

**提交规范**：每步独立提交，conventional 前缀 `feat(app):`（ui 图标用 `feat(ui):`、文档用 `docs:`），push 前不跳过 typecheck hook（若需快速迭代可用 `AIGCFROGE_SKIP_TYPECHECK=1`，最终提交前必须真实跑过）。

## 6. 关键实现约束（摘自计划 §6，防止跑偏）

- `pinLastActive`：`pathKey` 归一目录比对；未命中（归档/不存在）返回无置顶，不得静默丢 rest
- 模式徽标：`mode === undefined` 归 coding（D3，与 `filterSessionsByMode` 语义一致）
- 模式同步：仅 `isMode(session.mode)` 时 `setCurrentMode`（undefined 不强改当前模式）
- 左列项目行：**复用 `HomeProjectRow` 全量**（含菜单；`openNewSession`/`editProject`/`closeProject` 等 props 按 `CodingProjectColumnSidebar`（mode-workspace-slots.tsx:67-109）同款逻辑提供）——B-1 已锁定
- 首页搜索：`bindFocus` 传空函数（mode-workspace-slots.tsx:351 先例）
- 首页数据：focusedServer 聚合（D5）；`projectDirectories` 未选项目时展开全部 projects（worktree + sandboxes）；并发 `loadSessions` 上限 `HOME_SESSION_LIMIT`=64
- 顶栏按钮：`IconButtonV2` + `IconV2 name="home"`，`navigate("/")`，pathname 为 `/` 时隐藏；aria-label 用新 i18n key

## 7. 手动验收清单（步骤 10；无法验证的如实标"待审批者代验"）

1. `/` 渲染聚合首页（不再跳到 /mode/coding）；刷新 `/` 停留首页
2. 左列模式筛选计数正确、点击过滤右侧；项目行点击过滤、菜单可管理项目
3. 「继续上次」置顶组：打开某会话 → 回首页 → 该会话置顶第一；归档/不存在时无置顶组
4. 点击会话（含跨模式，如 coding 页面点 work 会话）→ 进入会话详情页，次级侧栏与该会话模式匹配（无 mismatch 提示）
5. 顶栏左侧主页 icon 在会话页/模式页可见，点击回 `/`；`/` 页顶栏按钮隐藏
6. chat 模式首页不再全宽（收敛 max-w-[1080px]）
7. 会话行显示模式徽标；搜索框跨项目搜索带项目名

## 8. 最终汇报（提交审批者前必须包含）

1. 分支名 + 提交列表（每步对应 commit hash）
2. 五层 grep 核对结果（§4 命令输出摘要）
3. 测试结果：`packages/app` 全量测试 + typecheck 输出（含 pass 计数）
4. 手动验收记录：§7 每项 ✅ / ⚠️（附原因）+ `docs/review/global-home-overview-review.md` 路径
5. 与计划不符的偏离点（如有）：文件/行为/理由——**禁止静默偏离，发现即停并汇报**

完成以上全部（或如实标记未决项）后，把本汇报交给审批者。

<!-- PROMPT END -->

---

## 使用说明（粘贴前检查）

1. 分支切换：执行前确认 `git checkout main && git pull && git checkout -b global-home`（提示词已含，但粘贴者确认分支名无冲突）
2. 手动验收若用户桌面 dev 占用 4096/4444 端口，执行 agent 应改用其他端口或标记"待审批者代验"（红线 3）
3. 执行中 agent 每完成一个步骤应汇报进度；审批者（本轮会话）可在关键节点介入审批
