# 运营商与模型底座实施入口

日期：2026-11-15。工程目标工作区为 `/home/keer/workspace/aigcfroge-v2`，集成分支 `v2-dev`；当前实施隔离工作树为 `/home/keer/.codex/worktrees/provider-foundation/aigcfroge-v2`，分支 `provider-foundation`。

用户批准协议/源码/skills/测试复核后实施，完成全部工程检查再合入v2工作区并移除隔离工作树。完整目标为运营商持久定义、模型列表发现和导入、来源生命周期、原生路由组、连接轮换、Magpie及动态策略、实际attempt/SSE/单次计量，按P0–P6逐片推进。

唯一目标方案：[plan.md](/home/keer/.codex/outputs/2026-11-15/provider-model-foundation-plan/plan.md)。

工程审批：[approval.md](/home/keer/.codex/outputs/2026-11-15/provider-model-foundation-plan/approval.md)。

P1手动底座任务与接受：[task sheet](/home/keer/.codex/outputs/2026-11-15/provider-model-foundation-plan/P1-task-sheet.md)、[acceptance](/home/keer/.codex/outputs/2026-11-15/provider-model-foundation-plan/P1-acceptance.md)。

P2连接目录任务与接受：[task sheet](/home/keer/.codex/outputs/2026-11-15/provider-model-foundation-plan/P2-backend-task-sheet.md)、[acceptance](/home/keer/.codex/outputs/2026-11-15/provider-model-foundation-plan/P2-acceptance.md)。

当前状态：P0–P6工程实施与集成完成，273个文件的本任务差额已合入`v2-dev`。源码完整check、目标24项类型检查、同源CLI/Web/Desktop构建及隔离Electron设置/模型组接受通过，见[P6交付](/home/keer/.codex/outputs/2026-11-15/provider-model-foundation-plan/P6-acceptance.md)。目标完整lint此前的81项归档错误已通过修正扫描范围消除；最新完整check退出0，24项类型任务通过。P4连接轮换与策略见[P4接受](/home/keer/.codex/outputs/2026-11-15/provider-model-foundation-plan/P4-acceptance.md)，P5-A/B/C见[P5接受](/home/keer/.codex/outputs/2026-11-15/provider-model-foundation-plan/P5-acceptance.md)。用户桌面手测与真实模型验收另列，真实模型继续暂停。

P3有序模型组、实际attempt、单次计量及Web/CLI/TUI/fork/child/Meta消费者已取得[工程接受](/home/keer/.codex/outputs/2026-11-15/provider-model-foundation-plan/P3-acceptance.md)。P4、P5的连接策略、配额、时间观测与UI接线均已取得对应工程接受。

## 添加与来源流程

1. 在原运营商表单选择实际 Chat、Responses 或 Messages 协议，填写 base URL，选择 Credential/env 连接及全局或项目保存位置。保存分别报告配置和凭证结果；部分成功沿原 Continue save 补完。
2. 按连接获取模型候选后，选择导入；也可直接手填 API model ID。发现失败或列表不受支持时，手填流程继续可用。`provider/model`、`group/<id>` 等外部 API ID保持原值，显示名称单独保存。
3. 目录缓存、导入seed、用户覆盖与运行时可用模型分别沿原来源owner管理。导入seed保留初始值；仅编辑其他字段不会把seed报价提升为用户报价。来源开关、自动同步、连接变化与重新打开沿原Data/SSE刷新。
4. 价格状态区分 known、free、unknown。手动价格有效起止时间沿原 Price JSON 表单写入 `Config.Model.quote`；清空日期使用原unset，Restore Auto清除用户报价。报价有效期、出处及缓存价格随实际attempt保存，未知价格不据数值零判断免费。

## 原生组、策略与可观察事实

组保存逻辑Selection、成员顺序、变体、成员/连接权重与turn/session/off亲和；实际请求保存物理Model Ref和连接。表单切换策略保留草稿字段，选择连接不改变全局active账号。原有序组、连接轮换及动态策略共用Session runner/Step、durable attempt、projector与SSE。

| 策略 | 运行所需事实 |
| --- | --- |
| order | 成员与连接顺序 |
| rotate / weight | 稳定成员席位、权重及实际承接记录 |
| fast | 同连接、同部署的近期合格TTFT/TPS，区分已测与未测 |
| cheap | 实际输入、输出和缓存报价及有效期 |
| smart / usage / pace / free / expiring / drain | 对应策略所需的账号/模型资格、免费资格、额度、同单位窗口、重置或到期事实 |

`fast`当前用最新24小时合格观测，按TTFT和预计200 tokens输出时间排序，每8个正常initial Step给未测候选一次正常请求机会。200 tokens、24小时和每8个Step均是**待调优排序参数**；它们不限制本次输出长度，探测仍使用原Step回执和预算。后续按获准的实际模型样本调优，当前没有真实模型性能优化结论。

尝试详情区分归因输出边界与首token时间：TTFT取 `firstTokenAt - started`，TPS取 `(usage.output + usage.reasoning) * 1000 / (providerEndedAt - firstTokenAt)`。`providerEndedAt`记录模型流结束，`ended`保留本地结算结束时间；缺少新时间字段的历史记录显示未测。网关信息单列“响应头报告”，保留实际模型与部署字段。

## 配额与扩展边界

额度仅由需要该输入的运行时策略通过原 `model.quota` hook按需读取；普通UI、模型列表与策略菜单只读现有 `Metadata.quota`。快照绑定安全连接引用，保留known/unknown/unsupported/error、观察时间、freshUntil、来源、资格和窗口单位；过期可见，不跨不同单位直接比较余额。

配额adapter已接通时，unknown/error/过期只表示排序输入未知；候选保留，沿同策略和原retry继续，部分未知排在已知输入后。只有全部来源missing/unsupported才报strategy-unavailable。未知不推断免费、零余额或无限；fallback沿原错误分类和策略执行，旧fresh快照不提供额外许可条件。

当前源码接入OpenAI Codex OAuth和GitHub Copilot原账号adapter的额度来源。Copilot模型窗口使用原生API modelID；ChatGPT token-sharing明确返回unsupported。两类账号均使用5分钟读取缓存；刷新失败时可保留最近成功的原事实，但状态改为unknown并保留原观察/有效时间。其他运营商须接入自己的可验证额度来源，标准兼容协议本身不提供统一配额合同。

Magpie沿已有兼容协议、显式模型/组ID、标准输出、错误和usage接入。P5-A/B/C各按自己的输入与fixture验收；**P5-D隐藏attempt/费用关联仍未解锁**。其解除条件保留并发请求关联、早发响应头与最终候选区分、各尝试usage/报价归属，以及缓存身份fixture。原债务账本登记该项owner和解除条件，P5-D不阻塞已批准的A/B/C。

P6已完成受影响消费者、必要工程检查及隔离桌面接受。用户手测可使用同源桌面产物；真实模型链由用户解除暂停并指定有限预算后另行验收。

隔离源/WIP身份：[implementation-source-baseline.json](/home/keer/.codex/outputs/2026-11-15/provider-model-foundation-plan/implementation-source-baseline.json)。本片贡献按baseline至最终差额计算，继承WIP不作为本任务新增代码。最终合入保留原工作区staging和其他会话改动。

源与行为owner保持Config/Credential/Integration/Provider/Model、原Session runner/Step/projector、Client Data与原SSE。公共合同沿Schema/Protocol/Server正式生成Client，具体来源先运行再提炼可插拔接口。
