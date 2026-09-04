# ADR-13：Product Mode 职责边界

> 状态：Accepted（2026-07-15 接受；接受条件已满足：四份 v3 PRD 对边界表述与本 ADR 一致、工作流归属保持未决、ARCHITECTURE.md §7 同步列 Accepted）
> 关联：[ADR-11](ADR-11-product-mode-session-classification.md)、[ADR-12](ADR-12-product-mode-entry-routing.md)、[Amendment-1](ADR-13-amendment-1-workflow-asset.md)、[Amendment-2](ADR-13-amendment-2-meta-agent-dispatch.md)、[Chat PRD](../../prd/chat-mode-creation-layer.md)、[Work PRD](../../prd/work-mode-execution-layer.md)、[Assistant PRD](../../prd/assistant-mode-personal-agent.md)、[My Agents PRD](../../prd/my-agents-launcher.md)
> Accepted supersede of §4 under implementation: [ADR-17](ADR-17-custom-mode-composition-platform.md) merges the My Agents launcher into the fifth fixed Custom Mode (`mode=custom`). Until M0 Phase B and later App gates land, §边界规则 4 remains the current active decision in production runtime.

## 背景

ADR-11/12 已确定四类 Product Mode 的持久分类和模块入口，但没有决定各模式拥有的产品对象。若职责边界继续由页面或 Agent 名称隐式推断，资产创建、非编程执行、主动提醒和用户 Agent 使用会互相重叠。

本 ADR 只决定模式职责，不批准具体资产 Schema、Artifact 投影、Scheduler、Agent provenance 或工作流引擎。相关能力仍需各自的 owner contract 和安全评审。

## 提议决策

### 模式定位

| 模式      | 核心对象       | 职责                         | 首个验证闭环            |
| --------- | -------------- | ---------------------------- | ----------------------- |
| Chat      | 可复用资产     | 通过对话生成、校验并应用资产 | 项目级普通提示词模板    |
| Coding    | 代码与开发任务 | 使用编程工具修改、验证代码   | 已有 Coding 能力        |
| Work      | 非编程产出     | 使用系统预设能力完成一次任务 | Markdown 文档与只读预览 |
| Assistant | 个人主动事项   | 管理个人上下文和主动触达     | 持久单次提醒            |

### 边界规则

1. **Chat 创建，Work/Coding 执行**：Chat 不承担通用任务执行；Work/Coding 可以消费已注册资产，但 Work 的系统预设能力不依赖用户先在 Chat 创建资产。
2. **Coding 与 Work 按产出切分**：代码或代码库变更归 Coding；面向业务的非编程产出归 Work。需要同时修改代码和业务文档时，由用户选择主 Session，跨域工作通过明确引用或委派完成。
3. **Assistant 的主动性来自持久调度**：Assistant 不以常驻 Session 或心跳表达主动能力；V2 Session 仍是有限 Drain。
4. **“我的智能体”不是 Product Mode**：`/my-agents` 是 Agent 启动台。它选择 Agent 与 Work/Coding Mode 后进入 canonical Draft/Session route，不增加第五种 Mode。（注：ADR-17 提议取代本条，见文末修订说明）。
5. **工作流归属暂不决定**：工作流定义、执行、恢复和审计需要独立 ADR。任何模式在该 ADR 接受前都不得把工作流引擎视为既有能力。
6. **Skill 与 System Context 保持正交**：Skill 是按需 playbook；System Context 只承载上下文来源，不作为新的能力路由器。

### 共享基础设施

- 四类 Mode 复用 ADR-12 的 `ModeRoute`/`ModeWorkspace`、Project、Workspace、Session、Permission 和 canonical Session route。
- Product Mode 只分类 Session；切换 Mode 不创建、恢复、重分类 Session，也不改变 Agent。
- Mode 专属领域数据由 owner module 管理，不塞入 `DraftTab.type`、Session URL 或自由文本 metadata 充当事实真源。
- 各模式的 M1 以对应 v3 PRD 为准；后续范围不能从本 ADR 自动继承批准。

## 结果

### 正向影响

- 模式边界由产品对象定义，而不是由页面布局或 Agent 名称推断。
- Chat、Work 和 Assistant 可以分别验证资产、产出和主动触达，不要求同时建设完整平台。
- My Agents 保持为启动入口，避免破坏四元 Product Mode 和 Session identity。

### 代价

- 跨模式复杂任务需要显式选择主对象，不能依赖隐式自动路由。
- 工作流、跨模式委派和资产消费需要后续独立决策。

## 接受条件

1. 四份 v3 PRD 对模式边界的表述与本 ADR 一致。
2. `ARCHITECTURE.md` 在本 ADR 接受前将其列为 Proposed，而非 Accepted decision。
3. 工作流归属保持未决，不被任何 M1 实现提前固化。

## 由 ADR-17 修订的条款（Accepted for M0/M1 implementation；运行时待后续 Gate）

在 ADR-17 获准进入 M0/M1 实施后：

1. **§边界规则 4 迁移**：“我的智能体”独立启动台概念并入 Custom 模式。用户通过 `/mode/custom`、Custom Profile 与组合 Builder 启动基于自建 Agent 的会话，Session 分类持久化为 `mode=custom`，消除 `/my-agents` 作为独立伪模式与四模式之间的张力。
2. **Chat 与 Custom 职责分离**：Chat 保持为 Prompt、Skill、Agent 等七类资产的创建、管理与编辑中心；Custom 作为资产组合、绑定、解析、冻结与运行的消费平台。
3. **现行基准**：~~在 M0 Phase B 与后续 App gate 完成前，本 ADR 的四模式定位表与 §边界规则 4 仍为生产运行时的有效决策。~~ **已 superseded（2026-09-03 复核）**：M0 Phase B 已合入，`ProductMode.ID`（`packages/schema/src/product-mode.ts:5`）与 `MODE_DEFINITIONS`（`packages/app/src/context/mode.tsx:6`）都是含 `custom` 的五值，`/mode/custom` 是切换器上的常规入口。本 ADR 的四模式定位表作为历史论证保留，不再是运行时基准；当前基准见本条 1、2 与 [ADR-17](ADR-17-custom-mode-composition-platform.md)。
