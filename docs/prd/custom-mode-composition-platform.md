# PRD：Custom 模式 - 用户资产组合与运行平台

> 状态：**Draft v1.1 — 已同步协议复核结论，待 ADR-17 与 Product/Core/App/Security 评审**
> 日期：2026-08-16
> 负责人：产品（范围与指标）/ Core（Composition、Session、Permission）/ App（Custom surface）/ Security（能力与扩展边界）
> 范围：`packages/schema` + `packages/core` + `packages/aigcfroge` + `packages/app` + `packages/sdk/js`
> 关联：[ADR-17](../architecture/adr/ADR-17-custom-mode-composition-platform.md)、[Custom 研究稿](../research/agent/DeepSeek-Harness四模式借鉴与自定义模式思维风暴.md)、[ARCHITECTURE.md](../../ARCHITECTURE.md) §4.1/§4.4/§4.6/§4.7/§4.10、[CONTEXT.md](../../CONTEXT.md)、[Session V2 Spec](../../specs/v2/session.md)、[Tool Spec](../../specs/v2/tools.md)
> 关联路线图：[Custom 模式完整开发路线图](../roadmap/custom-mode-roadmap.md)

---

## 1. 三行摘要

- **做什么**：新增第五个固定 Product Mode `custom`，让用户在一个受约束、可预览、可恢复的运行空间中，为固定根编排者 `meta` 选择自建 Agent，并组合 Prompt、Skill 及后续分阶段开放的能力资产。
- **为谁做**：已经通过 Chat 创建 Agent、Prompt、Skill、MCP、Command、Workflow 或 Plugin，希望把这些资产组合成可重复运行环境的高级用户与团队。
- **为什么现在做**：七类资产已有创建和管理闭环，但缺少统一消费层；用户仍无法回答“这次由谁执行、带哪些资产、实际可见哪些工具、最终权限是什么、以后能否按同一版本恢复”。

## 2. 产品裁决与文档关系

当前产品方向已经收敛为：

```text
Product Mode: custom
Root Orchestrator: meta
Composition Profile: 可保存的组合定义
Composition Snapshot: Session 启动时冻结的运行真值
```

本 PRD 采用“第五 Product Mode + 任意多个 Custom Profile”的双层模型，不再把 Custom 降级为 My Agents 启动台。

ADR-17 接受后需要正式修订：

- ADR-11：Product Mode 从四值扩展为五值。
- ADR-12：`/mode/:mode` 解码加入 `custom`。
- ADR-15：ModeWorkspace 增加 Custom typed slot。
- My Agents PRD：启动能力并入 Custom 首页，不再作为相互竞争的产品入口。
- Assistant PRD §21.2：撤销“不新增第五种 Product Mode”的旧扩展结论。

在 ADR-17 接受前，本 PRD 只定义目标产品契约，不授权实现静默改写现有四模式 Schema 或 Session 兼容语义。

### 2.1 协议复核后的范围裁决

| 问题 | M1/M3/M4 正式口径 |
|---|---|
| `custom-profile` | 第八类资产的目标方向；必须复用 AssetKind/typed owner/CAS/registry/watcher 框架，ADR-17 接受前不算已实现类型 |
| Agent 数量 | M1=`meta` 根 Session + 1 个用户 Agent 委派目标；零个或多个都阻断 |
| 资产作用域 | M1 仅当前 Location 项目资产；不支持 Global/Cross-Location/绝对路径 |
| Runtime Extension | M1 完全不执行；M4 只开放 Installed+Validated+Approved+Pinned 的 Trusted Extension |
| 删除后恢复 | 历史与 Snapshot 始终可查看；继续执行依赖冻结内容和完全匹配的运行依赖，缺失时阻断 |
| 审批中心 | M3 提供应用级可见入口；授权范围为 once/Session/Location，不存在默认应用级永久信任 |

## 3. 问题与定位

Chat 已能创建和管理七类资产，但资产被创建后仍分散在各自 registry 中。用户需要自己记住：

- 哪个 Agent 适合当前任务。
- 哪些 Prompt、Skill、MCP 或 Workflow 应交给哪个执行者。
- 某个资产是否仍可用、是否已经变化。
- 组合请求的能力是否真正获得权限。
- Session 恢复时使用的是旧版本还是当前最新版本。

> 用户任务：我已经创建了安全审查 Agent、发布规范 Prompt 和检查清单 Skill，希望把它们保存成一套“发布审查团队”，以后从一个入口直接启动，并确保运行中不会因为资产更新而悄悄换版本。

Custom 是**用户资产的组合消费与运行层**：

- Chat 继续负责资产创建、编辑、导入和生命周期管理。
- Custom 负责选择、绑定、解析、预览、冻结和运行资产组合。
- `meta` 固定拥有根 Session，并只在组合快照允许的用户 Agent 集合内委派。
- Custom 不取代 Coding、Work 或 Assistant 的稳定默认体验。

## 4. 目标与非目标

### 4.1 M1 目标

- 增加固定 Product Mode `custom`、入口 `/mode/custom` 和 Custom typed slot。
- 用户必须选择一个现有 Location，不创建隐式全局工作区。
- 支持临时组合，以及保存为第八类资产 `custom-profile` 的可复用组合。
- M1 每个组合严格包含一个用户 Agent，可选绑定 Prompt 和 Skill。
- 根 Session Agent 固定为 `meta`，用户 Agent 只能作为委派执行者。
- 首次提交前生成可解释的 `CompositionPlan`，展示最终 Instructions、Capabilities、Permissions 和 Diagnostics。
- 首次提交冻结不可变 `CompositionSnapshot`，Session、子 Session、恢复和 fork 均使用明确版本。
- Profile 或资产变化不得静默改变运行中 Session。
- 删除、版本漂移和依赖缺失必须有明确状态，不回退默认 Agent 或最新资产。

### 4.2 M1 非目标

- 不支持多个用户 Agent、并行委派或用户定义工作流执行。
- 不开放 MCP 动态注册、远程凭证生命周期或断线恢复。
- 不运行 Plugin Host/Client 代码，不允许模型生成代码后立即执行。
- 不支持 Code Presentation 或 `run_code`。
- 不支持全局资产、跨项目路径引用或自动复制其他 Location 的资产。
- 不允许 Session 运行中直接修改组合；变更必须创建新 Session 或显式 fork。
- 不新增第二套 Session route、ToolRegistry、Permission 服务或 Agent registry。

## 5. 核心领域模型

### 5.1 Platform Foundation

平台固定提供且用户资产不能替换：

- Product Mode、Location、Session V2、EventV2 和 canonical Session route。
- `ModeRoute`、`ModeWorkspace`、Session timeline、Composer 和共享状态面。
- `PermissionV2`、Policy、ToolRegistry、FileSystem 和中断语义。
- `meta` 根编排器、任务状态、子 Session 和审计事件。
- v2 UI tokens、i18n、图标、可访问性和响应式约束。

### 5.2 Custom Profile

Custom Profile 是第八类配置资产，由 Chat 管理、Custom 消费。它描述组合，不执行组合。

该类型必须拥有独立的 AssetKind owner、规范路径、Schema、revision、CAS、registry、watcher、invalid/health 投影、apply/delete 事务和反向引用查询。不得把 Profile 塞入 Agent Asset，也不得复制七类资产的事务实现形成平行 owner。

最小产品字段：

| 字段                    | 语义                                              |
| ----------------------- | ------------------------------------------------- |
| `name` / `description`  | 用户可识别的组合信息                              |
| `revision`              | Profile 内容 revision                             |
| `agents`                | `meta` 可委派的用户 Agent 引用；M1 长度固定为 1   |
| `bindings`              | Prompt、Skill 与 `meta` 或用户 Agent 的消费者绑定 |
| `presentation`          | M1 固定为 `native`                                |
| `requestedCapabilities` | 组合请求的能力，不代表已经授权                    |

Profile 不内嵌其他资产文件，也不能把资产请求转换成 Permission allow。

### 5.3 Composition Plan

`CompositionPlan` 是启动前的解析投影，可缓存但不是运行真源：

- 解析后的引用与 revision。
- 指令和 Skill guidance 的最终顺序。
- 候选 Agent allowlist。
- 请求工具、有效工具和被拒绝工具。
- Location、凭证、依赖、冲突和版本漂移诊断。
- Profile 健康状态。

首次提交必须重新确认 revision、权限和依赖可用性，不能直接信任旧 Plan。

### 5.4 Composition Snapshot

`CompositionSnapshot` 是每个 Session 独立拥有的不可变运行记录，至少冻结：

- `mode=custom` 和根 Agent=`meta`。
- Profile id/revision，或临时组合 id/digest。
- 用户 Agent id、provenance、revision 和允许委派集合。
- Prompt/Skill 的规范引用、revision、消费者绑定和有效顺序。
- 实际进入模型上下文的内容型输入或可重建记录。
- 有效工具定义目录及注册 identity digest。
- Permission/Policy 计算摘要和当时的诊断结果。
- 外部凭证只保存引用，不保存秘密内容。

快照不替代 Context Epoch。实际展示给模型的系统上下文仍按 Session V2 Context Epoch 规则持久化和重放。

## 6. 组合与绑定规则

M1 支持两种消费者：

```text
orchestrator
  = Custom 根 Session 的 meta

agents/<agent-id>
  = meta 创建的用户 Agent 子 Session
```

默认绑定：

- 用户 Agent 定义只进入委派目录，不替换根 Agent。
- Prompt 默认绑定到用户 Agent。
- Skill 默认绑定到用户 Agent，并继续按需加载。
- 用户可以在启动前把 Prompt 或 Skill 改绑到 `orchestrator`。
- 未连接资产不加载、不进入模型上下文、不进入工具目录。
- M1 不支持 `shared` 自动注入；后续阶段可增加“可选择共享”，但不能等同于“所有执行者自动获得”。

指令顺序必须稳定且可预览：

```text
Platform baseline
-> Custom mode instruction
-> selected Agent instruction
-> bound Prompt assets
-> available Skill guidance
-> chronological Session context
```

## 7. 有效能力与权限

Custom Profile 不是权限系统。有效能力按交集计算：

```text
Effective Capabilities
  = Custom Mode ceiling
  ∩ Meta permissions
  ∩ Selected executor permissions
  ∩ Asset requested capabilities
  ∩ Location policy
  ∩ Session policy
  ∩ User approval facts
```

强制规则：

- 任意一层 deny 都不能被 Profile 覆盖。
- Skill、Prompt 和 Workflow 不能授予工具权限。
- 用户 Agent 不能继承高于自身规则或父 Session 上限的权限。
- `meta` 的 `task` 调用必须在执行点检查 Snapshot allowlist。
- 子 Session 创建必须再次检查相同 allowlist，不能只依赖 Prompt。
- 外部 CLI 等不创建子 Session 的执行路径必须有独立模式与组合检查。
- 工具是否展示给模型，与工具执行时是否获准，是两个不同阶段。
- Snapshot 中的 permission digest 只用于审计；每次工具调用仍由 canonical `PermissionV2` 判断。

现有 `always` 保存审批以 Project 为作用域，不能直接冒充未来的 once/Session/Location grant model。M3 必须明确扩展 `PermissionSaved` 或引入唯一 scoped grant owner，并支持 Agent/revision/expiry/revocation；应用级审批中心只负责发现和裁决请求，不成为应用级权限真源。

## 8. 用户故事

| 用户故事                                                                     | 验收结果                                                    |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 作为资产创建者，我想把 Agent、Prompt 和 Skill 组合起来，以便直接运行真实任务 | M1 可选择一个用户 Agent，并绑定任意兼容 Prompt/Skill        |
| 作为安全敏感用户，我想在启动前看见最终权限，以免组合后意外获得更高权限       | 预览分开展示请求、有效和被拒绝能力，并标明来源              |
| 作为重复使用者，我想保存组合，以便下次一键启动                               | 临时组合可保存为 Custom Profile，后续按 revision 启动       |
| 作为审计用户，我想知道 Session 实际用了哪个版本                              | Session 可查看 Snapshot 中的 Profile、Agent 和资产 revision |
| 作为历史用户，我不希望资产更新改变正在运行的 Session                         | watcher 只提示版本漂移，不能替换当前 Snapshot               |
| 作为恢复用户，我想在依赖缺失时得到明确选择                                   | 可查看历史；继续旧版本、迁移并 fork 或取消，不静默升级      |
| 作为多项目用户，我不希望组合误读其他项目资产                                 | M1 只列出并解析当前 Location 的项目资产                     |

## 9. M1 产品流程

### 9.1 临时组合

1. 用户进入 `/mode/custom`。
2. 选择现有 server/Location。
3. 选择一个来源明确、当前可用的用户 Agent。
4. 可选添加 Prompt 和 Skill，并检查默认消费者绑定。
5. Resolver 生成 CompositionPlan。
6. 用户查看 Instructions、Capabilities、Permissions、Diagnostics。
7. 用户点击“启动”，服务端重新确认 revision、权限和依赖。
8. App 创建 `mode=custom` Draft；首次提交创建根 Agent=`meta` 的 Session 并冻结 Snapshot。
9. `meta` 仅可委派到 Snapshot 中的用户 Agent。

### 9.2 保存组合

1. 用户在通过预览的临时组合上选择“保存为 Profile”。
2. 进入现有 Chat 资产确认/事务边界，校验名称、路径和冲突。
3. Profile 保存成功后回到 Custom，并以新 revision 重新生成 Plan。
4. Profile 保存不自动启动 Session，也不自动批准能力。

### 9.3 恢复与升级

- 依赖完整：按原 Snapshot 恢复。
- 内容型资产文件已变化：继续使用已冻结的模型可见输入。
- 运行时依赖缺失或 identity 不匹配：阻断执行并显示具体依赖。
- 用户采用新版本：必须 fork 或新建 Session，生成新 Snapshot。
- Profile 被删除：历史 Session 仍可查看；是否继续执行取决于 Snapshot 和运行依赖是否完整。

## 10. 页面与交互

Custom 复用共享 ModeWorkspace，不创建平行页面外壳。

### 10.1 Mode 首页

- 左栏：Location、Profile 搜索、最近使用、健康状态过滤。
- 主区：临时组合入口、Profile 列表、组合 Builder、最近 Custom Sessions。
- 预览区：Instructions、Capabilities、Permissions、Diagnostics 四个 Tab。
- Session 列表按当前 Location 和 `mode=custom` 查询。

桌面宽屏可使用“资产目录 / 组合清单 / 解析预览”三列布局；窄屏改为单列步骤和抽屉，不压缩成互相遮挡的三列。

### 10.2 Session 详情

- 中栏继续使用共享 timeline 和 Composer。
- Custom 可在 SessionSidePanel typed slot 中提供 Composition、Dependencies 和 Run History。
- Composition 面板只读展示当前 Snapshot，不允许原地编辑运行组合。
- “采用新版本”操作创建 fork/new Session，不修改当前 Session。

### 10.3 状态与反馈

Profile 健康状态：

```text
ready | needs-recheck | degraded | broken | deleted | quarantined
```

必须分别提供 loading、empty、permission-required、dependency-missing、version-drift 和 resolver-failed 状态。不得把所有失败折叠成“无法启动”。

## 11. 删除与生命周期

| 操作           | Profile                      | 被引用资产    | 已有 Session                       | 后续启动                |
| -------------- | ---------------------------- | ------------- | ---------------------------------- | ----------------------- |
| 移除引用       | 产生新 revision              | 不删除        | 旧 Snapshot 不变                   | 使用新组合              |
| 删除 Profile   | 不再可发现                   | 不删除        | 历史始终可查看                     | 不能从该 Profile 新启动 |
| 删除内容型资产 | Profile 标记 broken          | 事务删除      | 已冻结内容可继续参与历史重放       | 新启动阻断              |
| 删除运行时资产 | Profile 标记 broken          | 事务删除/卸载 | 缺少完全相同运行依赖时阻断继续执行 | 新启动阻断              |
| 禁用扩展       | Profile degraded/quarantined | 文件可保留    | 按扩展停止策略处理                 | 默认阻断                |

删除前必须显示反向引用；删除不能级联删除 Profile、其他资产或 Session 历史。

## 12. 失败、中断与并发

- 用户中断根 Session 时，当前进程内的子 Session、工具调用和委派链按现有 Effect interruption 传播。
- M1 不承诺崩溃后自动重试模糊的 provider work；遵循 Session V2 的显式 resume 语义。
- Profile 保存使用 baseRevision CAS；两个窗口不能静默覆盖。
- 同一 `(Location, profileRevision)` 的 Plan 解析可以去重，但 Snapshot、审批和 Session 状态不得共享。
- Resolver 失败必须保持 Draft 和用户选择，允许修正后重试。
- 已开始执行的工具调用遵循 Tool Registry captured registration 与 stale rejection 规则。

## 13. 成功指标

内部阶段至少完成 50 次组合启动基线，覆盖临时/保存 Profile、版本变化、依赖删除和恢复。

| 指标                      | M1 目标 | 测量方式                                              |
| ------------------------- | ------: | ----------------------------------------------------- |
| Plan 解析成功率           |    ≥98% | 成功生成可预览 Plan / 有效解析请求                    |
| 预览到 Session 启动成功率 |    ≥95% | 成功冻结 Snapshot 的 Session / 启动确认               |
| Snapshot 一致率           |    100% | Draft、Session、子 Session 的 allowlist/revision 一致 |
| 未授权 Agent 委派         |       0 | task 与子 Session 双层拦截统计                        |
| 运行中静默版本替换        |       0 | watcher/registry 变化后的 Snapshot digest 变化次数    |
| 缺失依赖静默回退          |       0 | 依赖失败后使用默认 Agent/最新版本的次数               |
| 7 日 Profile 再次使用率   |    ≥25% | 同一 Profile revision 或显式升级后再次启动            |
| M1 首次可运行组合时间 P50 | ≤3 分钟 | 进入 Custom 到成功启动 Session                        |

埋点不得记录 Prompt、Skill 正文、凭证、完整权限资源或用户文件内容。

## 14. 灰度与回滚

- 使用 Custom Mode feature flag；先内部，再 10% Beta，再全量。
- 关闭 flag 只隐藏入口和新建能力，不删除 Profile 或已有 Custom Session。
- Schema/API 必须保持旧客户端可解码；缺失 `custom` 支持的旧客户端应明确显示“不支持此 Session 模式”，不得解码成 Coding。
- 出现跨 Location 读取、allowlist 绕过、静默升级、权限提权或 Snapshot 不可重建时立即停止灰度。
- 回滚应用代码不得删除用户 Profile 或改写已有 Snapshot。

## 15. 验收与测试

- Product Mode Schema、Draft、Session create/list/filter、child/fork 继承和 canonical route。
- M1 单 Agent 上限、零 Agent 阻断、未知/hidden/不可用 Agent、加载后失效。
- Prompt/Skill 默认绑定、改绑、顺序、未连接资产不加载。
- Plan freshness check、revision TOCTOU、Profile CAS 和多窗口覆盖。
- `task` 执行点与子 Session 创建点都拒绝非 Snapshot Agent。
- Profile/资产 watcher 变化不修改运行中 Snapshot。
- 内容型资产删除后的历史重放；运行时依赖缺失后的明确阻断。
- Permission deny 不被 Profile、saved approval 或 presentation 绕过。
- 中断根 Session 时子 Session 和工具链正确结束，无伪成功。
- 桌面/窄屏、键盘、焦点、明暗主题、中英文溢出、loading/empty/error/diagnostic 状态。
- SDK 生成、旧客户端兼容、迁移和事件 replay。

## 16. 分阶段范围

| 阶段 | 产品范围                                                                    |
| ---- | --------------------------------------------------------------------------- |
| M0   | 第五 Mode 治理、Profile/Plan/Snapshot/引用契约和 Resolver 设计              |
| M1   | 一个用户 Agent + Prompt/Skill + native presentation + 可恢复 Snapshot       |
| M2   | 多 Agent、Command、Workflow、并行/串行编排、进度和部分成功                  |
| M3   | MCP、凭证引用、健康检查、Session/Location scoped registration、统一审批入口 |
| M4   | Trusted Runtime Extension、Host/Agent/Client 分面、停止/隔离/回滚；禁止模型代码即时执行 |
| M5   | Native/Code Presentation、`run_code` 受限 SDK                               |

详细依赖、准入和退出条件见 [Custom 模式完整开发路线图](../roadmap/custom-mode-roadmap.md)。

## 17. 批准 Gate

本 PRD 从 Draft 转为 Approved 前必须全部满足：

1. ADR-17 正式接受第五 Product Mode，并明确 supersede ADR-11/12/15 及旧 PRD 条款。
2. Core 评审 Profile、AssetRef、Plan、Snapshot、Resolver 和 Context Epoch 的 owner/真源边界。
3. Security 评审 capability intersection、task 双层 allowlist、权限重评估、凭证引用和删除恢复语义。
4. App 评审 Custom 首页、Builder、预览、SessionSidePanel 和窄屏交互。
5. Schema/API/SDK 评审 `custom` 兼容、旧客户端行为和迁移策略。
6. 产品确认 M1 严格限制一个用户 Agent、当前 Location、Prompt/Skill 和 native presentation。
7. 内部 50 次基线、埋点隐私和 Beta 停止规则就绪。

## 18. 开放问题

| 问题                                                       | 负责人         | 默认建议                                        |
| ---------------------------------------------------------- | -------------- | ----------------------------------------------- |
| Snapshot 的物理存储采用 Session 表、独立表还是内容寻址记录 | Core           | 独立 typed owner；内容与运行依赖分层保存        |
| Profile 文件扩展名和目录                                   | Core + Chat    | 复用 AssetKind 框架，由独立 owner 定义          |
| 内容型资产快照保留多久                                     | 产品 + Core    | 至少覆盖 Session 可恢复生命周期                 |
| Session move 后 Custom Snapshot 如何处理                   | Core           | 保留历史；目标 Location 缺依赖时阻断继续        |
| 应用级审批中心何时交付                                     | App + Security | M3 与 MCP 一起交付；授权仍绑定 Session/Location |
| Custom 是否允许覆盖 Agent 模型                             | 产品 + Core    | M1 不允许；后续按 Agent 明确声明开放            |
