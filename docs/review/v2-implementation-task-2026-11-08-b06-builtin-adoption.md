# B04.0 / B06.1 正式任务：内置根选择与显式采用首链

2026-11-08 当前状态：**B04.0 / B06 内置根选择与显式采用首链已闭环；下一节为 Profile 保存与显式采用。** [Root 最终接受](/home/keer/.codex/outputs/2026-11-08/b06-runtime-root-v5/root-final-acceptance.json)串联工程、v2 Plan 预览/取消及 v5 Build/Meta 两条真实结果。v5 实际 2 次 DeepSeek Flash/high 请求成功，采用根/版本、重载、IPC 存储与窗口观察通过；资源已关闭。本片累计模型2、Native5、Source5、gateway2、Codex0，旧失败及 v4 已准入 User 保留。首链完成，完整 B06 继续；MC10 的有效接受保持。

下一实施入口：[B06 Profile 正式任务](/home/keer/workspace/aigcfroge-v2/docs/review/v2-implementation-task-2026-11-08-b06-profile-adoption.md)。复用真实 Location 保存 owner、同一内置根和既有 plan/start，完成保存→读回→用户预览/确认→Session→另行提交。已有授权与通过工件在原范围继续有效；上下文压缩只恢复未完成步骤，不触发重复审批、额外修复前红证或重跑已通过链。下方旧状态按历史时点读取。

2026-11-08，Root 在既有人类自主推进委托下正式派发。阶段 A 已完成，独立审查已确认无实际阻断；原稿的测试定位属性禁令已删除。工作聊天沿用 `01a1b91c-8284-7bf2-84c4-cea200af6a27`，本片工程输出 `/home/keer/.codex/outputs/2026-11-08/b06-base-engineering-v1`。

本任务一次授权原范围必要实现、现有测试扩展、定向回归/类型/静态检查、正式 Client 生成与私有 CLI/App/Desktop dev 构建。直接调用链中若有真实漏消费，在同一合同内完成必要接线并交付实际差额；不逐文件、逐命令再次等待 Root。新产品范围、不可逆动作或实际权限变化才回传具体冲突。实现先约定共享 Schema 与 plan.input，再可由两个子智能体分别承担 Core 与 App 的互不重叠文件；主智能体整合，检查/生成/构建保持串行。

私有打包复用 `/home/keer/.codex/outputs/2026-11-08/b06-runtime-prepare-v1/build-reuse.md`，版本 `2.0.26-dev-b06-20261108-v1`；保存并复位原 App dist/archive 中间产物，生成新同源包。按影响选必要检查，旧 WIP 诊断按原证据保留，只裁定本片新增差额；不借机清理整个文件或全仓。共享状态文档由 Root 统一更新。实际产品启动与模型验收由 Root 在同源产物交付后绑定具体有限场景。

压缩后的续接读取当前任务与实际接受，不将压缩本身视为授权失效或已验行为失效；继续当前未完成步骤。MC10 已闭环并保持其原接受。

你是 Root 派发的本小节实施者，工作模型及子智能体为 gpt-6.1-sol/max。所有仓库命令显式使用 `/home/keer/workspace/aigcfroge-v2`。保留 `v2-dev`、HEAD `9e2c6577ef6dd65c8f01ff94d46da0142bcb877c`、全部 WIP、暂存条目与文件模式。索引保护以 `git ls-files --stage` 的暂存语义为准，使用 `GIT_OPTIONAL_LOCKS=0` 读取；stat-cache 字节变化不触发索引回写或恢复。默认仓仅只读参考，旧 Custom 不作设计来源。原范围常规修复、定向验证和私有构建直接完成；Root 负责统一状态与最终运行验收。

## 目标与依据

完成一条最小用户链：**明确工作位置 → `/mode/custom` → 内置根选择 → Plan → 用户确认/start → canonical Session → 用户显式提交 → 真实结果**。零用户资产可以执行；Build/Plan/Meta 可明确选择，Meta 仅在选中时启用其持久身份与统筹。先补原 B04.0 来源/绑定/版本合同，再让 B06 界面消费它。

首读当前 CLAUDE/AGENTS、ARCHITECTURE/DESIGN/docs/testing、受影响包指南、Session/Tools 规格；唯一总计划及 B04/B05/B06 附件、共享底座决定、技术债和 S1 owner。进入 Effect/UI 实现时读取适用技能。继承 [MC10 最终接受](/home/keer/.codex/outputs/2026-11-08/mc10-runtime-root-v2/root-final-acceptance.json)和 [本片 findings](/home/keer/.codex/outputs/2026-11-08/b06-stage-a-v1/findings.md)，不重审 MC00–MC10。Codegraph 未初始化的事实复用，用精确 rg，不建索引。

已确认差额：Resolver:245 要求用户 Agent；SessionComposition:451 拒绝空池；startCustom:624、retryCustom:588、selectSessionAgent:645、fork:980 固定 Meta；consumer-view:52 以 Meta 决定根 binding。App 没有 plan/start 调用，Home 新建会拒绝 Custom。上述位置均在本仓实际文件，详见 findings 链接。现有失败作为对照保留；源码已定位的缺陷可直接修复，修复后完成新增合同 keeper。额外修复前红证不作为前置门槛。

## 最小实现合同

1. **复用真实内置对象。** 从 `Agent.Service.get/list/select` 取得 Build/Plan/Meta，保留现默认/default_agent owner；界面将实际选中根显式写入采用输入。选中不存在、不可作根或被资产遮蔽的对象时返回具体诊断，不静默换根。零库存常规基准使用现内置 Build。根选择不写成 executorPreference。
2. **窄的来源表达。** 在现 Composition 输入、Plan 和快照补内置根 source、真实 ID、定义 revision；根内容沿用 canonical Agent.Info 与现根 binding。用户池继续使用真实 AgentRef/path/revision。字段名按现 Schema owner 确定，不新增全资产 Ref 框架、注册表或执行层。来源必须能 typed 区分内置根与用户资产，且不生成 Agent/Profile 假文件。
3. **Plan 可直接用于确认。** 初次预览可捕获当前根 revision，返回含完整来源/版本的规范 `plan.input` 与 digest。start 使用此输入和 `expectedPlanDigest`，重验当前根定义及已选引用；已提供的过期 revision 产生诊断，不自动替换。revision 对实际捕获定义可重算；Meta 专属 system 渲染只作用于所选 Meta，版本计算明确覆盖其实际冻结值。凭据继续留在 credential owner。
4. **零池必须有真实冻结根。** 新链在根 Info、来源/version、binding 和工具 capture 完整时允许 `agents=[]`；旧缺少新来源证据的空快照保持既有拒绝。readAsset 的错误不能因过滤后池为空而变成基础组合成功。保留根/用户池 ID、name、consumer 冲突与 binding 完整性检查。
5. **同一采用与执行 owner。** `startCustom` 的 Created commit、snapshot 插入和 expectedPlanDigest 保持；写入实际根。Meta 才建立现 RootController/Meta association，非 Meta 沿普通创建语义。`selectAgent/assertDependency/selectSessionAgent`、Permission 的冻结选择和 consumer-view 按保存根处理，SessionContext/Runner 继续消费同一 Info/request/system/binding。
6. **首次身份保持。** `retryCustom` 比较保存的规范输入/版本，不重读当前资产或根来重新冻结；同 ID 冲突保持既有错误。历史未含新根字段的真实输入和快照按原版本读取与重入，不因补默认值而改写已保存 digest。普通 fork 复制原根/快照，不能默认为 Meta 或采用最新版。`upgradeCustom` 沿所选根调用同一 start，保持原 source mode/Location/busy 与 commit 内复验；本片不把其普通源→独立新根语义扩成完整 Custom 新版升级产品。
7. **现权限逐次执行。** 不新增 capability 授权、默认安装、提权或 Task/Workflow 隐式运行。新根的冻结规则、当前权限覆盖、ask/deny、无人值守 ceiling 均交给现 Permission owner。

## 修改文件与理由

| 文件（均相对上述目标仓） | 本片职责 |
| --- | --- |
| `packages/schema/src/composition.ts` | 输入/Plan/快照的窄内置根来源与 revision；保持真实旧 Snapshot read 合同。 |
| `packages/core/src/composition-resolver.ts` | 显式根读取、规范输入/version、零池、Meta 条件渲染、诊断与 freeze。 |
| `packages/core/src/session/composition.ts` | assertDependency/selectAgent/根子身份、来源证据与旧快照分支。 |
| `packages/schema/src/composition-consumer-view.ts` | 由快照根 ID 决定 orchestrator consumer。 |
| `packages/core/src/session.ts` | start/retry/upgrade/fork/model/controller 消费保存根，保留原子提交。 |
| `packages/app/src/home/route.tsx` | 在 Custom 工作面呈现最小装配入口，复用现 Home/工作位置。 |
| `packages/app/src/home/model.ts` | Custom 的新建动作进入显式组合流程，成功后走现 Session readback/remember/tab 导航。 |
| `packages/app/src/home/custom-composition.tsx`（必要新组件） | 可操作的根选择、来源/version/模型/权限预览、取消/确认、请求状态与错误。 |
| `packages/app/src/runtime/i18n/en.ts` | 新入口文案与可访问名称。 |

公开 Schema 改动后从 `packages/client` 正式 `generate`，登记实际生成差额，不能手改 generated。现 Protocol/Server plan/start 已传 canonical Composition 合同，先复用；若某处确实漏消费，给出该决定函数证据再最小修改。`CompositionDigest.computeCompositionDigest`可继续 hash 含根 revision 的规范输入；无需另造摘要 owner。Created projector、Permission、SessionContext、Profile service 当前未发现必须生产修改的差额，不扩成格式整理。

## 界面接线

沿现 `client["custom-composition"].plan/start`，传真实 directory/workspace 和捕获的 server owner。确认请求必须使用最后有效 Plan 的规范 input/digest；根、位置或输入变动后重新预览。位置缺失、连接不可用、禁用或不支持时给出现可恢复状态。取消与迟到响应按现 scope/lifecycle，不写入另一 server/Session。

start 后复用现 canonical Session readback/remember 与 tab owner；界面显示采用根、来源/version 和实际 Session 结果。确认/start 不自动发送用户草稿，用户另行提交。普通 Draft 创建表仍由其 owner 决定；Custom 走组合 start。现 Shell/模式路由/Session screen 足够，首片不另造 Shell、缓存或扩展宿主。明暗、窄屏和键盘按现 V2 原语/i18n 实现。

## 必要定向验证

扩展现 keeper，按新增合同和直接影响选择 case；不要另造测试框架或重跑 MC10 整场链。

- Schema 的 `test/composition.test.ts`：窄根来源、revision、旧 JSON/optional read、无假资产路径及必要 wire 编码。
- Core 的 `test/composition-resolver.test.ts`：零库存 Build/Plan/Meta、规范 Plan、缺失/漂移根、混合真实用户池、坏引用不 fallback。
- Core 的 `test/session-composition.test.ts`、`test/composition-consumer-view.test.ts`：实际根绑定、身份冲突、缺 Info/source/binding 拒绝、旧分支保持。
- Core 的 `test/session-custom-lifecycle.test.ts` 与 `test/session-custom-context.test.ts`：首次原子采用、exact retry、普通 fork 原根、非 Meta 无 Meta controller、冻结 system/request 正式模型请求消费、源定义更新后的旧根保持、当前权限拒绝。只有被新选择实际影响的旧 case 才复验。
- Server 的 `test/custom-composition.test.ts`：经正式 HTTP/generated client 的 plan→start、expectedPlanDigest/根 revision 漂移、失败零 Session/snapshot 残留、upgrade 源检查；预览/确认无模型输入副作用。
- App 的 `e2e/regression/home.spec.ts` 持有新的 Custom 用户链；复用现 fixture 请求观察，按项目现有约定选择稳定的用户可访问名称或测试定位属性。旧 Custom draft 阻断仍由原 new-session keeper 持有。

检查串行。使用本仓 launcher 和包脚本，例如 `/home/keer/workspace/aigcfroge-v2/script/bun run --cwd=packages/core test <已选真实测试文件> --timeout 30000`；先核脚本及新增 case 名。按影响完成 Schema/Core/Server 类型、Client 正式生成与类型、App 类型/E2E 类型及现静态检查。UI/session 影响沿现 production benchmark，保留同条件样本；已有绿色组不无依据扩大重跑。记录完整 cwd/命令/退出码、最终 tally 与失败轮次，当前结果和历史接受分开。

## Root 真实 Electron 退出条件

工程期 Native/Source/gateway/Codex CLI/真实 provider 启动预算为 0。工程完成后 Root 冻结同源产物并安排隔离 Electron＋Flash 及具体请求预算；不接管用户现用服务。

实际退出观察：空七资产库从左侧 Custom 进入，使用真实工作位置；可以选择 Build/Plan/Meta，预览真实来源/version/模型与权限，选择/预览/取消/确认本身无 prompt/model 执行；确认创建一个根和一个快照，非 Meta 无 Meta association。用户再显式提交，实际请求消费选中根与冻结值，Session 显示完整结果。重载/冷读与普通 fork 保持身份/version；已选漂移或缺失不换根，取消保留输入。权限变更在后续叶操作生效。明暗、窄窗口、键盘/焦点和当前 server/位置隔离需实际窗口观察。真实模型与确定性 keeper 各证明其合同，不重复已完整通过的消费者链。

## 后继与交付

本片只关闭上述基础合同和第一条用户链。技术债仍映射原 **V2-D-COMPOSITION**（Profile 保存、完整 Builder/plan/health/start/upgrade、用户资产根及全部装配）、**V2-D-FREEZE**（producer 代码闭包与全模式实现身份）、**V2-D-REFERENCES**（Project/global 来源绑定、引用/删除/恢复）。Profile apply 目前要求 Session ID；后继对齐 Location mutation 后才能创建前保存，不能填假 ID。B05 已接受的提案保存链保留，保存不自动采用。S1 归原 owner。

交付实际修改文件、定向证据、原子采用/运行结果与未决项。Root 同步唯一状态文档与最终接受；不自行提交、发远程消息或派发后继聊天。无新的产品待决项，不重新询问已决定的目标。

## 2026-11-08 最终交付

工程实际差额 24 文件（21 修改、3 新增），Schema/Core/Server/Client/App 定向检查、类型、正式生成与私有同源产物均按原工程接受通过；重叠测试组不合计，历史失败逐轮保留。静态差额新增诊断0、继承34。Home 性能 after 每场景1样本对照原10样本，仅记录值，不推断显著变化。

v2 Plan 预览/取消与 v5 两根采用/两条结果分别来自各自原运行；同 Native 重载、明暗、800×720、焦点和 IPC/SQL 读回通过。Native/gateway 退出0，Source 已结束、端口释放，detached 数字退出 unknown。工程中回写捕获 index 以恢复 stat-cache 的多余操作已经停止；暂存条目语义核对保持，不能概括为整个工程 Git 写入0。

后续工作由 Profile 正式任务和原技术债条目继续。首链最终接受链接见本页顶部。
