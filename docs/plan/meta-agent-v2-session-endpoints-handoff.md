# Meta-Agent V2 闭环 — Session 端点移植 Handoff

> **用途**: 新对话接续的完整上下文快照
> **更新**: 2026-07-08
> **分支**: `meta-v2-closure`
> **主方案**: [meta-agent-v2-production-closure.md](meta-agent-v2-production-closure.md)

---

## 0. 一句话现状

Range 1（前台派生+返回结果）和 Range 2（background 后台委托+synthetic 注入）**已提交**。
Range 3（V1 task tool 6 项功能对齐）**全部完成**（未提交，在 working tree）：

| 范围 | 任务 | 状态 |
|---|---|---|
| batch A | task_id resume + retry + foreground abort + attended | ✅ 完成 |
| batch A | background extend（task_id 命中运行中 job） | ✅ 完成 |
| scope 升级 | attended 模式（字段→DB→configured→UI 标识→设置开关） | ✅ 完成 |
| ⑥ | 后台 abort 级联传播 | ✅ 完成 |
| ② | external-cli 迁移（CliTimeout 移 core + opencode + 4 适配器 + 去重） | ✅ 完成 |
| — | 前端设置开关（V1 settings + V2 settings + server config 贯通） | ✅ 完成 |
| — | 测试（session-task 10 + permission 13，全部通过） | ✅ 完成 |
| — | V1 适配器代码去重（6 文件改为 re-export core） | ✅ 完成 |

**剩余 unplanned**：share + fork 两批未做（待独立排期）。

---

## 1. 已完成并提交（git HEAD = `041463e`）

### 已提交

- `041463e feat: add background subagent delegation to V2 task tool`（Range 1 + Range 2）
- `3f8d2b2 feat: add V2 task tool for subagent delegation`（Range 1 基础）

### Range 3 完成（working tree，待提交）

**关键成果：V2 task tool 功能对等 V1**

| 功能 | V1 路径 | V2 路径 |
|---|---|---|
| 前台派生 | `executeCLI` + `runTask` | `TaskDriver.delegate`（seam）|
| 后台派发 | `delegateBackground` | `TaskDriver.delegateBackground`（seam）|
| task_id 续接 | `task_id` → `sessions.get` → 复用 | `task_id` → `SessionV2.create` idempotent |
| 重试+孤儿清理 | `Effect.retry` + cancel orphan | 同左（DelegateError 判定）|
| 前台 abort | runner interrupt → fiber cancelled | `Effect.onInterrupt` → `TaskDriver.cancel` |
| 后台 abort 级联 | —（V1 无等同需求） | `SessionV2.interrupt` cascade `store.children` |
| attended 模式 | `deriveSubagentSessionPermission`（Ruleset） | `session.attended` 布尔 → `configured` ask→deny |
| background extend | `task_id` + running → append | `BackgroundJob.extend`（seam）|
| external-cli | `AdapterRegistry` + `CliTimeout`（aigcfroge） | `TaskDriver.executeCLI` seam + core CliAdapter/CliTimeout |
| 子会话权限 | Ruleset 合并 | `attended` 布尔（V2 PermissionV2 简化）|

### 已验证基线

- core: 1050 pass, 6 fail（**pre-existing**：Git worktrees/ProjectCopy/DatabaseMigration/LocationServiceMap）
- typecheck: schema/core/server/aigcfroge/app/sdk 全 0 err（root tsgo）
- lint: 2 pre-existing errors（desktop/electron.vite.config.ts, tui/error.test.ts）
- session-task: 10/10 × 5 rerun（无竞态）
- permission: 13/13

---

## 2. 剩余任务

### 任务 A：fork（最高难度）

**现状**：V2 完全无 fork（core/server/事件契约全无）。上游 V2 native 也无 fork（同 shell/share，无可移植 V2 参考）。specs/v2 无 fork 设计意图。

**V1 fork 逻辑**（[aigcfroge/src/session/session.ts:690](../../packages/aigcfroge/src/session/session.ts#L690)）：createNext 新 session → 读投影后 messages/parts → 映射 ID（idMap: 旧 messageID→新）→ 到 messageID 边界停 → updateMessage/updatePart 到新 session，重写 parentID + compaction tail_start_id 引用。

**V2 的核心难点（event-sourced）**：
- `session_message.id` 是全局主键 → fork 必须重写所有 messageID
- messageID/assistantMessageID 散布在 **~24 个事件类型**的 data 里
- `replayAll`（[event.ts:472](../../packages/core/src/event.ts#L472)）严格校验：同一 aggregate + seq 严格连续 + aggregateID 从 `data[durable.aggregate]`（sessionID 字段）提取

**两条路线（未决，需用户拍板）**：
- **路 A（事件复制 + replayAll，event-sourced 原生）**：读源 durable 事件 → 重写 sessionID + 重映射所有 messageID → replayAll 到新 aggregate。最贴架构，**但高风险**：24 事件类型 ID 重写遗漏会污染事件存储（难逆转）+ seq/replayAll 严格守卫易踩坑。
- **路 B（投影层复制，V1 式务实）**：读源投影后 SessionMessage[] → 为新 session 合成线性 Prompted/settled 事件序列。保真度低（丢 delta 细粒度），但 fork 语义只需"模型可见对话历史"续接 prompt，settled 够。风险低（不碰源事件存储）。

**用户上次指示**：先看 `/home/keer/Documents/web/cc`（另一个 opencode fork）的 fork 实现再定 A/B。已确认该项目存在，fork 引用在 [cc/packages/opencode/src/session/index.ts]。**新对话应先读 cc 的 fork 逻辑**，判断它是否有 event-sourced fork 的可借鉴模式，再定 A/B。

**V1 fork 端点**：`session.fork` POST，payload = ForkInput omit sessionID（含可选 messageID 边界）。handler 有 forkRaw（空 body 兜底）。

### 任务 B：share（高难度 + 触及外部数据传输）

**现状**：V2 core 只有 `SessionShareTable`（[share/sql.ts](../../packages/core/src/share/sql.ts)）+ `AccountV2` 的 sql.ts（无 service）。**无 SessionShare service、无 ShareNext、无 share 事件契约**。上游 V2 native 也无 share 端点。

**specs/v2 裁决**：share 保留（[config.md:150](../../specs/v2/config.md#L150) "keep `manual|auto|disabled`"）。非否决（不同于 command）。

**V1 实现依赖链庞大**：
- `SessionShare.Service`（[aigcfroge/src/share/session.ts](../../packages/aigcfroge/src/share/session.ts)）：share/unshare/auto-share，依赖 Config/Session/ShareNext/RuntimeFlags
- `ShareNext.Service`（[aigcfroge/src/share/share-next.ts](../../packages/aigcfroge/src/share/share-next.ts)）：**网络 sync/remove/data 到外部 share server**，依赖 Account/EventV2Bridge/Config/Provider/Session
- V1 端点：`session.share`(POST) / `session.unshare`(DELETE)

**⚠️ 安全性质**：share 把会话消息同步到外部 `share.example.com`。属 `<safety_guardrails>` 的"传输用户数据到第三方 / outward-facing"高风险类别 — 实现/接线前需向用户明确授权，Clean Logs 复查（禁泄露 token/url secret）。

**工作量判断**：整个 share 子系统未建（非补端点）。需从零建 V2 SessionShare + ShareNext + Account service + share 事件契约。工作量可能超过前 4 批之和。

---

## 3. 项目边界（强制遵守）

- 仓库: `/media/keer/办公/aigcfroge`（协议见 CLAUDE.md/AGENTS.md/ARCHITECTURE.md + `.aigcfroge/skills/{effect,database,frontend-theming}`）
- 测试: 只单包 `bun --cwd packages/<name> test --timeout 30000`，**禁根目录跑**
- 类型: `bun --cwd packages/<name> typecheck`（tsgo，非 tsc）
- SDK: codegen 产物，改后端 schema 后必须 `bun dev generate`（在 packages/aigcfroge）+ `packages/sdk/js/script/build.ts` 重生。**用绝对路径跑**（bash cwd 会漂移）
- 迁移: `bun script/migration.ts`（packages/core）**自动生成**，禁手写迁移 + schema.gen.ts；无 down；snake_case
- 上游对比: `/home/keer/Documents/web/opencode-dev`（opencode 品牌，移植需改名）；另有 `/home/keer/Documents/web/cc`（fork 参考）
- 模块: `export * as Foo from "./foo"` 自导出；Effect.gen + Effect.fn("Domain.method")；禁 Effect.fork（用 forkIn）；yield* new MyError()

## 4. 改完即审流程（每批必走）

1. git diff 锁定影响面
2. 安全门禁：Catch Everything / No Null Pointer / Security First（**share 特别注意外部数据传输 + Clean Logs**）
3. 工程门禁：No Cheating / Reusability / Clean Logs
4. 数据流追踪 + Layer provide 确认
5. 命令验证：lint + 受影响包 typecheck + **受影响包 test**
6. 事件驱动强约束：**加进 SessionEvent.All union 的事件必须在 message-updater 的穷尽 handler map 加 case**（否则全仓 typecheck 级联报错）
7. runner 新依赖需在 3 个测试文件（session-runner/session-runner-recorded/smoke-v2）加 stub

## 5. 记忆

- `meta-agent-v2-closure-decision` — 4 批进度 + 剩余 share/fork
- `upstream-v2-session-comparison` — 上游 V2 无 shell/share/fork 可移植实现（handoff 前提屡过时，须自查）
