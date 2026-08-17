# Custom Mode M0 实施计划：治理与组合底座

> 状态：**Draft v1.0 - 等待 ADR-17 / Custom PRD 正式批准后进入代码阶段**
> 分析基线：`main@e0e0f970f`（2026-08-17）；执行基线必须是开工时最新、已同步并通过前置 Gate 的 `main`
> 范围：治理协议 + `packages/schema` + `packages/core` + `packages/aigcfroge` + `packages/sdk/js`；不创建 Custom Session，不开放 App 入口
> 上级计划：[Custom Mode 组合平台实施计划](custom-mode-composition-platform-implementation.md)
> 后继计划：[Custom Mode M1](custom-mode-m1-single-agent-runtime.md)
> 依据：[ADR-17](../architecture/adr/ADR-17-custom-mode-composition-platform.md)、[Custom PRD](../prd/custom-mode-composition-platform.md)、[Custom Roadmap](../roadmap/custom-mode-roadmap.md)、[Session V2](../../specs/v2/session.md)、[V2 Tools](../../specs/v2/tools.md)

---

## 0. M0 目标与边界

M0 只回答五个问题，并用可执行契约证明答案成立：

1. 第五个固定 Product Mode 如何兼容旧客户端，而不是被误解为 Coding。
2. `custom-profile` 如何成为独立 typed asset owner，而不是 Agent Asset 的附属字段。
3. Agent/Prompt/Skill 如何被统一解析为确定性 Composition Plan。
4. Plan、Snapshot、Context Epoch、Draft 各自归谁所有，生命周期如何分离。
5. M1 启动前，哪些运行、安全和持久化接口已经被定义，但尚未开放执行。

M0 对应总计划的 `PR 0-PR 4`：治理、Schema/兼容、Profile owner、Agent/Skill bridge、Resolver/Plan API。

### 0.1 明确非目标

- 不创建 `mode=custom` Session，不写 `session_composition_snapshot` 数据。
- 不实现 `/custom-composition/start`、Runner 注入、Tool allowlist 或 task 委派。
- 不开放 `/mode/custom`，feature capability 必须报告不可运行。
- 不接受 MCP、Command、Workflow、Plugin 或 Code Presentation 作为 M0/M1 Profile input。
- 不复制 Workflow/Plugin handler 内联事务，不新增第二 Asset/Agent registry。

## 1. Gate 与决策真源

| Gate          | 条件                                                                     | 未通过时允许做什么               | 阻塞范围         |
| ------------- | ------------------------------------------------------------------------ | -------------------------------- | ---------------- |
| G0-A 产品治理 | ADR-17 Accepted；Custom PRD Approved；旧 ADR/PRD amend/supersede 完整    | 只改文档、测试设计和 Schema 草案 | 所有生产代码     |
| G0-B 兼容     | Product/Core/App/Schema+SDK 接受 capable-client 与 unsupported-mode 矩阵 | 可写失败测试，不扩公开 enum      | Phase B-F        |
| G0-C 真源     | Profile/Plan/Snapshot/Context Epoch owner 与 Profile YAML 契约批准       | 只完成 ADR 修订                  | Phase C-F        |
| G0-D 范围     | M1 固定一个当前 Location 用户 Agent + Prompt/Skill + native              | 不接受长期模型字段               | Profile/Resolver |

治理文档里的“建议”不等于签字。执行者必须记录批准证据；拿不到证据就完成 Phase A 的修订草案并停止。

## 2. 五层影响与复用表

| 层             | M0 owner                                  | 复用                                                             | M0 交付                                                         | 禁止                              |
| -------------- | ----------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------- |
| L1 Schema/wire | `packages/schema`、OpenAPI、SDK           | `ProductMode`、`AssetKindId`、`Schema.Class`/brand/error         | 五值 contract、Profile/Plan/Snapshot v1、capability negotiation | 把未知显式 mode default 为 Coding |
| L2 Core        | typed asset services、Location registries | Prompt/Skill/MCP/Command/Agent 的 registry + `FileMutation` 模式 | Profile owner、Agent/Skill bridge、Resolver                     | 复制 Workflow/Plugin 内联事务     |
| L3 HTTP/SDK    | HttpApi group/handler、generator          | 现有 asset group、capabilities、Location middleware              | Profile CRUD、Plan、typed unsupported                           | start/create Session              |
| L4 App         | 当前只做兼容消费者                        | `isMode`、badge/list 的 unknown handling                         | 能识别 unsupported，不显示入口                                  | Builder/Custom slot               |
| L5 runtime     | 只定义后继契约                            | Session V2、ToolRegistry、PermissionV2                           | Snapshot/runtime interfaces 的 Schema 与测试夹具                | 执行、委派、工具注册              |

每个 Phase 开始前必须补一张局部 reuse table：`candidate / caller+test evidence / compatibility / decision / rejection reason`。

## 3. 分阶段实施

### Phase A：治理修订链（总计划 PR 0）

**目标**：把 Proposed 方向变成不冲突的协议真源；只改文档。

**红**：

1. 用 `rg` 列出仍声明“四种 Product Mode”“不新增第五模式”“My Agents 独立入口”的有效协议文本。
2. 运行引用检查并保存基线；建立决策矩阵测试清单，证明 ADR-11/12/13/15、PRD、Session/Tool spec 都被覆盖。

**绿**：

- 接受 ADR-17，修订 ADR-11/12/13/15、ARCHITECTURE、CONTEXT、DESIGN、Session/Tool spec、Custom PRD/Roadmap。
- 固化 `.aigcfroge/custom-profiles/*.yaml`、独立 Snapshot 表、capable-client header、Custom ceiling、M1 严格范围。
- 把未决定项转成 owner + 截止 Gate；不得写成已实现事实。

**重构**：删除互相重复的规范描述，保留 ADR=决策、PRD=产品范围、Roadmap=阶段、Plan=执行细节四层关系。

**验证**：

```bash
bash .aigcfroge/skills/protocols/scripts/check-refs.sh
bunx prettier --check <changed-docs>
git diff --check
```

`<changed-docs>` 必须替换为当前治理 PR 的明确文件列表；不要把用户无关的 Markdown 改动或全仓既有格式债混入本 PR。

Phase A 结束必须输出复查结论并检查 G0-A；没有正式批准就停止，不进入 Phase B。

### Phase B：Schema 与 capable-client（总计划 PR 1）

**红**：

- ProductMode：五值、缺字段仍兼容 Coding、显式未知值拒绝。
- Profile：exactly-one Agent、M1 kind union、consumer grammar、native-only、路径/revision/digest 负例。
- Plan/Snapshot：version=1、diagnostic exhaustiveness、禁止 secret-shaped fields。
- HTTP：旧 client list/event 排除 Custom；按 ID 读取返回 typed unsupported；新 client/旧 server 隐藏能力。
- App：unknown/custom 不再 fallback Coding；capability 不支持时不进入 Custom 分支。

**绿**：

- 新增 `custom-profile.ts`、`composition.ts`，扩 `ProductMode` 与 `AssetKindId`。
- 扩 `/experimental/capabilities` 与 `x-aigcfroge-capabilities: product-mode-custom-v1`；同步 CORS/proxy/header preservation。
- 统一 unsupported-mode 过滤 owner，覆盖 legacy、V2、global list/event、children/fork/readback。
- 通过仓库脚本再生成 SDK，禁止手改生成文件。

**重构**：兼容判断只能有一个服务端 policy owner和一个 App capability owner，不能散落字符串判断。

**验证**：

```bash
bun --cwd packages/schema test --timeout 30000
bun --cwd packages/schema typecheck
bun --cwd packages/aigcfroge test path/to/product-mode-compatibility.test.ts --timeout 30000
bun --cwd packages/aigcfroge run test:httpapi
./packages/sdk/js/script/build.ts
bun --cwd packages/sdk/js typecheck
bun --cwd packages/app run test:unit
bun --cwd packages/app typecheck
bun run script/lint-changed.ts
git diff --check
```

### Phase C：Custom Profile typed owner（总计划 PR 2）

**红**：

- clean/existing Location 的 list/get/invalid projection/watcher。
- YAML round-trip、稳定 bytes/revision、重复 name/path、非法字段和 M1 cardinality。
- 绝对路径、`..`、符号链接越界、Windows 非法段、超限和跨 Location 拒绝。
- CAS apply/delete、overwrite、concurrent modification、reload/readback mismatch、rollback success/failure。
- AssetKind duplicate registration 返回 typed error，不覆盖旧 owner。

**绿**：

- 新增 Profile path/codec/registry/service，复用前五类资产的 typed service + `FileMutation` 事务。
- 注册第八类 AssetKind；补强当前 Map 静默覆盖问题。
- 新增 Profile list/content/apply/delete HttpApi 与 SDK；Chat 管理入口仍由 flag 隐藏运行动作。
- delete 返回反向引用摘要；M0 只投影 Profile/资产引用，不读取 Session Snapshot。

**重构**：共享可证明等价的 path/CAS/rollback 原语；不做万能 AssetService，也不搬迁未触及的旧资产。

**验证**：Schema/Core/HTTP focused tests + Core/AigcForge typecheck + SDK build + HttpApi exerciser + lint/diff。

### Phase D：Agent/Skill runtime bridge（总计划 PR 3）

**红**：

- AgentAsset config 使用 `js-yaml` 解析 unknown，再由 `ConfigAgent.Info` 解码。
- 空 config、非 object、excess/invalid field、hidden/disabled、name conflict、revision drift。
- AgentAsset 能形成可供 subagent 解析的 AgentV2 candidate，但不能替换 root `meta`。
- Skill 只从显式 binding 形成 Snapshot-local catalog；未绑定或 Location-wide Skill 不可见。
- watcher reload 更新候选 Plan，冻结 fixture 不变化。

**绿**：

- 在现有 `AgentV2.transform`/State 生命周期上增加 AgentAsset 驱动 transform，不新建 registry。
- 增加 Resolver 可消费的 provenance/revision projection。
- 为 Skill guidance/tool lookup 提供 composition-local catalog seam；M0 不接 Runner。

**重构**：bridge 只做资产到运行候选的转换；Profile、Resolver、Runner 规则不得塞入 AgentV2/SkillV2 基础 owner。

**验证**：Core focused tests、watcher readiness tests、Core typecheck/lint/diff；禁止 sleep。

### Phase E：Resolver 与 Plan API（总计划 PR 4）

**红**：

- 成功解析临时组合与 Profile；同一规范输入 digest 稳定。
- zero/multi Agent、missing/stale/cross-location ref、bad binding、duplicate/unconnected asset、cycle/conflict 全部 fail closed。
- Prompt/Skill 顺序、consumer binding、requested/effective/denied capabilities 与 diagnostics 稳定。
- cache hit 仍做 freshness check；并发同 key 去重但不共享审批或 Session 状态。
- `/custom-composition/plan` typed error mapping 不泄露正文、绝对路径或 permission resource。

**绿**：

- 新增 Location-scoped `CompositionResolver`，实现固定解析顺序和规范序列化/digest。
- 增加 Plan API、Profile health 和反向引用查询。
- `freeze` 仅定义为 M1 使用的内部接口；不得从 HTTP 接受客户端 Snapshot。

**重构**：Resolver 不执行 Tool、不读取 credential secret、不加载 Plugin、不创建 Session；同步解析保持纯函数，Effect 只包 registry/文件/权限事实边界。

**验证**：Schema/Core/HTTP focused + package suites/typechecks + SDK build + HttpApi exerciser + lint/diff。

### Phase F：M0 收口

- 确认 capability 仍报告 `customMode=false` 或等价不可运行状态。
- 运行 old/new client matrix、Profile failure injection、deterministic digest 重复测试。
- 同步 schema changelog、technical debt、Roadmap 状态和 M1 输入契约。
- 差异审查必须证明没有 Custom Session、Snapshot row、App 入口或运行时 allowlist 半成品。

## 4. 每个小节的 TDD 与协议复查循环

每个 Phase 内按最小 vertical slice 重复：

```text
1. 重读本 slice owner、调用方、近邻测试、Git 历史和计划小节
2. 写 reuse table 与验收映射
3. 红：先写测试并运行，确认因缺目标行为而失败
4. 绿：最小实现；不得修改非目标 owner
5. 重构：去重、收敛 Layer/错误/分支，focused test 保持绿
6. 执行 CLAUDE.md「改完即审」七项并输出复查结论
7. 重读 CLAUDE.md、相关 AGENTS/skill 与本 slice 计划文本
8. focused + package test/typecheck + lint/diff 全绿后，才继续下一 slice
```

执行协议复查不是只读文件：复查结论必须逐项回答 Catch Everything、No Null Pointer、Security First、No Cheating、Reusability、Clean Logs 和五层数据流。

## 5. M0 最终验收

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
bash .aigcfroge/skills/protocols/scripts/check-refs.sh
bun run script/lint-changed.ts
bun typecheck
bun run lint
git diff --check
```

测试不得从根目录运行；上面的根命令仅是 typecheck/lint/protocol/diff 门禁。

## 6. 停止条件

- ADR/PRD 仍是 Proposed/Draft 或批准意见与本计划冲突。
- 旧客户端兼容只能靠 unknown -> Coding fallback。
- Profile 事务需要复制 Workflow/Plugin handler 内联写法。
- Resolver 需要执行工具、加载插件、读取秘密或信任客户端 Plan/Snapshot。
- 任一测试、typecheck、HttpApi exerciser、SDK generation、lint、协议引用检查失败。
- 只能靠 `as any`、`@ts-ignore`、任意 sleep、吞错或假测试继续。

## 7. 分支与 main 策略

- Phase A 治理 PR 从开工时最新、干净、已同步的 `main` 建短分支 `custom-governance`。
- Phase B-F **不能都从今天的 `main@e0e0f970f` 并行切出**；每个 PR 在前一 PR 合入后，从当时最新 `main` 新建短分支。
- 推荐分支：`custom-contracts`、`custom-profile`、`custom-bridges`、`custom-resolver`。
- 如果同一执行窗口经 owner 明确批准采用 stacked branches，仍需在每层合并后 rebase 到最新 main 并重跑全部受影响门禁；不得让长期堆叠替代 Gate。
- 本 M 完成后停止，等待 M0 评审和 M1 开工批准；不自动进入 M1。
