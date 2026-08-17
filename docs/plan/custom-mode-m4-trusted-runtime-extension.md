# Custom Mode M4 实施计划：Trusted Runtime Extension

> 状态：**Future / Highest-risk ADR blocked - 禁止提前加载 Custom Plugin runtime**
> 分析基线：`main@e0e0f970f`（2026-08-17）；执行基线为 M3 合入并完成安全复审后的最新 `main`
> 范围：Installed Extension、provenance/trust/revision、Host/Agent/Client 分面、mount/stop/quarantine/rollback、跨端降级
> 前置：[Custom Mode M3](custom-mode-m3-mcp-approval.md)
> 上级计划：[Custom Mode 组合平台实施计划](custom-mode-composition-platform-implementation.md)

---

## 0. 根问题与当前代码事实

M4 不是让 `.aigcfroge/plugins/*.plugin.yaml` 被 `import()`。Plugin Asset 当前只是配置资产；现有 `PluginV2.add/remove` 和 external config plugin 可以加载代码，但没有 Custom 所需的安装记录、来源验证、不可变 revision、审批、staged rollout、quarantine、rollback 和跨端能力降级。

M4 要把“资产声明”和“可执行扩展”分成两类真源：

```text
Plugin Asset (declarative request)
-> InstalledExtension (verified, approved, immutable revision)
-> Extension Mount (owner Scope, runtime state)
-> narrow capability contribution
```

### 0.1 首批范围

- `agent-capability`：通过窄 typed capability 贡献 Agent/Skill/Command/Tool。
- 既有受控 `tool-view`：只读渲染已解码、已脱敏的 tool output。
- Installed/Validated/Approved/Pinned revision、stop/quarantine/remove/rollback。
- Web/TUI/ACP/Headless capability negotiation 与明确降级。

### 0.2 延后范围

- `client-slot` 只有在资源、卸载、CSP/隔离、跨端 fallback 完整后单独开 Gate。
- `host-capability` 需要更高安全评审，M4 首批不开放。
- 不执行模型即时生成代码；不允许全局 DOM/CSS、任意路由、内部 registry、Permission executor、进程环境或秘密直通。
- 不把 npm/package 名、文件路径或 Plugin Asset revision 当作可信安装证明。

## 1. 开工 Gate

| Gate                | 通过标准                                                                                            | 阻塞范围    |
| ------------------- | --------------------------------------------------------------------------------------------------- | ----------- |
| G4-0 前置           | M3 scoped tools/grants/credential/cleanup 稳定                                                      | 全部        |
| G4-1 Threat model   | supply-chain、代码执行、DOM/XSS、secret、network/fs/process、DoS、update rollback 威胁模型批准      | ADR/实现    |
| G4-2 Lifecycle ADR  | provenance/digest/signature policy、revision、state machine、owner Scope、rollback、quarantine 批准 | Core/DB     |
| G4-3 Capability ADR | Host/Agent/Client/tool-view 每一能力的窄接口和禁止面批准                                            | SDK/runtime |
| G4-4 Distribution   | 本地/远程来源、安装包存储、更新/撤销和离线验证策略批准                                              | 安装/Beta   |

未通过 Gate 时只能写研究、ADR、攻击测试设计，不得从 Custom Profile mount 任何代码。

## 2. 五层设计

| 层                  | M4 交付                                                          | 核心不变量                                |
| ------------------- | ---------------------------------------------------------------- | ----------------------------------------- |
| L1 Schema           | manifest、provenance、capability faces、revision/trust/state     | manifest 不等于 approval                  |
| L2 Core/DB          | InstalledExtension + ExtensionRevision + Mount owner             | immutable revision + current/next + audit |
| L3 HTTP/SDK         | install/validate/approve/stage/activate/stop/quarantine/rollback | 状态机命令有 CAS/auth                     |
| L4 App/clients      | extension manager、health、scope、fallback/tool-view             | 无任意页面接管                            |
| L5 runtime/security | narrow host、Scope cleanup、canonical tool registration          | stop 后贡献立即不可用                     |

### 2.1 状态机

```text
discovered -> validated -> approved -> staged -> mounted -> active
                                      \-> rejected
active -> stopped -> mounted
active/staged/mounted -> quarantined
stopped/quarantined -> removed
next revision failure -> retain current active revision
```

状态转换只能经一个 service owner；不能由 UI、Plugin callback 或文件 watcher 直接赋值。

## 3. 分阶段实施

### Phase A：Threat model、ADR 与 Schema

**红**：manifest unknown fields、face/capability mismatch、digest/source mismatch、future revision approval reuse、invalid transition、unsigned/untrusted source、client capability missing、secret request、global DOM/CSS/route declarations。

**绿**：接受 Lifecycle/Capability ADR；定义 InstalledExtension、Revision、Manifest、Face、Trust、State、AuditEvent 和 typed errors；明确签名不可用时的本地 trust policy与风险文案。

**重构**：Plugin Asset、安装记录、运行 mount 三种 identity 分离；Profile 只引用已安装 revision。

### Phase B：InstalledExtension 持久化与安装事务

**红**：clean/existing migration、content-addressed revision、source/digest verify、CAS state transition、concurrent install/update、partial failure rollback、remove referenced revision、audit redaction。

**绿**：新增 typed owner/表/不可变 revision storage；安装过程写 `next`，验证/审批成功后才能切 `current`；失败保留当前。

**重构**：不把可执行 bytes、秘密或大 manifest 塞进 Session Snapshot；Snapshot 保存 installed revision ref/digest。

### Phase C：窄 Extension Host 与 owner Scope

**红**：extension 只能获得声明并批准的 capability；Scope close 移除 tools/listeners/agents/skills/views；load cycle、stop during mount、mount failure、quarantine、interruption；不能读取内部 services或注册越权 action。

**绿**：基于现有 PluginV2 Scope lifecycle建立 `ExtensionRuntime` owner；Host 只暴露 capability-specific façade；Agent tool 通过 M3 canonical `Tools.Service` 和 ScopedGrant；expected lifecycle failure用 tagged errors而非 die。

**重构**：不创建第二 Plugin/Tool registry；PluginV2可作为低层 mount primitive，但 trust/lifecycle truth归 InstalledExtension owner。

### Phase D：Agent capability 与 tool-view

**红**：Agent/Skill/Command/Tool id collision、revision pin、permission ceiling、Session/Location cleanup、tool output schema decode/redaction、XSS payload、oversize output、unsupported client fallback。

**绿**：实现首批 capability adapters；tool-view 输入只来自 canonical bounded output且经 Schema decode/sanitize；无 view 时使用平台默认 renderer。

**重构**：view 不能改变执行结果、grant或Settlement；Agent capability不能取得 credential value。

### Phase E：更新、停止、隔离与回滚

**红**：current/next并存、staged health check、更新失败保旧、activate原子切换、旧Scope清理、quarantine即时阻断新调用、in-flight策略、rollback、撤销信任。

**绿**：实现 staged mount/health/atomic promote；保存可审计状态和错误分类；明确运行中 Session遇 revision缺失/撤销时阻断或按 ADR 结束。

### Phase F：HTTP/SDK/App 与跨端降级

**红**：install/approve/activate auth/CAS；来源/digest/trust展示；stop/quarantine/rollback确认；Web/TUI/ACP/Headless capability negotiation；client-slot未支持时阻断或default fallback；responsive/a11y/i18n。

**绿**：Extension manager和 Custom Builder installed-only selector；Profile不能直接选择未安装 Plugin Asset；应用只展示实际支持的 faces。

### Phase G：供应链与故障注入

- tampered package、TOCTOU source change、malicious manifest、mount leak、listener/tool leak、XSS、secret probe、CPU/memory/output abuse、update crash、rollback crash。
- 关闭/隔离后新调用为 0，贡献资源为 0；历史 audit/Snapshot仍可读。
- 跨端无 client capability 时不挂起、不空白、不执行 hidden code。

## 4. TDD/协议复查

每个 slice 走 owner/history/reuse -> 红 -> 绿 -> 重构 -> focused verification -> `CLAUDE.md` 改完即审 -> 重读 Plugin/Tool/Permission/DB/UI 协议 -> lint/diff。

额外安全复查：provenance验证、路径/URL、dynamic import边界、Scope finalizer、CSP/XSS、secret/log、资源上限、revocation、supply-chain。任何“配置里写 trusted: true”都不是批准证据。

## 5. 最终测试矩阵

- Schema/DB：manifest/state transitions、migration、CAS、revision immutability。
- Core/Plugin/Tool：Scope cleanup、collision、permission、stop/quarantine/rollback、interruption。
- Security：tamper/XSS/secret/DoS/supply-chain fixtures。
- HTTP/SDK/App/clients：auth、generated types、manager流程、跨端fallback、Playwright/a11y/i18n。
- 全局：受影响包 test/typecheck、HttpApi exerciser、Storybook、protocol refs、lint/full typecheck/diff。

## 6. 停止条件

- Threat model/Lifecycle/Capability ADR 任一未批准。
- 需要给 extension 内部 Context、Permission executor、credential value、全局 DOM/CSS 或任意 route。
- stop/quarantine 不能通过 owner Scope证明资源清理。
- 更新失败可能覆盖 current revision或留下半挂载状态。
- Plugin Asset 可绕过 InstalledExtension直接运行。
- 任一安全/供应链/回滚/跨端测试失败。

## 7. 分支策略

- Threat model/ADR 从 M3 后最新 main 建 `extension-adr`。
- 实现依次建议 `extension-store`、`extension-runtime`、`extension-faces`、`extension-manager`。
- 每个分支基于前置 PR 合入后的最新 main；M4 不与 M5 code sandbox 同分支或同 PR。
