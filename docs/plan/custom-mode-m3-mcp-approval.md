# Custom Mode M3 实施计划：MCP 与统一审批

> 状态：**Future / Security contract blocked - M1 后可研究，M3 Gate 通过后才能实现**
> 分析基线：`main@e0e0f970f`（2026-08-17）；执行基线为前置里程碑合入后的最新 `main`
> 范围：Session/Location scoped MCP canonical registration、credential refs、health/revocation、once/Session/Location grant、应用级审批入口
> 前置：[Custom Mode M1](custom-mode-m1-single-agent-runtime.md)；M2 不是硬依赖，但若并存必须验证多 Agent scope
> 上级计划：[Custom Mode 组合平台实施计划](custom-mode-composition-platform-implementation.md)

---

## 0. 根问题与当前缺口

M3 的根问题不是“让 Profile 能选 MCP”，而是让外部工具在一个明确 Location/Session/Agent/revision scope 内进入唯一 ToolRegistry，并且凭证、授权、健康、撤销和无人值守策略都能 fail closed。

当前代码事实：

- `McpV2` 只有 start/stop/tools/callTool，`v2-bridge.ts` 使用宽类型和进程内 server Map，尚未注册 canonical Tool。
- Tool 协议明确 Session-scoped registrations 仍缺设计。
- `PermissionSaved.always` 是既有 Project 语义，不能改文案冒充 Session grant。
- Credential service 可保存秘密，但 Snapshot 只能持有 opaque ref。

## 1. 开工 Gate

| Gate                  | 通过标准                                                                                         | 阻塞范围    |
| --------------------- | ------------------------------------------------------------------------------------------------ | ----------- |
| G3-0 前置             | M1 Tool allowlist/fingerprint/Permission 运行稳定；若 M2 已上线，Agent scope 已可表达            | 全部        |
| G3-1 Registration ADR | Session/Location registration、owner Scope、name collision、fingerprint、cleanup、reconnect 批准 | MCP runtime |
| G3-2 Grant ADR        | once/Session/Location + action/resource/agent/revision/expiry/revocation 的唯一真源批准          | 审批/执行   |
| G3-3 Credential       | secret owner、opaque ref、rotation/revocation、日志脱敏和跨 Location 隔离批准                    | 连接        |
| G3-4 Unattended       | 无页面/无用户时 ask 的 timeout/fail-closed 策略批准                                              | Beta        |

应用级审批入口只聚合 pending request；它不成为“应用级永久 allow”。

## 2. 五层设计

| 层              | M3 交付                                                                   | 不变量                              |
| --------------- | ------------------------------------------------------------------------- | ----------------------------------- |
| L1 Schema       | MCP binding/ref/health/fingerprint、ScopedGrant、pending request          | scope/version/expires/revoked typed |
| L2 Core/DB      | MCPConnection owner、ScopedGrant owner、registration lifecycle            | secret 不进 Snapshot/event/log      |
| L3 HTTP/SDK     | connect/status/revoke、pending/reply/grant/revoke APIs                    | auth + scope checks                 |
| L4 App          | Builder MCP blocks、health、全局 pending center                           | 入口全局可见，grant 明确显示 scope  |
| L5 Tool/runtime | canonical registration、captured settle、runtime permission/grant recheck | Location A 永不泄露到 B             |

## 3. 分阶段实施

### Phase A：Registration/Grant ADR 与 Schema

**红**：scope grammar、Location/Session/Agent/revision identity、expiry/revocation、MCP server/tool fingerprint、name collision、credential ref secret rejection、old Snapshot version compatibility。

**绿**：接受两个 ADR；定义 MCP binding、health state、ScopedGrant/pending request、event/error schemas；决定扩 `PermissionSaved` 还是新增唯一 `ScopedGrant` owner。默认建议新增 scoped owner并让 PermissionEffective消费，避免破坏 `always` 兼容语义。

**重构**：authorization fact 与 connection health 分离；Snapshot audit digest 与实时 grant 分离。

### Phase B：Canonical scoped registration

**红**：Location/Session register/unregister；latest active placement规则；Scope close 只移除自己的工具；同名 collision；definitions/settle捕获一致；reconnect revision变化产生 fingerprint drift；A/B Location 隔离。

**绿**：给 MCP producer 注入窄 `Tools.Service` capability；每个 server/Session 拥有 Scope；把工具转换为 canonical `Tool.make`，settle 回到 MCP client且保留 interruption/ToolFailure。

**重构**：不增加 MCP registry/executor；ToolRegistry 仍是唯一执行入口。先解决 Location-layer ordering，不能形成 `PluginBoot -> Tools -> PluginBoot` 循环。

### Phase C：Connection、credential 与 health

**红**：stdio/remote/OAuth connect、invalid URL/command/config、credential missing/expired/revoked、disconnect/reconnect、timeout、process interruption、secret redaction、跨 Location ref拒绝。

**绿**：重构现有 bridge 为 typed MCPConnection owner；凭证只经 Credential/Integration service解析；health=`connecting|ready|degraded|offline|auth-required|revoked`；Snapshot只存 ref/fingerprint。

**重构**：移除新增路径里的宽 `any`/raw console；expected failures 用 tagged errors，外部 SDK callback 经 Effect 边界兜底。

### Phase D：ScopedGrant 与 PermissionEffective

**红**：once 消费一次；Session 不跨 Session；Location 不跨 Location；agent/revision mismatch；expiry/revocation立即生效；deny 始终胜出；saved `always` 不被静默迁义；unattended ask fail closed。

**绿**：实现唯一 grant store/service和事务；PermissionEffective 查询候选 grant但仍由 leaf assert最终授权；pending request/reply/revoke事件持久或可回放语义按 ADR 落地。

**重构**：审批 UI、Resolver、ToolRegistry 不计算授权；统一走 Permission owner。

### Phase E：Resolver/Snapshot 与运行依赖

**红**：只有 Profile 显式绑定 MCP 被解析；Plan 显示 requested/effective/denied + credential/health；start re-freeze；运行中定义变化不改 Snapshot；新 provider turn fingerprint mismatch 阻断；撤销后新调用失败。

**绿**：扩 composition v3/version union；MCP tool catalog 进入 Snapshot audit facts；Runner materialize 时同时满足 Snapshot allowlist、registration fingerprint、Permission/grant。

### Phase F：HTTP/SDK/App 审批中心

**红**：auth/scope/CSRF等现有 HTTP 边界；pending 聚合；once/Session/Location 明示；revoke；无页面连接；Builder health/diagnostics；desktop/narrow/keyboard/i18n。

**绿**：薄 endpoints + SDK；应用级 pending indicator/dialog；Custom Builder/Session panel MCP health。入口不自动扩大 scope。

### Phase G：故障注入与灰度

- server crash、network partition、OAuth expiry、credential revoke、grant expiry、Session close、Location unload、name collision、tool schema change。
- 验证撤销后新调用立即失败；已开始调用按 ADR 明确结束/中断策略。
- 验证无页面连接时请求不会无限挂起。

## 4. TDD/协议复查

每个 slice 走红->绿->重构，并在继续前执行 `CLAUDE.md` 改完即审。MCP/Tool slice 重读 `packages/core/src/tool/AGENTS.md` 与 Tool spec；credential/grant 重读 database/effect/security owner；UI 重读 DESIGN/frontend-theming；HTTP 重读 HttpApi/test server AGENTS。

安全测试必须成对覆盖“模型看到定义”和“settle 真执行”；只测 permission assert 或只测 UI 隐藏均不合格。

## 5. 最终测试矩阵

- Core：registration Scope/collision/stale/interruption；credential/health；grant transaction/expiry/revoke；Permission deny。
- AigcForge：stdio/remote/OAuth fixture、HTTP coverage/auth/effect、session recovery。
- Schema/SDK：version/negative/secret rejection、generated diff/typecheck。
- App：pending center、scope selection/revoke、Builder health、Playwright disconnected/unattended、responsive/a11y/i18n。
- 全局：包级 test/typecheck、protocol refs、lint/full typecheck、diff；不得从根跑 test。

## 6. 停止条件

- canonical Session/Location registration 或唯一 grant owner 未批准。
- 方案要求把 executor/client/secret 存入 Snapshot。
- Location/Session cleanup 只能依赖手工 Map 删除而无 owner Scope。
- `always` 被直接改名成 Session/Location grant。
- ask 在 unattended/headless 状态可能无限等待或默认 allow。
- 撤销、断线、schema drift、权限拒绝测试失败。

## 7. 分支策略

- 研究/ADR可在 M1 后从最新 main 建 `mcp-scope-adr`；生产实现必须等所有 G3 Gate。
- 推荐实现分支：`mcp-registration`、`scoped-grants`、`mcp-composition`、`approval-center`。
- 每个 PR 合入后从最新 main 开下一分支，不与 M4 Plugin 生命周期修改混在同一 PR。
