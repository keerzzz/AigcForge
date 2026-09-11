# 全局壳端到端走查报告（2026-09-10）

> 范围：阶段 1 第 1 项「全局壳」——ModeSwitcher、titlebar 标签栏与历史、多会话 tabs、DirtyDraftGuard、状态栏、ConnectionGate。
> 方法：受控实例（mock server e2e，仓库既有标准）× 五项目展示矩阵 + 真实后端（`serve` on 4096）+ 真实浏览器无 mock 冒烟。
> 交付：`packages/app/e2e/regression/global-shell.spec.ts`（10 用例 × 5 项目 = 50/50 通过）。

## 0. 结论

全局壳主链路的既有受控用例通过，但真实用户走查已发现状态栏 Context 死按钮、后台标签关闭误导航和脏草稿关闭时序风险；同时记录首页、底部状态栏和新建会话页的产品改造要求。当前文档是阶段性事实与需求台账，不等同于全应用最终验收结论。

## 1. Bug

### P2 · 状态栏 "Open context tab" 是死按钮

- **复现**：会话详情页（受控 mock 与真实后端均复现；legacy 与 canonical 路由均复现）。点击状态栏右侧 "Open context tab" → 页面零变化：会话 tab（Preview/Context/Artifact）状态不变、review 面板不打开、file tree 不变；连点两次（toggle 路径）同样无效。
- **对比**：timeline 内 "View context usage" 按钮调用**同一函数** `openSessionContext`，点击后 Context tab 正常可见+选中（该路径已被现有 `tab-close-owner.spec.ts` 钉住）。
- **根因方向**：状态栏 `components/status-bar/current-session-source.ts:304` 的 `openContext()` 用自推导 `sessionKey()`（scope = `ServerScope.fromServerKey(activeServerKey())`、目录 = `placement()?.directory`）取 `layout.tabs(key)` / `layout.view(key)`；会话页渲染用的是 `useSessionLayout()`（`session-layout.ts:15-16`，scope = `serverSDK().scope`）。两处 key 任一字节不一致即会新建一个无人渲染的空 store，所有操作落空。尚未用页面内探针最终定位差异字节。
- **证据**：`docs/review/` 本报告附录 A（body 对比：点击前后仅 composer 迟到渲染，tab/review/fileTree 全部零变化）。
- **建议**：下一批用探针对比两处 key 实际值，修 `current-session-source.ts` 的 key 推导复用 `useSessionLayout` 同源。

### P2 · 顶部会话标签关闭后的页面切换不区分活动/后台标签

- 当前 `tabs.tsx:180-199` 关闭任意标签都会导航到其右侧标签，无右侧才到左侧，最后一个标签回全局首页。活动标签的“右 → 左 → 首页”顺序合理，但关闭后台标签也会强制切走当前页面。
- 正确规则：关闭后台标签只移除标签并保持当前页面；只有关闭活动标签才选择后继页面。正式会话仅关闭视图、不删除会话数据，这一点合理。
- 现有 E2E 只覆盖关闭活动标签，缺少 `A/B/C` 中查看 C、关闭后台 A 后仍停留 C 的回归用例。

### P1 候选 · 脏草稿点击 X 可能先删除、后确认

- `removeTab()` 会先移除标签、清理 tab memory/草稿持久化并跳转；`DirtyDraftGuard` 在路由变化后才弹出 Stay/Leave。用户选择 Stay 时可能已无法恢复原标签与草稿状态。
- 应改为关闭前置状态机：脏内容先确认；Stay 不改变任何状态，Leave 后才移除标签与持久化数据。需补“脏草稿 × 顶部 X”实测和回归用例后确认等级。
- 附带 P3：正式 Session 标签的 X 缺少 `aria-label`，而 Draft 标签已有 `Close tab`，无障碍语义不一致。

## 2. 测试基建与覆盖缺口

| 项                           | 说明                                                                                                                                                                                                  | 触发/到期条件          |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| E2E 冷编译超时               | Vite 冷编译首测 > 180s 单测超时上限：6 并行 worker 各首条用例全部超时（假失败风暴）。CI 靠 5 worker 分摊掩盖。本地需预热（常驻 vite + 真实浏览器加载一次）。                                          | e2e 基建专项时         |
| ConnectionGate 不可 web 测试 | `entry.tsx:175` 设 `disableHealthCheck`，"Could not reach" 重试屏为桌面壳主进程行为，web e2e 无挂点（已在 spec 内注释说明，非遗忘）                                                                   | 桌面壳主进程测试基建时 |
| ownerless 警告覆盖面         | 真实链路控制台仍有 `computations created outside a createRoot or render` 警告；`solid-owner-diagnosis.spec.ts` 只钉 toast-v2 已知站且仅覆盖其声明路由，home/mode 路由不在其内，无法区分已知站或新泄漏 | 诊断 spec 扩面专项时   |
| 真实链路 404 ×3              | 真实后端冒烟时 3 条资源 404（疑似静态资源/图标，未定位）                                                                                                                                              | 顺手排查               |

## 3. 用户反馈与产品改造项（2026-09-10）

> 本节记录用户截图与口述需求。标记为“产品改造”的项目已确认当前交互与目标不一致；标记为“待复现 Bug”的项目尚未完成数据链路和持久化验证，不预判根因。

### 3.1 首页右侧补充固定“新建会话”主按钮（产品改造）

用户截图显示：在“自定义”等无结果筛选状态下，主内容标题行右侧可以看到“新建会话”；但该入口会随空态、筛选结果和会话分组状态改变位置或消失。当前实现还在顶部标签栏、项目行、空态正文提供多个新建入口，导致同一动作缺少稳定的空间锚点；这不是单纯的“用户记忆偏差”。不同端口显示不一致还可能由代码版本、功能开关、本地缓存或返回数据状态不同造成，需在多端口对照时核实。

**目标交互：**

- 首页主内容区域右上方始终显示一个固定的“新建会话”主按钮，不受空态、分组或筛选结果影响。
- 空态中央可以保留引导按钮，但仅作为同一动作的辅助入口。
- 新建动作应继承当前项目和模式筛选；“全部会话”下使用默认模式或进入模式选择，具体语义待产品确认。
- 所有入口必须复用同一新建流程，避免 draft ID、默认模式、Location 或项目上下文出现分叉。

**验收关注：**全部/对话/编程/工作/助手/自定义六种筛选，有无会话、切换项目、刷新和重启后，固定按钮均可见且创建上下文一致。

### 3.2 “添加项目”改为可视化文件夹浏览（产品改造）

现状（`directory-picker.tsx` / `dialog-select-directory-v2`）：用户截图中的“打开项目”弹窗本质是已知/最近物理路径列表与搜索框，目录行不能展开、进入上级或下级目录，也没有面包屑。桌面路径走系统原生目录选择能力，Web/回退路径仍是路径候选器。用户需要的是可浏览的文件夹，而不是阅读或输入物理地址 URL。

**目标交互：**

- 以文件夹树或文件夹网格展示目录，可进入上级/下级目录并通过面包屑返回。
- 只允许选择文件夹；物理路径降为辅助信息，不作为主要操作对象。
- 保留“最近项目”和搜索作为快捷入口，但不能替代目录导航。
- 清楚呈现加载中、空目录、无权限、目录不存在和读取失败状态。
- 首页与五个模式页中的所有“添加项目”入口必须复用同一套可视化目录选择弹窗，不得在 Chat/Coding/Work/助手/自定义模式中退回物理路径或 URL 输入。弹窗的信息架构、文件夹树/网格、面包屑、最近项目、搜索、选中态和错误状态应与本节目标 UI 保持一致；入口只负责提供当前 server/Location、初始目录和是否允许多选。
- 模式页添加完成后，应原子更新项目列表、当前项目及相应模式的数据范围；取消不产生项目记录，重复选择同一目录不重复添加，切换模式后也不能出现不同目录选择实现或状态串扰。

**方案对冲：**

- 简单方案：桌面端继续使用系统原生文件夹选择器，仅统一入口与当前目录提示；优点是稳定、安全、改动小，缺点是 Web 与桌面体验不统一。
- 健壮方案：桌面端通过受权限约束的 main/preload IPC 枚举目录，Web 端通过受限服务端目录枚举能力，App 复用一套目录浏览 UI；必须限制允许浏览的根、阻止符号链接越界并处理权限失败。File System Access API 只作为浏览器能力增强，不作为桌面端主架构。

该项是跨层功能增强，不应简化为更换路径文案或图标。

### 3.3 项目“更多 → 编辑”弹窗的颜色功能异常（待复现 Bug）

用户报告项目列表“更多”菜单中的编辑弹窗存在颜色功能问题。当前尚未记录最小复现步骤，先作为待复现功能缺陷，不猜测是颜色控件、状态同步、接口还是持久化层根因。

**下一阶段验证矩阵：**

- 选择预设颜色后，编辑弹窗内是否即时预览，保存按钮状态是否正确变化。
- 保存后，首页项目行、项目头像/图标、会话列表和其他已打开页面是否同步更新。
- 取消是否完整回滚；刷新和应用重启后颜色是否持久化。
- 浅色/深色主题、自定义色值格式及透明度处理是否一致。
- 连续编辑不同项目是否发生颜色串扰；接口失败时是否错误保留乐观更新。
- 对照 UI store、更新请求/响应和持久化记录，定位单一事实来源及共同根因。

复现后再确定 P1–P3 严重级别、代码位置和修复建议。

### 3.4 首页左侧“项目”移动到“模式筛选”上方（信息架构调整）

当前顺序是“模式筛选 → 项目”。用户建议交换为“项目 → 模式筛选”。该调整符合先选择工作上下文、再筛选上下文内会话类型的用户心智模型，建议采纳：

1. 项目（全部项目、具体项目、添加项目）；
2. 模式筛选（全部会话、对话、编程、工作、助手、自定义）；
3. 会话搜索与结果。

**交互约束：**

- 选择项目后，模式计数按该项目重新计算；切换模式不得清除项目选择。
- “全部项目”才聚合所有项目；项目和模式两个维度应可组合，而不是互相覆盖。
- 当前选择可恢复，但不能跨窗口或跨 Location 污染其他会话上下文。
- 仅交换视觉顺序不够，需验证键盘 Tab 顺序、可访问性阅读顺序和窄屏布局同步改变。

### 3.5 首页全局模式导航与模式筛选的语义边界（关联现有设计）

现状：`layout.tsx` 在首页刻意隐藏 `ModeSwitcher`，该行为由 `home-mode-ownership.spec.ts` 固化，依据 ADR-16（`/` 是独立全局聚合页，模式归 `/mode/:mode`）。用户当前明确提出的是首页项目/模式筛选顺序与固定新建入口，并非要求把首页变成某个模式页。

建议保留首页的全局聚合语义，同时严格区分：

- “模式筛选”只过滤首页会话结果；
- 若后续需要直接进入五个模式详情页，应增加明确的模式导航入口，而不是让筛选按钮同时承担导航；
- 若产品决定改变 ADR-16，应同步修订 ADR 与回归测试，不能把现有测试当作否决新需求的依据。

## 4. 新建会话页专项（2026-09-10 用户反馈）

### 4.1 移除遗留 `opencode` 背景字标，改为当前项目主题名称

- 截图中的大号 `opencode` 来自 `session-new-design-view.tsx` 使用的 `WordmarkV2`；其 SVG 路径仍拼出遗留品牌文字，与 AigcForge 当前品牌及用户所在项目均不一致。
- 用户要求背景展示当前项目主题名称。建议以 `sync().project.name` 为首选，缺失时回退项目目录名；该内容只作低对比度背景水印，不应进入输入框可访问名称或抢占主要阅读层级。
- 项目切换后水印必须响应更新；长名称需要自适应字号、截断或换行，不能溢出输入区。项目数据未就绪时使用 AigcForge 品牌占位，不能闪现 `opencode`。

### 4.2 移除输入框上方“权限档位 / 提议 / 完整”可视控件

- 当前 `SessionComposerRegion` 在所有 PromptInput 前渲染 `PermissionTierSelector`，当模式为 Chat/Work/Assistant 且 agent 为 `meta` 时显示，因此新建页出现独立的“权限档位、提议、完整”区域。
- 用户确认该控件破坏新建页视觉层级，应从新建页面移除。权限策略本身不能删除：仍须由模式与 agent 的既有策略给出安全默认值，并允许在设置、会话详情或真正需要提权时以明确确认流程调整。
- 不应仅用 CSS 隐藏后保留错误状态；新建页首次提交的 `permissionTier`、工具权限和 UI 显示必须保持一致。现有 `permission-tier.spec.ts` 应调整为验证策略数据链路，而非固化该新建页控件。

### 4.3 输入框缺少智能体选择器

- PromptInput 已实现智能体控件，但显示条件为 `settings.visibility.customAgents() && agentOptions.length > 0`；`showCustomAgents` 默认值为 `false`，所以默认新建页看不到智能体列表。这是配置门禁造成的产品默认行为，不是接口中完全没有智能体数据。
- 用户要求新建页直接提供智能体列表。建议：新建页始终显示当前模式允许的主智能体/编排智能体；“显示自定义智能体”设置只控制额外自定义项，不能隐藏整个选择器。
- 列表必须遵循 `ProductModeAgentPolicy`，不能暴露当前模式禁止的 orchestrator；需覆盖加载、空列表、切换模式、切换项目、选择持久化及首次提交携带正确 agent。

### 4.4 项目名称后按条件显示 Git 分支或工作树

- 当前输入框下方项目控件只显示项目名；页面内部另有 Git/worktree 数据源：`sync().data.vcs?.branch`、项目 `worktree` 和 `sandboxes`。用户要求在项目名后补充当前分支或工作树信息。
- 目标格式建议为 `项目名 · 分支名`；当目录属于附加 worktree/sandbox 时优先显示可识别的 worktree 名，并可附分支，例如 `项目名 · worktree-name / feature-x`。
- 仅在 `project.vcs === "git"` 且 branch/worktree 信息真实可用时显示；非 Git、数据加载中或字段为空时完全不渲染占位符、图标或破折号。
- 切换项目、目录或 worktree 后必须即时更新，首次提交必须使用显示内容对应的 directory/worktree，避免 UI 与实际 Session Location 不一致。

### 4.5 新建页上方显示并允许确认/切换当前模式

- 当前 Draft 数据包含 `mode`，但新建页没有模式选择器；模式仅在首页或模式页创建 Draft 时写入。用户确认模式控件应放在输入框上方，替换将移除的权限档位区域，使首次发送前的会话类型清晰可见。
- 首页选择具体筛选后新建时，筛选一次性解析为 Draft 模式：对话→Chat、编程→Coding、工作→Work、助手→Assistant；Custom 没有通用 Draft 路径，必须进入其专属创建流程。
- “全部会话”不是 Session 模式：默认使用最近一次成功新建的模式，首次使用回退 Chat。新建页必须显示最终解析后的实际模式，不能显示“全部会话”。
- Draft 创建后 `draft.mode` 独立持久化；首页后续切换筛选不得静默修改已打开草稿。用户在新建页主动切换模式时，需原子重算 agent 白名单/默认 agent、权限策略、preset/category、可用工具/Skills/工作流及模式文案；保留通用文本和附件，明确重置不兼容配置。
- 首次发送并提升为正式 Session 后冻结模式；如需其他模式，应新建会话。

### 4.6 首页筛选与新建模式的状态分离

- 不得继续用一个全局 `currentMode` 同时表达首页浏览筛选与新建目标。建议明确三份状态：`homeSessionFilter`（首页浏览条件）、`lastNewSessionMode`（“全部会话”下的默认值）、`draft.mode`（草稿模式快照）。
- 首页顶部、项目行、空态及模式页的所有新建入口必须复用同一个 resolver，避免入口不同导致 mode/server/directory/agent/permissionTier 分叉。
- 首页实现当前直接以 `mode.currentMode` 调用 `launchModeSessionOrRoute()`；文档将其视为待重构耦合点，而非稳定持久化设计。

### P1 候选 · 首页切换模式后新建出现 `Cannot connect to API`

- 用户报告在首页选择 Chat/其他模式后新建，会出现 `Cannot connect to API: Unable to connect...`。实测时 4096 与 4444 仍在监听，因此不能直接归因于后端未启动，也不能仅凭错误文案认定为真实网络故障。
- 高概率方向是新建链路的 `mode + server + directory/Location` 组合不一致，或切换项目后只更新 Draft 的 server/directory、未同步模式相关配置。Custom 被源码明确禁止进入通用 Draft 路径，否则首次发送必然失败。
- 该问题与首页模式选择存在相关性，但尚未确认因果。复现时必须记录入口、首页筛选、`draft.mode`、server key、directory/Location、请求 URL/method、底层异常 cause 和 Draft→Session 状态；禁止只修改错误提示掩盖根因。
- 发送前若 mode/server/directory 尚未解析完成，应禁用发送并给出可操作错误；失败后不得产生幽灵 Session、丢失草稿或污染最近模式。

### 4.7 新建页验收组合

- 覆盖 Chat、Coding、Work、Assistant 与 Custom 五种入口，并验证项目水印、模式显示、智能体白名单和权限默认值随模式正确变化。
- 覆盖首页六种筛选（含“全部会话”）、刷新草稿、多草稿标签隔离、首页筛选后续变化和新建页主动切换模式。
- 覆盖 Git 主工作树、Git 附加 worktree、无 Git 项目及 VCS 信息迟到四种状态。
- 覆盖首次发送后的 Draft → Session 提升及失败回滚，确保 mode、project、agent、model、permission、server 和 worktree 一次性原子继承。

## 5. Chat 模式首页专项（2026-09-11）

### 5.1 产品方向：资产主区 + 左侧会话列表

- Chat 模式暂不改成纯“会话优先”首页：主区域保留提示词、Skills、MCP、命令、智能体、工作流和插件资产工作台，左侧在“功能”列表下方新增“会话”列表，兼顾资产管理与会话快速进入。
- 左侧按“项目 → 功能 → 会话”组织为三个独立区块；项目、功能、会话均支持展开/收起。折叠状态应按用户与工作区持久化，刷新及模式往返后保持；首次进入默认展开当前任务最需要的区块。
- 将当前项目区下方的“新建会话”移动到功能列表之后、会话列表之前，并归属会话模块，形成“会话标题/折叠控制 → 新建会话 → 会话列表”的稳定结构；功能区收起时按钮位置不得上移或改变归属，会话区整体收起时只保留会话标题、状态摘要及新建入口。
- 会话列表至少覆盖当前项目的最近会话、活动/流式状态和当前选中态；点击会话复用现有标签，不能重复创建 Tab。展开大量会话时应分页或虚拟化，且不得重新触发七类资产请求。
- 项目、功能、会话必须具有清晰但不过度的模块范围分割：各区块使用独立标题栏、统一内边距和稳定的上下边界/间距；滚动范围要明确，长项目或长会话列表不能挤压其他模块的标题和核心操作。优先采用分区间距与单条弱分隔线，避免多层卡片和重边框造成视觉噪声。
- 建议项目区按内容上限滚动、功能区按七项完整展示、会话区占用剩余高度并独立滚动；窄屏或低窗口高度下至少保证三个标题栏及“新建会话”始终可达，滚动条不能跨越三区造成归属不清。
- 项目区折叠后仍需保留当前项目名称和切换入口；功能区折叠后保留当前资产类型摘要；会话区折叠后保留活动会话/未读或运行中状态提示。三个区块的折叠按钮需具备 `aria-expanded`、键盘操作和明确名称，并统一展开图标、命中区域及动效。

### 5.2 会话列表仅负责导航，不在右侧内嵌详情

- Chat 首页右侧保持资产工作台职责，不内嵌消息流、输入框、流式输出、工具调用、权限审批或上下文面板，避免与标准 Session 页面形成两套状态和协议链路。
- 点击左侧会话条目直接进入现有标准会话详情路由；整行均应可点击，标题是主要文本而不是唯一命中区域。点击“新建会话”同样进入标准 Draft 新建页。
- 已打开的会话应复用现有顶部 Tab，不得创建重复 Tab；会话的完整运行与交互状态均由标准 Session 页面及其既有数据源负责。左侧列表只显示生成中、等待授权、失败、完成等摘要状态。
- 从会话详情返回 Chat 首页时，恢复此前的项目、资产分类、搜索条件、三个区块的折叠状态及各自滚动位置。恢复状态不能重新触发重复的七类资产请求。
- 关闭顶部 Session Tab 只关闭工作视图，不删除左侧历史会话；会话删除、归档与关闭 Tab 必须保持不同语义。
- 因此产品边界确定为：Chat 首页负责资产管理与会话导航，标准会话详情页负责完整交互执行；不实现“左侧选择会话、右侧联动渲染完整会话”的双栏方案。

### 5.3 已确认缺陷与技术债

- **P2 · 资产行伪交互**：资产行呈现为可点击且支持 Enter/Space，但点击没有详情页、弹窗或反馈。`AssetWorkbenchTable` 已提供 `onSelect`，`ChatAssetWorkbenchMain` 未传入；应接入只读详情/编辑流程，或在未实现前取消按钮语义。位置：`packages/app/src/components/chat/asset-workbench.tsx:313`、`packages/app/src/pages/mode-workspace-slots.tsx:558`。
- **P2 · 搜索条件跨资产类型泄漏**：在 MCP 搜索 `code` 后切换命令，命令列表仍被该条件静默过滤。切换类型时应清空搜索，或按类型分别保存并显式显示过滤状态。
- **P2 · 首次进入重复请求**：主工作台和左侧计数各自并发请求全部七类资产，一次冷加载至少形成 14 次列表请求，随后还会启动 MCP child sync。应归并为单一资源层，计数与列表共享结果及错误状态。位置：`packages/app/src/pages/mode-workspace.tsx:134`、`packages/app/src/components/mode-surfaces.tsx:89`。
- **P2 性能候选 · 大列表无虚拟化**：命令 245、Skills 117、插件 94 均通过 `<For>` 全量渲染；现场切换出现长任务/Jank，INP 一度约 144–208ms。需用固定数据集复测后确定阈值，并为大列表增加虚拟化/分页。
- **P2 · 插件系统来源内部重名**：实测出现 `context7`、`github`、`playwright`、`gitkraken-hooks`、`linear` 等重名条目。当前合并只处理项目与系统之间的同名，不处理多个系统来源；应以稳定的 `source + kind + name` 标识资产，并在 UI 显示来源，不得只按名称粗暴去重。
- **P3 · 空态文案类型错误**：工作流为空、MCP 项目筛选为空时仍显示“暂无已保存的提示词”。空态文案必须使用当前资产类型和当前来源筛选。

### 5.4 本轮通过项与边界

- 七类入口均可加载；搜索与“全部/项目/系统”过滤本身可生效。
- Chat 左侧“新建会话”已验证创建 `mode=chat` Draft；未发送消息、未消耗模型额度，测试空草稿已清理。
- 本轮未创建、导入、删除或修改真实资产；相关写操作、失败回滚和并发冲突留待受控数据专项验证。

## 6. 全局底部模块专项（2026-09-10）

### 6.1 状态栏空态与数据源边界

- 非正式 Session 页面仍渲染会话型指标，出现 `localhost:4096 — — 0 —` 等低价值占位。首页、模式页和新建草稿页应只保留有意义的连接状态；无活动 Session 时隐藏会话指标、Context 和无数据占位。
- `createCurrentSessionSource()` 全局挂载且指标固定值直接写裸 `localStorage`；后续应复用统一 Persist/platform 机制，并验证多窗口、迁移和存储失败。
- 子代理统计通过 assistant message 的 agent/完成时间启发式推导，需与 delegation/background-job 的真实状态源核对，避免误计。

### 6.2 底部弹窗以点击位置为虚拟锚点

- 用户要求点击底部状态栏后，弹窗位置跟随本次鼠标点击位置，而不是固定在整条状态栏或页面预设位置。
- 鼠标点击时以落点创建虚拟锚点；弹窗打开后保持稳定，不随鼠标持续移动。键盘触发时回退到触发控件边界，保证可访问性。
- 必须做 viewport 碰撞检测并自动翻转/偏移，避免越界、遮挡状态栏或与 DebugBar、Help 重叠；窗口缩放后重新计算位置。
- 点击外部和 Escape 关闭后，焦点应回到原触发控件。需覆盖状态栏左、中、右不同落点及窄屏。

### 6.3 开发诊断与 Help 隔离

- DebugBar 与 HelpButton 同占右下区域，且分别使用 `DEV` 与 dev channel 两种门禁，显示策略不一致。
- Help 内容仍为 `Lorem ipsum`，关闭持久化被注释；该占位实现不得进入可交付构建。
- 开发诊断、用户帮助和产品状态栏应拆分层级，避免遮挡与误触。

## 7. 台账登记

见 `docs/technical-debt.md` §4.2（本报告为证据源）。

## 附录 A：状态栏 context 死按钮的 body 对比证据

- 点击前 tabs：`Preview:V | Context:h | Artifact:h`，reviewPanel 计数 0，fileTree 计数 0
- 点击后（1 次、2 次）：与上完全一致；body 文本 diff 仅来自 composer 迟到渲染（"Permission tier"/"Ask anything..."等行出现），与按钮无关
- 真实后端 URL：`/server/<base64("http://127.0.0.1:4096")>/session/<id>`，会话由 `POST /api/session`（`x-aigcfroge-directory` 头指向真实工作区）创建

## 8. 修复闭环状态（2026-09-11）

> 本节只追加实施结果，不改写上文原始复现事实。当前工作区尚无提交，因此 commit 记为 `N/A（未提交）`。

| ID              | 状态     | 实施结果与证据                                                                                                                                                                          |
| --------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TOP-01          | CLOSED   | `TabsProvider.removeTab` 区分 route-active 与后台标签；后台关闭不导航，活动关闭按右→左→Home。`global-shell.spec.ts` 覆盖后台与活动关闭。                                                |
| TOP-02          | CLOSED   | Dirty 改为 `tabKey` 注册；关闭先确认再清理，并对同 key 合并、不同 key FIFO，replacement/unmount 均 settle。Draft 与正式 Session 共用关闭事务。                                          |
| TOP-03/TOP-04   | CLOSED   | Session/Draft 统一 `common.closeTab`；顶层 `mod+w` 所有权由既有 `tab-close-owner.spec.ts` 继续守卫；新增活动关闭 focus handoff。                                                        |
| BOT-01          | CLOSED   | Session route contribution 直接提供权威 `openContext`；状态栏不再二次推导 SessionStateKey。                                                                                             |
| BOT-02/BOT-03   | CLOSED   | 非 Session 只显示连接态；pinned metrics 已迁入 `Persist` 并加 ready gate。                                                                                                              |
| BOT-04          | DEFERRED | 已删除 message 启发式子代理指标；在共享 delegation projection 可供壳层消费前不展示替代伪指标。                                                                                          |
| BOT-05          | CLOSED   | 状态栏按本次 pointer 落点建立 virtual anchor；键盘回退 trigger rect；Popover outside-close 可恢复焦点。                                                                                 |
| BOT-06          | CLOSED   | Help 占位实现与挂载删除；DebugBar 保持 DEV 门禁并上移，production smoke 证明生产构建不含 DebugBar。                                                                                     |
| LEFT-01/LEFT-02 | CLOSED   | Home 左栏改为项目优先；固定 New Session CTA；项目行 directory 进入统一父 action，Mode resolver 不再分叉。                                                                               |
| LEFT-03/LEFT-04 | CLOSED   | Chat Session 次级侧栏归一为 Project→Feature→Session 三个独立 section；canonical `scope + directory` keyed Persist owner，ready 前禁写；ModeWorkspace ADR-15 render-all 不变量保持不变。 |

### 8.1 已取得验证

- App/UI 包测试、typecheck、production build、增量 lint 与 `git diff --check` 已通过。
- Chromium 目标 E2E 在改动前一轮为 `global-shell.spec.ts` 12/12、owner/mode 四 spec 20/20；实施中新增 focus、三区 presentation 与 production smoke 用例。
- 五 project 全量 E2E 首轮受到同一 Vite 进程下高并发热更新/磁盘产物竞争污染，出现 Babel 重编译栈、navigation timeout 与 Playwright artifact `ENOTEMPTY`；这些失败不作为功能绿色证据。最终结果以清理后串行复跑记录为准。

### 8.2 审批后跟进：脏草稿关闭用例根因（2026-09-11，已更正）

- 复核复跑中 `global-shell.spec.ts` "closing a dirty draft confirms before removing it" 稳定失败：点 X 后要么没有确认框，要么 Stay 之后 draft 标签消失、`/new-session?draftId=` 主体空白。
- **根因是规格竞态，不是产品缺陷**：点击 "New session" 后 draft 标签立即登记、其路由在 transition 中渲染，用例未等待路由就输入并关闭；插桩日志显示失败运行的 URL 仍是 session 路由、`fill` 落在 session composer（`dirty.set {session key, value: true}`），draft 页面从未挂载因而无页面级登记，X 关闭被正确判为后台关闭（移除标签、不导航），随后延迟的 draft 导航落在已无标签的路由上，页面空白。此前版本探针因多了一条 `toHaveURL(/new-session?draftId=/)` 等待而总是通过，正是缺失的同步点。
- 修复：spec 在点击 "New session" 后等待 draft 路由，再输入/关闭。同一路径另做产品加固（dirty 实时来源、身份 token 化并与水合解耦、关闭判定事务内快照、确认队列与关闭决策抽为纯模块），细节与单测见计划 §13.1。
- 测试基建边界：provider 级渲染测试与 `mock.module` 进程级作用域冲突（详见 `docs/technical-debt.md` §6）。

## 9. 顶部 New session 的导航延迟：已定性为开发态过渡开销（2026-09-11）

> 本节记录一次独立现象的取证过程与结论。结论：**不是产品死锁，也不是 DESIGN.md 描述的路由冻结缺陷**；是开发态路由过渡在负载下的延迟，已用显式等待预算缓解。

### 9.1 现象与初始怀疑

- 用例：`packages/app/e2e/regression/global-shell.spec.ts:264` "the new-session button on a session route opens a draft tab that closes back to the session"。
- 失败形态：点击标题栏 "New session" 后 `toHaveURL(/\/new-session\?draftId=/)` 连续 10s（14 次轮询）未满足，URL 停在会话路由；同一用例在其他轮次通过，非稳定重现。
- 初始怀疑：与 `DESIGN.md` §Router Transitions And Resources 记载的"transition 游离 promise 导致导航静默冻结"同形。

### 9.2 取证（插桩：`newDraft` 调用点、guard 判定、URL 时间线，5 轮重复）

| 观察项                      | 结果                                                           |
| --------------------------- | -------------------------------------------------------------- |
| `tabs.newDraft` 是否被调用  | 每轮都调用（点击处理链完整，`server/directory/mode` 正常）     |
| `DirtyDraftGuard` 是否拦截  | 每轮都放行：`key=<session>`、`dirty: false`、未 preventDefault |
| URL 是否提交                | **5/5 全部提交**，无一轮冻结                                   |
| 提交延迟（点击 → URL 变化） | 1282ms / 1728ms / **4515ms** / 1285ms / 1690ms                 |

失败轮的高负载下超过了 10s 断言窗口，但机制与上面相同——过渡最终 resolve。

### 9.3 结论

- **导航不会永久冻结**：guard 不拦截、`newDraft` 正常、URL 必然提交；DESIGN.md 的"游离 promise"路径未被触发（全仓 `createResource(() => cond ? … : undefined)` 仅剩 app.tsx 启动健康检查，web 下立即 resolve；`whenActive` 站点是已知豁免）。
- **延迟来源是开发态路由过渡**：Vite 按需 transform + 挂载 new-session 子树，在本机负载下 1.3–4.5s，重负载时超过 10s。会话页到草稿页的过渡不是产品 SLA；生产构建的时序由 production smoke 与性能基准覆盖。

### 9.4 缓解

- 两个依赖"草稿路由已提交"的用例（new-session 打开、脏草稿关闭）把 URL 等待显式设为 30s，并注释说明这是开发态过渡预算、不是产品时限；禁止用缩短等待或断言标签代替 URL 断言（DESIGN.md 要求路由级导航必须断言 URL）。
- 若该延迟继续增长，应在生产构建里测量（`test:bench`），而不是收紧 e2e 窗口。

### 9.5 与关闭事务修复的关系

关闭事务（§8.2）与本次取证均未触及 transition 资源；两者独立。
