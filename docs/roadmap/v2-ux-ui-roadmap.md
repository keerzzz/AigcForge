# AigcForge V2 UX/UI 完整升级路线图

> **状态**：**有条件进入执行**。统一工作台、状态真实性、可维护设计系统与渐进式模式补全已获得设计层面的批准；“全量纯 V2”、自治审查、Thought Canvas、Skill Budget Gauge 与真正 DAG 编排仍不是当前已实现能力。
>
> **日期**：2026-08-29
>
> **Owner**：产品 / UX/UI / App / UI / Session UI / QA；涉及执行状态与恢复语义时，由 Core、Desktop 与架构 Owner 共同确认。
>
> **设计基线**：`DESIGN.md`
>
> **来源交付物**：`/home/keer/.cursor/projects/media-win-data-aigcfroge/canvases/aigcfroge-v2-ux-upgrade.canvas.tsx`
>
> **研究材料**：完整智能体历史 `33cc3ae3-bbc0-48e6-86fc-53cdee5c2850` 与 `f9d543d2-60af-4c5b-bc48-b5b0d92a8032` 的全量日志；前者完整日志路径为 `/home/keer/.gemini/antigravity/brain/33cc3ae3-bbc0-48e6-86fc-53cdee5c2850/.system_generated/logs/transcript_full.jsonl`，后者完整日志路径为 `/home/keer/.gemini/antigravity/brain/f9d543d2-60af-4c5b-bc48-b5b0d92a8032/.system_generated/logs/transcript_full.jsonl`。

---

## 1. 文档状态与适用范围

这份文档把 UX/UI Canvas 收敛为可排期、可验收、可暂停的产品线路图，适用于桌面端 V2 的 Home、五种 Product Mode、Session 工作区、资产工作台、审批与错误恢复体验，以及 UI/Session UI 的设计系统迁移。

本路线图不替代以下事实源：

- 产品模式、Session、事件与上下文的架构约束：`ARCHITECTURE.md`、`CONTEXT.md`；
- 工程执行规则：`AGENTS.md`、`CLAUDE.md`；
- 已批准的模式专线：
  - `docs/roadmap/custom-mode-roadmap.md`
  - `docs/roadmap/assistant-mode-roadmap.md`
  - `docs/roadmap/work-mode-roadmap.md`
  - `docs/roadmap/external-cli-dispatch-roadmap.md`

### 1.1 事实、提案与待验证项的标记

| 标记 | 含义 | 使用规则 |
| --- | --- | --- |
| **事实** | 能由当前代码、文档、日志或探针复核 | 可以作为路线图前置条件或验收基线 |
| **提案** | 设计方向或产品假设，尚未形成完整契约 | 必须先做数据/交互/安全验证，不能写成已上线能力 |
| **待验证** | 仅凭静态代码或视觉判断无法确认 | 先测量、埋点或测试，再决定是否改动 |

Canvas 的 UX 代码事实快照来自 **2026-08-28、`main@f21cb4be5`**；本 Markdown 在 **2026-08-29、`main@eeaec64f2`** 上整理。若快照数字与后续代码产生差异，以当前仓库实际扫描结果为准，不以旧数字覆盖新事实。

---

## 2. 产品判断与总原则

### 2.1 总决策：一套可变工作台，而不是五套皮肤

AigcForge V2 应共享一套稳定的产品外壳：导航、模式切换、Session 语义、设计 Token、键盘焦点、状态词汇、错误呈现、恢复动作和审计反馈保持一致；模式差异只来自：

1. **任务对象**：用户当前在处理 Session、资产、Task/Artifact、记忆/笔记，还是 Composition/Snapshot；
2. **首屏主操作**：继续执行、治理资产、审阅并应用产物、确认记忆，或诊断并启动组合；
3. **信息密度**：高密度执行、中密度扫描、舒展阅读、关系导航或结构化配置。

这样既保留各模式的工作效率，又避免五套互不兼容的布局、交互和视觉语言造成学习成本与组件分叉。

### 2.2 先信任，再质感

V2 的首要升级不是玻璃材质、粒子连线、渐变背景或更复杂的卡片，而是让用户始终知道：

- 当前处于哪个模式、处理什么对象；
- 能力是否可用、为什么不可用；
- 请求是在加载、刷新、等待审批、执行、失败、过期还是恢复中；
- 失败影响了什么，下一步能做什么，是否会重复外部副作用；
- 资产或 Session 的来源、版本、快照和应用结果是什么。

视觉表达必须服务于扫描、层级、反馈和恢复。它不能掩盖错误，也不能把未知状态装饰成“空白但正常”。

### 2.3 设计执行顺序

遵循仓库协议的减法原则：

```text
先查事实
→ 统一产品承诺
→ 建立状态与几何基线
→ 复用既有 Shell / Token / 组件
→ 小范围迁移并验证
→ 再扩展高级视觉与编排能力
```

禁止以一次全仓盲替换、重复建 Shell 或新增大型抽象来代替迁移账本和行为验证。

---

## 3. 当前事实基线

下表是 UX Canvas 中已记录的基线。数字是快照，不是不可变 KPI；每次扩展路线前应重新扫描并更新记录。

| 领域 | 当前事实 | UX 含义 | 证据位置 |
| --- | --- | --- | --- |
| 研究范围 | 完整 UX 会话日志约 230 条记录、16 次用户明确输入；研究覆盖五模式 × 三层级 | 角色研究已足够支撑第一版契约，但不能把后期愿景直接当产品事实 | `/home/keer/.gemini/antigravity/brain/33cc3ae3-bbc0-48e6-86fc-53cdee5c2850/.system_generated/logs/transcript_full.jsonl` |
| V2 组件 | `packages/ui/src/v2/components` 有 51 个 TSX 文件；旧 `src/components` 有 68 个 TSX 文件 | V2 组件库已成形，但不能称为“全量 V2” | `packages/ui/src/v2/components` |
| 旧 Token | 扫描快照：`ui` 580、`app` 55、`session-ui` 266 处旧 Token 引用，含源码与 Story | 视觉断层的根因是双系统并存，不是缺少装饰效果 | `packages/ui/src`、`packages/app/src`、`packages/session-ui/src` |
| 旧组件入口 | 约 60 个 App 源文件仍直接导入 `@aigcfroge/ui` 的旧组件入口 | 迁移需要按 owner、风险和用户路径分批完成 | `packages/app/src` |
| 主题 | `themes` 目录有 37 个 JSON 主题文件 | 主题数量不等于可用性；需要逐主题检查对比度、零白闪与语义完整性 | `packages/ui/src/theme/themes` |
| 共享外壳 | `ModeWorkspace` 使用 render-all + `display:none`；HomeOverview、ModeSwitcher、SessionRightPanel 已存在 | 这是可复用底座，应继续收敛，不再创建平行 Shell | `packages/app/src/pages/mode-workspace.tsx` |
| Custom 真实形态 | Custom 已进入模式轨；当前中间区域是组合配置表单与 Plan Tabs，不是 DAG 节点画布 | M1 应被命名为配置工作台；真正编排画布只能作为 M2 单独立项 | `packages/app/src/pages/mode-workspace-slots.tsx`、`packages/app/src/components/custom/` |
| 能力门控 | ModeSwitcher 当前无条件遍历 `MODE_DEFINITIONS`；Custom 的后端能力/开关在 Plan/Start 调用时才反馈 | 入口、不可用原因和服务端能力需要共享同一事实源 | `packages/app/src/components/mode-switcher.tsx`、`packages/core/src/product-mode-policy.ts` |
| 几何风险 | `ModeWorkspace` 的 `max-w-[1080px]` 与 `280px + 960px + gap + padding` 存在语义冲突 | 不能仅凭 class 名称判断溢出，必须先读取 computed geometry | `packages/app/src/pages/mode-workspace.tsx` |

### 3.1 对原始提案的校准

| 原始表述 | 当前判断 | V2 路线处理 |
| --- | --- | --- |
| “100% 纯 V2” | **不成立** | 建立 v1→v2 迁移账本，按高频路径逐批迁移；不承诺一次清零 |
| “Auto-Review 已可落地” | **提案** | 先优化已有 Approval Center 与 Permission 的信息架构；自治放行另立安全契约与 rollout gate |
| “Thought Canvas 已存在” | **提案** | 先做可解释的状态摘要；不展示未经验证的内部推理内容 |
| “2% Skill Budget Gauge” | **提案** | 只有在 Context/Tool budget 成为稳定、可消费的数据契约后再做可视化 |
| “Custom 是视觉编排画布” | **部分成立** | 当前是 Composition Config + Plan Preview；M1 先交付配置工作台，DAG 画布另立 M2 |
| “玻璃、粒子、超椭圆是升级重点” | **不建议** | 以层级、密度、状态和反馈提升质感，遵循 `DESIGN.md` 的 quiet / dense / operational 取向 |
| “五种模式要五套风格” | **不建议** | 统一 Shell、Token、状态与无障碍；差异化任务语义和信息密度 |

---

## 4. 五模式统一契约

每个模式都必须在首屏回答同一组问题：**我在哪？我在处理什么？现在能做什么？当前状态是什么？失败或完成后下一步是什么？**

| 模式 | 首要对象 | 首屏主操作 | 信息密度 | 当前真实能力 | V2 补全重点 | 明确不做 | 主要 UI Owner |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Coding** | Session / Diff / Tool execution | 继续会话、审查改动、运行或停止执行 | 高密度、键盘优先；保留项目、分支和沙箱语义 | Session timeline、Diff、行级评论、Terminal、Composer Dock | 工具结果分层：运行中可见、成功后摘要、失败保留诊断与下一步；强化停止、恢复和影响范围 | 不把日志压成不可追溯的一行；不以动效替代执行状态 | `packages/app/src/pages/session.tsx`；`packages/session-ui/src/components/message-part.tsx` |
| **Chat** | Prompt / Skill / MCP / Agent 等资产 | 创建、导入、预览、应用和治理资产 | 中密度、扫描优先；来源、版本和错误可见 | AssetWorkbench、分类侧栏、导入/删除、会话插入 | 统一资产状态：`draft`、`candidate`、`applied`、`invalid`、`conflict`；减少隐藏动作 | 不退化为普通聊天气泡；不把资产治理埋进悬浮特效 | `packages/app/src/components/chat/asset-workbench.tsx`；`packages/app/src/pages/mode-workspace-slots.tsx` |
| **Work** | Preset / Task / Artifact | 选择目标、回答必要问题、审阅产物、原子应用 | 舒展但不松散；阅读优先；交付状态固定在视口可见区 | WorkPresetCatalog、WorkArtifactPanel、workflow/preset launch | 建立任务到产物的时间线；明确 `preview`、`apply`、`conflict`、`saved` 差异 | 不把预设目录做成营销落地页；不模糊只读与可编辑 | `packages/app/src/pages/work-preset-catalog.ts`；`packages/app/src/pages/work-artifact-panel.tsx` |
| **Assistant** | Reminder / Delivery / Memory / Note / Session | 处理待办、确认记忆、编辑知识、回到相关会话 | 阅读与关系导航优先；降低底层执行术语首屏占比 | AssistantDashboard、实体列表、KB Note Editor、Session linkage | 稳定呈现“待确认”“已生效”“来源会话”“下一步”；写入动作提供可逆反馈 | 不做装饰性知识卡片墙；不允许无确认自动写入记忆 | `packages/app/src/pages/assistant-dashboard.tsx`；`packages/app/src/components/assistant-entity-lists.tsx` |
| **Custom** | Composition Draft / Plan / Snapshot | 选择能力、绑定资产、修复诊断、启动并冻结快照 | 结构化高密度；配置与诊断并列；权限和能力可解释 | CustomDraft、CustomSidebar、CompositionConfig、Plan Preview、Snapshot Panel | 先补能力门控、错误区分、版本漂移和快照语义；M2 再决定是否进入节点画布 | 不把 `unsupported` / `disabled` 当空列表；没有 DAG 数据模型前不实现粒子连线 | `packages/app/src/components/custom/`；`packages/app/src/context/custom-draft.tsx` |

### 4.1 模式切换不变量

- 切换模式不改变当前 Session、Agent、Project、Location 或权限语义；只改变工作区呈现与主任务入口。
- `unsupported`、`disabled`、`empty`、`error` 必须是不同状态，不能通过空数组或静默回退隐藏原因。
- 模式入口的可见性、可用性、提示文案和服务端能力必须来自同一份 capability-aware registry。
- 在桌面窄窗口、加载中、错误态、计数变化和恢复操作中，导航与主工作区骨架保持稳定。

---

## 5. 共享外壳与设计系统治理

### 5.1 Shared Shell 的稳定区域

| 区域 | 责任 | 统一要求 |
| --- | --- | --- |
| Home / 全局入口 | 呈现模式、最近会话、待处理事项和能力状态 | 入口文案与实际 capability 一致；不把不可用功能伪装成可点击成功路径 |
| ModeSwitcher | 进入五种模式 | 显示模式名、对象、可用性和不可用原因；键盘可达；不静默回退 |
| ModeWorkspace | 承载模式级 slot | 保留统一的页面几何、加载骨架、错误边界和响应式断点；slot 只承载模式主对象 |
| Session 主区 | 对话、执行时间线、Diff、产物或上下文 | 同一 Session/Agent 语义在不同模式可追溯；执行状态不被视觉折叠丢失 |
| SessionRightPanel | 详情、上下文、审批、资源和恢复信息 | 状态来源明确；可折叠但不丢失待处理动作；窄屏改为可访问抽屉/页签 |
| Composer / 主操作区 | 输入、启动、停止、应用、确认或回退 | 主操作唯一且有明确前置条件；提交后保留输入与附件状态 |
| 全局状态反馈 | Toast、Banner、Inline error、Empty state、Recovery panel | 按严重性和持久性选择承载方式；错误必须给原因、影响和下一步 |

### 5.2 状态词汇契约

以下状态应成为五模式共享的语义层和 i18n key，不允许各页面自行命名、着色或改变含义：

```text
empty          没有数据，且没有请求失败
loading        首次获取或首次构建中
refreshing     已有内容，正在更新
invalid        数据存在但无法使用，需要修复
unsupported    当前产品/服务端不支持该能力
 disabled      能力存在但被策略、配置或权限关闭
error          请求或执行失败，可重试或需处理
stale          数据可读但版本/来源已过期
applied        已应用并持久化
conflict       应用目标与当前状态冲突，需要用户决策
recovery       执行中断，是否继续取决于副作用语义
```

文案至少要表达：**状态 + 原因 + 影响 + 下一步**。错误信息不能把请求失败渲染为“暂无资产”，也不能用“成功”覆盖只完成了预览或计划生成的路径。

### 5.3 Token 迁移策略

采用三层 Token：

1. **Global / Primitive**：颜色、间距、字体、圆角、阴影和动效的原始值；
2. **Semantic / Alias**：`surface`、`content`、`border`、`status`、`focus`、`syntax`、`markdown`、`diff`、`input` 等语义；
3. **Component**：Button、Panel、Input、Timeline、Diff、Composer、Callout 等组件属性。

迁移规则：

- 新代码不得增加旧 Token 或旧组件入口引用。
- 先迁 shared shell、Session 状态、Settings 等高频路径，再迁模式专用表面。
- 先建立迁移账本：文件、旧引用、目标 Token、风险、Owner、验证命令、删除条件。
- 不做无边界的全仓自动替换；一个迁移切片必须能独立回归。
- Light / Dark 主题必须同时有语义绑定；37 个主题先抽样，再对高风险主题全量检查。

### 5.4 无障碍与本地化门禁

- 所有 icon-only 控件提供可访问名称；焦点始终可见且顺序稳定。
- Diff 不只依赖红/绿表达增删；状态同时有文字、图标、结构或辅助技术语义。
- 错误、审批、停止、恢复和冲突均支持键盘完成；抽屉/页签打开后焦点有去处，关闭后返回触发点。
- 中文与英文长文案不截断关键动作；窄屏不产生不可解释横向滚动。
- 颜色对比度、主题切换零白闪、减少动效和高对比度模式需纳入 Storybook/E2E 证据，而不是只靠目测。

---

## 6. 分阶段路线

### Phase 0：能力与产品承诺校准

**目标**：先把“用户能看到什么”和“系统真正支持什么”对齐，停止愿景冒充事实。

**范围与交付物**：

- 审计 Home、ModeSwitcher、ModeRoute、Custom Plan/Start 的能力链路；
- 将 `ModeDefinition` 扩展为包含 availability/capability 语义的统一事实源，或复用现有 owner 完成同等收敛；
- 为五模式建立“当前能力 / 提案 / 待验证”清单；
- 逐项撤下或改名未经契约证明的 Auto-Review、Thought Canvas、Skill Budget Gauge 等文案；
- 将 Custom M1 明确定位为“组合配置与计划诊断工作台”。

**Owner**：Product + App + Core policy。

**依赖**：无；但必须与 V2 架构路线的 Session/恢复状态命名保持一致。

**退出条件**：

- 五种模式均有明确的首要对象、主操作、可用性和失败路径；
- Custom 的 `unsupported` / `disabled` / `empty` 能被用户区分；
- Home、ModeSwitcher 与实际 Route 不再出现静默回退或宣传过度；
- 所有“已存在能力”均有代码、契约或测试证据。

**停止条件**：不能证明能力来源或服务端状态时，不得通过添加视觉强化继续放大入口。

### Phase 1：Geometry Baseline

**目标**：用计算后的几何事实解决空间冲突，不凭 Tailwind class 或截图猜测。

**范围与交付物**：

- 记录 Home、ModeWorkspace、SessionRightPanel 在 desktop / narrow 的 computed width、height、scroll、overflow 与抽屉断点；
- 覆盖 loading、error、长标题、长中文/英文、计数变化、模式切换和右栏打开等状态；
- 形成可重复的 geometry test 或 E2E 检查，而非只留一次性截图；
- 只在基线证明后调整 `max-width`、列宽、gap、padding 与 breakpoint。

**Owner**：App UI + QA。

**依赖**：Phase 0 的共享 Shell 与五模式入口契约。

**退出条件**：desktop/narrow 无横向溢出；主操作、导航和错误信息在关键状态仍可见；computed geometry 有可追溯记录。

**停止条件**：没有 geometry 证据时，不得通过继续堆叠面板或强行缩小字体解决布局问题。

### Phase 2：状态词汇与错误真实性

**目标**：让执行、资产和恢复状态可理解、可行动。

**范围与交付物**：

- 建立共享状态枚举与 i18n keys：`empty`、`loading`、`refreshing`、`invalid`、`unsupported`、`disabled`、`error`、`stale`、`applied`、`conflict`、`recovery`；
- 将现有 Permission、Approval Center、Composer Dock、Session message parts 的状态表达对齐；
- 工具结果分为运行中、成功摘要、失败诊断、停止、重试、恢复；
- 修复 CustomSidebar 把请求失败吞成空列表的路径，保留资源错误并提供重试；
- 将架构侧的 `server-dead` / `recovery_required` 状态纳入 UI 显示契约，但在后端未提供真实状态前不伪造按钮。

**Owner**：App + Session UI + Core/架构。

**依赖**：Phase 0；架构路线 Slice 0/2 的状态定义。

**退出条件**：每个阻塞状态都有原因、影响、下一步；网络、429、权限、工具失败不会丢失用户输入与上下文；错误不再伪装为空。

**停止条件**：任何自动批准、自动重试或恢复动作没有副作用与审计语义时，只能显示人工处理路径。

### Phase 3：Shared Shell 与 Token 迁移试点

**目标**：证明 v1→v2 的迁移方法可行，减少双系统而不制造新的平行抽象。

**范围与交付物**：

- 选择一条 shared 高频路径（建议 Home/ModeSwitcher 或 Settings）和一条 Session UI 路径；
- 建立迁移账本、目标语义 Token、旧组件替代关系、截图与行为回归清单；
- 补齐 syntax / markdown / diff / input 等高风险语义 Token；
- 迁移 Light/Dark 绑定，并抽样检查 37 个主题；
- 形成可复用的 codemod 或人工迁移检查清单，但不把 codemod 当作安全证明。

**Owner**：UI + App + Session UI。

**依赖**：Phase 1 几何基线与 Phase 2 状态词汇。

**退出条件**：新增改动不再增加 legacy 引用；试点路径在 light/dark、键盘、中文/英文和错误态下行为一致；迁移方式可被第二条路径复用。

**停止条件**：出现跨包 owner 不清、行为变化或主题回归时，暂停扩面，先修正账本和组件契约。

### Phase 4：五模式核心闭环

**目标**：按每个模式的主对象完成一个可用首屏，而不是按五套视觉风格分叉。

**交付顺序**：Coding → Chat → Work → Assistant；Custom 以 M1 配置工作台并行受控交付。

| 模式 | 核心闭环 | 必须看见的状态 |
| --- | --- | --- |
| Coding | 继续 Session → 查看执行/工具结果 → 审查 Diff → 运行/停止/恢复 | running、success summary、failure diagnosis、stopped、recovery |
| Chat | 创建/导入资产 → 预览 → 应用/插入 → 查看版本或冲突 | draft、candidate、applied、invalid、conflict |
| Work | 选 Preset/Task → 回答必要问题 → preview → review → apply | preview、apply、conflict、saved、partial failure |
| Assistant | 查看待办 → 确认记忆/编辑 Note → 回到来源 Session | pending confirmation、applied、source、next step、reversible feedback |
| Custom M1 | 选能力 → 绑定资产 → 诊断 → 生成 Plan → 冻结 Snapshot → 启动 | unsupported、disabled、invalid config、plan ready、snapshot drift、recovery |

**Owner**：各模式产品 Owner + App/UI；涉及状态真源时由 Core 配合。

**依赖**：Phase 0–3；Custom 依赖既有 Custom M0/M1/M2 路线和 ADR-17/18；Assistant 依赖 `docs/roadmap/assistant-mode-roadmap.md`。

**退出条件**：每种模式首屏能完成一个核心任务；跨模式切换不改变 Session/Agent 语义；每条闭环都有可验证的失败、取消、重试或回退路径。

**停止条件**：任何模式只能靠隐藏状态、Toast 或全量日志才能完成任务时，不得继续扩展装饰层。

### Phase 5：高级能力与渐进披露

**目标**：提升高阶用户吞吐，但不把复杂度强加给初级用户。

**候选范围**：

- Coding 的键盘审查、影响范围、子智能体观察；
- Session/Context 的预算可视化（前提是已有稳定数据契约）；
- 可选分屏、右栏诊断、可展开工具细节；
- Approval Center 的重复请求聚合与审计可见性；
- 以状态摘要替代未经验证的内部推理可视化。

**Owner**：UX/UI + App + Core/Permission + QA。

**依赖**：Phase 2 的状态契约；架构路线 Slice 2–5 的恢复、权限和执行边界。

**退出条件**：高级功能默认可折叠、不阻塞主路径；每项能力有可撤销动作、数据来源和性能基线；自动批准或自动恢复均有安全规则、审计记录与 kill switch。

**停止条件**：没有可消费数据、没有可逆交互或会增加副作用不确定性时，不做可视化包装。

### Phase 6：Custom M2 可视化编排

**目标**：仅在执行契约成熟后，将配置工作台升级为真正可诊断的编排画布。

**前置契约**：

- 节点、端口、输入/输出类型和连接合法性；
- Workflow/Agent 的执行事件与生命周期；
- 断点、单步、取消、部分成功和恢复语义；
- Snapshot、版本漂移、回放与调试快照；
- 统一的权限、能力和高风险副作用边界。

**Owner**：Custom 产品 + Core Workflow/Session + App/UI + Security。

**退出条件**：画布可回放、可诊断、可安全终止；连线表达真实数据关系，而不是装饰；节点失败不会丢失上下文，也不会把未知副作用伪装成可重试。

**停止条件**：上述任一数据/执行契约不稳定时，继续使用 M1 配置表单和 Plan Preview，不实现粒子连线、断点或单步假功能。

### Phase 7：持续质量门禁

**目标**：把 UX 质量变成可重复的工程证据。

**范围**：

- Storybook 状态矩阵：五模式 × loading/error/empty/unsupported/disabled/recovery 等；
- desktop/narrow geometry 与 overflow 检查；
- 视觉截图、Light/Dark 与高风险主题对比度抽样；
- 键盘路径、焦点回归、icon-only label、Diff 非颜色语义；
- 中文/英文长文案与辅助技术语义；
- legacy Token/旧组件入口趋势扫描；
- 受影响包按协议执行 typecheck/test/lint。

**Owner**：QA + UI/App + Product/UX。

**退出条件**：每次 V2 UI 合并都有状态、几何、无障碍、主题和迁移证据；不以 typecheck 代替行为验证。

---

## 7. 首个执行切片

首个切片不追求“做完 V2”，只追求建立可信底座。建议按以下顺序连续完成，并在第 6 步形成第一份 V2 UX 基线报告。

| 顺序 | 工作项 | 主要范围 | Owner | 完成证据 |
| --- | --- | --- | --- | --- |
| 1 | Capability-aware mode registry | 让 `ModeDefinition` 承载 availability/capability；ModeSwitcher、Home、ModeRoute 复用同一事实源 | App + Core policy | Custom 未启用、服务端不支持、可运行三态可解释；不误导入口 |
| 2 | Geometry baseline | 记录 Home、ModeWorkspace、SessionRightPanel 的 computed width、scroll、overflow 与断点 | App + QA | desktop/narrow 基线可重复，先有证据再改宽度 |
| 3 | State vocabulary | 建立共享状态语义与 i18n keys | App + Session UI | 五模式不再各自命名、各自着色同一状态 |
| 4 | Custom error truthfulness | 修复 CustomSidebar 将请求失败吞成空列表的路径，保留错误并提供重试 | App | 网络失败不再伪装成没有资产 |
| 5 | Token migration pilot | 一条 shared 高频路径 + 一条 Session UI 路径完成 v2 Token/组件迁移 | UI + Session UI + App | 形成可复用迁移账本/检查清单，未扩大为全仓重构 |
| 6 | Review gate | 执行 `git diff`、legacy grep、Light/Dark、keyboard、中文/英文、受影响包 typecheck/test | QA + 变更 Owner | 形成第一份真实的 V2 UX 基线报告 |

### 7.1 首个切片的依赖图

```text
Capability registry
        ↓
Geometry baseline ─────┐
        ↓              │
State vocabulary ──────┼──→ Token migration pilot
        ↓              │             ↓
Custom error truth ────┘       Review gate
                                      ↓
                              五模式核心闭环
                                      ↓
                           高级能力 / Custom M2
```

架构路线的 Session lifecycle、sidecar recovery 与 V1/V2 迁移结论是 UX 的硬依赖：如果后端不能诚实表达 `recovery_required`、`server-dead` 或事件重放语义，UI 只能显示人工恢复与不确定状态，不能承诺自动继续。

---

## 8. 验收指标

这些指标的目的是形成可复核的质量趋势；具体数值阈值应在 Phase 0 结合现有基线与产品 SLA 决定，不提前伪造精确百分比。

| 指标 | 用户问题 | 验收标准 |
| --- | --- | --- |
| 模式入口可信度 | 我点进去后，是否知道模式和能力是什么？ | 五种模式均能说明首要对象、主操作和可用性；Custom 的 `unsupported` / `disabled` 明确区分；无静默回 Coding |
| 空间稳定性 | 状态变化会不会把我带到另一个布局？ | desktop/narrow 无横向溢出；切换、加载、错误和计数变化不破坏导航与主工作区骨架；无不可解释闪烁 |
| 恢复成功率 | 失败后我还能不能继续？ | 网络、429、权限、工具失败分别给可执行下一步；输入与附件不丢；未知副作用不被伪装成安全重试 |
| 审批负担 | 安全确认是否重复且不可理解？ | 先统计 ask 类型与重复率；任何自动批准都有明确规则、审计记录与 kill switch |
| 资产可追溯 | 我是否知道资产从哪里来、是否有效、应用后做了什么？ | `project/system`、`revision`、`invalid`、`conflict`、`applied` 可见且语义一致 |
| 可访问性 | 键盘和辅助技术能否完成关键任务？ | icon-only 有 label；焦点可见；Diff 不只依赖红绿；中文/英文不截断关键动作；抽屉/页签焦点可回收 |
| 迁移健康度 | V2 是否越做越统一？ | 新改动不引入 legacy Token/旧组件入口；按包维护存量趋势，不承诺一次性清零 |

---

## 9. 风险、停止条件与明确不做

### 9.1 主要风险

| 风险 | 表现 | 控制措施 |
| --- | --- | --- |
| 视觉先行 | 以玻璃、粒子、渐变和装饰卡片掩盖状态/信息架构问题 | Phase 0–3 完成前不扩大视觉材质；所有视觉变更必须关联可用性或状态目标 |
| 五套模式分叉 | 组件、Token、交互、键盘语义各自发展 | 共享 Shell、状态词汇与 Token；模式只拥有 slot 内主对象 |
| 迁移范围失控 | 一次性替换旧 Token/组件导致行为和主题回归 | 迁移账本、分批 owner、每片独立回归；复用优先于新增 |
| 能力误导 | 入口显示可用，点击后才发现服务端不支持 | capability-aware registry；明确 unsupported/disabled/error |
| 恢复承诺过度 | UI 显示“重试”但无法判断外部副作用是否已经发生 | 与架构 recovery policy 对齐；未知副作用显示 recovery_required/人工确认 |
| DAG 假完成 | 把配置表单画成“编排画布” | Custom M1/M2 分开；没有节点/事件/回放契约不做画布 |
| 本地化/无障碍后置 | 英文、中文、键盘和主题只在发布前才发现断裂 | 从 Geometry、State 和 Review gate 起纳入验证 |

### 9.2 明确不做

- 不将当前产品宣传为“100% 纯 V2”。
- 不将 Approval Center 直接命名为已具备自治 Auto-Review。
- 不展示未经验证的模型内部推理内容或所谓 Thought Canvas。
- 不制作没有稳定数据契约支持的 `2% Skill Budget Gauge`。
- 不在没有真实 DAG 数据模型和执行事件的情况下实现粒子连线、断点、单步。
- 不以一键全仓替换旧 Token/旧组件代替分批迁移。
- 不把 `unsupported`、`disabled`、网络错误渲染成空列表。
- 不为了“质感”违反 `DESIGN.md` 的 quiet、dense、operational 方向。
- 不在没有副作用与审计契约时增加自动批准或无条件自动重试。

---

## 10. 关联文档与代码 Owner

### 10.1 规范与架构

- `CLAUDE.md`
- `AGENTS.md`
- `DESIGN.md`
- `ARCHITECTURE.md`
- `CONTEXT.md`

### 10.2 模式路线

- `docs/roadmap/custom-mode-roadmap.md`
- `docs/roadmap/assistant-mode-roadmap.md`
- `docs/roadmap/work-mode-roadmap.md`
- `docs/roadmap/external-cli-dispatch-roadmap.md`
- `docs/architecture/adr/ADR-11-product-mode-session-classification.md`
- `docs/architecture/adr/ADR-12-product-mode-entry-routing.md`
- `docs/architecture/adr/ADR-15-mode-workspace-main-area-slot.md`
- `docs/architecture/adr/ADR-16-global-home-overview.md`
- `docs/architecture/adr/ADR-17-custom-mode-composition-platform.md`

### 10.3 主要实现面

- `packages/app/src/context/mode.tsx`
- `packages/app/src/components/mode-switcher.tsx`
- `packages/app/src/pages/mode-workspace.tsx`
- `packages/app/src/pages/mode-workspace-slots.tsx`
- `packages/app/src/components/custom/`
- `packages/app/src/components/custom/custom-sidebar.tsx`
- `packages/app/src/pages/session.tsx`
- `packages/session-ui/src/components/message-part.tsx`
- `packages/ui/src/v2/components/`
- `packages/ui/src/theme/themes/`

---

## 11. 版本复查记录

- 本文由 `/home/keer/.cursor/projects/media-win-data-aigcfroge/canvases/aigcfroge-v2-ux-upgrade.canvas.tsx` 转写，不改变生产代码。
- 当前整理基线：`main@eeaec64f2`，与 `origin/main` 一致；UX 画布中的统计来自 `2026-08-28 / main@f21cb4be5` 快照，需在执行前重新扫描。
- 没有把历史会话中的未来设想当作已实现能力。
- 首个执行切片完成前，不建议把 V2 UI 宣传为全量完成。
