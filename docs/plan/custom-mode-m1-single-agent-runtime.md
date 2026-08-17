# Custom Mode M1 实施计划：单 Agent 可恢复运行闭环

> 状态：**Blocked by M0 + G2/G3 - 不得提前实现**
> 分析基线：`main@e0e0f970f`（2026-08-17）；执行基线为 M0 全部合入后的最新 `main`
> 范围：`packages/schema` + `packages/core` + `packages/aigcfroge` + `packages/app` + `packages/sdk/js` + migrations/specs
> 前置：[Custom Mode M0](custom-mode-m0-composition-foundation.md)
> 上级计划：[Custom Mode 组合平台实施计划](custom-mode-composition-platform-implementation.md)

---

## 0. M1 目标与硬边界

M1 证明唯一拓扑的完整闭环：

```text
Location -> temporary/Profile composition -> Plan -> server re-freeze
-> atomic Session(mode=custom, root=meta) + immutable Snapshot
-> meta delegates exactly one Snapshot Agent
-> Snapshot Prompt/Skill/native tools
-> resume/fork/move/dependency recheck
```

M1 对应总计划 `PR 5-PR 8`。它不是“七类资产自由运行”的 MVP。

### 0.1 禁区

- 用户 Agent 不得成为 root；root 固定 `meta`。
- 不支持多 Agent、Command、Workflow execution、MCP、Plugin runtime、external CLI、judge、`run_code`。
- 不把 Snapshot 放进 `session.metadata`、transcript、Profile 或 Context Epoch。
- 不先 create Session 再由客户端 PATCH Snapshot。
- 不把 allowlist 只写进 Prompt；task 与 child create 必须双层强制。
- 不在运行中采用最新资产；升级只能 fork/new Session。

## 1. 开工 Gate

| Gate         | 通过标准                                                                                          | 阻塞内容            |
| ------------ | ------------------------------------------------------------------------------------------------- | ------------------- |
| G1 M0        | M0 contracts/Profile/bridge/Resolver 全部合入；old-client matrix 绿                               | 全部 M1             |
| G2 V2 native | Custom create/prompt/resume/interrupt/fork 由唯一 runtime policy 强制 V2；auth/message shape 验证 | Snapshot start/执行 |
| G3 Security  | Snapshot 真源、stable native-tool fingerprint、Custom ceiling、task+child 双门禁批准              | Runner/委派         |
| G4 App       | 最新 ModeWorkspace owner、Location owner、Draft helper、side panel slot 评审                      | App Phase           |

Feature flag 不能代替 Gate。G2/G3 未通过时 capabilities/start 必须 fail closed。

## 2. 五层交付

| 层                  | M1 交付                                                            | 核心不变量                                                 |
| ------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------- |
| L1 Schema           | Snapshot/start/upgrade/dependency status、mode/session wire 完整化 | versioned、无 secret、旧 client typed unsupported          |
| L2 Core/DB          | Snapshot 独立表、SessionComposition、原子 createCustom             | 一个 Session 一个 Snapshot，无 orphan                      |
| L3 HTTP/SDK         | start/get/upgrade + runtime policy 委托                            | handler thin，客户端不能传 Snapshot                        |
| L4 App              | Custom slot、Builder/Preview/Draft/start/Snapshot panel            | 复用共享 shell，Draft 不是真源                             |
| L5 runtime/security | Runner inputs、tool fingerprint/allowlist、ceiling、dual gate      | definition=settle effective set，runtime permission 重评估 |

## 3. 分阶段实施

### Phase A：Snapshot persistence 与迁移

**红**：clean/existing DB migration；Snapshot Schema v1 decode；Session FK cascade；每 Session 唯一；坏 JSON/version typed failure；内容型与运行依赖字段分层；无 secret 字段。

**绿**：

- 新增 `session_composition_snapshot` 表和 `SessionComposition` typed owner。
- 走 drizzle/migration generator 与 `schema.gen.ts`/`migration.gen.ts` 管线，不手写游离 SQL。
- 提供 attach/read/copy/assertDependency 接口；Snapshot bytes/digest 一旦写入不可 update。

**重构**：Snapshot owner 不读取活动 Profile 替换旧值，不承担 Context Epoch 或 permission grant。

**验证**：Core migration focused tests（clean + existing + rerun）/Core test/typecheck/lint/diff。

### Phase B：原子 start 与唯一 V2 runtime policy

**红**：

- re-freeze 成功后 Session+Snapshot 同事务提交；freeze/insert/event 任一点失败均无半状态。
- exact retry：同 session id + digest 幂等，不同 digest conflict。
- flag off、G2 unavailable、stale Plan、missing dependency、wrong M1 kind/cardinality fail closed。
- global V2 flag true/false 下 Custom 始终走同一 V2-native路径；四模式保持既有策略。
- Custom 无 Snapshot 时 prompt/resume 拒绝。

**绿**：复用 `SessionV2.create` 内部构造/投影路径，增加 `createCustom` domain transaction；新增 start/get API 和唯一 runtime policy owner。

**重构**：不得在 handlers 散落 `AIGCFROGE_V2_RUNTIME || mode === "custom"`，不得复制 Session create。

**验证**：Core transaction/Session tests、AigcForge HTTP/auth/exerciser、SDK regeneration/typecheck。

### Phase C：Runner、Skill catalog 与 Tool materialization

**红**：

- root system = platform + Custom + Snapshot instructions；selected Agent 内容只进入委派目标。
- Skill guidance/lookup 只见 Snapshot-local catalog。
- native tool fingerprint 对规范 definition 稳定，版本/schema/name/placement 变化产生 drift。
- `materialize` allowlist 同时限制 definitions 与 captured settle；未知/stale/removed registration 不执行。
- 非 Custom caller 不传 allowlist时行为零回归。

**绿**：扩现有 `ToolRegistry.materialize` options；新增稳定 native fingerprint；Runner 按 Snapshot 组装 context/skill/tool facts。

**重构**：保留进程对象 identity 的 provider-turn stale rejection；stable fingerprint 只做跨 turn/恢复依赖匹配，不能持久化 executor。

**验证**：tool registry contract、runner recorded/failure/interruption tests、Core suite/typecheck。

### Phase D：Custom ceiling 与委派双层门禁

**红**：

- root 总是 meta；直接替换 root 拒绝。
- task 只允许 Snapshot Agent；task precheck 与 `SessionV2.create({parentID, agent})` 防线分别有绕过测试。
- external-cli/judge/background multi-agent/task recursion 拒绝。
- foreign resume id、child digest mismatch、changed Agent identity、missing runtime dependency 拒绝。
- Profile/requestedCapabilities/saved approval/presentation 不能提升 Permission deny。
- root interruption 停止 child/tool fiber，不发伪成功；不使用 sleep。

**绿**：新增 `SessionComposition.assertAgentAllowed`；接入 task 和 child create；Custom ceiling进入 `PermissionEffective` 唯一 owner；Runner 每次执行重评估 PermissionV2。

**重构**：Resolver 解释能力、Permission owner 计算有效规则、leaf tool 最终授权，三者不得互相复制。

**验证**：Core permission/task/session/security focused + full Core suite/typecheck/lint。

### Phase E：App Custom surface

**红**：

- mode registry/href/route/slot、render-all + `display:none`、切换不 remount。
- Location/Profile/temporary composition、exact-one Agent、Prompt/Skill binding、四预览 Tabs。
- Draft composition 恢复；start stale 保留用户选择；成功进入 canonical Session route。
- flag off、old server、empty/loading/error/dependency/version drift/starting/read-only states。
- Snapshot panel 只读；upgrade 创建 fork/new Session。
- desktop/narrow、light/dark、keyboard/focus、18 locale parity、English/Chinese overflow。

**绿**：扩 `MODE_DEFINITIONS`/`MODE_SURFACES`/typed slots；复用最新 Location owner、mode launch helper、shared Session rows/timeline/composer/side panel；实现 Builder/Preview/Draft/start。

**重构**：Builder 三列位于主区 unframed layout；窄屏 steps/tabs/drawer；不创建 `/custom/*` shell、不嵌套页面 cards。

**验证**：App unit/typecheck、target Playwright、Storybook、现有 mode geometry/benchmark、lint/diff。启动本地 dev server并提供 URL供人工验收。

### Phase F：恢复、fork、move 与升级

**红**：

- 同一 Profile 两个 Session 有独立 Snapshot row。
- child/fork 拥有独立 Snapshot row且 digest按契约复制。
- Profile 删除后历史可读；内容资产删除后冻结内容可回放；运行依赖缺失明确阻断。
- move 保留 Snapshot、reset Context Epoch并在目标 Location重检；不匹配拒绝继续。
- upgrade 重新解析/冻结，只创建新 Session/fork，不更新旧 Snapshot。

**绿**：接入 canonical child/fork/move/resume owner和 upgrade API/UI action。

**重构**：所有运行依赖检查经 `SessionComposition`，不在 handler/App 复制。

### Phase G：50 次基线、灰度与文档收口

- 执行 50 次矩阵：temporary/profile、stale、delete、resume、fork、move、permission deny、interrupt、old client。
- 指标：Plan >=98%、preview->start >=95%、Snapshot consistency=100%、unauthorized/silent upgrade/fallback=0。
- 演练入口 flag 与 execution kill switch；关闭后保留历史读取，不删除数据。
- 同步 ADR/PRD/Roadmap/technical debt/schema changelog/operator notes。

## 4. 每个小节的 TDD/复查循环

每个 slice 必须执行：读取 owner/调用方/近邻测试和 Git 历史 -> reuse table -> 红 -> 绿 -> 重构 -> focused test/typecheck -> `CLAUDE.md` 改完即审 -> 重读相关协议/skill/计划小节 -> lint/diff -> 继续。

每次复查结论固定包含：

```text
复查结论:
- M / Phase / slice / 基线 / 分支:
- 影响文件与五层数据流:
- reuse table 摘要:
- Catch Everything / No Null Pointer / Security First:
- No Cheating / Reusability / Clean Logs:
- 红测试与绿测试证据:
- 已运行命令:
- 剩余风险与下一 slice:
```

Phase 内验证全绿后可按已批准的执行授权继续下一 slice；M1 完成后必须停止等待 M2 Gate，不能自动跨 M。

## 5. M1 最终协议与测试门禁

```bash
bun --cwd packages/schema test --timeout 30000
bun --cwd packages/schema typecheck
bun --cwd packages/core test --timeout 30000
bun --cwd packages/core typecheck
bun --cwd packages/aigcfroge test --timeout 30000
bun --cwd packages/aigcfroge run test:httpapi
bun --cwd packages/aigcfroge typecheck
./packages/sdk/js/script/build.ts
bun --cwd packages/sdk/js typecheck
bun --cwd packages/app run test:unit
bun --cwd packages/app typecheck
bun --cwd packages/app run test:e2e e2e/regression/custom-mode.spec.ts
bun --cwd packages/app run test:bench
bun --cwd packages/storybook build
bash .aigcfroge/skills/protocols/scripts/check-refs.sh
bun run script/lint-changed.ts
bun typecheck
bun run lint
git diff --check
```

数据库必须额外提供 clean/existing/rerun migration 证据；HTTP 必须提供 coverage+auth exerciser；UI 必须提供 desktop/narrow、主题、键盘、三语截图或视频。

## 6. 停止条件

- M0/G2/G3/G4 任一没有批准证据。
- 原子 start 无法保证 Session/Snapshot/Event 同一 durable outcome。
- Custom 仍可能落到 V1、无 Snapshot 执行或旧 client 误解 Coding。
- definitions 与 settle effective set 不一致，或 allowlist 只存在 Prompt/UI。
- 需要支持 M2-M5 能力才能完成 M1。
- 任一行为/迁移/HTTP/UI/security gate 失败。

## 7. 分支策略

- M1 不从今天的 main 提前切长期分支；必须从 M0 全部合入后的最新 `main` 开始。
- 每个可独立合并 slice 从当时最新 main 建短分支：`custom-snapshot`、`custom-runtime`、`custom-security`、`custom-surface`、`custom-rollout`。
- 后一 slice 必须包含前一 slice 已合入 main 的结果；不建议把五层改动长期堆在单一 `custom-mode` 巨型分支。
- 本 M 合入并复审后才可设计/启动 M2 实现分支。
