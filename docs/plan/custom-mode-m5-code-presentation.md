# Custom Mode M5 实施计划：Code Presentation

> 状态：**Future / Sandbox proof blocked - M3/M4 稳定后独立立项**
> 分析基线：`main@e0e0f970f`（2026-08-17）；执行基线为 M4 合入并通过安全复审后的最新 `main`
> 范围：Native/Code presentation 等价、generated capability SDK、`run_code`、资源隔离、中断与审计
> 前置：[Custom Mode M3](custom-mode-m3-mcp-approval.md)、[Custom Mode M4](custom-mode-m4-trusted-runtime-extension.md)
> 上级计划：[Custom Mode 组合平台实施计划](custom-mode-composition-platform-implementation.md)

---

## 0. 根问题与安全边界

M5 只改变模型看到工具的呈现方式：

```text
Snapshot effective tools
-> native: N canonical definitions
-> code: run_code + generated SDK for the same N tools
-> every SDK call returns to the same captured ToolRegistry materialization
```

Code Presentation 不能增加工具、权限、Location、credential、网络、文件或进程能力。`run_code` 不持有 executor 引用，不直接调用 MCP/Plugin，不绕过 ToolFailure/Permission/interruption/output bounding。

### 0.1 非目标

- 不执行任意宿主 TypeScript/JavaScript，不提供 `require`/dynamic import/`process`/Bun/Node APIs。
- 不把 `node:vm`、Worker 或 iframe 单独当安全边界。
- 不生成一个能访问全局 ToolRegistry/SDK client 的万能对象。
- 不承诺任意 npm 包、持久磁盘或公网访问。
- 不因 code 模式改变工具的授权、settle、错误或审计语义。

## 1. 开工 Gate

| Gate              | 通过标准                                                                                              | 阻塞范围       |
| ----------------- | ----------------------------------------------------------------------------------------------------- | -------------- |
| G5-0 前置         | M3 canonical scoped tools + M4 trust/lifecycle稳定，无高风险 finding                                  | 全部           |
| G5-1 Sandbox ADR  | 运行时选型、隔离边界、host-call协议、CPU/time/memory/output/concurrency/temp storage限制批准          | runtime        |
| G5-2 Equivalence  | Native/Code Effective Tool Set、permission、error、interrupt、audit等价律批准                         | SDK/run_code   |
| G5-3 Threat model | escape、prototype pollution、serialization、covert channel、DoS、secret、reentrancy、nested calls评审 | Beta           |
| G5-4 Benchmark    | 选定成熟隔离引擎；维护/平台/性能/安全补丁证据通过，禁止手写解释器/沙箱                                | implementation |

## 2. 五层设计

| 层                  | M5 交付                                                             | 不变量                        |
| ------------------- | ------------------------------------------------------------------- | ----------------------------- |
| L1 Schema           | Presentation config、SDK manifest、RunCode input/result/error/audit | versioned + bounded           |
| L2 Core             | Presentation compiler、sandbox adapter、host-call broker            | broker只有captured settlement |
| L3 HTTP/SDK         | 无独立越权执行API；必要状态/诊断查询                                | Session/auth/snapshot绑定     |
| L4 App              | native/code选择、成本/限制/失败诊断、只读审计                       | 不提供宿主代码控制台          |
| L5 runtime/security | `run_code` canonical Tool、resource limits、interrupt               | effective set严格等价         |

## 3. 分阶段实施

### Phase A：Sandbox/Equivalence ADR 与攻击 harness

**红**：先建立会失败的攻击/等价 harness：访问 host globals、动态 import、fs/network/process、原型污染、无限循环、内存/输出爆炸、并发风暴、序列化循环、伪造 tool name/call identity、调用 revoked/stale tool。

**绿**：完成成熟引擎对比和 ADR；定义 sandbox adapter/host-call wire protocol、resource budget、typed errors、audit mapping和支持平台矩阵。

**重构**：测试 harness独立于具体引擎，避免换实现后失去威胁回归。

### Phase B：Effective Tool Set manifest 与 SDK generator

**红**：同一 captured materialization生成稳定 manifest；schema/name/fingerprint变化更新digest；非法/冲突名称拒绝；SDK只含allowlist tools；参数/结果Schema round-trip；manifest不含executor/credential。

**绿**：在ToolRegistry materialization之上生成纯数据manifest和受限SDK stubs；SDK调用只产生结构化host-call request。

**重构**：definition/manifest/fingerprint规范化共用一个owner，不能三套serializer。

### Phase C：Host-call broker 与 `run_code` canonical tool

**红**：valid call回到本次captured `settle`；未知/stale/revoked/permission denied；nested order；ToolFailure/interruption/defect区分；output bounding；Session/agent/message/call identity不可伪造。

**绿**：`run_code`作为普通canonical `Tool.make`注册；broker闭包只持有materialization提供的窄调用能力和不可伪造invocation context。

**重构**：不注入ToolRegistry Service或executor map到sandbox；所有leaf authorization保持原路径。

### Phase D：资源隔离与生命周期

**红**：CPU/time/memory/output/concurrency/temp-storage边界；root interrupt、Session close、Scope close、extension revoke；半完成工具链取消；无泄漏fiber/process/file；deterministic cleanup。

**绿**：接入选定sandbox adapter，所有资源绑定Session/provider-turn Scope；limit hit映射typed ToolFailure，interruption不被catch吞掉。

**重构**：资源限制配置归一个 policy owner；App/Profile只能请求更低上限，不能提高平台上限。

### Phase E：Native/Code 等价验证

**红**：对同一Snapshot/Permission/Location/Agent生成两种presentation；逐工具成功、deny、ask/reject、stale、MCP revoke、Extension quarantine、interrupt结果等价；工具调用audit可映射。

**绿**：Resolver/Runner支持 `presentation: native|code`；code模式只广告 `run_code`和manifest guidance，但真实capability集合不变。

**重构**：presentation不进入PermissionEffective，不创建单独code allowlist。

### Phase F：App/SDK/诊断

**红**：Builder segmented control、capability/limit preview、unsupported server/platform、runtime failure、read-only Snapshot/audit、responsive/a11y/i18n；切换presentation需新Snapshot，不改运行中Session。

**绿**：开放code选项和诊断；展示实际limits与调用映射；不展示内部源码、秘密或完整用户代码日志。

### Phase G：安全审计、性能与灰度

- 攻击 harness 全量、第三方 sandbox安全公告/版本核查、fuzz/property tests、长时间资源泄漏。
- Native/Code parity矩阵100%；未授权调用/escape/secret leak=0。
- benchmark比较provider token、latency、tool round-trip、内存；不设机器相关硬阈值，记录回归基线。
- kill switch只阻断新code执行，历史Snapshot/audit仍可读，native fallback必须由用户显式创建新Snapshot。

## 4. TDD/协议复查

每个 slice：owner/reuse/threat audit -> 红 -> 绿 -> 重构 -> focused test/typecheck -> `CLAUDE.md` 改完即审 -> 重读 Tool/Permission/Plugin/Session/DB/UI 协议 -> lint/diff。

M5 必须使用 property-based/fuzz测试覆盖host-call codec和资源边界，并保留固定攻击corpus。任何测试不得为了方便把宿主能力注入sandbox。

## 5. 最终测试矩阵

- Schema/property/fuzz：manifest、codec、bounded values、malformed/cyclic payload。
- Core/Tool：captured settle、permission/stale/revoke、interrupt/defect、resource cleanup。
- Security：escape/DoS/prototype/serialization/reentrancy/secret corpus。
- App/E2E：presentation选择、新Snapshot、unsupported/failure/audit、responsive/a11y/i18n。
- Performance：native/code稳定基线；受影响包test/typecheck、protocol refs、lint/full typecheck/diff。

## 6. 停止条件

- 找不到维护活跃且满足平台/隔离要求的成熟sandbox引擎。
- 方案依赖 `node:vm`/Worker/iframe作为唯一边界或开放宿主API。
- sandbox能持有executor、ToolRegistry、credential、process/fs/network。
- Native/Code在权限、stale、interrupt、audit任一不等价。
- 资源限制或Scope cleanup无法自动验证。
- 任一攻击、安全、fuzz、parity或E2E gate失败。

## 7. 分支策略

- Sandbox研究/ADR从M4稳定后的最新main建 `code-sandbox-adr`。
- 实现建议 `code-manifest`、`run-code-runtime`、`code-presentation`、`code-rollout`。
- 每个分支基于前置PR合入后的最新main；安全harness与实现可分PR，但harness必须先合入并保持红灯原因可解释。
