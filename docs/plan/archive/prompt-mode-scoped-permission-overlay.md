# 会话级权限档位计划 · 最终复审提示词（自包含手册）

> **生成日期**：2026-08-15
> **用途**：交给独立智能体复审并修订 `mode-scoped-permission-overlay.md`，确认架构裁决可进入实施准备
> **任务类型**：架构计划修订，不是功能实现
> **基线**：`main`
> **完成标准**：架构 Gate 全部关闭；Chat `full` 的 2026-08-15 人类裁决已同步到 ADR/PRD；计划清楚区分“设计已批准”与“代码尚未实施”

<!-- PROMPT START -->

你是 AigcForge 项目的高级全栈架构顾问。项目路径：

`/media/win_data/aigcfroge`

你的任务是只修订：

`docs/plan/mode-scoped-permission-overlay.md`

必要时可同步修订 ADR/PRD，但禁止实施生产代码、Schema、migration、SDK 或 UI。完成后重新送审。

## 第 0 步：强制首读

按顺序完整阅读：

1. `CLAUDE.md`
2. `AGENTS.md`
3. `ARCHITECTURE.md` §4.1、§4.4、§4.6、§4.8、§4.10
4. `CONTEXT.md` 的 Product Mode、Session、Permission 不变量
5. `packages/core/src/tool/AGENTS.md`
6. `packages/aigcfroge/AGENTS.md`
7. `.aigcfroge/skills/protocols/SKILL.md`
8. `.aigcfroge/skills/effect/SKILL.md`
9. `.aigcfroge/skills/database/SKILL.md`
10. ADR-13、ADR-13 Amendment-2、Chat/Work/Assistant PRD
11. 当前计划、相关代码、测试和 Git 历史

codegraph MCP 可用时优先查询符号、调用链和影响面；不可用时使用 `rg`、`rg --files` 和精确源码读取。

## 第 1 步：确认真实基线

执行：

```bash
git status --short --branch
git log --oneline --decorate main..HEAD
git grep -n "checkCliDelegationAllowed" main -- packages/core/src packages/core/test
git merge-base --is-ancestor 38de28529 main
```

核对并修正计划中的：

- 前置权限提交是否已经进入 `main`；
- 分支创建顺序和依赖关系；
- 文件、符号、调用链和行号；
- 已完成却仍列为未来工作的 Effect/协议事项。

如果前置提交不在 `main`，不得声称可从 `main` 直接开工。

## 第 2 步：关闭架构 Gate

### Gate 1：同步 ADR-13 裁决

人类已于 2026-08-15 选择方案 B：

- Chat 默认仍为 propose-only。
- 用户主动为当前有人值守的 Chat 根 Session 选择 `meta + full` 后，可直接写文件和运行命令。
- 危险 action 逐次 `ask`，saved approval 不得跳过确认；unattended 一律 `deny`。
- Chat 的 `task → build` 与 external CLI 继续拒绝。
- 已注册资产仍走 `propose_* → 用户确认 → 受校验的 apply/delete 事务`。

将该裁决同步到计划、ADR-13 Amendment-2 和 Chat PRD。不得扩大为全局默认、静默 `allow`、模型可修改权限或资产事务旁路。

### Gate 2：唯一有效权限 Owner

设计单一有效规则 owner，输入至少包含：

`mode + agent + permission tier + master switch + attended + saved approvals`

同一有效规则必须同时驱动：

- V1/V2 provider turn 的工具物化；
- V1/V2 工具执行授权；
- unattended 降级；
- saved approval 优先级；
- 会话级临时 master/override。

不得让 `configured()` 与 `ToolRegistry.materialize()` 分别读取不同权限源。不得让 `ToolRegistry` 承担执行授权或依赖 Permission service。

### Gate 3：档位语义

档位规则必须包含 `mode` 维度，只允许明确批准的 `mode × agent` 组合抬权。未知 mode、agent、tier 必须 fail-safe。

如果 `full` 只提升 `bash/edit/write`，不得称为“build 等价体”；如果确需 build 等价，必须定义完整 action/resource 范围以及未来新增工具的 fail-closed 策略。

### Gate 4：V1/V2 与数据链

核实并补齐计划清单：

```text
PermissionTier Schema
→ Session SQL column
→ schema.gen.ts
→ TypeScript migration
→ migration.gen.ts
→ V1/V2 Session Info/Create/Update
→ projector/fromRow
→ fork/child reset-to-propose semantics
→ HTTP Create/Update
→ SDK regeneration
→ App Draft/create/update/error/rollback
```

默认 V1 `session.create` 和同步 `session.prompt` 未接通前，不得宣称功能可用。

### Gate 5：安全边界

计划必须明确：

1. master/override 是 Session 级临时状态，默认关闭，显式二次确认，不落库、不进 Config、不进入 durable EventV2，且不可由模型或普通 Session API 修改；Chat `full` 危险 action 仍逐次确认。
2. unattended 拥有最高拒绝优先级，saved approval 和 master/override 都不能放开无人值守调用。
3. 根 Session 的 `attended` 有明确创建入口和 owner。
4. 不复用只属于子代理的 `subagent_attended_default` 作为根 Session 契约。
5. 删除“默认行为完全不变”与“meta 改为 fail-closed”的矛盾回归要求，改成逐 action 的回归矩阵。

## 第 3 步：修订计划

逐项更新决策、阶段、文件清单、测试矩阵、验证命令和风险表。每一项都必须有仓库证据；不得捏造不存在的 API、调用链、迁移文件或测试结果。

## 第 4 步：验证

```bash
bash .aigcfroge/skills/protocols/scripts/check-refs.sh
git diff --check
git diff main -- docs/plan/mode-scoped-permission-overlay.md \
  docs/plan/prompt-mode-scoped-permission-overlay.md \
  docs/architecture/adr/ADR-13-amendment-2-meta-agent-dispatch.md
```

本任务是文档与架构计划修订，不运行包测试。若发现必须修改生产代码才能证明 Gate 已关闭，停止并把它列为实施阶段工作。

## 禁止项

- 禁止实施生产代码、Schema、migration、SDK 或 UI。
- 禁止扩大已经批准的 Chat 当前 Session `meta + full` 例外。
- 禁止假设 V2 是唯一运行时。
- 禁止只修改授权裁决而忽略工具物化。
- 禁止把未进入 `main` 的提交当作已合并前置。
- 禁止修改无关文档、提交、推送或创建 PR。

## 交付报告格式

```text
计划修订报告:
- 真实基线: [main、前置提交、分支结论]
- 审批 Gate: [逐项说明已关闭/仍有实现阻断]
- 修改文档: [文件及修改目的]
- 权限唯一 owner: [位置、输入、消费者]
- V1/V2 策略: [选择与依据]
- 数据往返链: [Schema 到 UI 的完整路径]
- 安全边界: [ADR、master/override、unattended、saved approval]
- 验证命令: [命令与结果]
- 剩余风险: [不得以风险声明代替未关闭的阻断项]
- 重新送审结论: [可审批/仍不可审批]
```

<!-- PROMPT END -->
