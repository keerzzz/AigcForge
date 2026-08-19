# Custom Mode M0 Phase A 差异审批报告

> 日期：2026-08-18
> 分支：`custom-governance`
> 基线：`main@a4ffba0b3d22bae564f6616f0f84fe8ead8342fc`
> 范围：21 份治理、ADR、PRD、Spec、计划和技术债文档，`+314/-223`
> 结论：**CHANGES REQUESTED - 不批准 G0-A，不允许进入 Phase B**

## 1. 执行摘要

| 严重级别 | 数量 |
| -------- | ---: |
| P0       |    0 |
| P1       |    2 |
| P2       |    3 |
| P3       |    1 |

本轮已经补齐 ADR-17 v1.2、Custom PRD v1.2、ADR-11/12/13/15 的 proposed amendment、ARCHITECTURE/CONTEXT/DESIGN、Session/Tool spec 和审批模板，且未修改生产代码。Prettier、协议引用、增量 lint 与 `git diff --check` 均通过。

但当前治理契约仍存在一个实施审批循环、一个安全相关工具身份契约冲突，以及三项 owner/交付物不一致。机械门禁通过不能替代这些语义问题。因此本报告只确认治理草案进入正式复审，不代表 ADR Accepted、PRD Approved 或五方签字。

## 2. 阻断发现

### P1：PRD 批准条件与开工 Gate 形成循环依赖

**证据**：

- `docs/prd/custom-mode-composition-platform.md:364-372` 要求 PRD 从 Draft 转为 Approved 前，内部 50 次启动基线、埋点和 Beta 停止规则已经就绪。
- `docs/plan/custom-mode-m0-composition-foundation.md:34-41` 又要求 ADR-17 Accepted、Custom PRD Approved 后才允许任何生产代码。
- `docs/roadmap/custom-mode-roadmap.md:105-110` 将 ADR/PRD Approved 作为 M0 退出条件，而 50 次启动基线属于 M1 交付。

**影响**：没有实现就无法完成 50 次真实启动，没有 PRD Approved 又不能开始实现，导致 M0 Phase B 永久不可进入。若绕过 Gate 开工，则治理记录失真。

**整改**：把批准拆成两个不同 Gate：

1. `Approved for M0/M1 implementation`：ADR/范围/owner/兼容/安全设计获得五方签字后允许代码实现。
2. `M1 rollout exit`：50 次基线、指标和 Beta 停止规则在 M1 Phase G 完成，阻塞 Beta/全量，不阻塞 Phase B。

### P1：Tool materialization 和 stable fingerprint 契约不一致

**证据**：

- `specs/v2/tools.md:192` 定义 `ToolRegistry.materialize(permissions, intent, allowlist?)` 的位置参数。
- `docs/plan/custom-mode-composition-platform-implementation.md:436-442` 定义单一 options object：`materialize({ permissions, intent, allowlist })`。
- `specs/v2/tools.md:195` 只把 fingerprint 描述为 name、description、schema digest。
- 总计划 `:449-451` 要求 fingerprint 至少包含 placement、tool name、规范化 definition/schema digest 和 `InstallationVersion`，并在每个 provider turn 重算校验。

**影响**：Phase B/M1 的实现者会面对两个不同 API；更严重的是较弱 fingerprint 无法区分 placement 或安装版本变化，可能把同名同 Schema 的新 registration 误认为 Snapshot 原依赖，削弱 stale/dependency drift 门禁。

**整改**：以总计划的安全约束为准，在 ADR-17 和 Tool spec 中统一为 options object，并明确 fingerprint 的最小字段、规范化算法、aggregate catalog digest、provider-turn 重验和 mismatch 失败语义。

## 3. 中等级发现

### P2：Profile Schema 与 Agent config Schema 被混写

`docs/architecture/adr/ADR-17-custom-mode-composition-platform.md:54-56` 写 Profile YAML 使用 `Schema.Class / ConfigAgent.Info` 解码。`ConfigAgent.Info` 是 `AgentAsset.config -> AgentV2` 桥接的配置 Schema，只适用于总计划 `:415-423` 和 M0 Phase D，不是 Custom Profile Schema。

**整改**：Profile 使用 `CustomProfile.Profile/Frontmatter` 等独立 `Schema.Class` 解码；只有 Profile 引用的 Agent Asset `config` 字段先经 `js-yaml` 解析，再用 `ConfigAgent.Info` 解码。

### P2：PR 0 明确要求的 schema changelog 预告缺失

`docs/plan/custom-mode-composition-platform-implementation.md:607-615` 要求 PR 0 更新 technical debt 状态和 schema changelog 预告。当前 diff 更新了 technical debt，但没有修改 `specs/v2/schema-changelog.md`。

**整改**：增加 Proposed/Not Implemented 条目，记录预期的 ProductMode、AssetKind、composition schema、Snapshot table、HTTP/SDK/capability/event 影响；不得写成已交付 migration 或 API。

### P2：审批 owner 数量在计划中仍自相矛盾

ADR-17/PRD 模板已经列出 Product、Core、App、Security、Schema+SDK 五方，但总计划 `docs/plan/custom-mode-composition-platform-implementation.md:615` 仍写“四方 owner 签字”，Roadmap 的部分准入文本也只列四方。

**整改**：统一为五方；若 Schema+SDK 只是 Core 的子责任而不是独立 Gate，则删除独立签字行并在所有文档使用同一模型，不能两种口径并存。

## 4. 低等级发现

### P3：无关表格格式化扩大治理 diff

`ARCHITECTURE.md`、`ADR-15` 和 `docs/technical-debt.md` 存在大量与 Custom 语义无关的 Markdown 表格格式化。它不改变行为，但显著增加审阅噪音并掩盖真实治理变化。

**整改**：提交前尽量把纯格式化区域从治理 PR 中移除；若仓库 Prettier 强制导致不可避免，应在 PR 中单列 mechanical formatting，并用 `git diff -w` 提供语义 diff。

## 5. 已通过检查

```text
bunx prettier --check <21 changed docs>                    PASS
bash .aigcfroge/skills/protocols/scripts/check-refs.sh     PASS (32 paths)
bun run script/lint-changed.ts                             PASS (no JS/TS changes)
git diff --check main                                      PASS
```

未运行生产包测试，因为本轮为纯文档治理变更。Markdown 相对链接的临时 Perl 检查对仓库根文档产生了路径基准误报，不作为审批证据；协议脚本和逐链接人工核对未发现本轮新增断链。

## 6. 审批边界

- **批准**：分支隔离、基线同步、Phase A 治理草案覆盖面和机械门禁。
- **不批准**：ADR-17 Accepted、Custom PRD Approved、G0-A 通过、Phase B 开工、commit/push/PR。
- **签字状态**：五方审批模板仍全部为 `待评审`，本报告不能代替 Product/Core/App/Security/Schema+SDK 的领域签字。

整改 P1/P2 后重新提交完整 diff。复审通过后，才进入五方签字；五方签字完成并同步 ADR/PRD 状态后，方可批准 M0 Phase B。

## 7. 审查方法

- 策略：文档治理差异深审，21/21 文件覆盖。
- 基线：`main@a4ffba0b3`。
- 方法：完整 diff、忽略空白语义 diff、协议交叉引用、Gate 依赖图、owner 真源核对、独立机械验证。
- 限制：未替代真实 Product/Core/App/Security/Schema+SDK 负责人作业务或风险承诺。
- 置信度：高。
