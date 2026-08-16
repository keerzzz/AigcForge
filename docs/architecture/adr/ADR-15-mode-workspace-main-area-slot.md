# ADR-15: ModeWorkspace 主区为 Typed Slot（Chat 资产为中心）

> 状态：Accepted（2026-07-19，全权 owner 授权 AI 代理 Gate 1+5 签字；见接受记录）
> Date: 2026-07-19
> Amends: [ADR-12 §3](ADR-12-product-mode-entry-routing.md)
> 关联：[ADR-11](ADR-11-product-mode-session-classification.md)、[ADR-13](ADR-13-chat-work-mode-boundary.md)（模式定位表）、[ADR-14](ADR-14-persistence-and-scope-strategy.md) §4（数据真源）、[Chat PRD §9](../../prd/chat-mode-creation-layer.md)
> Proposed extension: [ADR-17](ADR-17-custom-mode-composition-platform.md) proposes a Custom typed slot using this same shared owner. It must not create a parallel workspace shell and is not implemented until ADR-17 is Accepted.

## 背景

ADR-12 §3 规定 ModeWorkspace 共享结构含 "Mode-scoped Session lists"（主区为会话列表），四模式同构。ADR-13 模式定位表定义各模式核心对象：Chat=可复用资产、Coding=代码任务、Work=非编程产出、Assistant=个人主动事项。

两者存在张力：强制 Chat 首页主区为会话列表（与 Coding 同构），偏离 ADR-13 对 Chat "核心对象=资产" 的定位 -- Chat 退化为 "带资产侧栏的 Coding"，模式差异化弱化，资产管理（PRD §7.4 批量搜索/编辑/去重）受右栏窄槽位空间限制无法承载。

现状实现进一步偏离 ADR-12 §3："首页 `/` 顶部模式卡片就地切换" + `ModeRoute` redirect 回 `/`（而非渲染共享 ModeWorkspace）+ Home 自绘伪四区 + `ChatFeatureSidebar` 在 Home 与 SecondarySidebar 重复实例化，导致模式切换组件 remount 闪烁。

## 决策

### 1. ModeWorkspace 主区为 typed slot

主区内容由模式核心对象决定（对齐 ADR-13 模式定位表），不强制为会话列表：

| 模式 | 主区 slot | 依据 |
|---|---|---|
| Chat | 资产工作台（资产树 + 编辑/预览 + 新建/导入） | ADR-13: Chat 核心对象=可复用资产 |
| Coding | 会话列表（从 Home 自绘抽为 slot，数据流迁移） | ADR-13: Coding=代码任务 |
| Work | 非编程产出视图（未来开闸）¹ | ADR-13: Work=非编程产出 |
| Assistant | 个人主动事项视图（未来开闸）² | ADR-13: Assistant=个人主动事项 |

¹ Work 的具体 slot（是否含工作流引擎）待 ADR-13 §边界规则5（工作流归属未决）+ Work PRD 决定，本 ADR 不预设工作流。
² Assistant 的记忆/主动触达 slot 待 Assistant PRD + ADR-13 §边界规则3（主动性来自持久调度）决定。

### 2. Session lists 降为共享能力

Session lists 仍是 ModeWorkspace 共享能力（各模式可用），但不强制为主区。Chat 下会话降为次级视图（SecondarySidebar 或主区 tab），不占主位；会话列表仍按 Location 联动过滤，与 Coding 共享同一查询/过滤逻辑。

### 3. 外壳共享不变（保留 ADR-12 §3 意图）

ModeSwitcher / SecondarySidebar / StatusBar / 路由 / 同步 / 通知 / 空 loading error 仍全模式共享。ADR-12 §3 的核心意图 -- "一个共享 workspace 避免四份 drift" -- 保留并强化：外壳共享，仅主区按模式 slot 差异化。**No Mode may copy the shared workspace into a sibling page** 不变。

### 4. slot 切换不 remount

> 锚定 solid-js@1.9.10 源码实证（`dist/dev.js:1521` Show / `:1545` Switch）。

`<Dynamic>`、`<Switch>`/`<Match>`、非 keyed `<Show>` 在分支切换时**都会 remount**（旧子树 dispose + 新子树 create），与 remount 同等触发 `createResource` 重取。**禁用这三者做模式 slot 切换**。

唯一不 remount 的两种方案（择一）：

1. **render-all + display:none**：全部模式 slot 常驻挂载，CSS `display:none` 切可见。代价：eager 付 4× 资源拉取。
2. **上提 resource 到 slot 之上**（推荐；slot 仍 remount，但 resource 不重取、无闪烁）：把 `createResource`（如 `promptAsset.list`、`assetCount`）提升到 ModeWorkspace 级 provider，不随 slot remount；slot 内仅消费，即便 slot 仍用 Dynamic/Switch 也不重取。避免 4× eager 拉取，resource 跨模式复用。

`ModeRoute` 渲染共享 ModeWorkspace（不 redirect），`/mode/:mode` 参数变化时同路由组件不卸载重挂（@solidjs/router 0.15.4 特性），消除外壳 remount。另见 plan step 7：sessionLoad queryKey 去掉 `mode.currentMode`，消除会话列表 skeleton 闪烁（与 remount 独立的第二闪烁源）。

### 5. 会话↔资产不落库

资产真源为 typed registry + 文件（ADR-14 §4），非 Session transcript，非 slot 状态。会话产出资产的记忆用内存态 session-scoped 记录（PRD §9.6），不落库；不新增数据库 migration（PRD §5.2 非目标不变）。

## 对齐

- **ADR-13 模式定位表**：主区 slot = 模式核心对象，产品定位与架构层一致
- **ADR-14 §4**：资产真源 registry + 文件，slot 不落库
- **ADR-11/12 §5**：不编 mode 进 Session URL，canonical `/server/:serverKey/session/:id` 不变
- **ADR-12 §1/§2**：`/mode/:mode` 参数化入口 + Home cards/icon rail 导航控件**契约**不变。导航控件=点选 navigate 到 `/mode/:mode`（契约不变）；独立 Home 页与 HomeModeCards 组件并入 ModeWorkspace，非保留独立 Home 页。
- **ADR-12 §4 + 根重定向**：`/` 重定向到 `/mode/<persistedMode>` 仅作**初始落地点选择**（one-time landing，非 authority）；route/work item 仍为权威，persisted currentMode 单向跟随（ADR-12 §4 不变）。Home 概念从"独立 `/` 页"迁移为"ModeWorkspace 在 persisted mode 下的呈现"，presentation-default 语义保留。
- **ARCHITECTURE §4.10**：`/mode/:mode` renders one shared ModeWorkspace + typed slots/adapters 已隐含本 ADR 概念；§4.10 Decisions 补引 ADR-15。

## 结果

### 正向影响

- Chat 以资产为中心，符合 ADR-13 定位；四模式主区差异化清晰，Chat 有明确存在理由
- 资产管理（PRD §7.4）获得主区空间，批量搜索/编辑/去重可承载
- 为 Work/Assistant/自定义 Agent 奠定 "主区=核心对象" 演进范式：新模式 = 注册 typed slot，不改路由/ModeWorkspace 外壳（开闭原则）；自定义 Agent 可通过 slot registry 动态注册
- 模式切换不闪烁：共享 ModeWorkspace 不 remount + slot 不 remount，根因修复

### 代价

- ADR-12 §3 字面修订：主区从 "Mode-scoped Session lists" 改为 "typed slot"
- Chat 会话降为次级，用户找会话路径需设计（SecondarySidebar 或主区 tab）
- 跨模式 "存为资产" 入口需补（PRD §7.2，Coding 会话跳 Chat 工作台或就地弹预览）

## 明确不决定

- Work 工作流、Assistant 记忆的具体 slot 实现（各自 PRD + owner contract）
- 自定义 Agent 的 slot 注册机制细节（My Agents PRD 后续）
- Chat 会话次级视图的具体形态（SecondarySidebar vs 主区 tab，PRD §9.1 实施时定）

## 接受条件

1. ADR-12 §3 修订经 Core/App owner 评审（本 ADR 即修订载体，ADR-12 原文保留历史）。
2. PRD §9.1 按本 ADR 重写（Chat 主区=资产工作台），过 PRD §15 Gate 复审。
3. `ARCHITECTURE.md` §7 在本 ADR 接受前将其列为 Proposed；接受后同步 Accepted。

## 接受记录（2026-07-19）

### 评审轨迹

- **初审**（双 owner agent）：Core ACCEPT WITH CONDITIONS（5×P1）/ App ACCEPT WITH CONDITIONS（2×P0 + 6×P1）
- **复审**（双 owner agent）：App ACCEPT（P0 全 RESOLVED，solid-js@1.9.10 源码实证 `dist/dev.js:1521` Show / `:1545` Switch）/ Core 发现 P1-NEW（§4 禁令未传导 plan/PRD 3 处）
- **第 3 轮**（Core owner agent）：P1-NEW RESOLVED（plan step 4 / 关键变更点 / PRD §9.1 三处改禁用，grep 全文核验无遗漏）；附带 §4 方案 2 标签精化 + plan step 7 queryFn 补充到位

### Gate 核对

| Gate | 状态 | 证据 | 签字 |
|---|---|---|---|
| 1. ADR 一致 | PASS | amends ADR-12 §3，对齐 ADR-13 模式定位表 + ADR-14 §4；不冲突 ADR-11（不编 mode 进 session URL）| Core owner ✓ |
| 2. 框架契约 Core 评审 | PASS | §4 slot 不 remount 两方案（display:none / 上提 resource）+ §5 不落库 | Core owner ✓ |
| 3. 安全评审 | PASS | §5 会话↔资产不落库（ADR-14 §4）；无新 migration（PRD §5.2 不变）；沿用 PRD §8.3.1 授权模型 | Security ✓（沿用 §8.3.1） |
| 4. 指标/埋点 | N/A | 本 ADR 不涉及指标 | - |
| 5. App 评审 | PASS | §4 SolidJS 机制（solid-js@1.9.10 实证）/ plan step 1 createEffect（对齐 app.tsx:201）/ step 7 queryKey 去 mode / 实施前置项 A1·A4·A5 已标注 | App owner ✓ |

### 签字

**全权 owner 授权 AI 代理签字**（2026-07-19）：双 owner 三轮 agent 评审文档层 ACCEPT，Gate 1+5 证据齐全。Gate 签字为治理流程的"人确认"环节，文档质量由内容判定（三轮 RESOLVED）。

> 注：本签字由用户（全权 owner）授权 AI 代行，非真人 owner 手签。如需真人 owner 复核，可在上表签字列追加签字行。

## 实现参考

[`docs/plan/mode-module-switching-completion.md`](../../plan/mode-module-switching-completion.md)（C 方案实施步骤：ModeRoute 渲染 ModeWorkspace、Home 并入、slot 不 remount）。
