# Custom 模式完整开发路线图

> 状态：**Approved for M0/M1 implementation v1.2 — M0 Phase A-F 可连续执行并在完成后统一复审；M1 仍受 G2/G3/G4 与 rollout Gate 约束**
> 日期：2026-08-18
> 同步基线：`main@a4ffba0b3`（本地 `main`、`origin/main` 与 GitHub `refs/heads/main` 已核对一致）
> Owner：产品 + Core + App + Security + Schema/SDK
> 依据：[Custom PRD v1.2](../prd/custom-mode-composition-platform.md)、[ADR-17](../architecture/adr/ADR-17-custom-mode-composition-platform.md)、[Custom 研究稿](../research/agent/DeepSeek-Harness四模式借鉴与自定义模式思维风暴.md)、[Session V2 Spec](../../specs/v2/session.md)、[Tool Spec](../../specs/v2/tools.md)
> 分支策略：ADR/契约先行；每个可独立合并的 PR 从前置提交合入后的最新 `main` 创建不超过三个词的短分支，不使用承载 M0-M5 的长期巨型分支

---

## 1. 路线图总览

```text
已完成基础
├── 四模式 Product Mode / ModeWorkspace typed slot
├── Chat 七类资产创建与管理闭环
├── Meta Agent + task 子 Session 委派
├── Location-scoped ToolRegistry / PermissionV2
└── Session V2 / EventV2 / Context Epoch

Custom 主线
├── M0 治理与统一组合契约
├── M1 单 Agent 可恢复闭环
├── M2 多 Agent 与 Workflow 编排
├── M3 MCP 与统一审批入口
├── M4 Trusted Runtime Extension
└── M5 Code Presentation
```

### 全阶段一览

| 阶段   | 名称                      | 核心范围                                             | 关键依赖                 | 状态                |
| ------ | ------------------------- | ---------------------------------------------------- | ------------------------ | ------------------- |
| **M0** | 治理与组合底座            | 第五 Mode、Profile/Plan/Snapshot、AssetRef、Resolver | ADR-17 已批准            | 已完成（Phase A-F） |
| **M1** | 单 Agent 可恢复闭环       | `meta` + 一个用户 Agent + Prompt/Skill + native + Upgrade + UI Phase E + 50 轮稳定性矩阵 | M0                       | 已完成（Waves W1-W4） |
| **M2** | 多 Agent 与编排           | Agent 池、Command、Workflow、进度、取消、部分成功    | M1                       | 已完成（PR #46 合入 `main@a11b50020`） |
| **M3** | MCP 与审批                | scoped registration、凭证、健康、统一审批入口        | M2 + Tool Registry 扩展  | 进行中（G3-1/G3-2/G3-3/G3-4 全过；Phase A/B/C/D/E/F0-F4 已合入本地 `main`；余 F5 与 Phase G，其中 F5 待产品裁定） |
| **M4** | Trusted Runtime Extension | Host/Agent/Client 分面、信任、停止、隔离、回滚       | M3 + Plugin 生命周期 ADR | 远期                |
| **M5** | Code Presentation         | `run_code` + 受限 SDK，共用 Effective Tool Set       | M3/M4 稳定               | 远期                |

### 独立实施计划

| 阶段 | TDD 实施计划                                                                     | 关键停止点                                               |
| ---- | -------------------------------------------------------------------------------- | -------------------------------------------------------- |
| M0   | [治理与组合底座](../plan/custom-mode-m0-composition-foundation.md)               | ADR/PRD 未批准不得进入生产代码                           |
| M1   | [单 Agent 可恢复运行闭环](../plan/custom-mode-m1-single-agent-runtime.md)        | M0/G2/G3/G4 未过不得创建 Custom Session                  |
| M2   | [多 Agent 与 Workflow 编排](../plan/custom-mode-m2-multi-agent-workflow.md)      | Workflow Execution ADR 未批准不得改 cardinality          |
| M3   | [MCP 与统一审批](../plan/custom-mode-m3-mcp-approval.md)（含 [执行提示词](../plan/prompt-custom-mode-m3-mcp-approval.md)） | canonical registration / scoped grant 未批准不得开放 MCP |
| M4   | [Trusted Runtime Extension](../plan/custom-mode-m4-trusted-runtime-extension.md) | threat/lifecycle/capability ADR 未批准不得 mount code    |
| M5   | [Code Presentation](../plan/custom-mode-m5-code-presentation.md)                 | sandbox/equivalence 证明未过不得实现 `run_code`          |

当前执行手册：M0/M1/M2 已完成并合入 `main`（M2 = PR #46，合并提交 `a11b50020`，复审报告 [Custom M2 复审报告](../review/AigcForge_CUSTOM_M2_REVIEW.md) 结论 APPROVED）。**M3 进行中**（2026-08-26 状态）：四道 Gate 已全过 —— G3-1 [ADR-19](../architecture/adr/ADR-19-mcp-scoped-registration.md) Accepted v1.0、G3-2 [ADR-20](../architecture/adr/ADR-20-scoped-grant-model.md) Accepted v1.2、G3-3 [ADR-21](../architecture/adr/ADR-21-mcp-credential-custody.md) Accepted v1.2、G3-4 由 ADR-20 §2.6/§2.7/§2.8 回答。**已合入本地 `main`（未推送）**：Phase A / B / D / F0，Phase C（Slice 0-4：typed stdio 与 remote 连接 owner、`mcp_credential_binding`、六态 health、两项止血）、Phase E（Resolver/Snapshot 绑定 MCP facts，未开 Composition V3）、Phase F1-F4（responder 能力对齐、V2 审批客户端、审批展示、Location 审批中心 + scoped grant 端点 + Builder MCP health）。**剩余：F5（浏览器 auto-accept 收敛，**等产品/安全裁定**）→ Phase G（故障注入与灰度）**，随后才是 M4/M5。执行提示词见 [M3 剩余阶段执行提示词](../plan/prompt-custom-mode-m3-remaining.md)。M3 全部 Phase 完成后统一开一个 PR。

## 2. 总体原则

### 2.1 主线约束

- 第五 Product Mode 是固定枚举 `custom`，不是任意动态 Mode。
- `meta` 固定拥有 Custom 根 Session，Profile 不能替换它。
- Profile 请求能力，Permission/Policy 决定实际能力。
- Resolver 只解析组合，不执行工具、不加载任意代码。
- Snapshot 冻结 Session 运行真值，但不取代 Context Epoch 或 ToolRegistry。
- 所有工具执行仍使用 canonical invocation context、Permission 和 settlement。
- 资产更新只影响未启动 Plan；运行中 Session 通过 fork/new Session 升级。
- 每个阶段先完成 owner contract 和失败语义，再开放 UI 入口。
- M1 不包含 MCP 动态注册、统一审批中心或任何 Runtime Extension；这些能力不得以“可信配置”名义提前进入首个闭环。

### 2.2 禁区

| 禁区                                           | 原因                                 |
| ---------------------------------------------- | ------------------------------------ |
| 不从 M1 一次开放七类资产                       | MCP/Plugin/Workflow 的运行成熟度不同 |
| 不把 Profile 做成第二种 Agent Asset            | Agent 是执行角色，Profile 是组合定义 |
| 不复制 Session/ModeWorkspace 页面              | 违反 ADR-12/15 的共享 owner          |
| 不在 Prompt 中单独承担 allowlist 安全          | 必须在 task 与子 Session 创建点执行  |
| 不把 `node:vm` 或 UI iframe 当可信代码安全边界 | 不能阻止宿主权限滥用                 |
| 不把 permission digest 当授权票据              | 执行时必须重新判断                   |
| 不静默使用最新 revision                        | 破坏恢复、审计和工具身份             |

## 3. M0：治理与统一组合契约

**目标**：先让第五模式、引用、解析、持久化和权限边界具有唯一 owner。

### 交付物

| 交付物                    | 内容                                                                    |
| ------------------------- | ----------------------------------------------------------------------- |
| ADR 修订链                | 接受 ADR-17；明确 supersede ADR-11/12/15 和旧 PRD 条款                  |
| Product Mode 契约         | `custom` Schema、路由、Draft/Session/child/fork 继承、旧客户端策略      |
| `custom-profile` 资产契约 | AssetKind、Schema、路径、revision、CAS、registry、watcher、apply/delete |
| Profile owner 边界        | 独立 owner；复用资产事务原语，不并入 Agent Asset、不复制平行事务        |
| `AssetRef`                | kind、Location/provenance、relativePath、revision、consumer binding     |
| `CompositionPlan`         | 预览、诊断、health、freshness，不作为运行真源                           |
| `CompositionSnapshot`     | Session 独立不可变快照、内容与运行依赖分层                              |
| `CompositionResolver`     | Location 解析、依赖/循环/冲突检查、capability intersection              |
| 反向引用                  | Profile、资产、Snapshot、Workflow、Plugin 的引用查询                    |
| 失败模型                  | missing、stale、conflict、permission、credential、runtime、defect       |

### 准入（治理评审已完成；代码仍按 Phase Gate 执行）

- 最新研究稿中的第五模式与 `meta` 根编排裁决已确认。
- Product/Core/App/Security/Schema+SDK 五方技术审批已由用户授权 AI 代理代行并记录于 ADR-17 与 Custom PRD；该代签不冒充真人负责人手签。

### 退出

- ADR-17 Accepted for M0/M1 implementation；Custom PRD Approved for M0/M1 implementation。
- 所有新增 domain 对象有明确 owner 和真源。
- Snapshot 与 Context Epoch、Session fork/move/resume 的关系通过 Core 评审。
- M1 不依赖未定义的 MCP/Plugin 动态运行能力。

## 4. M1：单 Agent 可恢复闭环

**目标**：证明“选择 → 解析 → 预览 → 冻结 → 委派 → 恢复”端到端成立。

### 范围

```text
custom
  -> root meta
      -> exactly one user Agent
          -> Prompt assets
          -> Skill assets
  -> native Tool Presentation
```

### 交付物

| 层            | 交付物                                                                    |
| ------------- | ------------------------------------------------------------------------- |
| Schema        | `ProductMode.custom`、Profile/Plan/Snapshot、错误和健康状态               |
| Core          | Resolver、Profile owner、Snapshot persistence、task allowlist enforcement |
| Session       | Draft 冻结、root=`meta`、child/fork/recovery 继承                         |
| Permission    | Custom ceiling、能力交集、执行时重评估                                    |
| App           | `/mode/custom`、Location、Builder、四类预览、Profile 列表、最近 Session   |
| Chat          | Custom Profile 创建/编辑/删除入口，复用资产事务                           |
| SDK           | Profile、Plan、启动、Snapshot 查询 API                                    |
| Observability | resolver latency、启动结果、版本漂移、委派拒绝                            |

### 必测链路

1. 临时组合直接启动。
2. 临时组合保存为 Profile 后启动。
3. Profile revision 在确认前变化，启动返回 stale。
4. 运行中资产变化，Snapshot 保持不变。
5. `meta` 尝试委派未入 Snapshot 的 Agent，被 task 和 Session 创建双层拒绝。
6. 内容型资产删除后历史仍可重建。
7. 运行依赖缺失后继续执行被明确阻断。
8. 使用新版资产时创建 fork 和新 Snapshot。

### 退出

- Custom PRD §15 的 M1 测试全部通过。
- 内部 50 次组合启动基线达标。
- Snapshot 一致率 100%，未授权委派和静默升级均为 0。
- 旧客户端不会把 Custom Session 错解为 Coding。

## 5. M2：多 Agent 与 Workflow 编排

**目标**：从单执行者扩展为由 `meta` 统一拥有结果的受控 Agent 团队。

### 交付物

| 交付物             | 内容                                                   |
| ------------------ | ------------------------------------------------------ |
| Agent pool         | 多用户 Agent allowlist、职责摘要、冲突与重复检测       |
| Binding v2         | 每个 Agent 的 Prompt/Skill/Command/Workflow 绑定       |
| Workflow execution | 串行、并行、依赖 DAG、失败策略                         |
| Progress           | 根 Session 聚合进度、子任务状态、部分成功              |
| Cancellation       | 根取消、单子任务取消、剩余任务策略                     |
| Retry/resume       | 复用 task_id、明确重试边界，不重放已完成副作用         |
| Cost preview       | Agent 数量、Prompt/Skill token、预计并发和工具目录大小 |

### 准入

- M1 Snapshot 与 allowlist 执行点稳定。
- Workflow 定义与执行 owner 契约已明确。
- task 失败、取消和部分成功具有结构化结果。

### 退出

- 多 Agent 并行时权限、上下文和输出不串扰。
- 根 Session 始终拥有最终回答与取消权。
- 一个 Agent 失败不会把已完成结果伪装成全部失败或全部成功。
- Workflow 不能提高任一 Agent 或父 Session 权限上限。

## 6. M3：MCP 与统一审批入口

**目标**：安全开放外部工具和数据源，并让用户在任意页面看见待审批请求。

### 交付物

| 交付物               | 内容                                                         |
| -------------------- | ------------------------------------------------------------ |
| Scoped registration  | MCP 工具按 Session 或 Location 注册到 canonical ToolRegistry |
| Credential reference | Snapshot 只记录引用；秘密由 credential owner 管理            |
| Health               | connect/auth/degraded/offline/revoked 状态与重连策略         |
| Tool snapshot        | 工具定义、registration identity、presentation digest         |
| Approval center      | 应用级待审批列表；授权范围为 once/Session/Location           |
| Grant model          | action/resource/agent/revision/expiry/revocation             |
| Headless behavior    | 无页面连接时 ask 不无限挂起，按 attended policy fail closed  |

### 准入

- Tool Registry 的 Session/Location 注册与 scope 清理设计通过。
- PermissionSaved 能表达所需授权范围，或已有迁移到唯一 scoped grant owner 的方案；当前 Project 级 `always` 不能被文案重命名为 Session grant。
- 凭证服务可撤销且日志不泄漏秘密。

### 退出

- Location A 的 MCP 不会出现在 Location B。
- 撤销凭证或授权后新调用立即失败，运行中调用按明确策略结束。
- 审批入口全局可见，但授权不会默认扩散到整个应用。
- 应用级入口只聚合请求；grant 的真源、撤销和过期仍绑定明确 Session/Location/Agent/revision。
- MCP 版本或工具定义变化不会修改已有 Snapshot。

## 7. M4：Trusted Runtime Extension

**目标**：开放经过安装、验证和审批的 Runtime Extension，不执行任意模型生成代码。

### Extension 分面

```text
host-capability
agent-capability
client-slot
tool-view
```

M4 首批建议只开放：

- `agent-capability`
- 既有受控 `tool-view`

`client-slot` 在卸载、资源和跨端降级契约完成后单独开闸；`host-capability` 需要最高级安全评审。

### 交付物

| 交付物             | 内容                                                                            |
| ------------------ | ------------------------------------------------------------------------------- |
| InstalledExtension | 安装记录、来源、digest、信任状态                                                |
| ExtensionRevision  | 不可变版本和 Host/Agent/Client manifest                                         |
| 生命周期           | discovered→validated→approved→staged→mounted→active→stopped/quarantined→removed |
| 审批               | 信任与工具 Permission 分离；未来 revision 默认不继承                            |
| 回滚               | current/next revision、失败保留旧版本                                           |
| Scope cleanup      | 工具、监听器、UI 贡献绑定拥有者 Scope                                           |
| 跨端               | Web/TUI/ACP/Headless 的 client capability 降级或阻断                            |

### 退出

- Plugin 更新失败不留下半挂载状态。
- 禁用/隔离能停止拥有者贡献，并保留审计记录。
- Client 页面不存在时请求不会无限等待。
- Extension 不能直接取得内部 registry、Permission executor 或全局 DOM/CSS 控制权。

## 8. M5：Code Presentation

**目标**：在不改变有效工具和权限真值的前提下，以一个 `run_code` + 受限 SDK 呈现能力。

### 数据流

```text
Registered Tools
-> Effective Tool Set
-> Presentation
   -> native
   -> code: run_code + generated SDK
-> canonical ToolRegistry execution
```

### 交付物

| 交付物                | 内容                                               |
| --------------------- | -------------------------------------------------- |
| Presentation contract | native/code 只改变模型呈现，不改变能力             |
| Generated SDK         | 仅包含当前 Snapshot 有效工具                       |
| `run_code`            | 无 executor 引用；每次调用回到 ToolRegistry        |
| Limits                | CPU/time/output/concurrency/temporary storage 限制 |
| Errors                | ToolFailure、interruption、defect 保持现有语义     |
| Audit                 | 代码调用映射到具体工具调用和 durable identity      |

### 退出

- Native 与 Code 对同一请求得到相同权限结果。
- `run_code` 无法构造未在 Effective Tool Set 中的调用。
- 中断 `run_code` 会中断其未完成工具链。
- 代码运行环境不能直接读取宿主秘密或绕过 Location。

## 9. 依赖矩阵

| 能力                     | 当前 owner        | Custom 使用方式                        | 阶段  |
| ------------------------ | ----------------- | -------------------------------------- | ----- |
| Product Mode / routes    | Schema + App      | 增加固定 `custom`                      | M0/M1 |
| ModeWorkspace typed slot | App               | Custom Sidebar/Main/RightPanel         | M1    |
| 七类资产                 | Chat typed owners | M1 用 Agent/Prompt/Skill，后续分批开放 | M1-M4 |
| Meta/task                | Core              | 根编排与用户 Agent 委派                | M1-M2 |
| Session V2               | Core              | Snapshot、恢复、fork、child 继承       | M0-M2 |
| Context Epoch            | Core              | 持久化实际模型可见上下文               | M0-M1 |
| ToolRegistry             | Core              | 唯一工具执行与 settlement              | M1-M5 |
| PermissionV2             | Core              | 能力交集和运行时授权                   | M1-M5 |
| MCP V2                   | Core              | scoped registration 与凭证             | M3    |
| Plugin SDK               | Plugin/Core       | Trusted Extension 分面                 | M4    |

## 10. 建议实施节奏

时间只作为初步容量估算，正式排期在各阶段实施计划审批后确定。

```text
第 1-2 周：M0 ADR/PRD、Schema 草案、Resolver/Snapshot 技术设计
第 3-6 周：M1 Core + App + Chat + SDK，内部 50 次基线
第 7-9 周：M2 多 Agent、Workflow、进度与取消
第 10-12 周：M3 MCP scoped registration、凭证和审批中心
后续独立立项：M4 Trusted Extension
M4 稳定后：M5 Code Presentation
```

不允许为了赶排期把 M3/M4 的安全前置塞进 M1 形成隐式技术债。

## 11. 关键 Gate

| Gate               | 通过标准                                       | 阻塞阶段 |
| ------------------ | ---------------------------------------------- | -------- |
| G0 产品治理        | ADR-17 Accepted，旧决策 supersede 清楚         | M0       |
| G1 真源与恢复      | Snapshot/Context Epoch/asset revision 契约通过 | M1       |
| G2 委派安全        | task + child creation 双层 allowlist           | M1       |
| G3 多 Agent 所有权 | 取消、部分成功、最终回答 owner 明确            | M2       |
| G4 MCP 权限        | scoped registration、凭证和 unattended 策略    | M3       |
| G5 Extension trust | 来源、digest、revision、停止、隔离、回滚       | M4       |
| G6 Code sandbox    | 能力等价、资源限制、不可绕过 ToolRegistry      | M5       |

## 12. 风险与应对

| 风险                               | 概率 | 影响 | 应对                                               |
| ---------------------------------- | ---- | ---- | -------------------------------------------------- |
| 第五 Mode 修改面过大               | 高   | 高   | M0 先列完整 Schema/API/App/SDK 迁移矩阵            |
| Snapshot 与 Context Epoch 重复建模 | 中   | 高   | Snapshot 保存组合事实，Epoch 保存实际模型上下文    |
| allowlist 只写进 Prompt            | 中   | 严重 | task 与 Session 创建双层强制检查                   |
| 资产删除导致无法恢复               | 高   | 高   | 内容快照与运行依赖分层；缺依赖明确阻断             |
| Profile 变成权限系统               | 中   | 严重 | 请求/有效/拒绝三列；执行时 Permission 重评估       |
| 多 Agent 成本失控                  | 中   | 中   | M2 增加 token/并发/目录预览与上限                  |
| MCP/Plugin 跨会话串扰              | 高   | 严重 | 未完成 scoped registration 前不开闸                |
| Extension 更新半挂载               | 中   | 高   | current/next revision + owner Scope + 回滚事务     |
| Custom 吞并内置模式                | 中   | 中   | 内置模式保持稳定默认和专属 UI，Custom 只做组合容器 |

## 13. 下一步

1. 顺序执行 M0 Phase A-F；每个 slice 完成 TDD、CLAUDE.md 复查和测试验证后自动继续，不设置中间审批点。
2. M0 Phase F 完成后输出统一 completion report，停机等待高级全栈顾问总复审；不得自动进入 M1。
3. 确认 `custom-profile` 的 AssetKind owner、目录和文件格式。
4. 确认 M1 严格范围：一个用户 Agent、当前 Location、Prompt/Skill、native。
5. M0 Approved 后按独立实施计划从当时最新 `main` 建立短生命周期实现分支；M1 只能在 M0 全部合入并复审后启动。

## 14. 关联文档

- [Custom PRD v1.2](../prd/custom-mode-composition-platform.md) — 产品范围真源
- [ADR-17](../architecture/adr/ADR-17-custom-mode-composition-platform.md) — 平台架构决策
- [Custom 研究稿](../research/agent/DeepSeek-Harness四模式借鉴与自定义模式思维风暴.md) — 产品裁决与外部借鉴
- [Session V2 Spec](../../specs/v2/session.md) — Session、恢复、Context Epoch
- [Tool Spec](../../specs/v2/tools.md) — Tool Registry、权限和中断
- [Chat PRD](../prd/chat-mode-creation-layer.md) — 资产创建和生命周期
- [Work 路线图](work-mode-roadmap.md) — 分阶段交付格式参考
- [Assistant 路线图](assistant-mode-roadmap.md) — 跨阶段依赖格式参考
