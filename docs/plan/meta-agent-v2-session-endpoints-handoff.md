# Meta-Agent V2 闭环 — Session 端点移植 Handoff

> **用途**: 新对话接续的完整上下文快照
> **更新**: 2026-07-06
> **分支**: `meta-v2-closure`
> **主方案**: [meta-agent-v2-production-closure.md](meta-agent-v2-production-closure.md)

---

## 0. 一句话现状

弃 V1 全切 V2 的接线闭合工程。6 个缺失 session 端点中 **4 批已完成并验证**（inbox 地基 + abort/children + shell + skill），**剩 share + fork 两批未做**。

⚠️ **关键：4 批工作全部未提交**，仍在 working tree（`git log` HEAD = `c21bd96`；之前对话里"提交 8afac152b"的记录与实际 git 状态矛盾，以 `git log` 为准）。新对话第一步应先真正提交，再动 share/fork。

---

## 1. 已完成（未提交，在 working tree）

### 核心成果：V2 durable inbox contract（三 kind union）

`SessionInput.Admitted` 从单一 `prompt` 字段改为 `Schema.Union` + `kind` 判别式（`prompt`/`shell`/`skill`），三者共用 `session_input` 表 + durable inbox，但生命周期不同构：

| kind | 生命周期 | delivery |
|---|---|---|
| prompt | admit → promote → `Prompted` → user message → LLM turn | steer（默认） |
| shell | admit → runner drain 边界 spawn 子进程 → `Shell.Started`/`Shell.Ended` → shell message（**不进 LLM turn**） | queue |
| skill | admit → promote 边界经 SkillV2 解析 name→content → emit `Prompted`（**复用 prompt 路径**） | steer |

### 已改文件（4 批累计）

- `packages/schema/src/session-input.ts` — Admitted union（AdmittedPrompt/Shell/Skill）
- `packages/core/src/session/sql.ts` — session_input 表加 `kind`/`command`/`skill` 列，prompt 改 nullable
- `packages/core/src/database/migration/20260705170359_session_input_kind.ts` — 表重建（relax prompt NOT NULL + 加 kind/command，回填 kind='prompt'）
- `packages/core/src/database/migration/20260706021802_session_input_skill.ts` — 加 skill 列（ALTER ADD）
- `packages/core/src/database/{migration.gen.ts,schema.gen.ts}` + `schema.json` — 迁移注册 + 基线 DDL（由 `bun script/migration.ts` 生成，非手写）
- `packages/core/src/session/event.ts` — 加 `ShellAdmitted`/`SkillAdmitted` 事件 + All union
- `packages/core/src/session/input.ts` — admitShell/admitSkill + projectShellAdmitted/projectSkillAdmitted + nextPendingShell/pendingSkillSteers/markPromoted + equivalentShell/equivalentSkill + hasPending 加 kind 参数 + matchesProjection kind-aware
- `packages/core/src/session/message-updater.ts` — shell.admitted/skill.admitted no-op（穷尽 handler map 强制）
- `packages/core/src/session/projector.ts` — 注册 ShellAdmitted/SkillAdmitted 投影 + Shell.Started 扩展调 markPromoted
- `packages/core/src/session/runner/llm.ts` — drainShell（timeout/uninterruptibleMask 保证 Shell.Ended/location fence）+ promoteSkills（用 admitted.timeCreated 非 wall-clock）+ run loop shell drain phase + shell-only 跳过空 LLM turn（forceTurn 一次性）
- `packages/core/src/session.ts` — shell/skill 门面（admitShell/admitSkill + wake + equivalent 校验），children 门面 + interrupt
- `packages/core/src/session/store.ts` — children SQL 方法
- `packages/server/src/groups/session.ts` + `handlers/session.ts` — 端点：children(GET) / interrupt(POST，即 abort) / shell(POST) / skill(POST)
- `packages/sdk/**` + `packages/sdk/openapi.json` — SDK 重生（bun dev generate + build.ts）
- `packages/aigcfroge/src/effect/app-runtime.ts` — Phase 0 的 `AIGCFROGE_V2_RUNTIME` flag
- 测试：session-children/session-shell/smoke-v2（新建）+ session-runner（shell/skill drain 测试，skill 用 **it.live** 捕获真实时钟 bug）+ session-create/session-prompt/session-runner-recorded（union 适配 + AppProcess/SkillV2 stub）+ database-migration（upgrade 测试）

### 验证基线（当前 working tree）

- core: 1042 pass, 1 fail（**pre-existing 无关**：`ProjectCopy > requires force to remove a dirty git worktree`，it.live git 测试）
- typecheck: schema/core/server/sdk/aigcfroge/app/tui/desktop/session-ui 全 0 err
- lint: 0 err
- migration --check: pass + 17 migration 测试 pass

### 已修的关键 bug（审批发现）

- **shell（Stage 2 审批，6 major）**：drainShell 无 timeout / Shell.Ended 不保证（uninterruptibleMask+exit）/ 门面缺 equivalent / 无 location fence / shell-only 空 turn / 无测试
- **skill（CRITICAL）**：promoteSkills 曾用 `timestamp: yield* DateTime.now`（promotion 时刻），但 projectPrompted 的 matchesProjection 比较 admission 时刻 → 真实时钟下崩溃（LifecycleConflict defect）。已修为 `admitted.timeCreated`。TestClock 冻结在 0 掩盖了它 → 测试改 it.live 对抗验证（回退失败/恢复通过）

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
