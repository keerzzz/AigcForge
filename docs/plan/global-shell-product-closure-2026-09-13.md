# 全局壳与五模式产品闭环实施计划（2026-09-13）

> **状态**：TECHNICALLY APPROVED WITH CHANGES / OWNER EXECUTION GATE PENDING；本次审批批准技术方向与分阶段实施计划，但不替代 Owner 对未提交工作区、分支、提交、推送、PR、迁移和生产发布的单独授权。
> **事实截止**：2026-09-13（Asia/Shanghai）。实施开工时必须重跑 Slice 0，不能把本文中的测试数量当永久常量。
> **直接事实源**：[`docs/review/global-shell-e2e-2026-09-10.md`](../review/global-shell-e2e-2026-09-10.md) §10–§20、当前 worktree 代码与测试、`CLAUDE.md`、`AGENTS.md`、`ARCHITECTURE.md`、`CONTEXT.md`、`DESIGN.md`、`docs/testing.md`、`specs/v2/session.md`、ADR-11–22、各模式 PRD/页面文档与 `.aigcfroge/skills/`。
> **前序计划关系**：[`global-shell-remediation-2026-09-11.md`](global-shell-remediation-2026-09-11.md) 已完成顶部标签、底部状态栏和 Chat 左栏的实现切片；本计划不重做其 CLOSED 项，只承接最新 E2E 报告中的真实执行、产品身份、路由恢复、模式闭环与交付环境缺口。
> **建议实施分支**：`shell-product-closure`（三词、连字符、无类型前缀）。当前 `global-shell-e2e` worktree 有未提交用户改动；未经 Owner 明确确认，不切分支、不搬移、不暂存、不覆盖这些改动。

---

## 0. 审批摘要

详细报告摘要、代码地图、文档漂移和方案对冲已移至[调研归档](archive/global-shell-product-closure-research-2026-09-13.md)。审批只需抓住以下事实：

- 2026-09-13 复跑 discovery 仍为 `50 files / 198 tests`；这是发现基线，不是通过结果。历史完整基础 Chromium 为 `179/188`，本次没有 `198/198` 全量绿色证据。
- **本轮审批新增的三处代码事实纠偏**（详见 §0.1、§13.1、§12.1）：`createCurrentSessionSource()` 并未暴露 `SessionV2.Info`，底栏今天不显示任何权限状态；`AssistantSchedulerDaemon` 不是代码符号，生产守护是 `daemonLayer`/`daemonNode`；`WorkArtifact` 确认为内存态 + 非 durable 事件，全仓无对应表。计划原稿这三处措辞已修正，实施时不得回退到旧措辞。
- App regression 主要依赖 `mockAigcfrogeServer`，属于 E3；真实 provider、durable Session、File、PTY、restart 和 Electron 尚未成为 E4 门禁。当前仓库也没有 `test:e2e:real` script 或 `chromium-real` project，计划后续命令已按显式 config 方式修订。
- 根因顺序是：证据层 → 身份/恢复层 → 模式业务层 → Desktop 交付层。不能继续用增加 mock 数量代替真实闭环。
- 当前分支为 `global-shell-e2e`，相对 `origin/main` 为 `ahead 9 / behind 0`，worktree 含用户未提交改动；未经 Owner 明确授权，不切分支、不搬移、不暂存、不覆盖、不提交、不操作远程 Issue。
- 代码事实纠偏：产品默认模式是 `coding`；Custom capability 的协议字面值是 `product-mode-custom-v1`；五模式已实现但 Custom 默认关闭；Chat 已有七类资产。

### 0.1 本轮新增 UI 调研结论

1. 输入框上方的“权限档位 / 提议 / 完整”来自 `PermissionTierSelector`（`packages/app/src/pages/session/composer/permission-tier-selector.tsx:8`，渲染于 `session-composer-region.tsx:294`，是 `PromptInput`（同文件 `:363`）的前置兄弟节点），它不是运行时权限请求。写入路径在父组件：草稿走 `tabs.updateDraft(..., { permissionTier })`（`session-composer-region.tsx:207`），既有会话走 `client.session.update({ sessionID, permissionTier })`（`:213`），新建会话由 `prompt-input/submit.ts:411` 带入 `session.create`。真正阻塞用户的授权请求由 `SessionPermissionDock`（`session-permission-dock.tsx:8`，仅在 `permissionRequest()` 存在时渲染于 `:281`）显示；break-glass 由 `SessionPermissionOverrideControl`（`session-permission-override-dialog.tsx:15`，渲染于 `:297`）管理，客户端 30s renew（`:7`）对应服务端 60s lease（`packages/core/src/permission/session-override.ts:14`）。
2. 全局底部已有 `StatusBar`（`packages/app/src/components/status-bar/status-bar.tsx:70`，挂载于 `pages/layout.tsx:61`）。**事实纠偏**：`createCurrentSessionSource()`（`current-session-source.ts:18`）当前**不**暴露 `SessionV2.Info`；它内部读的是 global-sync 里生成的 SDK `Session` 记录（`current-session-source.ts:64-68`），而 `StatusBarSource`（`status-bar/types.ts:19-32`）只对外给 label/connection/model/cache/metrics/openContext，没有任何 session-info 访问器，`MetricGroup`（`metrics.ts:1`）也没有 permission 分组——底栏今天完全不显示权限状态。可用的事实是：该 SDK `Session` 记录本身已带 `permissionTier`（`packages/sdk/js/src/v2/gen/types.gen.ts:274`）与 `attended`（`:273`），所以 S6 的工作是给 `StatusBarSource` 增加权限投影字段并接上 ADR-23 projection，不是“已能读取，只需搬位置”。
3. 输入框内已有 `ComposerAgentControl`（`packages/app/src/components/prompt-input.tsx:1841`，渲染于 `:1636`）。**事实纠偏**：它自身不调用 `local.agent.list()`，只渲染 `props.state.options`（`:1850-1852`）；调用点在 `session-composer-region.tsx:131`，经 `controls.agents.options`（`:135`）注入。设置项的确切键路是 `general.showCustomAgents`（`packages/app/src/context/settings.tsx:38`），经 `settings.visibility.customAgents`（`:288-295`）流入 `session-composer-region.tsx:138` 的 `visible`，而 `showAgentControl`（`prompt-input.tsx:1438`）把 `visible` 与整个控件的渲染绑在一起（`:1635-1637`）——关闭后整个 picker 从 DOM 移除，确认为待修缺陷。`local.agent.list()`（`context/local.tsx:70-93`）已过滤 `mode !== "subagent" && !hidden`（`:71`）并按模式裁剪 orchestrator（`:78-92`）；但 custom 分支只剥 orchestrator、**不**收窄到 `meta`，`meta` 限制只存在于服务端 `product-mode-agent-policy.ts:125-135`。因此 S6 必须让客户端 picker 与该服务端 allowlist 同源，不能把“解除隐藏”误当成合法 Agent 暴露，也不另建 Agent 列表。
4. 归位原则：默认 `propose` 不制造常驻噪声；`full` 和 break-glass 等权限扩大态在底部显示醒目状态并可进入控制面。实时 permission request 仍留在 Composer 上方，因为它是当前提交的阻塞交互，不是背景状态。`permissionTier` 只是声明档位，不等于最终授权；最终效果必须继续由 `PermissionEffective` 与既有 override/grant owner 判定。

### 0.2 本次技术审批结论（2026-09-13）

**审批结论：APPROVED WITH CHANGES。** 本计划的根因收敛、E1–E4 证据分层、只读投影方向、fail-closed 原则和分阶段交付方式可以进入实施；但必须先吸收本次修订，尤其是以下硬条件：

1. **不把未批准产品范围伪装成已批准能力**：Work 不在本计划内新增 Work-side 自定义 Preset 持久化；Assistant M1 只把单次 Reminder/Delivery 作为硬门，Memory/KB 归入独立 M2 gate，除非 Owner 先批准相应 PRD/ADR amendment。
2. **不改变 V2 Session 的安全边界**：`specs/v2/session.md` 明确延后的“provider-dispatch ambiguity”不能被本计划改成自动重试。E4 只验证安全重启点、显式 resume 和 durable projection；不声称已实现 post-crash continuation。
3. **权限语义不得混淆**：投影同时表达声明的 `permissionTier`、由既有 `PermissionEffective` 计算的有效状态和 override 可见性；App 不复制授权算法，也不把 break-glass lease 变成第二真源。
4. **所有命令必须真实可执行**：当前没有 `packages/app` 的 `test:e2e:real` script、`chromium-real` project，也没有 `packages/server` 的 test script；S2 先落地 real config/fixture，最终门禁使用显式 `test:e2e --config ...`，删除不存在的命令。
5. **技术审批不等于 Git/远程授权**：当前脏 worktree 保持原样；S0 可做只读基线，后续代码修改、迁移、分支、commit、push、PR 和远程 Issue 仍按 Owner gate 执行。
6. **命令必须运行真实门禁入口**：`packages/app` 的 `test` 脚本是 `test:unit && test:virtualizer`，而 `test:unit` 必须带 `--conditions=browser --preload ./happydom.ts` 且 `bunfig.toml` 把 `[test].root` 钉在 `./src`。已核验 `bun --cwd packages/app test --timeout 30000` 展开为 `bun run test:unit && bun run test:virtualizer --timeout "30000"`——额外参数只落到第二段，第一段（76 个 `src` 单测文件）不受 `--timeout` 影响，且 `test-browser/` 下的两个文件永远不在 `[test].root` 的发现范围内。因此本计划全量命令改用 `bun --cwd packages/app test`，与 CI 的 `bun turbo test` 同一入口。

本次已核验的只读证据：2026-09-13 复跑 Playwright discovery 仍为 `Total: 198 tests in 50 files`；分支相对 `origin/main` 为 `ahead 9 / behind 0`；`packages/app/e2e/real` 目录不存在、`playwright.config.ts` 只定义 `chromium`/`chromium-dark`/`chromium-zh`/`chromium-zht`/`chromium-narrow` 五个 project、`packages/server` 只有 `typecheck` 脚本；`packages/core/script/migration.ts:18,23` 确认支持 `--check`；`packages/sdk/js/script/build.ts` 存在；`.aigcfroge/skills/protocols/scripts/check-refs.sh` 存在且校验 32 条路径。其中 App 的 `permission-tier-selector.test.tsx` 用 `fs.readFileSync` 读自身与四个相邻源文件做 `toContain` 断言（无 DOM、无 testing-library），只能作为弱证据，实施时必须替换为行为测试。

---

## 1. 审批前裁决（D1–D8）

### D1. E2E 发布分层

建议批准四层证据模型：

- **E1**：纯函数/Schema/领域单测。
- **E2**：服务/API 集成，真实 DB/文件/进程，浏览器外。
- **E3**：Playwright + 精确 mock，验证 UI 与请求契约。
- **E4**：Playwright/Electron + 隔离真实 backend/DB/workspace/PTY + 确定性 provider，验证产品生命线。

E3 不得替代 E4；外部付费 provider 不进入默认 CI。Custom kill switch 未打开时，E4 的正确证据是 typed-gate 负向路径，不是假阳性 happy path。

E4 的“重启恢复”必须按安全边界分层：可测试的是 admission 前、durable admission 后尚未 dispatch、以及用户显式 `run/resume` 从 durable projection 继续；provider 已 dispatch 但结果不确定的窗口属于 `specs/v2/session.md` 明确延后的能力，不得用自动 retry 或固定等待把它伪装成已闭环。

### D2. SessionProductIdentity 是只读投影，不是第二 Session 表

建议新增 schema 中的 discriminated projection，形状在 Slice 1 ADR 定稿：

```text
common:
  sessionID, mode, location, projectID, agent, model
  permission: declaredTier + effectiveState + overrideState（均为只读投影）
  capability: ready | blocked | degraded + typed reasons/recovery
mode detail:
  coding: vcs/worktree identity（可迟到）
  chat: asset/session scope（不复制资产正文）
  work: preset/contract/revision + artifact/review summary
  assistant: personal|project scope + projectRef? + reminder/memory/KB health
  custom: profileRef/revision/digest + snapshot version + runtime policy health
```

组合 endpoint 只读各 owner；缺失数据必须表达为 typed `missing/degraded`，不能用空字符串或 inferred default 掩盖。`permissionTier` 不得取代 `PermissionEffective.evaluate`；projection 只能调用既有有效权限、Session override、saved approval owner，并返回脱敏摘要。HTTP transport 归现有 `packages/aigcfroge/src/server/routes/instance/httpapi` group/handler；不得因为 projection 新建平行 `packages/server` 业务 owner。

### D3. Work 任务合同必须显式版本化

建议将 `presetCategoryId` 降为兼容字段，新增耐久 Work contract identity：preset/workflow ID、owner revision 或 catalog digest、contract schema version、output spec、创建来源。无 preset 的 Work Session 必须被明确标为 `ad-hoc`，Artifact 空态不能继续假定“基于预设”。revision 必须来自 Preset/Workflow owner，不能由 App 在 prompt 或 localStorage 中拼出来。

**这条裁决的实现成本必须先看清**：`WorkflowAsset` 已有真 revision（YAML 字节 SHA-256），可直接复用；但官方 `WorkPreset` 目前**没有**任何 revision/version/digest 字段，`presetCategoryId` 也只是 session 表 JSON `metadata` 里的一个键，不是列。所以 D3 对 Preset 侧是"新增 schema 字段 + 决定 catalog digest 的计算 owner"，对 `presetCategoryId` 侧只是文档降级。详见 §12.1 的代码事实清单。

Work PRD 当前明确把“Work 内部自定义 Preset 资产的直接创建与持久化”列为非目标。因此本次审批只批准：Work 消费已有的版本化 `WorkPreset`/`WorkflowAsset`，并为一次执行冻结 contract snapshot；不批准新增 Work-side preset store。若产品要允许用户创建预设，必须先 amendment ADR-13/14 与 Work PRD，并复用 Chat/Workflow 的既有资产真源，不得另建平行存储。

### D4. Assistant scope 必须成为服务端合同

建议把 Assistant 会话/Reminder 能力范围明确为 `personal | project(projectID/location)`；Schedule/Delivery 保留现有 owner，但查询、创建和 Header 都由同一 scope contract 约束。`personal_memory` 表**刻意**跨项目（表头注释自述 "Cross-project by design — no project foreign key"），KB 只有一个 `scope` 文本列且 project 归属靠目录约定、无稳定 project identity 列（细节见 §13.2）。因此在迁移和安全评审完成前，projection 对这些能力必须返回 `unsupported/degraded`，不能由 App 固定写 `global` 后再靠页面 Tab 解释。注意"无 project scope"对 PersonalMemory 是**设计意图**而非疏漏，M2 若要加 scope，必须先推翻或修订该设计注释所代表的决策，不能当成补洞。Assistant PRD 已把 Memory/KB 放在 M2，本计划不得把它们偷偷升级为 M1 发布条件。

### D5. Custom rollout 不与 Custom 架构重写绑定

保留 `mode="custom" + immutable snapshot`、`createCustom` 原子创建、upgrade 生成新 Session 的现有架构。实现只补：

- capability/runtime gate 的统一投影；
- blocked 原因与恢复动作；
- 真实 gate 负向 E4；
- 在获准环境中的 plan→freeze→start→snapshot→reload E4。

Profile 生命周期、Session snapshot 生命周期和 live runtime registration 生命周期必须分开验收。Profile 删除不删除被引用资产或历史 snapshot；内容型资产在冻结快照中可重放的，不得因源文件后续删除而一律阻断；实时工具、MCP 授权、tool fingerprint/catalog digest 漂移仍必须 fail closed。不实现 Session 运行中的热插拔，不把每个用户模式加入 `ProductMode.ID`。

### D6. 路由必须 fail closed

未知 server、未知 Session、parent 404、malformed key 均显示 typed error + 可恢复动作；绝不静默切到当前 server。实现必须移除 route resolver 中的 `data!`、裸 `catch {}` 和当前 server fallback；完整 leaf/root/Location 校验前不得写 placement/tab。Legacy redirect 保留显式声明的 query/hash 白名单字段；`prompt` 水合后使用 replace 清理 URL，且 Dirty Guard 不阻断这次内部清理。现有 E3 对 404 的“空白且无错误页”断言属于待修复缺陷，不能当作通过标准。

### D7. 窄屏保留能力而非复制页面

Work Artifact、Assistant panel、Custom composition、Coding review/files 使用现有 Session typed side panel 作为内容 owner；窄屏只新增共享的 tab/drawer/navigation contribution，不复制请求、store 或业务组件。

### D8. Desktop 是独立发布 Gate

Web 390px/200% 只能证明响应式布局。Electron sidecar、IPC、native picker、deep link、menu/shortcut、update、notification、WSL、window state、native zoom/DPI 必须由 Desktop smoke/人工矩阵单独签字。

---

## 2. 范围、非目标与依赖图

### 2.1 本计划内

- 真实 backend E4 harness、确定性 provider、真实 file/PTY、清理与证据保留。
- 当前基础 Chromium 全套稳定化与状态隔离；presentation matrix 去业务重复化。
- Session/Product identity + capability read projection。
- canonical/legacy/Draft/unknown route fail-closed、恢复与 query 隐私。
- 共享窄屏 side-panel 入口与 a11y。
- Home/Project/Location 生命周期与路径别名/失效处理。
- Work 合同→产物 revision→保存/导出→review/rollback 最小闭环。
- Assistant M1 scope→reminder/Delivery 生命周期最小闭环；Memory/KB 仅在独立 M2 contract/migration/security gate 获批后实施，不默认成为本计划的 M1 放行条件。
- Custom gate 与获准环境中的 snapshot 生命周期闭环，区分 Profile、immutable snapshot 与 live runtime drift。
- Electron/Desktop 核心 smoke、offline/reconnect、附件/导出、安全/a11y/视觉/性能门禁。
- ADR、PRD、Architecture、Context、technical debt、review report 同步。

### 2.2 非目标

- 不重做前序计划已 CLOSED 的 Tab/StatusBar/Chat 三区。
- 不用真实外部 provider 作为默认 CI 条件。
- 不一次实现全部未来团队共享、市场、跨设备同步。
- 不实现 Custom 运行中原地热插拔。
- 不把 Work-side 自定义 Preset 持久化或 Assistant M2 Memory/KB 偷渡为未审批范围。
- 不把所有 198+ 业务用例机械复制到五 presentation projects。
- 不以 retry、固定 sleep、扩大 timeout 隐藏竞态。
- 不在本计划中部署生产、发布版本或迁移用户数据；部署另行审批。

### 2.3 执行图与并行分支

```text
S0 基线冻结
  ├─> S1 ADR/Schema 契约
  └─> S2 E4 harness + coverage manifest
         ├─> S3 全套稳定化
         ├─> S4 路由 fail-closed
         └─> S5 真实 Session/File/PTY 生命线
S1 + S5
  ├─> S6 Identity/Capability projection + Header
  │      ├─> S7 窄屏共享 panel
  │      ├─> S8 Home/Project/Location
  │      ├─> S9A Work 闭环
  │      ├─> S9B Assistant 闭环
  │      └─> S9C Custom 闭环
  └─> S10 网络/附件/安全恢复
S3–S10
  ├─> S11 Desktop/跨平台 + a11y/视觉/性能
  └─> S12 文档同步、全量终审与交付
```

S9A/S9B-M1/S9C 可在不同分支/PR 并行，但必须基于已合并的 S1/S2/S6；S9B-M2（Memory/KB）只有在单独 contract/security gate 通过后才可启动。各分支不得同时编辑共享 schema、Session Header 或 E4 harness。

---

## 3. Slice 0：冻结事实基线与保护工作区

### 3.1 入口动作

1. 记录 `git status --short --branch`、`git diff --stat`、untracked 清单；当前报告、technical debt、UI dialog 与新增 E2E 文件均视为用户工作，禁止 reset/clean/stash。2026-09-13 已核验的脏工作区为 10 个 modified（`CONTEXT.md`、ADR-15、`pages/chat.md`、`pages/work.md`、前序 remediation 计划、E2E 报告、`docs/technical-debt.md`、`custom-builder-states.spec.ts`、`e2e/utils/mock-server.ts`、`packages/ui/src/context/dialog.tsx`）+ 12 项 untracked（本计划、`docs/plan/archive/` 与 10 个新 regression spec）。注意 `packages/ui/src/context/dialog.tsx` 的改动意味着 `packages/ui` 也进入受影响包，全量命令必须包含它。
2. 确认目标基线为 `main`/`origin/main`（已核验 `ahead 9 / behind 0`），记录 HEAD、merge-base、Bun/Node/Playwright/Chromium 版本和 OS。注意 CI 把 Node 钉在 `24.15`（`.github/workflows/test.yml`：`Playwright 1.59 hangs while extracting Chromium with Node 24.16`），本机版本若不同需记录差异。
3. 从 `packages/app` 运行 discovery，记录 `N0 files / N0 tests`；2026-09-13 复核为 `Total: 198 tests in 50 files`（注意 `find e2e -name "*.spec.ts"` 得 56，差额来自 `performance/**` 被 `playwright.config.ts:25` 默认忽略——不要把这两个数字混用）。若不等于 50/198，先解释增减来源。
4. 对当前 198（或 N0）执行一次基础 Chromium、一次随机/反序顺序复跑；保存 trace/video/report，不用 retry。
5. 记录 production benchmark 基线。依据逐字为 `packages/app/AGENTS.md:4`："Before changing session or timeline code, record a production benchmark baseline and compare it after the change." 本计划的 S5/S6/S9A 都会碰 session 代码，所以这是硬前置。`test:bench` 展开为 `bun test ./e2e/performance/unit && playwright test --config e2e/performance/playwright.config.ts`，其中该 config（`:17-19`）用 `bun run build && bun run serve` 起 **production** 构建且 `reuseExistingServer: false`、`workers: 1`——符合 `e2e/performance/AGENTS.md` 的"Run benchmarks against production builds"与"Run benchmarks serially"。`AIGCFROGE_PERFORMANCE_TRACE_DIR` 由 `e2e/performance/chrome-trace.ts:22` 消费，确认有效。注意基础 `playwright.config.ts:25` 默认整体忽略 `performance/**`，两套套件产物目录也已分开（`outputDir: ../test-results/performance`）。

### 3.2 基线命令

```bash
(cd packages/app && bunx playwright test --list --project=chromium)
bun --cwd packages/app test:e2e:local --project=chromium --workers=1 --retries=0
AIGCFROGE_PERFORMANCE_TRACE_DIR=/tmp/aigcfroge-shell-closure-baseline bun --cwd packages/app test:bench
bun --cwd packages/app typecheck
bun --cwd packages/app test   # 展开为 test:unit && test:virtualizer，不传额外参数
bun --cwd packages/desktop test
bun --cwd packages/desktop typecheck
```

**两个命令陷阱（本轮复审实测，写法不可自由变形）**：

1. **`--cwd` 后面不能加 `run`**。`docs/testing.md:10` 已记录：`bun --cwd <pkg> run <script>` 会打印 `bun run` 的 usage、**什么都不执行、且 exit 0**（bun 1.3.14；本轮以 `bun --cwd packages/app run test` 复现确认）。这是"绿了但没跑"的静默陷阱，并且有真实门禁：`script/lint-changed.ts` 经 `findBadBunCwdRun`（`packages/script/src/changed-lines.ts:133` 的 `BAD_CWD_RUN` 正则）扫 Markdown 新增行——但 `COMMAND_GATE_EXEMPT_PATHS`（`:185`）**豁免了 `docs/plan/`**，所以本计划里写错不会被拦，照抄的人会中招。唯一正确形式是 `bun --cwd <pkg> <script>`（CI 同形，`test.yml`/`storybook.yml` 均无 `run`），或 `cd packages/<name> && bun run <script>`。
2. **app 的 `test` 不接受额外参数**。`bun --cwd packages/app test --timeout 30000` 展开成 `bun run test:unit && bun run test:virtualizer --timeout "30000"`——`--timeout` 只落到第二段，第一段的 76 个 `src` 单测文件完全不受影响。且 `packages/app/bunfig.toml` 把 `[test].root` 钉在 `./src`，`test-browser/` 下的 `solid-virtual.test.ts` / `prompt-persistence.test.ts` 永远不在内建发现范围内（实测 `bun test test-browser/...` 报 "did not match any test files"）。所以 app 一律裸写 `bun --cwd packages/app test`；需要单文件时用 `bun --cwd packages/app test:unit:file <path>`（已带 `--conditions=browser --preload ./happydom.ts`）。

测试必须在包目录运行；禁止从仓库根运行 `bun test`（根 `test` 脚本是 guard，`[test].root` 指向 `./do-not-run-tests-from-root`）。若本机已有用户服务，禁止重启或占用 4096/4444；E4 harness 使用动态端口和独立目录。`packages/app/AGENTS.md` 还有一条更硬的运行时禁令："NEVER try to restart the app, or the server process, EVER."

### 3.3 退出门禁

- 基线结果按失败类型分组：产品回归、测试状态污染、环境/端口、产物竞争、已知稳定失败。
- 每组有共同前提和 owner；不允许按 spec 文件逐条“加等待”。
- 建立 `route × mode × layer(E1–E4) × failure × platform` manifest 初稿。

---

## 4. Slice 1：ADR 与跨层契约定稿

### 4.1 文档决策

新增 `ADR-23-session-product-identity-capability.md`，并 amendment ADR-13/14/15/17。先固定 owner 拓扑：Schema 在 `packages/schema`，组合服务在 `packages/core`，现有 instance HttpApi group/handler 在 `packages/aigcfroge`，App 只消费 SDK projection；`packages/server` 不因本计划新增第二套业务 projection。

- Session common identity 与 mode detail 的 owner；
- Work preset/workflow 复用裁决与版本合同；
- Assistant personal/project scope；
- Custom Snapshot 引用与 capability health；
- projection 的兼容、404、权限与缓存语义；
- Header/列表/StatusBar 只是 consumer，不持久化 projection；
- 权限状态归位：默认 `propose` 不常驻，`full` / break-glass 在全局底栏可见，运行时 permission request 仍在 Composer 阻塞位处理；
- Composer Agent picker 默认可见并复用 mode-scoped `local.agent.list()`；设置项只决定是否显示额外 custom Agent，而不能隐藏当前模式的基础智能体列表。Custom 根会话的 `meta` 限制必须在同一 policy owner 中表达。

同步 Work/Assistant/Custom PRD 的 approved 范围；未批准项继续标 OPEN，不写“已实现”。

### 4.2 Schema/API RED

先写 Schema round-trip、OpenAPI snapshot、兼容解码 RED：

- common 字段完整；
- 五种 discriminant 只允许各自 detail；
- historical Session 缺 mode detail 时返回 typed degraded，不伪造 ready；
- Custom 只返回 snapshot ref/digest/health，不返回敏感 instruction/credential；
- capability reason 使用稳定 code，不以本地化文案作为协议；
- 旧 SDK 可忽略新增字段，新 SDK 正确生成。

**新增 endpoint 的 SDK 命名空间硬约束**：projection endpoint 必须带 `OpenApi.annotations({ identifier: ... })`。缺少 identifier 时 hey-api 会把方法平铺到父类，`client.<group>.<sub>.<method>` 直接变 `undefined`，而且**没有任何门禁会报错**（见 `docs/technical-debt.md` 与既往教训）。S1 的 Schema/API RED 必须包含一条"生成后的 SDK 上该 projection 方法存在且可调用"的断言，否则 S6 的 App 消费会在运行时静默失败。生成一律走 `./packages/sdk/js/script/build.ts`，不手改 `packages/sdk/js/src/v2/gen/`。

### 4.3 退出门禁

ADR 获批后才能创建 migration 或 endpoint。若 D3/D4 未获批准，停止对应 Work contract 或 Assistant scope slice；不得用 metadata 临时字段绕过。任何迁移必须先给出 clean/existing fixture、兼容解码和 forward-only rollback/stop 方案。

---

## 5. Slice 2：真实 E4 Harness 与覆盖清单

### 5.1 Harness 结构

在 `packages/app/e2e/real/` 建独立 `playwright.config.ts`、fixtures、process controller 和 provider adapter，不修改 `mockAigcfrogeServer` 的 E3 职责。S2 必须同时补充可执行入口；当前不存在 `test:e2e:real` script 或 `chromium-real` project，不能在它们落地前把这两个名字写成已存在接口。

- 每 worker 创建临时 config、SQLite DB、workspace、Git fixture、日志和动态端口。已核验的现有配置边界：`packages/app/playwright.config.ts:3-6` 读 `PLAYWRIGHT_PORT`/`PLAYWRIGHT_BASE_URL`/`PLAYWRIGHT_SERVER_HOST`/`PLAYWRIGHT_SERVER_PORT`（默认 3000 / 4096），`:43-47` 的 `webServer.env` 把后两者转成 `VITE_AIGCFROGE_SERVER_HOST`/`VITE_AIGCFROGE_SERVER_PORT`。`AIGCFROGE_DB` / `AIGCFROGE_CONFIG_DIR` 的确切变量名与语义**必须在 S2 开工时用 Grep 核实**，本计划不预设其存在。real config 不得 `import` 根 `playwright.config.ts` 再覆盖（`e2e/performance/playwright.config.ts:1` 是这种写法，但它同时继承了 `reuse`、`retries: CI?2:0`、`webServer.command` 等不适合 E4 的默认值）——E4 必须显式定义 `retries: 0`、`reuseExistingServer: false` 和自己的 `webServer`；
- 启动真实 backend + production App preview，使用仓库已有 health/readiness owner，等待真实信号，不用 sleep；backend 与 preview 的进程组、stdout/stderr、退出码必须可追踪；
- 通过既有 provider/LLM adapter 指向 loopback 确定性 provider；优先复用 `packages/aigcfroge/test/lib/llm-server.ts`（已核验存在，22KB）与 `packages/llm/test/recorded-{golden,runner,scenarios,test,utils,websocket}.ts` 的协议语义，但**不得** `import` 另一个 package 的 test internals（`packages/app` 无法这样跨包依赖，且这会把测试基建变成隐式公共 API）；必要时把最小协议中立 fixture 提取到明确 owner 并在 S1 记录该 owner；
- 提供流式成功、工具调用、HTTP 失败、SSE 中断、重复/乱序、慢响应脚本；所有外部网络默认 deny；
- 提供真实 PTY lifecycle 和文件 fixture；
- teardown 先中断 Session/PTY，再关服务，校验无子进程、无端口、无工作区残留；失败时保留 manifest、退出状态和脱敏日志。

禁止在 production route 添加 `if (E2E)` 后门。需要注入的服务通过既有 Layer/Config/provider 边界完成。

### 5.2 Coverage manifest

新增机器可读 manifest 和校验测试：

- 每个关键 route 至少有 owner、E3/E4 层级和 failure case；
- 五模式至少各一条 happy path + failure/recovery；Custom gate 关闭环境允许用 typed negative 代替 happy path，但必须显式标 blocked；
- PR job 选择 affected matrix，main/nightly 执行完整 E4；
- flake 条目必须有 owner、issue、到期时间，不能永久 quarantine。

### 5.3 RED → GREEN

RED：catch-all mock 被开启时 real project 直接失败；泄漏进程/文件时 teardown 失败；请求外部网络时 fail closed。

GREEN：最小 health → create Session → reload 流程在 Linux 本地重复三轮；全部产物可定位且无 secret/prompt 正文泄漏。

S2 退出时必须能用如下显式命令运行 real project：

```bash
bun --cwd packages/app test:e2e --config e2e/real/playwright.config.ts --project=chromium-real --workers=1 --retries=0
```

已核验：`test:e2e` 脚本存在（`playwright test`），但 `packages/app/e2e/real/` 目录**不存在**，`playwright.config.ts` 的 projects 只有 `chromium`/`chromium-dark`/`chromium-zh`/`chromium-zht`/`chromium-narrow`，**没有** `chromium-real`。两者都是 S2 的交付物。在 S2 合并前，本计划其他 Slice 引用该命令时必须标注"S2 后可用"，不得当成现存入口。S2 的 DoD 包含：该命令在干净 clone 上可执行且退出码为 0。

---

## 6. Slice 3：基础 Chromium 全套稳定化

### 6.1 收敛方法

按报告历史失败归类，不按文件修补：

1. **进程级 mock 污染**：先用最小复现证明污染发生在哪个 runner/fixture 边界；只有证据确认后才引入 isolate/独立进程，不能预先扩大测试架构。
2. **共享浏览器状态**：统一 server/localStorage/indexedDB/draft/session fixture 的 test-scoped owner。
3. **Vite/HMR/产物竞争**：CI 使用冻结源码与独立 outputDir；业务 suite 与 performance/production suite 不共享产物。
4. **locator/契约漂移**：只修改稳定可访问语义，不用 CSS/文案弱 locator 掩盖真实 owner 错误。
5. **导航时序**：等待 URL、route contribution、readiness/Deferred；保留报告确认的 30s 开发态预算，不用短 sleep。

### 6.2 Gate

- Chat 七类资产列表/计数归并到现有单一资源 owner。已核验的双路读取具体形态：`packages/app/src/pages/mode-workspace.tsx:148-156` 用一个 resource 读七个 `*-asset` 端点（`promptAsset.list()` … `pluginAsset.list()`，类目定义见 `e2e/regression/chat-asset-categories.spec.ts:31-39`），同时 `:226-231` 另读 server-sync 的 `command`/`agent`/`mcp` 并在 `:233-252` 用 `AssetWorkbench.mergeAssets` 合并；`mode-workspace.tsx:140-142` 的注释还自述 `ChatFeatureSidebar` 用**第三个** resource 读同样七类。归并时增加请求计数与 A→B→A 恢复断言，关闭 `docs/technical-debt.md:274` 的条目，不新建缓存真源。
- 当前 `N0 tests / N0 files` 基础 Chromium 连续两轮绿色，顺序变换一轮绿色；N0 由实施开工时重新 discovery 得出（2026-09-13 复核仍为 198/50）。
- 基础 `chromium` 承担业务套件；dark/zh/zht/narrow 只在展示/a11y 相关规格上运行。**前置事实**：仓库当前**没有任何** `@presentation` / `@a11y` 标签（全 `e2e/` 目录 grep 为 0），`playwright.config.ts` 也没有 `grep`/`grepInvert` 配置，五 project 一律跑全部非性能 spec；CI 的 Linux 步骤显式列出五个 `--project`（`.github/workflows/test.yml`，90 分钟预算）。因此"标签化收窄"是**新增机制**，必须在本 Slice 内一并落地标签、config 的 `grep` 过滤、CI 命令与 `docs/testing.md` §4 的矩阵契约描述，并交代对 56 个 spec 中已有 38 个 `pinEnglishUI`（`e2e/utils/locale.ts`）的影响——那些 pin 过的 spec 在 zh/zht project 下本就按英文断言，是收窄的首批候选。不得用全局排除悄悄丢失业务覆盖；任何矩阵缩减都要同步 `docs/testing.md` 与 manifest，并同步改 `presentation-matrix.spec.ts` 的契约断言。
- CI artifact 路径无 `ENOTEMPTY`，失败 trace 可复现；现有仅检查源码字符串的 App 测试只能作为 RED 线索，必须替换为 DOM/API/行为断言后才计入产品门禁。

---

## 7. Slice 4：路由 fail-closed、隐私与恢复

### 7.1 Owner 修复

围绕 `app.tsx` route resolution、server registry、Session placement 建单一解析流程：

- validate server key → resolve exact server → fetch leaf → resolve parent chain → validate Location → commit placement/mode/tab；
- 任一步失败不写 tab/placement，不回退当前 server；exact server 未解析成功时不得挂载 `ServerSDKProvider` 到当前 server；
- route resolver 移除非空断言和裸 `catch {}`，将 SDK/parent/Location 错误映射为稳定 typed error。具体位置：`packages/app/src/app.tsx:135`（`(await sdk.client.session.get(...)).data!`）、`:138`（同样的 `result.data!`）、`:152`（`directory()!`）、`:172`（`(placement() ?? resolved())!`）；裸 `catch {}` 在 `app.tsx:100`（`LegacySessionRedirect` 的草稿创建 effect）与 `utils/base64.ts:3-10`（`decode64` 吞掉解码失败，被 `requireServerKey` 调用于 `app.tsx:109/130`）；
- typed error page 提供返回 Home、选择 server/project、重试、复制诊断（脱敏）；
- child parent 404 明确显示 parent missing，不挂半个 Session；
- **未知 server 的静默 fallback 根因在 `packages/app/src/context/server-sdk.tsx:311-315`**：`conn` 为 `undefined` 时回落 `server.current`。`app.tsx:108-111` 的 `conn` memo 在 key 找不到时返回 `undefined` 并原样传下，`requireServerKey`（`utils/session-route.ts:9-13`）只校验 base64 可往返、不校验 server 存在。修复必须在挂载 `ServerSDKProvider` 之前拦截，而不是在 provider 内部兜底；
- **`isWindowsPath` 不是吞错点，是崩溃症状点**：`packages/app/src/utils/path-key.ts:16` 是纯谓词（`value[1] === ":"`），传入 `undefined` 直接 TypeError。真正吞掉 NotFound 的是上面的 `data!` 断言与 mock 的 200 `{}`（见 §7.2）。修复顺序是先让解析链 fail closed，`path-key.ts` 只需保证入参已验证；不要指望改 `isWindowsPath` 能修好路由。

Legacy/Draft：

- legacy redirect（`app.tsx:72-103`）当前**完全丢弃** query/hash：带 id 时直接 `<Navigate href={sessionHref(...)} />`（`:79`），`legacy-session-route.spec.ts:90-96` 已钉住"重定向后 `searchParams.has("prompt")` 为 false"。因此白名单是**新增**行为，必须同时更新该 spec，不能当成既有能力；
- `prompt` 的实际消费点是 `/new-session`（`packages/app/src/pages/new-session.tsx:62-70` 的 `setSearchParams({ ..., prompt: undefined })`），不是 legacy 路由。修复对象是这个一次性 replace 清理；
- 内部清理不触发 Dirty Guard。当前 `DirtyDraftGuard`（`packages/app/src/context/chat-workspace.tsx:145-160`，挂载于 `app.tsx:555`）通过 `useBeforeLeave` 拦截，而草稿页在 `new-session.tsx:42` 注册了 dirty，导致水合后的清理导航被"Unsaved content"对话框阻断——`new-session-route.spec.ts:101-116` 已钉住这个缺陷。修复必须让 guard 能区分内部 replace 清理与用户离开，并把该 spec 从"钉住缺陷"改为"钉住正确行为"；失败保留 draft 内容但不在 URL；
- 无项目/Location 时显示恢复入口，不创建不可用 tab。

**§7.1 附则：Server host 别名裁决（2026-09-14，S4 第一项定案）**

- **归一规则**：同一 scheme + 同端口下，`localhost` 与 `127.0.0.1` 是同一个 server。归一函数唯一（`canonicalServerUrl`）：trim → 补 http/https 默认 scheme → hostname 小写化 → `localhost` 映射 `127.0.0.1` → 省略 scheme 默认端口（http:80 / https:443）→ 去尾斜杠。server 身份的**所有比较**（registry 去重、路由 key 匹配、draft/tab 引用、WebSocket base）都过 canonical 形态；用户可见展示保留原始拼写。
- **canonical 拼写**：`127.0.0.1`（与 `playwright.config.ts` 的 `PLAYWRIGHT_SERVER_HOST` 默认一致）。terminal 的 ws 断言、legacy redirect 期望 key 随之翻转。
- **双锁设计**：锁 A = `ServerConnection.key()` 的 http 分支经 `canonicalServerUrl` 派生（覆盖一切从 connection 对象派生的比较点）；锁 B = `ServerConnection.sameKey(a, b)`（两侧归一后比较，覆盖**存量持久化 key**——旧 localStorage 的 tab.server/draft.server/active 是原始拼写字符串，绕过 key()）。registry 的 `list` 存储保留用户原始拼写，添加时同 canonical 合并进既有条目（只更新展示字段），不产生重复条目。
- **`[::1]` 不与 IPv4 环回互认**：跨协议栈的同义性是额外假设，保守排除；`::1` 是独立身份。后续若需互认，改 `canonicalServerUrl` 一处即可。
- **Windows path key 不参与 host 归一**：`isWindowsPath` 族（`C:/...`）是目录路径身份，不是 server URL，两种形态互不转换。
- **实现边界**：读路径（localStorage 读取、路由 key 解码）同为摄入边界，必须归一——存量 draft/tab 持久化了旧拼写，仅靠"新输入归一"会让真实用户旧数据继续断裂（S0 的 new-session 三例正是此形态）。工作区 `.aigcfroge/` 由后端自建，属 workspace 残留白名单。
- **canonical:92 语义修正**："同 ID 两 tab 隔离"改用两个**物理不同**的 server（`:4096`/`:4097`）验证；"同物异名归一为单 tab"成为 alias 的正向断言。

### 7.2 测试矩阵

扩展已有 `canonical-session-route`、`legacy-session-route`、`new-session-route`、`unknown-route`：同 Session ID 跨 server、unknown/malformed server、leaf/parent 404、Windows/WSL path、query/hash、refresh/back/forward、敏感 prompt history。

**必须改写（不是新增）的既有断言清单**——这些 spec 目前把缺陷钉成了通过标准，S4 交付时它们必须变成 typed error + recovery 断言：

| 文件:行                                   | 当前断言的行为                                                                  | 目标                                    |
| ----------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------- |
| `unknown-route.spec.ts:60-68`             | 未知路径下 `main` 为空且 `"Something went wrong"` 计数为 0（无 wildcard route） | typed 404 页 + 返回 Home 动作           |
| `unknown-route.spec.ts:79-88`             | 未知 server 保留 URL 但渲染当前 server 的会话标题（钉住静默 fallback）          | typed unknown-server 错误 + 选择 server |
| `unknown-route.spec.ts:90-100`            | 未知 Session 报 `Cannot read properties of undefined ... isWindowsPath`         | typed session-not-found                 |
| `canonical-session-route.spec.ts:143-150` | 真 404（`failSessionRead`，`:59-68`）下 `main` 为空且无错误页                   | typed error + recovery                  |
| `canonical-session-route.spec.ts:152-158` | parent 404 时静默失败、无错误页                                                 | 明确显示 parent missing                 |

同时必须改 mock：`packages/app/e2e/utils/mock-server.ts:95-99` 对未知 session 返回 HTTP 200 `{}`（`session ?? {}`）——这一条按真实 404 形状修复（`{ name: "NotFoundError", data: { message } }`，S4 #3 已落地）。**边界裁决（2026-09-14，纠偏原文歧义）**：`:161` 对未匹配请求的 200 `{}` 兜底**保留**——它是隐式承重结构，`/api/permission/request` 等未被显式 mock 的容忍路径依赖它（约 30 个 spec 的"无意外浏览器错误"断言）；blanket-404 已实测并回退（console 洪流 + 超套件预算，证据在 mock 注释）。本计划对 mock 的要求是**能表达** 404（`notFound` helper + 定向使用），不是未匹配一律 404；更强严格性走显式 opt-in strict 模式，由 #4 的 mock/real 一致性 spec 裁决有无消费者，无则闭案。（原文此段曾同时暗示"让 mock 产生 404"与"能表达 404"两种读法，是 S4 #3 blanket-404 实验的诱因，特此改写消除。）

E4 加真实 unknown server/404 与 reload，证明 mock/real 错误形状一致。

---

## 8. Slice 5：真实 Session、Files 与 Terminal 生命线（P0）

### 8.1 Session 执行

**运行时事实（2026-09-14 S5 RED 追查修订，纠偏原文前提）**：生产默认路径是 V1 直写。`promptAsync`（`packages/aigcfroge/src/server/routes/instance/httpapi/handlers/session.ts:819`）经 `shouldUseV2Runtime`（`packages/core/src/product-mode-policy.ts:102`）分流——`custom` 恒走 V2，其余模式看 `AIGCFROGE_V2_RUNTIME`，而该 flag 默认 false 且 `app-runtime.ts:87-97` 注释明载两个未解 bug（LLM auth 未传入 LLMClient 致 401；V2 handler 形状与 V1 API schema 不匹配）。四层实测：默认路径 `session_input` 零行、message/part 直写并驱动 provider；flag 开启时 admission 行写入但零 dispatch、V1 读端投影为空。**原文的「POST durable prompt admission → session_input 可观测」链描述的是 V2 模型，不是默认产品路径**——该前提在两轮审批（含技术审批修订）中均未经运行时核验，S5 RED spec 首次执行时被证伪。教训与 §7.2 同类：运行时行为的契约前提必须运行时验证，只引 specs 文档不够。

**P0 主链（按真实产品默认路径交付，方案 A，2026-09-14 裁决）**：

```text
browser submit（默认 V1 路径）
→ provider turn（真实确定性 provider）
→ SSE user/assistant/tool parts
→ completion 或 typed error
→ reload 后投影一致
→ backend 重启后 message/part 行仍在且可见
```

耐久性证据 = 真实 DB 的 message/part 行 + 重启后可见，不以 DOM 出现一行文本代替。中断/失败/重连覆盖按 V1 实际支持的语义枚举（先盘点 V1 的 prompt_async 行为再写 spec，不强套 V2 概念）；重启断言只覆盖**已完成 turn** 的耐久性，不断言任何「进行中 turn 的恢复」。

**V2 admission 现状契约 spec（显式标注，独立 flag-on 后端，不混入默认链）**：单独命名的 E4 project/config，orchestrator 经显式开关注入 `AIGCFROGE_V2_RUNTIME`（默认后端永不携带此 flag，AIGCFROGE\_\* 剥离语义不变）。断言 V2 今天确实做到的（admission 行写入），**并**以「expected current behavior」命名钉住两个已记录缺口（零 dispatch、V1 投影为空）——V2 补全时这些断言转红，强制更新本契约（与 §7.2 pin-defect 同一模式，green 不代表 V2 可用）。缺口登记 `docs/technical-debt.md`（v2-runtime-execution-gap，含四层实验与代码引用）与 coverage-manifest deferred（owner S9C——`custom` 恒走 V2，S9C 正向 E4 必撞此墙；unlock = 开工前 Owner 裁决「补全 V2 execution（需单独授权，触碰 durable admission 不变量，§20）」或「重定 S9C 正向路径范围」）。

V2 不变量语言保留并只适用于该 spec 的范围：`specs/v2/session.md:188` 明确 "Post-crash continuation recovery is intentionally deferred. A wake does not infer that ambiguous provider work is safe to retry after an input has already been promoted."，`:127` 把 "Add durable post-crash continuation recovery for promoted or provider-dispatched work" 列为未来工作，`:176` 同时把 provider timeout/retry/watchdog 策略整体延后。因此任何 E4 断言若要求「崩溃后自动续跑」，就是在要求改变 V2 不变量，属于 §20 的整体停止条件。可用的正向事实是 `:58` 的 `session_input` durable admission inbox 与 `:60` 的 `admittedSeq`。

### 8.2 Files

在临时 workspace 验证搜索、读取、编码、大文件边界、权限拒绝、symlink/path traversal fail closed、watch/update、两个 tab 隔离；teardown 校验工作区只包含预期变更。

### 8.3 PTY

真实 HTTP + WebSocket：create/open/input/resize/output/exit/signal/delete、启动失败、断线重连、跨 Session 同 Location 共享与跨 Location 隔离、orphan cleanup。等待 exit/readiness 事件，禁止 `setTimeout` 猜完成。

### 8.4 P0 退出门禁

三条真实链（Session、Files、PTY）在 `retries=0` 下各连续三轮绿色；无残留进程、端口、文件、DB；失败日志脱敏。未通过不得进入“产品闭环完成”表述；不得把未实现的 post-crash continuation 写入 DoD。

---

## 9. Slice 6：SessionProductIdentity / Capability 投影与共享 Header

### 9.1 Core/Server

按 ADR-23 实现只读 projection service：

- common 从 `SessionV2.Info` 与 Location/Model owner 读取；
- permission 同时读取声明 tier，并调用既有 `PermissionEffective`、Session override、saved approval owner 得到脱敏 effective summary；projection 不复制授权算法；
- Work 从版本化 contract owner 读取；历史 metadata 仅走显式 compatibility decoder；
- Assistant 从已批准的 scope contract 与各能力 health 读取；未完成 Memory/KB scope migration 时返回 typed degraded；
- Custom 从 Snapshot store（`session_composition_snapshot` 表，`packages/core/src/session/sql.ts:220-233`，insert-only：唯一写入者 `session/composition.ts:78-96`，重复写抛 `SnapshotAlreadyExistsError` `:211-221`，全仓无 update/delete）+ ProductModePolicy 读取，精确使用 `CAPABILITY_CUSTOM_V1 = "product-mode-custom-v1"`（`packages/schema/src/product-mode.ts:57`）与 header `CAPABILITIES_HEADER = "x-aigcfroge-capabilities"`（同文件 `:58`）；kill switch 为 `AIGCFROGE_CUSTOM_MODE`（`packages/core/src/flag/flag.ts:82-84`，经 `product-mode-policy.ts:40-42` fail-closed 默认关）。snapshot 内确实存 instruction 正文（`packages/schema/src/composition.ts:182-185`、`:296-300`、`:329-357`）但 credential 只存 `credentialRef`（`:312-316`），所以 projection 必须只回 ref/digest/health，绝不回 instruction；
- capability 聚合 reason code、severity、recoverable action，不吞 defect；
- 同一请求保持一致快照，权限过滤后再返回；日志不输出资产/记忆正文。

HTTP canonical/legacy surfaces 使用同一 service；生成 SDK 用仓库脚本，不手改 generated 文件。

### 9.2 App

共享 Session Header 展示 mode、Location/scope、agent/model source、permission、模式专属 identity 与 health；信息过多时分主行/详情，不把所有字段塞进标题。

权限与 Agent 控件按职责归位：

- 删除 Composer 上方常驻的 `PermissionTierSelector`；真正等待用户决策的 `SessionPermissionDock` 保持原位。
- 给 `StatusBarSource`（`components/status-bar/types.ts:19-32`）**新增**权限投影字段——当前该类型没有任何 session-info 访问器，`MetricGroup`（`status-bar/metrics.ts:1`）也没有 permission 分组，所以这是新增能力而不是搬位置。数据来源为 ADR-23 projection；`createCurrentSessionSource` 内部已读到的 SDK `Session` 记录（`current-session-source.ts:64-68`）虽已带 `permissionTier`/`attended`，但只可作为过渡期兜底，不得成为第二真源。默认 `propose` 不显示，`full` 显示警示文本/图标，override 显示更高优先级状态，并提供进入既有确认/关闭控制面的入口。底栏只投影状态，不复制 lease owner（服务端 60s lease 与客户端 30s renew 仍归 `permission/session-override.ts` 与 `session-permission-override-dialog.tsx`）。
- 先修 `showAgentControl`（`packages/app/src/components/prompt-input.tsx:1438`）把 `props.controls.agents.visible` 与整个控件渲染（`:1635-1637`）绑死的缺陷：`showCustomAgents` 改为“是否包含额外自定义智能体”，基础 picker 始终可见。`ComposerAgentControl` 保持纯展示（它本身不发请求），列表仍由 `session-composer-region.tsx:131` 的单一 `local.agent.list()` 调用点供给，不得另发第二份 Agent list 请求。Custom 根会话的 `meta` 收窄当前只在服务端 `packages/core/src/product-mode-agent-policy.ts:125-135` 表达，`local.agent.list()` 的 custom 分支（`context/local.tsx:87-92`）只剥 orchestrator；本 Slice 必须让客户端可见项与该服务端 allowlist 同源，不能将任意 primary Agent 暴露为可创建根会话。
- 窄屏下 Agent picker 和权限状态必须可键盘访问、可读完整名称；过长列表使用搜索/滚动，不挤压模型和提交按钮。

所有 disabled Start/New/Save/Run 动作消费同一 gate：按钮附近显示原因、恢复动作和可复制诊断 ID。列表、Header、StatusBar、Custom diagnostics 不得各自计算不同 health。

### 9.3 验证

E1 schema/fold；E2 API/auth/cache/effective-permission owner；E3 五模式 Header/disabled reasons；E4 refresh/cross-server/historical Session。Custom Snapshot 正文、credential、memory 内容不得出现在 projection 或日志；projection 的 cache 不能跨 server/location/authorization boundary 复用。

新增 E3 回归矩阵：`propose` 底栏无噪声、`full` 底栏状态正确、override 启停/renew/刷新一致、permission request 仍在 Composer；Chat/Work/Assistant/Coding/Custom 的 Agent picker 可见项严格等于 mode policy，Custom 根只允许 `meta`，选择后提交携带正确 Agent，Settings 关闭 custom agents 不隐藏基础 picker。将现有源码字符串断言替换为实际渲染、请求 payload 和 policy 输出断言。Desktop smoke 复核底栏不会被 safe-area、缩放或窄视口裁切。

---

## 10. Slice 7：共享窄屏 Side Panel 导航

复用 `SessionSidePanel`、`WorkArtifact`、`AssistantSessionPanel`、Custom snapshot panel 与 Coding review/files 内容 owner，新增共享 contribution registry/窄屏 tab 或 drawer：

- 390×844 与 200% 下 Session、Composer、模式专属 panel 都有明确入口；
- panel 打开/关闭、back、Escape、focus restore、aria-selected/controls 完整；
- desktop resize 到 narrow 再恢复，不丢 active tab/store/scroll；
- ~~hidden panel 不重复请求、不 remount 业务 owner~~ **范围更正（2026-09-17，Owner 同意）**：本条虽列在本切片，但主题是**渲染所有权**（隐藏面仍挂载是仓库刻意设计，`ModeSlotActiveProvider` 负责屏蔽副作用），不属窄屏布局；已按主题改派给 **S11（Desktop、可访问性、视觉与性能）**，登记于 coverage manifest `hidden-panel-request-and-remount`；
- Custom 两个无名称 icon button 补可访问名称与命中区域。

RED 用现有 `mode-slot-fallback-a11y.spec.ts` 固定窄屏入口的“能力不可达”。**范围更正（2026-09-16，Owner 裁定）**：本段原先把 `mode-detail-personas.spec.ts` 的三处 `closed:false` 观察交给 S7 转正，但按主题归属它们不属于本切片——那三处的实际内容是 Work 的 `presetCategoryId=null`/产物空状态、Assistant 未显示 personal/project scope、以及 identity header 缺 scope/preset/继承的 model source，主题是 **Work/Assistant 身份与 scope contract**，而 `session-product-header-projection` 已判给 S9B（§13.1 依赖 Header）。因此这三处随主题归 **S9A/S9B**，不由 S7 越界转正；S7 的 RED 只建在窄屏 panel 导航入口上。

**必须理解 `closed:false` 的真实性质**：`mode-detail-personas.spec.ts:83-88` 的 `attachClosure` 是 `testInfo.attach(...)` 写 JSON 附件，不是 `expect()`；`:196-209`、`:245-258`、`:295-308` 三处 `logic/flow/interaction: { closed: false, evidence: ... }` **无论真假都不会让测试失败**。所以它们既不是 RED 也不是门禁，只是观察记录。GREEN 的定义是：把这些观察替换成真实的 `expect()` 可达性断言（panel 可见、可键盘到达、aria 关系正确），并让 `closed` 字段消失或成为断言的产物，而不是"把 false 改成 true"。

内容 owner 的准确名称（避免照抄不存在的符号）：`SessionSidePanel`（`packages/app/src/pages/session/session-side-panel.tsx`）、`AssistantSessionPanel`（`pages/session/assistant-session-panel.tsx`）、Work 侧为 `pages/work-artifact-panel.tsx`（**不叫** `WorkArtifactPanel` 组件导出，实施前先确认导出名）、Custom 侧 snapshot 相关面板须在 S7 开工时用 codegraph 定位实际 owner，本计划不预设名称。200% 必须使用真实浏览器缩放/重排检查，不以把 viewport 缩小代替；不得通过隐藏 panel 或 remount owner 制造假绿。

---

## 11. Slice 8：Home / Project / Location 生命周期

### 11.1 生命周期

基于现有 Global/Project/Directory picker owner 完成 add/edit/delete、重复/非法/不可访问路径、颜色保存失败回滚、大列表、offline、多 server 聚合和无项目恢复。

### 11.2 路径身份

针对报告中的 `/media/keer/办公/aigcfroge` 与 `/media/win_data/aigcfroge` 同 inode 场景：

- 后端/平台层对本地可证明的路径提供 canonical physical identity 或明确 alias relation；前端不自行 `realpath` 猜远端路径；Windows/WSL/远端无法证明时返回 `unknown/degraded`，不按字符串相等或 inode 猜测去重；
- 同一已证明的物理 Location 不重复项目/Session 分组；
- 历史路径失效时显示原路径、当前候选和重定位动作；
- 非 Git Location 明确显示无 VCS，而不是空 branch；
- destructive delete 只移除注册，不误删目录/Session，除非另有明确确认合同。

Home 继续遵守 ADR-16 全局聚合，筛选不创建/恢复 Session；模式首页继续使用 `/mode/:mode`。

---

## 12. Slice 9A：Work 最小产品闭环（按已批准 PRD 收敛）

### 12.1 先决边界

Work PRD 已批准的 M1/M1.5 是官方 Preset/既有 Workflow 消费、澄清、Progress Ledger/Resume、只读预览、路径安全和原子落盘；Work 内部自定义 Preset 资产的直接创建与持久化是非目标。本 Slice 不改变这个边界。

复用 owner：官方 `WorkPreset` catalog（`packages/core/src/session/work-preset.ts:5-89` 的硬编码 `PRESETS`）、`WorkflowAsset` revision、现有 `WorkArtifact`、`FileMutation.writeIfUnchanged`（`packages/core/src/file-mutation.ts:73-75`，`ConditionalWriteInput.expected` + `StaleContentError`，确认存在）、既有 diff/comment UI 和 Progress Ledger。

三处必须写进实施前提的代码事实：

- **`WorkPreset` 目前没有 revision/version/digest**（`packages/schema/src/work-preset.ts:30-41` 只有 id/title/category/description/guided/guidance/questions/outputType/artifact）。D3 要求的 contract 版本标识对 Preset 侧是**新增字段**，必须在 S1 ADR 与 schema RED 中落地；只有 `WorkflowAsset` 已有真 revision（`packages/schema/src/workflow-asset.ts:30-36`，值为 YAML 原始字节的 SHA-256，`core/src/workflow-asset.ts:99`）。不得把 `composition.ts:283-294` 的 tool `catalogDigest` 误当成 preset catalog digest。
- **`presetCategoryId` 不是独立数据库列**：它存在 `session` 表的 JSON `metadata` 列里（写入 `core/src/session.ts:480`，读出 `session/info.ts:22` 的 `decodePresetCategory`）。把它"降为兼容字段"是文档动作，不需要 drop column；但任何新 contract 字段若要可查询，必须显式决定是新列还是继续 JSON。
- **`WorkArtifact` 确认为非持久**：`core/src/session/artifact.ts:12-18` 自述"内存态事件，不落库"，其 `work.artifact_applied` 事件（`:32-40`）未传 `durable` 选项，因此在 `EventV2.define`（`core/src/event.ts:114-143`）下只是 pubsub，穷举 `packages/core/src` 的 `sqliteTable` 也无 artifact 表。计划任何位置都不得称其为 durable Artifact projection；若要持久 revision/reviewer，先过 contract ADR 和 migration gate。同理，`open → fix_requested → responded → resolved/reopened` 状态机目前在全仓**不存在任何实现**，只出现在本计划 §12.3 的未来工作描述里。

### 12.2 垂直链

```text
选择官方 preset / 已注册 WorkflowAsset
→ 回答澄清问题
→ 原子创建 Work Session + contract snapshot
→ provider output 形成 candidate revision
→ preview/review
→ 复用 FileMutation CAS 保存 Location 文件 + artifact projection
→ export/reopen
→ comment/fix/resolved 或 rollback
```

ad-hoc Work Session 有独立合同与文案，不假装来自 preset。编辑 Preset/Workflow 只影响新 Session；历史 Session 保留 owner revision/snapshot。Work 不在 localStorage、prompt seed 或临时 JSON 中保存产品身份。

### 12.3 Reviewer 与持久化 gate

复用既有 diff/comment 基础；只有在 Core owner 明确落地 durable review contract 后，才新增 `open → fix_requested → responded → resolved/reopened` 状态与 revision digest。审批只对当前 artifact revision 有效，旧审批不能放行新 revision。

### 12.4 Gate

- E1/E2：contract/schema round-trip、兼容历史 Session、FileMutation CAS 冲突（复用 `file-mutation.ts:158-171` 的 per-canonical-path 锁与 `StaleContentError`，**不得**重复实现文件锁）、rollback、权限与路径 containment。
- E3：Preset/Workflow 身份、ad-hoc 文案、空态、冲突、review 状态和窄屏入口。
- E4：happy + provider failure/recovery + save conflict；只有 durable Artifact/Reviewer contract 完成后，才可把 export/reopen/review/rollback 写为产品闭环通过。
- 若用户自建 Preset 仍是需求，停止在本 Slice，先走 ADR/PRD amendment，不以 Work 临时 store 交付。

---

## 13. Slice 9B：Assistant 最小产品闭环（M1 硬门 + M2 条件门）

### 13.1 M1：scope contract 与 Reminder

- Personal 与 Project scope 先成为服务端 contract；Session Header、Schedule/Delivery 查询 key、创建 payload、权限和持久化必须一致。
- Reminder：create → due → delivery → read/cancel → failure retry/dedupe，覆盖 IANA timezone、DST、过期补投和进程重启。
- 复用现有 `ScheduleService`（`packages/core/src/session/schedule-service.ts:159`）、`DeliveryService`（同文件 `:386`）、`SchedulerCore`（`schedule-core.ts`）与生产守护 `daemonLayer`/`daemonNode`（`schedule-service.ts:697-714`，构建于 `makeAssistantCore` `:496-506`）。**命名纠偏**：`AssistantSchedulerDaemon` 只出现在文档与测试 `describe()` 标签里，不是代码符号；实施与验收文案必须引用 `daemonLayer`/`daemonNode`，避免照抄一个不存在的 owner。另有 `scheduled-job.ts:224-235` 是面向 task 表的独立守护，不要与 Schedule 表守护混用。现有 Core scheduler 已有真实 DB、租约、恢复和幂等测试，E4 只补 browser → API → daemon → inbox 的真实连线，不另建调度器。
- 不运行常驻 Session，不把 `BackgroundJob` 或 EventV2 当调度真源。

### 13.2 M2：Memory/KB 条件门（默认不阻塞 M1）

Assistant PRD 把 Memory/KB 放在 M2。代码事实：`personal_memory` 表（`packages/core/src/session/personal-memory.sql.ts:12-31`）**刻意无** project 外键（表头注释 `:7-11` 写明 "Cross-project by design"），列只有 id/content/source/trust_level/sensitivity_level/status/source_session_id/source_message_id/created_by/confirmed_at/time_created/time_updated；KB 的 `NoteScope = ["global","project"]`（`packages/schema/src/kb-note.ts:36`）在 `kb_note` 表（`core/src/session/kb.sql.ts:12-30`）里只有一个 `scope` 文本列 + `(scope,title)` 唯一索引，**没有任何 project_id/路径列**，project 归属完全靠目录约定（`kb-service.ts:261-268`：global → `<config>/knowledge-base/`，project → `<directory>/.aigcfroge/knowledge-base/`）。因此本计划不把“Memory inject”或“KB personal/project 隔离”写成 M1 已实现；M2 若获批，必须同时设计 scope 列/迁移与目录约定的关系，而不是只加一个字面量。若 Owner 要在本批次纳入，必须先完成独立 scope/security ADR、Schema/migration、auth/API contract 和 E2/E4 隔离证据。

获批后的 M2 才覆盖：Memory `propose → confirm/reject → inject/audit → delete`（confirm-first，敏感正文不进日志）以及 KB global/project CRUD、搜索引用、跨 Session 持久和项目隔离。App 不得固定写 `scope: "global"`。

### 13.3 Gate

- M1 E2 用真实 DB + 可控 scheduler tick/TestClock 边界，不用 sleep；E3 覆盖 dashboard/confirmation/cancel；E4 用确定性时钟/worker 验证到期、补投、去重和 restart。
- scope 隔离以已存在的 server/auth/location identity 为边界；若仓库没有用户/租户 identity，不得宣称跨用户/跨服务器隔离已经完成。
- M2 未获批时，DoD 只要求 projection 明确 `unsupported/degraded`，不允许 UI 显示假 ready。窄屏 panel 由 S7 复用。

---

## 14. Slice 9C：Custom 发布与运行闭环

### 14.1 默认关闭环境

真实 backend 返回稳定 typed gate；Builder 明确区分 server kill switch、client capability 缺失、Agent 缺失、plan diagnostic、snapshot drift，并提供对应恢复动作。Start disabled 和 diagnostics 必须同源。

### 14.2 获准环境

在隔离 E4 backend 显式启用 flag/header，验证：asset revision → plan → expected digest → freeze/create atomic transaction → canonical Session → provider turn 按 snapshot allowlist → reload → upgrade 产生新 Session → old Session 保持 → archive/rollback。

**原子性的准确范围**（不要在验收文案里含糊说"全部原子"）：`createCustom`（`packages/core/src/session.ts:530-615`）把 Created 事件、session 行投影与 composition snapshot 插入放进同一个 DB 事务（`:580-588` 的 `events.publish(..., { commit })`，而 `EventV2.publish` 在 `core/src/event.ts:372-375` 于同一 `tx` 内先跑 projector 再跑 `commit`，最后 `:388-400` 插事件行）；但 `ProjectTable` 的 upsert 在 `:554-560`，是该事务**之前**的独立幂等写。重复创建走 `:542-552` / `:605-611` 的 frozen-digest 复用路径。E4 断言崩溃点时必须区分这两段，否则会把幂等 upsert 误报成原子性破洞。

删除/漂移按类型覆盖：内容型资产若已被 immutable snapshot 充分保存，历史 Session 按快照继续并只显示 source unavailable；若仅保存不可恢复引用则返回 typed degraded/blocked。runtime tool、MCP auth、registration identity、catalog fingerprint、tool schema/installation drift 必须 fail closed，绝不回落全量工具。Profile 删除不级联删除引用资产或旧 Session snapshot。

### 14.3 Gate

生产默认仍关闭不算失败；但负向 gate 必须绿色。正向 E4 必须同时设置 `AIGCFROGE_CUSTOM_MODE` 与精确 capability header `x-aigcfroge-capabilities: product-mode-custom-v1`，并验证 root `meta` policy（`packages/core/src/product-mode-agent-policy.ts:125-135`，`enforcePrimary` `:55-61` 的调用点见 `session.ts:422,424,827,1070`、`session/runner/llm.ts:592`、`tool/task.ts:361`）。既有负向证据可复用 `packages/core/test/custom-mode-security.test.ts:188-202`。

**测试环境陷阱**：core 里创建 custom session 的测试若不自管 `AIGCFROGE_CUSTOM_MODE`，会靠文件执行顺序蹭到别的测试设的 env——本地全绿、CI 挂。新增测试必须自己设置/清理该 env，并用 `env -u AIGCFROGE_CUSTOM_MODE bun --cwd packages/core test <file>` 单跑受影响文件作为判别式。只有显式 Custom CI job 可以开启能力，且不能把 test flag 带入 production artifact。

---

## 15. Slice 10：网络、附件、导入导出与安全恢复

- offline/slow/timeout/SSE/WS 中断、乱序、重复事件：reconnect 后幂等，未提交输入可恢复，错误有重试/取消。
- 附件：picker/paste/upload、类型/大小/权限、删除、context parts、跨 Session 隔离；日志和 URL 不泄漏内容。
- 导入按不受信内容处理，保留现有 untrusted wrapper；导出校验 MIME、文件名、内容、取消和写失败。
- 路径 traversal/symlink、Markdown/HTML sandbox、command validation、permission fail-closed 进入 E2/E4 security matrix。
- 外部网络默认 deny；测试只访问 loopback/fixture。附件、导入导出与 offline/reconnect 是独立矩阵，不得因为 Session E4 绿色就自动宣称这些能力已闭环。

---

## 16. Slice 11：Desktop、可访问性、视觉与性能

### 16.1 Electron/Desktop

在 `packages/desktop` 增加真实 launch smoke，复用 preload `window.api` 与 main `ipc.ts` owner：sidecar readiness、renderer load、native picker、deep link、menu/shortcut、notification permission、window restore、native zoom/DPI、update failure、WSL connection/restart。

**前置事实与命令边界**：`packages/desktop` 现有 11 个 `*.test.ts` 全是 `bun test` 单测（`electron-builder.config.test.ts`、`src/main/*.test.ts`、`src/renderer/*.test.ts`、`src/main/wsl/servers.test.ts` 等），全仓 grep `_electron` / `electron.*launch` 为 0——**当前没有任何 Electron launch smoke**。`@playwright/test` 虽未列入 `packages/desktop` 的 devDependencies，但 hoisted linker 下可从根 `node_modules` 解析（已实测），因此可用 `_electron.launch`；实施时须显式把 `@playwright/test` 加进该包 devDependencies，不靠 hoisting 巧合。新增 smoke 必须走**独立** `playwright.config.ts` 与**独立脚本名**（如 `test:e2e`），不得并入现有 `test` 脚本——后者是 `bun test`，两套 runner 混在一个脚本里会让 `bun turbo test` 语义漂移。不得重启或占用用户现有服务；测试启动隔离 sidecar/临时 profile。Linux/Windows 为 PR/main gate；macOS packaged launch 在可用 runner/nightly 运行；未运行的平台必须保留人工/CI residual risk，不能用 Web E2E 代签。

### 16.2 a11y/视觉

- 核心路径 keyboard/focus/name/role/live state；axe 作为补充，不代替人工屏幕阅读器抽检。
- 200% reflow、390×844、en/zh/zht、light/dark。
- 为稳定关键页建立少量 screenshot baseline；动态时间/ID 先语义归一，不用大面积 mask 隐藏回归。

### 16.3 性能

复用 production benchmark 与 trace；记录首屏、Home→Session、tab switch、长 timeline、terminal 流和 panel open。只断言场景完成与指标采集，不设机器相关硬阈值；与 S0 原始数据对比并解释退化。

---

## 17. Slice 12：文档同步、全量终审与交付

### 17.1 文档同步顺序

1. 给 E2E 报告追加实施结果/errata，不删除原始复现。
2. 更新 `docs/technical-debt.md`：只关闭有 E4/产品证据的项；其余写 owner、触发条件、放行标准。
3. 同步 `CONTEXT.md` 五模式术语与 Custom rollout 状态。
4. 同步 `ARCHITECTURE.md`、ADR-23 与 ADR amendments。
5. 重写 `pages/chat.md` 的过时 PLANNED 描述；更新 home/work/settings/custom/assistant 页面 current vs target。
6. 同步所有受影响 PRD（Chat、Work、Assistant、Custom）的批准范围、版本合同和非目标；不把草案内容回写成 approved。
7. 回写本计划每个 Slice 的 SHA、RED/GREEN、命令、残余风险。

### 17.2 全量命令

```bash
# 包级：只运行真实存在的脚本；packages/server 当前只有 typecheck
bun --cwd packages/schema typecheck
bun --cwd packages/core typecheck
bun --cwd packages/core test --timeout 30000
(cd packages/core && bun script/migration.ts --check)
bun --cwd packages/server typecheck
bun --cwd packages/aigcfroge typecheck
bun --cwd packages/aigcfroge test --timeout 30000
bun --cwd packages/aigcfroge test:httpapi
bun --cwd packages/app typecheck
bun --cwd packages/app test   # = test:unit && test:virtualizer；勿加 --timeout（只会落到第二段）
bun --cwd packages/ui typecheck
bun --cwd packages/ui test    # 本批次改了 packages/ui/src/context/dialog.tsx
bun --cwd packages/desktop typecheck
bun --cwd packages/desktop test

# E3 / E4 / performance
bun --cwd packages/app test:e2e --project=chromium --workers=1 --retries=0
# 展示矩阵（与 CI Linux 步骤同形；若 S3 落地标签收窄，此处与 CI 必须同步改）
bun --cwd packages/app test:e2e --project=chromium-dark --project=chromium-zh --project=chromium-zht --project=chromium-narrow
# S2 落地 real config 后运行；当前不存在 test:e2e:real script，禁止写成该脚本
bun --cwd packages/app test:e2e --config e2e/real/playwright.config.ts --project=chromium-real --workers=1 --retries=0
AIGCFROGE_PERFORMANCE_TRACE_DIR=/tmp/aigcfroge-shell-closure-final bun --cwd packages/app test:bench

# 仓库门禁
git diff --check
LINT_BASE_REF=origin/main bun run script/lint-changed.ts
bash .aigcfroge/skills/protocols/scripts/check-refs.sh
bun run lint     # = oxlint && format --check && lint-changed && check-unawaited-assertions
bun typecheck    # = bun turbo typecheck
```

**门禁细节（避免空绿）**：

- `LINT_BASE_REF=origin/main` 是必需的，不是可选优化。`script/lint-changed.ts` 默认以本地 `main` 为 diff 基线，而本分支相对 `origin/main` 已 `ahead 9`——在本地 `main` 上累积未推送提交时它会扫到 0 个文件并空绿通过。
- `lint-changed.ts` 对**新增行**重开六条 `.oxlintrc.json` 里只是 warn 或关闭的规则（`script/lint-changed.ts:6-16`）：`typescript/no-unsafe-type-assertion`、`typescript/consistent-return`、`typescript/unbound-method`、`typescript/await-thenable`、`typescript/no-unnecessary-type-assertion`、`eslint/no-unused-vars`。只跑 `oxlint` 会漏审这六项；新文件里的 early-return 要写 `return undefined` 以满足 `consistent-return`。
- `bun run lint` 还包含 `script/check-unawaited-assertions.ts`——一条文本门禁，抓没被 await 的 `expect(...).rejects` / `.resolves` 链（bun-types 把它声明成 `void`，`no-floating-promises` 看不见）。本计划会写大量 E2 断言，这条必跑。注意其头注释明确要求**不要**重新启用测试里的 `await-thenable`。
- `.husky/pre-push` 跑 `bun typecheck`（不是 pre-commit）；`AIGCFROGE_SKIP_TYPECHECK=1` 可跳过，但本计划的交付切片不得用它绕过。

不得直接运行 `tsc`。SDK 变更运行 `./packages/sdk/js/script/build.ts`；generated diff 必须由脚本产生并审阅。

### 17.3 最终发布判定

只有以下全部满足才可把报告状态从 CONDITIONAL 改为 READY：

- P0：实施期重新发现的 `N0 tests / N0 files` 基础 Chromium 稳定；真实 Session、Files、PTY E4 绿色；无资源泄漏；不包含未批准的 post-crash continuation 声明。
- P1：route fail-closed；已批准范围内的 Work/Assistant M1 闭环；Custom gate + 获准环境闭环；Home/Location 生命周期。Assistant M2 Memory/KB 只有在独立 gate 通过后才能从 residual risk 移除。
- Desktop：Linux/Windows smoke；macOS 未运行时明确保留 residual risk，不能称全平台完成。
- a11y/security/performance：适用门禁通过，证据可定位。
- 文档与代码一致，无旧默认值、旧 capability 名、旧四模式/Chat PLANNED 描述。

---

## 18. 执行边界（详细文件地图已归档）

详细文件级范围见调研归档 §B「文件级实施范围」（[`archive/global-shell-product-closure-research-2026-09-13.md`](archive/global-shell-product-closure-research-2026-09-13.md)，§18.1–18.4）。实施时遵守：

- Schema/Core/现有 instance HttpApi 只组合只读 identity/permission projection，不复制 Custom Snapshot、Memory、KB 或 Artifact 正文；`packages/server` 只在现有公共 group 确实受影响时修改。
- App 复用 `ModeWorkspace`、typed side panel、`StatusBar`、`PromptInput` 和既有 Agent policy，不新建平行壳层或第二列表。
- E4 可复用既有 provider/fixture 语义，但不直接依赖其他 package 的私有 test internals；跨包提取必须有明确测试 owner。
- mock server 只承担 E3；E4 使用隔离真实 backend、临时数据目录和确定性 provider。
- 不手改 generated SDK/migration index，不加入 production E2E bypass，不用裸 localStorage、固定 sleep、`any` 或 catch-all 吞错。

### 18.5 协议门禁对齐（本次复审补充）

本计划会新增 Schema、Effect 服务、测试与用户可见文案，以下 `AGENTS.md` / `DESIGN.md` 约束是硬门，不是风格建议：

- **模块组织**：新增 schema 文件沿用 `packages/schema` 的自导出首行模式（如 `work-preset.ts:1` 的 `export * as WorkPreset from "./work-preset"`）；禁止新增 `export namespace`。`Schema.Class` 用于多字段记录，`Schema.brand` 用于单值，错误用 `Schema.TaggedErrorClass`，defect 载荷用 `Schema.Defect` 而非 `unknown`（`AGENTS.md` §Schema）。ADR-23 的 projection 类型必须带 `annotate({ identifier: ... })`，与既有 schema 一致，否则 OpenAPI snapshot 不稳定。
- **Effect 编码**：用 `Effect.gen` 组合、`Effect.fn("Domain.method")` 命名；禁止 `Effect.fork`/`forkDaemon`，只用 `Effect.forkIn(scope)`；优先 `Effect.void`。平台条件导入必须走 subpath，禁止直写 `.bun.ts`/`.node.ts`；已核验的 subpath 分属两个包——`packages/core` 提供 `#sqlite`/`#pty`/`#fff`，`packages/aigcfroge` 提供 `#db`（`package.json:25`），所以引用哪个 subpath 取决于你在哪个包里写代码。
- **测试双端**：新增 E1/E2 一律用对应包的 `testEffect(...)`（owner 为 `packages/core/test/lib/effect.ts`、`packages/aigcfroge/test/lib/effect.ts`、`packages/llm/test/lib/effect.ts`），不手写 runtime；stub 优先 `Layer.mock`。禁止 `Effect.sleep(N)`/`setTimeout` 等并发 fiber，改用 `pollWithTimeout`/`awaitWithTimeout`/`BackgroundJob.wait`/`Deferred` 等就绪信号。三种测试模式 `it.effect`（TestClock）/`it.live`（真实 OS）/`it.instance`（scoped tmpdir）的选择要与被测对象匹配——S9B 的 scheduler 到期测试若用 `it.effect` 的 TestClock，需注意既有教训：TestClock 会让并发 drain 测试挂起，必要时改 `it.live`。
- **i18n 事实纠偏**：`DESIGN.md` §Text And I18n 称词典覆盖 18 语言且有 parity 测试守完整性，但 `packages/app/src/i18n/parity.test.ts:3-11` 只校验 `zh`/`zht`（2026-07-31 语言策略：其余为冻结快照，缺键经 `language.tsx` 回退英文）。因此本计划新增文案的硬要求是 **en/zh/zht 三语齐全**，其余 locale 不补；所有 typed capability reason、恢复动作、错误页文案必须走 `useI18n()` 点分键，不得硬编码。**注意 capability reason code 本身是协议不是文案**（§4.2），两者要分开：code 稳定不翻译，展示文案走 i18n。
- **无障碍**：icon-only 按钮（含 §10 提到的 Custom 两个无名称按钮）必须由调用方传 `aria-label`（`IconButtonV2` 不兜底）；自定义控件优先基于 `@kobalte/core` 拿原生语义；对比度 4.5:1 / 3:1 无自动审计，只能人工用 DevTools 或 Storybook a11y addon 验证——所以 §16.2 的"axe 作为补充，不代替人工抽检"是仓库现状的必然结果，不是保守措辞。
- **e2e 类型检查**：`packages/app` 的 `typecheck` 已含 `tsgo --noEmit -p e2e/tsconfig.json`，且该 tsconfig 的 `include` 是 `["./**/*.ts", "../playwright.config.ts"]`。S2 新增的 `e2e/real/playwright.config.ts` 落在 `./**/*.ts` 内会自动被检查；但若 S2 把 real config 放到 `e2e/` 之外，必须同步扩 `include`，否则新 config 逃过类型门禁。

---

## 19. PR/提交切片

建议按以下 **11 个**可独立审查的 PR/本地切片交付，而不是一个超大 PR；这里的编号是实施切片，不是预授权提交：

1. `test(app): add real backend e2e harness`（S2）
2. `test(app): stabilize chromium regression suite`（S3）
3. `fix(app): fail closed on invalid session routes`（S4）
4. `feat(core): expose session product identity`（S1/S6：schema/core/现有 instance HttpApi/SDK，生成物只由脚本产生）
5. `fix(app): relocate permission and expose agents`（S6：只消费已合并 projection，不与 Core PR 混写）
6. `feat(app): preserve mode panels on narrow screens`（S7）
7. `feat(app): reconcile project and location identity`（S8）
8. `feat(work): close versioned artifact workflow`（S9A，Work-side custom Preset 若未获批不得混入）
9. `feat(assistant): enforce reminder scope lifecycle`（S9B-M1）
10. `feat(custom): verify snapshot lifecycle`（S9C）
11. `test(desktop): add packaged smoke coverage` 与 `docs: align product closure evidence` 分开交付（S10–S12；若证据量很小也不得把未相关的生成/文档噪声混入代码 PR）

每个切片只在前置切片合并或明确采用同一工作树策略后 rebase；不跨切片复制共享 schema。提交、push、PR 仍需 Owner 单独授权和 issue linkage。

技术债、当前分支适配和远程 Issue 的长表见调研归档 §C「技术债与远程 Issue 对账」（[`archive/global-shell-product-closure-research-2026-09-13.md`](archive/global-shell-product-closure-research-2026-09-13.md)）；远程评论、关闭、新建仍需单独授权。

---

## 20. 风险、停止条件与回滚

| 风险                                            | 检测/预防                                                                                 | 停止或回滚单位           |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------ |
| identity projection 变成第二真源                | ADR 指定只读组合；领域表仍是 owner；一致性测试                                            | S1/S6 整体回滚           |
| Work/Assistant migration 破坏历史 Session       | clean+existing fixture、compat decoder、backfill dry-run                                  | 各 migration 独立停止    |
| E4 harness 污染本机服务/数据                    | 动态端口、临时目录、network deny、teardown manifest                                       | S2，不进入后续           |
| provider cassette 泄密或过时                    | recorder redaction、allowlist、review cassette diff                                       | 单 cassette/fixture      |
| 全套“绿色”依赖 retry                            | retries=0、重复/换序运行                                                                  | S3 不放行                |
| 路由 fail-closed 误伤合法 alias                 | canonical alias E2/E4 matrix、可恢复 UI                                                   | S4                       |
| 窄屏贡献导致重复请求/remount                    | request count + store identity + resize tests                                             | S7                       |
| Custom test flag进入生产                        | artifact env scan + production smoke                                                      | S9C/CI                   |
| Desktop CI 不稳定                               | 独立 smoke、readiness signal、平台 owner                                                  | S11；不得降级为 Web 通过 |
| 文档提前宣布完成                                | current/target/evidence 三栏与 report append-only                                         | S12                      |
| permissionTier 被误当成 effective allow         | 复用 PermissionEffective/override owner；E2/E3 对照测试                                   | S1/S6                    |
| Work/Assistant 范围越过已批准 PRD               | M1/M2 与 Work custom-preset gate 分离                                                     | 对应 Slice 停止          |
| 自动重试未决 provider dispatch                  | 按安全 restart window 编排；禁止改变 V2 不变量                                            | S5                       |
| 计划命令/项目名不存在导致假验证                 | S2 先落地 config/script；最终命令只用已存在入口                                           | S2/S12                   |
| Custom drift 语义过宽破坏历史重放               | 内容 snapshot 与 live tool/MCP drift 分型测试                                             | S9C                      |
| `bun --cwd app test --timeout` 静默漏跑单测     | 裸写 `bun --cwd packages/app test`；与 `bun turbo test` 同入口                            | S0 起全程                |
| `bun --cwd <pkg> run <script>` 空绿 exit 0      | 唯一正确形式 `bun --cwd <pkg> <script>`；`docs/plan/` 被 lint 门禁豁免，只能靠人守        | S0 起全程                |
| `lint-changed` 以本地 main 为基线空绿           | 一律 `LINT_BASE_REF=origin/main`（本分支 ahead 9）                                        | 每个切片交付前           |
| 新增文案只写英文或误补 18 语言                  | parity 测试实际只校验 zh/zht；硬要求 en/zh/zht 三语，reason code 与展示文案分离           | S6 起涉文案切片          |
| 新 endpoint 缺 identifier 致 SDK 方法 undefined | S1 RED 断言生成后的 SDK 方法可调用；无门禁会报错                                          | S1/S6                    |
| 把 `closed:false` 附件误当门禁                  | 认清 `testInfo.attach` 不会失败；S7 必须替换为 `expect()`                                 | S7                       |
| Custom 测试蹭 env 致 CI 挂                      | 测试自管 `AIGCFROGE_CUSTOM_MODE`；`env -u` 单跑判别                                       | S9C                      |
| 展示矩阵标签化收窄丢覆盖                        | 标签、config `grep`、CI 命令、`docs/testing.md`、`presentation-matrix.spec.ts` 五处同步改 | S3                       |

必须停止整个流程的条件：D1–D8 未批准；发现需要改变 V2 Session durable admission 不变量；需要向第三方发送代码/数据；需要破坏性 Git/DB 操作；无法隔离用户现有服务或未提交工作；migration 无兼容/回滚设计。

---

## 21. Definition of Done

### 证据与工程

- [ ] E1–E4 分层清楚，coverage manifest 无关键 orphan。
- [ ] 实施期重新发现的基础 Chromium `N0 tests / N0 files` 连续与换序绿色，失败不靠 retry/sleep。
- [ ] real Session/File/PTY 生命周期绿色且无资源泄漏。
- [ ] App/Core/Server/Schema/Desktop tests、typecheck、lint、diff、protocol refs 通过。
- [ ] production benchmark 有前后原始数据和解释。

### 产品与安全

- [ ] Header/List/Gate 使用同一 SessionProductIdentity projection；声明 tier 与 effective permission 没有混淆。
- [ ] Work、Assistant、Custom 的身份与 capability 不再由 UI 推断；未批准能力明确为 `unsupported/degraded`。
- [ ] 路由 unknown/404/malformed fail closed，Prompt 不留 URL/history，合法 query/hash 白名单有契约测试。
- [ ] 窄屏可达所有已批准模式关键 panel，键盘/focus/a11y 完整；200% 使用真实缩放证据。
- [ ] 已批准范围内 Work/Assistant M1 有 E4；Custom 有真实 gate 和隔离启用 E4；不把 deferred post-crash continuation 当通过。
- [ ] offline/附件/导出/path/HTML/permission 失败可恢复且不泄密；未纳入本批次的 M2 能力有明确 residual risk。
- [ ] Desktop 证据与 Web 证据分开签字。

### 文档

- [ ] `coding` 默认值、`product-mode-custom-v1`、五模式已实现/Custom 默认关闭等事实一致。
- [ ] Chat/Work/Assistant/Custom/Home/Settings 页面文档区分 current、target、verified。
- [ ] 报告只追加结果/errata，不抹掉历史失败。
- [ ] technical debt 只关闭有证据的项；每个关闭项引用实际命令/产物/测试，不引用 discovery 数字代替通过证据。
- [ ] 所有最终命令均在当前 package scripts/config 中存在，或在本 Slice 明确创建并被 typecheck/CI 验证。特别地：app 单测裸写 `bun --cwd packages/app test`（不加 `--timeout`、`--cwd` 后不加 `run`）；`e2e/real/playwright.config.ts` 与 `chromium-real` project 由 S2 创建后方可引用；desktop launch smoke 走独立脚本名，不并入 `bun test` 的 `test` 脚本。
- [ ] 每个切片交付前跑过 `LINT_BASE_REF=origin/main bun run script/lint-changed.ts`（默认本地 `main` 基线会空绿）与完整 `bun run lint`（含 `check-unawaited-assertions`）。
- [ ] 新增用户可见文案 en/zh/zht 三语齐全并走 `useI18n()` 点分键；capability reason code 作为协议保持稳定、不随文案翻译；icon-only 按钮均显式传 `aria-label`。
- [ ] 新增 Effect 代码用 `Effect.gen` + `Effect.fn("Domain.method")`、`Effect.forkIn(scope)`；新增测试用对应包的 `testEffect(...)` 与 `Layer.mock`，无 `Effect.sleep`/`setTimeout` 等并发 fiber。
- [ ] 新增/修改的 HttpApi endpoint 均带 `OpenApi.annotations` identifier，且有一条断言证明生成后的 SDK 上该方法可调用（缺 identifier 无门禁报错）。
- [ ] 被本计划改写的既有 spec（`unknown-route` 三处、`canonical-session-route` 两处、`legacy-session-route` prompt 丢弃、`new-session-route` dirty-guard 阻断、`mode-detail-personas` 三处 `closed:false` 观察）全部从"钉住缺陷"转为"钉住正确行为"，且 mock server 已能表达 404。

---

## 22. 执行前必须确认的 Owner gate

- [ ] 是否允许在当前 `global-shell-e2e` worktree 继续，或由 Owner 指定新 worktree；不得由执行 agent 猜测。
- [ ] 是否批准新增 ADR/migration/HTTP endpoint；未批准前只做 S0、测试 RED、契约草案和只读调研。
- [ ] 是否把 Assistant M2 Memory/KB、Work-side custom Preset、附件/导入导出和 Desktop packaged smoke 纳入本次 release scope；未确认项保持 conditional。
- [ ] 是否允许按第 19 节切片修改代码；commit/push/PR/Issue 另行授权。

## 23. Owner 审批模板

```text
审批结论：APPROVED / APPROVED WITH CHANGES / REJECTED

D1 E1–E4 证据分层：
D2 SessionProductIdentity 只读投影：
D3 Work 版本合同与复用 Workflow/Asset：
D4 Assistant personal/project scope：
D5 Custom 保持 immutable snapshot + kill switch：
D6 路由 fail-closed 与 Prompt URL 清理：
D7 共享窄屏 panel：
D8 Desktop 独立 Gate：

允许实施到：
- 仅 S0 基线
- S0–S2 harness/ADR
- S0–S6 共享底座
- 全部 S0–S12

Git 授权：
- 仅本地修改
- 允许按 PR 切片 commit
- 允许 push/创建 PR（需 issue 编号：____）

对当前未提交 worktree 的处理：继续当前分支 / 新建 worktree / 其他：____
```
