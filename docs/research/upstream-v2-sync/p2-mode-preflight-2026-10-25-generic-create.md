# P2.1 模式创建预检：四个 generic mode 运输子切片

取证日期：2026-10-25 UTC；Asia/Shanghai 为 2026-10-26。状态：只读取证、未实施、未运行验证。主智能体本轮限定后续子切片为四个 generic mode 的 create 运输、继承与 Agent 正交关系；第五 Custom 用户入口明确保留为 P3 未交付范围。Desktop 独立复审及主智能体解除 freeze 前不得改 packages。

取证 Owner：/root/p03_fd_final_review；实施/审批 Owner：/root。目标 `/home/keer/workspace/aigcfroge-v2`，`v2-dev`，HEAD `251c0fe38041a326e624db464d1ee0efd1522881`，含其他参与者 WIP。旧产品参考 `/home/keer/workspace/aigcfroge`，只读 `main` `edbe67383d830aa40269ddf453c7f5617c940b46` 及 WIP。仅新建本文件及同名 JSON；输入哈希是局部取证记录，不是完整不可变工作树快照。

工作令：[现行 P2.1](/home/keer/workspace/aigcfroge-v2/docs/research/upstream-v2-sync/2026-10-25-v2-alignment-execution-plan.md:134)、[AUDIT-V2-MODE-META](/home/keer/workspace/aigcfroge-v2/docs/technical-debt.md:65)。关联 [基础 Skill 用户链预检](/home/keer/workspace/aigcfroge-v2/docs/research/upstream-v2-sync/p1-first-asset-preflight-2026-10-25-skill.md:1)：Chat 产品验收需要真实 mode 创建，默认 Coding 探针不能替代它。

## 1. 最小方案与完成边界

复用已有 `ProductMode`、Session 行、Created/Forked projector、Core.create 和 Data cache。给公共 create 的现有字段链增加 `mode`，同时给乐观 Session 同一字段，保留服务器 canonical echo。Core 已能创建四个普通模式，不需要新模式表、registry、Session runner、mode 更新端点或按 mode 另建 Project/Workspace。

canonical [ProductMode.ID](/home/keer/workspace/aigcfroge-v2/packages/schema/src/product-mode.ts:5) 有 `chat/coding/work/assistant/custom`；[GENERIC_CREATION](/home/keer/workspace/aigcfroge-v2/packages/schema/src/product-mode.ts:26) 和 [isGenericSessionMode](/home/keer/workspace/aigcfroge-v2/packages/schema/src/product-mode.ts:44) 决定普通创建范围，custom 为 false，默认仍 coding。Client 普通 draft 输入可使用现有派生 `GenericSessionMode`；公共 Session 及 child/fork 仍使用同一完整 canonical mode 身份，不复制 enum。

当前子切片通过只代表四个普通模式运输/持久化/继承可用。它不代表四模式 UI 或五模式 P2.1 全部完成。Custom Profile/Builder 用户入口、draft 持久选择、按 mode 展示/过滤和完整模式行为仍需独立落地及验收。禁止把四个 generic mode 加一个失效 Custom 按钮记为“五模式完成”。

## 2. 真实链路与共用字段缺口

当前创建链为 [NewSessionPage](/home/keer/workspace/aigcfroge-v2/packages/app/src/new-session/screen.tsx:52) → [new-session composer adapter](/home/keer/workspace/aigcfroge-v2/packages/app/src/new-session/composer-adapter.ts:97) → [Data.session.create](/home/keer/workspace/aigcfroge-v2/packages/client/src/solid/data.ts:1552) → [generated Promise Client.create](/home/keer/workspace/aigcfroge-v2/packages/client/src/promise/generated/client.ts:1025) → [Protocol session.create](/home/keer/workspace/aigcfroge-v2/packages/protocol/src/groups/session.ts:222) → [Server handler](/home/keer/workspace/aigcfroge-v2/packages/server/src/handlers/session.ts:137) → [Core Session.create](/home/keer/workspace/aigcfroge-v2/packages/core/src/session.ts:454) → [Created projector](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/projector.ts:449)。

已接线的持久 owner：[Session.Info.mode](/home/keer/workspace/aigcfroge-v2/packages/schema/src/session.ts:43)、[SessionTable.mode](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/sql.ts:39)、[Core CreateBaseInput.mode](/home/keer/workspace/aigcfroge-v2/packages/core/src/session.ts:91)。旧缺失 mode 的 Info decode/default 和数据库默认仍为 coding；新请求必须回显实际创建的 mode，不能靠 default 证明运输成功。

共同缺口是 mode 没有沿真实字段链到达这些已有 owner：

- Protocol 的 [payload 字段集合](/home/keer/workspace/aigcfroge-v2/packages/protocol/src/groups/session.ts:223) 未声明 mode。
- Server 的 [create 参数组装](/home/keer/workspace/aigcfroge-v2/packages/server/src/handlers/session.ts:137) 未传 mode。
- generated Client 的 [body whitelist](/home/keer/workspace/aigcfroge-v2/packages/client/src/promise/generated/client.ts:1030) 未序列化 mode；只在调用对象塞一个字段无法修复它。应从 Protocol/现有 generator 生成 Promise/Effect/API/types 合同，禁止手工补 generated 文件。
- Data 的 [显式 create shape](/home/keer/workspace/aigcfroge-v2/packages/client/src/solid/data.ts:1552) 和 [乐观 remember payload](/home/keer/workspace/aigcfroge-v2/packages/client/src/solid/data.ts:1567) 都未包含 mode。当前 generated [SessionInfo](/home/keer/workspace/aigcfroge-v2/packages/client/src/promise/generated/types.ts:4896) 允许 wire mode 缺失，不能因此把占位对象的缺失字段视为正确分类。
- App [new-session adapter props](/home/keer/workspace/aigcfroge-v2/packages/app/src/new-session/composer-adapter.ts:22) 与 [create call](/home/keer/workspace/aigcfroge-v2/packages/app/src/new-session/composer-adapter.ts:97) 尚未携带产品模式。当前 screen/view 没有产品模式选择状态。

最小修复顺序：Schema 的现有 mode 值复用 → Protocol payload → Server 转交 → 现有生成器 → Data request/optimistic mode → App adapter 的显式 draft 输入。保持现有 title/agent/model/metadata/permissions、位置和请求 gate 语义；不扩大成新的生命周期实现。

## 3. Core 已有的创建、继承、冻结和重试规则

这些关系由实际决定函数成立，当前未重新运行测试：

1. **普通 root**：[Session.create 460 行](/home/keer/workspace/aigcfroge-v2/packages/core/src/session.ts:460) 选择 `parent.mode ?? input.mode ?? ProductMode.Default`，运行当前 runtime 检查；[495 行](/home/keer/workspace/aigcfroge-v2/packages/core/src/session.ts:495) 仅为 root 的 Created 记录 mode。Project 在 [485 行](/home/keer/workspace/aigcfroge-v2/packages/core/src/session.ts:485) 依据原 Location directory 解析，没有按 mode 切分 Project。
2. **child**：Core 在 [458 行](/home/keer/workspace/aigcfroge-v2/packages/core/src/session.ts:458) 读取实际 parent；[482 行](/home/keer/workspace/aigcfroge-v2/packages/core/src/session.ts:482) 继承 placement；[Created projector 466 行](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/projector.ts:466) 从 parent 行取 mode。普通 child 的输入 override 不改变 parent-wins 规则；Custom 的 mismatch/executor/snapshot 约束由 [464 行起](/home/keer/workspace/aigcfroge-v2/packages/core/src/session.ts:464) 单独处理。不能在 HTTP 对所有 child 无条件套 generic root 创建检查。
3. **fork**：[Session.fork](/home/keer/workspace/aigcfroge-v2/packages/core/src/session.ts:576) 读取实际 parent，复用现有边界和 snapshot；[projectFork 164 行](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/projector.ts:164) 明确写 `mode: parent.mode`，同时独立处理 child/root ownership、agent、model、permissions 和历史。
4. **复用 ID**：[Session.create 456 行](/home/keer/workspace/aigcfroge-v2/packages/core/src/session.ts:456) 对已有普通 Session 直接采用 recorded Session。不同的 draft mode 不能把已有 Session 重分类。Client 应采用 canonical response，不重新覆盖成请求 mode；不要把这改成新的 exact-payload retry 规则。
5. **创建后 mode 冻结**：当前创建/fork owner 给 row 分类；Agent/Model 切换只更新独立字段。此次不得新增 mode patch 或通过重发 create 改 mode。普通 create 的新 Custom root 在 [462 行](/home/keer/workspace/aigcfroge-v2/packages/core/src/session.ts:462) 要求 composition；继续保留这条防绕过路径。

## 4. Data 乐观记录与 canonical echo

[Data.session.create](/home/keer/workspace/aigcfroge-v2/packages/client/src/solid/data.ts:1552) 返回同步 ID 与 request，并以现有 `creating` map 阻止 prompt 提前发往尚不存在的 Session。[sessionOutbox](/home/keer/workspace/aigcfroge-v2/packages/client/src/solid/data.ts:364) 区分未确认占位与已有服务器事实。

新增 mode 必须同时进入 request 与 fresh optimistic row。当前 [response path](/home/keer/workspace/aigcfroge-v2/packages/client/src/solid/data.ts:1587) 清除 outbox，再用真实 info 调 [remember](/home/keer/workspace/aigcfroge-v2/packages/client/src/solid/data.ts:1393) 的 `reconcile(info)`，服务器结果决定缓存；[session.created](/home/keer/workspace/aigcfroge-v2/packages/client/src/solid/data.ts:673) 通过现有 Session GET sync 读取 canonical Info。[failure path](/home/keer/workspace/aigcfroge-v2/packages/client/src/solid/data.ts:1592) 只移除本次 fresh 且未获得 echo/response 确认的占位。

必须保留这套 reconcile、请求等待和失败回滚。无需第二份 mode cache。已有 ID 的创建、echo 先于 response、response 失败但 echo 已确认的场景，都由上述 owner 决定；不能用 draft 的当前选择覆盖这些持久事实。

## 5. 产品模式、Agent 分类与 Composer 输入模式的正交关系

[ProductMode.ID](/home/keer/workspace/aigcfroge-v2/packages/schema/src/product-mode.ts:5) 决定 Session 产品分类；[Agent.Info.mode](/home/keer/workspace/aigcfroge-v2/packages/schema/src/agent.ts:31) 是 `subagent/primary/all` 执行分类；[ComposerSubmission.mode](/home/keer/workspace/aigcfroge-v2/packages/app/src/composer/submit.ts:21) 是 `normal/shell` 输入行为。不得把三者合成一个 enum 或把 Chat/Work 映射为 Agent 名称。

普通创建保留用户当前 agent/model 选择，见 [adapter 99 行](/home/keer/workspace/aigcfroge-v2/packages/app/src/new-session/composer-adapter.ts:99)。运行时 [SessionContext.select](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/context.ts:149) 对普通 mode 使用选中 Agent；[Session.switchAgent](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/session.ts:92) 与 [AgentSelected projector](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/projector.ts:570) 只修改 agent/时间；[ModelSelected projector](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/projector.ts:581) 只修改 model/时间。App 的 [Agent 可见性 predicate](/home/keer/workspace/aigcfroge-v2/packages/app/src/providers/models/selection.tsx:95) 读取 Agent.mode，不是 Session 产品 mode。

后续 UI 的 mode 选择只能更新 draft 选择，不创建 Session、不调用 switchAgent/switchModel、不恢复工作。现有 [Data create call](/home/keer/workspace/aigcfroge-v2/packages/app/src/new-session/composer-adapter.ts:97) 留在明确 submit/start 边界。post-create [applySelection](/home/keer/workspace/aigcfroge-v2/packages/app/src/composer/submit.ts:456) 继续负责实际 Agent/Model 选择，不能把 mode 选择混进去。

Custom 明确的 composition start 具有既有 frozen meta root/executor 约束，属于真实 start 合同。它不是单纯选中 Custom 时改普通 draft Agent 的授权，见下一节。

## 6. 第五模式：真实后端可复用，用户入口尚未交付

已确认以下都是实际公共实现，不是只存在的 DTO 或 stub：

- `GET /custom-profile` 与 `GET /custom-profile/content`：[CustomProfileHandler.list](/home/keer/workspace/aigcfroge-v2/packages/server/src/handlers/custom-profile.ts:26) 读取 `CustomProfile.Service` 的 summaries/invalid entries；[content](/home/keer/workspace/aigcfroge-v2/packages/server/src/handlers/custom-profile.ts:53) 读 canonical profile。它们在 [handlers composition](/home/keer/workspace/aigcfroge-v2/packages/server/src/handlers.ts:96) 实际接线，read 不依赖 Chat asset 创建开关。已有 Profile listing/内容合同和 revision 可供选择器复用。
- `POST /custom-composition/plan`：[真实 handler](/home/keer/workspace/aigcfroge-v2/packages/server/src/handlers/composition-stubs.ts:65) 借当前 Location graph、等 Plugin activation，再调用现有 resolver；[68 行](/home/keer/workspace/aigcfroge-v2/packages/server/src/handlers/composition-stubs.ts:68) 检查 Custom kill switch，不写 Session。
- `POST /custom-composition/start`：[真实 handler](/home/keer/workspace/aigcfroge-v2/packages/server/src/handlers/composition-stubs.ts:78) → [Session.startCustom](/home/keer/workspace/aigcfroge-v2/packages/core/src/session.ts:392)，冻结 composition、检查 expectedPlanDigest，并将 [Created 与 insertSnapshot 的 commit](/home/keer/workspace/aigcfroge-v2/packages/core/src/session.ts:429) 原子提交。root [mode=custom、agent=meta](/home/keer/workspace/aigcfroge-v2/packages/core/src/session.ts:419)，[StartResponse](/home/keer/workspace/aigcfroge-v2/packages/schema/src/composition.ts:461) 同时返回 Session 和 snapshot。不能预建普通 Session，再事后附一个 snapshot。
- 既有 [Composition.ProfileInput](/home/keer/workspace/aigcfroge-v2/packages/schema/src/composition.ts:152) 只需 `source: profile`、`profilePath`、`profileRevision`，可作为后续最小 Profile 选择→plan→明确 start 用户链，无需先重建完整 Builder。真实 Client 是 [client["custom-profile"]](/home/keer/workspace/aigcfroge-v2/packages/client/src/promise/generated/client.ts:3053) 和 [client["custom-composition"]](/home/keer/workspace/aigcfroge-v2/packages/client/src/promise/generated/client.ts:3105)，遵守 flat directory/workspace 与 existing request envelope。

当前 App/src 字符串检索未找到上述 API 或 Custom capability token 的实际消费；[new-session adapter](/home/keer/workspace/aigcfroge-v2/packages/app/src/new-session/composer-adapter.ts:97) 仍统一调用普通 create。故第五模式用户入口未接线，不能计为可创建。

后续 P3 用户链建议复用这些 API 做真实 Profile list/content/health、plan 展示、明确 start、canonical Session remember 和导航。成功 start 前不要 promote 成可运行 Custom Session，失败不留普通/空 Custom Session。明确 start 后采用返回的 frozen meta root，不能用普通 draft 的任意 `selection.agent` 覆盖它；否则现有 [applySelection](/home/keer/workspace/aigcfroge-v2/packages/app/src/composer/submit.ts:467) 会请求不符合 snapshot 的切换。完整 Builder、Profile 创建/编辑与五模式 UI 是 P3 的明确未交付范围；四 generic 运输子切片不代做、不关闭它们。

## 7. Capability 与 disabled 边界：按当前消费者取证

当前 [ProductMode capability 常量](/home/keer/workspace/aigcfroge-v2/packages/schema/src/product-mode.ts:57) 已提供 `product-mode-custom-v1` 与 header 名；[ProductModePolicy.isCustomCapable](/home/keer/workspace/aigcfroge-v2/packages/core/src/product-mode-policy.ts:29) 解析它。当前可见的 Server runtime 消费者 [event subscription](/home/keer/workspace/aigcfroge-v2/packages/server/src/handlers/event.ts:23) 把 Custom 能力传给 `ApprovalPresence.bindResponder`，不能从函数名或旧 helper 测试推断所有 create/list/SSE 已有统一 capability gate。

现有 [ProductModePolicy helper tests](/home/keer/workspace/aigcfroge-v2/packages/core/test/product-mode-policy.test.ts:55) 检查过滤函数；它们不证明当前产品运输已调用这些函数。真实 Custom plan/start 的 disabled 行为由 [plan guard](/home/keer/workspace/aigcfroge-v2/packages/server/src/handlers/composition-stubs.ts:68) 与 [startCustom runtime guard](/home/keer/workspace/aigcfroge-v2/packages/core/src/session.ts:396) 决定；[runtime policy](/home/keer/workspace/aigcfroge-v2/packages/core/src/product-mode-policy.ts:78) 保留当前默认关闭的 Custom 开关。

四个普通模式不新增 capability token 或统一 gating 层。其未知输入、Custom 新 root 拒绝和既有 child 合同按真实 Protocol/Core owner 验收。P3 Custom 客户端的 responder 能力、disabled/不支持状态和实际 Session/审批消费要另做真实请求验证，不由本子切片的 helper 单测覆盖。

## 8. 真实改动 owner 与不扩大的范围

最小运输切片的生产改动 owner：

1. **Schema/Protocol**：复用 `ProductMode.ID`，在现有 [session.create payload](/home/keer/workspace/aigcfroge-v2/packages/protocol/src/groups/session.ts:223) 增加可选 mode；保留省略时 coding、公共 Info canonical identity 和 child 合同。已有 Session SQL/event 支持字段，无需新 migration。
2. **Server**：[session handler](/home/keer/workspace/aigcfroge-v2/packages/server/src/handlers/session.ts:137) 转交 mode，继续使用 Core.create 和现有错误转换。既有 Custom createCustom/start、child/fork/snapshot owner 不重写。
3. **Client 生成与 Data**：依现有 generator 更新 [Promise serializer](/home/keer/workspace/aigcfroge-v2/packages/client/src/promise/generated/client.ts:1030) 及 Effect/API/types；[Data.create](/home/keer/workspace/aigcfroge-v2/packages/client/src/solid/data.ts:1552) 接收 mode，request 与 optimistic row 使用同一值，response/echo 仍 canonical。保留 Client 运行时只依赖 Schema/Protocol，不引入 Core/Server。
4. **App 运输适配**：后续经批准时由 [new-session adapter props](/home/keer/workspace/aigcfroge-v2/packages/app/src/new-session/composer-adapter.ts:22) 接受显式产品模式，捕获在同次 submit/start 中，并传入 existing create。Agent/Model 当前选择和 normal/shell Composer 流不改为 mode 推导。

UI 与持久 draft 的真实后续 owner：[NewSessionPage](/home/keer/workspace/aigcfroge-v2/packages/app/src/new-session/screen.tsx:16)、[NewSessionView](/home/keer/workspace/aigcfroge-v2/packages/app/src/new-session/view.tsx:37)、[TabStorage.Draft](/home/keer/workspace/aigcfroge-v2/packages/app/src/shell/tabs/schema.ts:17)、[tabs.updateDraft](/home/keer/workspace/aigcfroge-v2/packages/app/src/shell/tabs/tabs.tsx:282)。当前 Draft 已持久化目录/worktree/branch/MCP，可沿原 owner 保存产品 mode；仅放局部 signal 会在 draft remount/reload 丢失选择。采用真实 V2 view/token/i18n，不虚构 new-session extension Slot。

当前按 mode 分类 UI 尚未接线。[Protocol SessionsQueryFields](/home/keer/workspace/aigcfroge-v2/packages/protocol/src/groups/session.ts:61) 与 [Core ListInputBase](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/store.ts:17) 不含产品 mode filter；App [home sessions controller](/home/keer/workspace/aigcfroge-v2/packages/app/src/home/sessions/controller.tsx:87) 消费现有索引/缓存。后续按 mode 过滤应以 canonical Info.mode 为准，继续共享 Project/Workspace、Session/location 缓存；需要服务器检索参数时另明确合同，不能默增镜像 endpoint。

## 9. 现有测试与最小新增验收

以下为已读取的现有夹具及待执行条件，未运行任何测试/构建/typecheck/lint/acceptance/server，没有 green tally，也没有 reproduced product red：

- **Schema**：[product-mode-creation.test](/home/keer/workspace/aigcfroge-v2/packages/schema/test/product-mode-creation.test.ts:16) 已区分四 generic 与 Custom；[mode/default tests](/home/keer/workspace/aigcfroge-v2/packages/schema/test/product-mode.test.ts:8) 和 [Session JSON transport](/home/keer/workspace/aigcfroge-v2/packages/schema/test/session.test.ts:8) 可回归。新增 create mode 的真实 encode/省略/未知值合同检查，避免 duplicate enum。
- **Server 真实 HTTP**：[session-create.test](/home/keer/workspace/aigcfroge-v2/packages/server/test/session-create.test.ts:10) 复用 ServerFetch.make，但当前只证明 parent placement/列表与 missing parent。新增 generated Client→真实 HTTP→Core→GET/echo 的四 mode case，保持同一显式 Agent，省略仍 coding；新 Custom root 拒绝且无残留，未知 mode 失败。不得只把 mocked response 的 mode 填成请求值。
- **Core 继承/replay**：[session-create fork 用例](/home/keer/workspace/aigcfroge-v2/packages/core/test/session-create.test.ts:627) 当前在 [633 行](/home/keer/workspace/aigcfroge-v2/packages/core/test/session-create.test.ts:633) 先直接更新数据库为 work。这只证明 mode 继承与 replay，不证明 mode.create。实现解除 freeze 后，将 root 通过真实 create(mode) 建立，再保留 child/root fork、explicit ID/retry、durable replay 和不同边界断言；检查切换 Agent/Model 不改变 mode。
- **Client 乐观/echo**：[solid-data creating 用例](/home/keer/workspace/aigcfroge-v2/packages/client/test/solid-data.test.ts:808) 已有 controlled request gate。新增立即可读的 optimistic mode、实际 serialized body、canonical response mode、echo 先后及失败后仅回滚未确认占位；已有 ID retry 采用原 mode。保留同 Session prompt 必须等待 create 的原 gate。
- **App 运输与 Agent 正交**：复用 [composer submit tests](/home/keer/workspace/aigcfroge-v2/packages/app/src/composer/submit.test.ts:163) 的真实 selection/submit 逻辑。四普通 mode 不隐式变更 Agent/Model，不新建或恢复 Session；transport field 在明确 submit 时捕获，mode 产品字段不得覆盖 normal/shell 输入模式。
- **UI 后续范围**：[tabs migration 用例](/home/keer/workspace/aigcfroge-v2/packages/app/src/shell/tabs/tabs.test.ts:27) 可覆盖旧 draft/default 与新选择 round trip；[new-session e2e](/home/keer/workspace/aigcfroge-v2/packages/app/e2e/regression/new-session.spec.ts:91) 提供 pending/draft promotion/failure 参考。四普通 selector、切换 project/workspace、route/reload、真实服务器创建 echo/分类需另做用户链验收；mock fixture 不能记作产品通过。
- **Custom 保留回归与未来用户链**：[Server Custom atomic start](/home/keer/workspace/aigcfroge-v2/packages/server/test/custom-composition.test.ts:688)、[无残留 failure](/home/keer/workspace/aigcfroge-v2/packages/server/test/custom-composition.test.ts:816)、[frozen root/child Agent](/home/keer/workspace/aigcfroge-v2/packages/server/test/custom-composition.test.ts:1039)、[disabled HTTP](/home/keer/workspace/aigcfroge-v2/packages/server/test/custom-composition.test.ts:1095) 是既有真实夹具，不在此重新执行或重开已验子范围。P3 仍须新增真实 Profile list/content→plan→明确 start→snapshot/Session→App 导航与首次消费的用户链，才能交付第五入口。

验收必须区分 API/存储运输、helper 单测、mock GUI 和 managed-server 产品证据。仅四 generic 运输通过不能关闭完整 AUDIT-V2-MODE-META 或宣布首资产 Chat UX 已验收。

## 10. 技术债与未交付登记

选择四 generic 运输的简单子切片，是先补已有 owner 的字段链。技术债明确为用户入口和分类消费尚未交付；它们不由传字段自动解决。完整 UI 方案沿现有 Draft/Session/Data/Custom owner 继续接线，无需另建模式架构。

- 四普通 new-session selector、持久 draft mode、route/reload 和按 mode 分类消费：Owner App/Client；解除条件为真实 V2 宿主选择→真实 create→canonical echo/重载/过滤，并证明选择本身不创建/改 Agent/恢复工作。
- 第五 Custom Profile 选择/Builder/start 用户入口：Owner App/Custom；阶段 P3；解除条件为复用真实 Profile/plan/start 的完整用户链、snapshot 原子性、frozen meta/executor 选择、disabled/capability 与实际消费。失效按钮不算交付。
- 各模式完整 Instructions/权限/记忆/Meta/Assistant/Work 行为：Owner 各领域/Core/App；阶段 P1/P3/P4；解除条件为现行计划逐域合同与生产消费者验收。mode 存储或展示本身不证明行为等价。
- 四 generic 当前运输实现及同源验证：Owner Core/Protocol/Server/Client/App、主智能体；解除条件为 Desktop 独立 gate 后明确授权、完成上述真实字段链与适用验证。本文只预检，不审批或关闭此项。

这些范围保持现行 AUDIT-V2-MODE-META 及相关账本开放。freeze 禁止本取证者编辑 plan/debt；主智能体关闭实现切片前应按既有 Slice Checkpoints 规则登记实际未交付范围与 owner/unlock，本报告不作关闭声明。
