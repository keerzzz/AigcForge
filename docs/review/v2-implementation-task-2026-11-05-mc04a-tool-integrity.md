# MC04a 首批任务：工具检测生产接线

日期：2026-11-05。当前阶段：工程和原限定真实消费者已接受，本节文档已同步，MC04aComplete=true；原运行失败与unknown保留，详见文末。原实施角色 `/root/mc04a_impl` 因宿主限流交回后，Root依本任务末尾的明确接管授权成为唯一写者；首次候选限制保留为派发历史。原MC01/MC03依赖已满足。

目的：通过既有 Tool pre/post hooks 接入 DoomLoop、文件/符号/反向引用检查与基础机械 Verifier，使用正式工具产物和已接受 CorrectionStore.record 接缝，向模型提供可核验结果。非目标：MC04b 的 PGE/Judge、第二工具注册表、第二模型循环、全语言索引框架、MC03 CRUD/TTL 重做、旧 Custom 产品复刻。

## 源身份与保护

工作区 `/home/keer/workspace/aigcfroge-v2`，`v2-dev@9e2c6577ef6dd65c8f01ff94d46da0142bcb877c`，暂存区空。启动为 201 tracked modified / 13945 untracked；原 WIP 的完整状态、tracked diff 和相关文件指纹在 `/home/keer/.codex/outputs/2026-11-05/mc04a-mc05-engineering-v1/`。这不是全部 WIP 的完整备份。

MC01/MC02 原退出与 MC03 最终同步收据保持。MC03 A11/11、B5/5 余0，C4/0/88、D Source130/Wrapper unknown 不改。CorrectionStore/Extractor/current/receipt/normalHead/birthAfter/来源资格与权限保护；只消费已接受检测入口。S1 四文件、默认工作区、全部未分配源码与当前现用服务/用户库保护。

## 当前决定函数

- `packages/core/src/tool.ts:118` 的 beforeExecute 和 `:128` 的 executeTool 已实际触发前后 hook；这里只 catchTag Tool.Error，interruption/defect 保留。
- `packages/core/src/plugin/hooks.ts:69` 的 register 已将 dispose 注册到 Scope；trigger 顺序调用当前回调。无需第二 hook 机制。
- `packages/core/src/plugin/internal.ts:398` 的 list 经 `:400` Context.pick 捕获 services，pre/post 是正式激活入口。AppProcess、Config、Bus、FSUtil、Location、Permission、Ripgrep 已在捕获清单；需要新增的依赖应按真实 Layer 要求核定，不能逐个补 Service not found。
- `packages/core/src/instructions/index.ts:198` 的 hash 已调用键排序 canonical（`:247`）；稳定 JSON 指纹先评估复用该导出，不按旧调查建议重复造序列化器或导出私有函数。原未知输入必须在实际 owning boundary 窄化，不能用 cast 伪造 Schema.Json。
- `packages/core/src/tool/plugin/write.ts:30` 的 Output 提供 target/resource；Edit/Patch 的正式 Output.files 提供实际变更文件。ReferenceChecker/Verifier 应消费这些已完成产物，不能按旧 bash/apply_patch 名称和输入字符串猜路径。
- `packages/schema/src/session-event.ts:696` 的 Definitions 以及 `:751` 的 DurableDefinitions 决定可编码/回放事件集合；当前 `:772` 的 Verify 三事件在清单之后定义且未加入 inventory。枚举存在不代表生产事件已接线。

## 首批文件分工

以下是 A 的精确接线候选；Root 下发源码阶段前均只读。A 必须交回实际修改理由、可信失败/未覆盖情况与依赖冻结，不能将此候选表当作直接写入权。

- `packages/core/src/session/doom-loop.ts`：语义等价输入 fingerprint、配置/阈值、调用 source、provider-hosted/local 与失败/拒绝/取消的实际计数范围。
- `packages/core/src/session/reference-checker.ts`：正式变更文件输入、有效文件引用、符号/反向引用的真实支持边界；扫描错误/不可用/超时不能变成“正确”。
- `packages/core/src/session/verifier.ts`：真实 package/script/launcher、变更/结果去重与单一执行槽；区分代码失败和进程缺失/超时/取消；移除无生产者 intent 导致的空操作和未执行 Judge 的升级措辞。
- `packages/core/src/plugin/tool-integrity.ts`（必要新增）：唯一内置插件组装三个已存在 detector 与 typed hooks，构造依赖一次，沿插件 Scope 回收；不改 Tool 注册模型。
- `packages/core/src/plugin/internal.ts`：A 是本节候选唯一写者；仅增加正式插件/所需捕获依赖，保留 MC03 LocationMutation 等 WIP。MC05 不占此文件。
- `packages/core/test/doom-loop.test.ts`、`packages/core/test/reference-checker.test.ts`：扩展既有最强 keeper；保留原行为断言。
- `packages/core/test/tool-integrity.test.ts`（必要新增）：真实 PluginInternal→激活→Tool 执行→模型可见结算、Scope 卸载及中断/defect 的最小集成 keeper。
- `packages/core/test/verifier.test.ts`（必要新增）：当前无此文件；使用真实临时 package 与进程，覆盖成功、代码失败、执行不可用/超时/取消，不能复制 verifier 逻辑。

共享 Schema 的 `packages/schema/src/session-event.ts` 与 `packages/schema/test/event-manifest.test.ts` 归 Root 串行分配：如果保留原 Verify durable 事实，则必须在定义顺序、canonical inventory 和实际消费者中完成同一接线；只增加本节必要事实，不顺手加入 ContextUpdated 或改 MC03 事件。公开 Protocol/HttpApi 变化需要正式 Client generate，由 Root 单写生成面。generated 不手改。

`packages/core/src/tool.ts`、`plugin/hooks.ts`、SessionRunner/SessionContext、Permission、CorrectionStore、VerificationRouter 默认保护。当前证据支持通过现有 hooks 组装，不足以授权改动这些共同 owner；有真实缺口时由 Root 指派唯一写者。

## 合同与检查

链路：真实成功修改→当前 leaf 权限→pre-hook DoomLoop→工具结算→post-hook 引用/机械检查→明确结果/必要检测纠错→模型消费及原 Step 结算。工具/诊断/纠错不授予权限，不替代父 source，不为每次 hook 调用增加纠错年龄。只有真实代码失败可生成 verifier 检测纠错；执行不可用不能计为类型错误。after hook 的 typed failure 为 never，不吞 interruption 或 defect。

先复用既有 keeper 证明键顺序等价、真实 patch/write/edit 产物、坏引用/红代码、执行不可用、注册卸载与取消。未执行的命令不记为 RED；受控模型不记 Flash。语言支持和未检查状态应明示，不能用没有 Codegraph 把整个检查静默当作成功。

所有命令由 Root 唯一资源槽运行。Core 使用 `/home/keer/workspace/aigcfroge-v2/script/bun run --cwd=packages/core test --timeout 30000 <实际文件>` 与包 typecheck；新增文件落地前不运行不存在的测试路径。Schema 使用自己的现有 test/typecheck 脚本；Protocol 无 test 脚本。格式、lint、必要生成按实际影响派发。不得安装依赖、从根跑产品 test 或直接 tsc。

方案选择：一个插件消费现有服务和 hook 的简单组装优先；不把三个 detector 塞进 Tool 注册表或另建常驻协调器。真实未覆盖的语言/外部 MCP、MC04b Judge 与 Native 验收分别保留原范围，不把“已登记”当作交付。新行为默认/权限或必要公共合同若有实质冲突，由 Root 用具体场景裁决，常规工程选择不反复请求人类确认。

## 退出与运行

原账本 ID：AUDIT-V2-MODE-META / V2-VALIDATION 之 MC04a，相关 AUDIT-V2-CODING-PARITY。Root 与原 Core Tool/Plugin/Session/verification owner 保持。工程退出需要实际接线、成功/失败/不可用、权限/回收/取消 keeper、类型和独审；完整原退出仍需明确原生消费者及文档同步。MC04b 和其它 MC/B/S1 不随本片关闭。

当前 provider/Native 新预算为0。先冻结源码/依赖/产物、隔离 Home/user-data/config/DB/ports、确切模型/variant、最大 physical 次数、停止规则与 owned cleanup，再提交具体运行包。不得借用 MC03 额度、自动探活/重试、限制仓外输出 tokens 或操作现用服务。Git 写入/分支/worktree/远程操作未授权。

## Root 接管实施

2026-11-05后继接续：Root核对原子智能体已因限流停止、无当前写入，确认本任务既有候选文件未有MC04a改动，保存逐文件baseline后接管。当前唯一实施者与资源槽为Root，授权本任务列明的detector/唯一插件/必要keeper及Schema inventory两文件；MC05两测试冻结不动。实际函数差异由Root在同节修复；不重建独审角色，冻结结果交监督侧完成原一轮独立复审。provider/Native预算仍为0，MC03接受及其它owner保护不变。

## 当前工程冻结（2026-11-05）

Root实施已落地；原初“未授权生产写入”属于启动时点，已由上节接管授权覆盖。首轮冻结的文件归属为本任务10个已存在/新增源码与keeper，加必要message-updater三个Verify空操作；独立verifier.test.ts的用例归并至tool-integrity.test.ts，不重复建文件。Schema事件公开清单触发正式Client生成，Root串行写三个实际差异文件：packages/client/src/effect/api/api.ts、src/promise/generated/client.ts、src/promise/generated/types.ts；OpenAPI正式生成后字节未变，原12个产物均先备份。

[冻结/最小增量/收据入口](/home/keer/.codex/outputs/2026-11-05/mc04a-mc05-engineering-v1/mc04a/root-engineering-handoff-v1.json)。原独审由监督侧执行并在四项修复后结束；Root工程接受见文末，Native接受仍未宣布。MC05冻结两测试未改、MC03接受保持。

## 同次独审的四项修复

监督侧原行为独审提出MC04A-BEH-001..004，本节按原合同修复，不重开事件/生成绿组。001将失败额度绑定Session/包/实际返回变更内容与脚本签名，仍限重复同一失败、成功清除；只覆盖工具返回的变更，不建立全仓或外部编辑失效索引。002删除任意编译文本关键词分类，使用AppProcess错误及126/127执行状态识别不可用。003默认导出分支登记default后结束，保留合法具名导出。004新增必要接缝白名单`packages/core/src/tool/plugin/patch.ts`和`packages/core/test/tool-patch.test.ts`，由Root单写：实际move成功的applied保留目的update及来源delete，现有hook自动消费两路径；原FileDiff与Output Schema字段不变。两个文件修改前baseline及授权见[分配收据](/home/keer/.codex/outputs/2026-11-05/mc04a-mc05-engineering-v1/mc04a/review-patch-seam-allocation.json)。

四项RED分两轮保存为0/2/6与0/2/5；最终受影响三文件keeper65/0/204，原DoomLoop、事件、生成与下游检查按未改边界复用，不相加。修后冻结见[root-source-freeze-v2.json](/home/keer/.codex/outputs/2026-11-05/mc04a-mc05-engineering-v1/mc04a/root-source-freeze-v2.json)，原v1及行为request_changes原样保留。后继只复核四项实际修复及其命令，不增加新层。

## Root 工程签收

[原一轮修复复核](/home/keer/.codex/outputs/2026-11-05/mc04a-mc05-engineering-v1/review/supervisor-mc04a-repair-review.json)确认四项全部解决，既有事件/生成子审查保持，无新阻断或条件。Root复核当前16源码/13依赖与实际命令哈希后[签收工程切片](/home/keer/.codex/outputs/2026-11-05/mc04a-mc05-engineering-v1/mc04a/root-engineering-acceptance-v2.json)。MC04aComplete=false：原限定Native工具检测用户链尚无预算/真实证据；MC05运行包也不替代该信用。其余MC/B/S1条件保持。

## 最小Native包准备完成

已核[监督Root正式工程接受](/home/keer/.codex/outputs/2026-11-05/mc04a-mc05-engineering-v1/review/supervisor-root-mc04a-engineering-acceptance.json)的四份证据SHA，无新检查门槛。普通Work/Build原生write→坏引用/真实tsgo失败→第二write修复→第三次模型消费及正常Step完成的[完整候选包](/home/keer/.codex/outputs/2026-11-05/mc04a-mc05-engineering-v1/mc04a/native-runtime-v1/README.md)已落盘，拟3次DeepSeek Flash/high physical与1次Native；独立短路径Home/user-data/config/DB/端口，复用已构建Desktop v2。新候选离线预算2/0、规则匹配8/8、真实package夹具bad exit2/fixed exit0、语法与false approval拒绝和全部绑定预检通过，均不记为Native/原keeper验收。详见[root-native-preparation-v1.json](/home/keer/.codex/outputs/2026-11-05/mc04a-mc05-engineering-v1/mc04a/root-native-preparation-v1.json)。

当前MC04a预算0、Native/provider0，未并入MC05已提出的7/1申请。原MC04a权限/失败上限/不可用/取消/卸载工程信用保持，不扩大原生矩阵；真正执行后再裁定完整原退出。

## 原退出及文档同步完成

[监督Root原范围接受](/home/keer/.codex/outputs/2026-11-05/mc04a-mc05-engineering-v1/review/supervisor-root-mc04a-original-exit-acceptance-v1.json)签收既有工程与一次Native普通Work/Build真实两write/诊断/修复/模型消费，3/3 physical完整200、Native1/1，余0。真实Verify失败后通过、三个原Step完成与两类CorrectionSource关联经原独审核定；本次不重跑已绿工程或模型。任务单、CLAUDE、专项§57与唯一账本已实际同步，MC04aComplete=true，见[闭环收据](/home/keer/.codex/outputs/2026-11-05/mc04a-mc05-engineering-v1/mc04a/root-original-exit-and-document-closure-v1.json)。

原controller/runner exit1及closed=false不变；原断言错在versioned事件比较（packages/schema/src/event.ts:174），并非该真实产品链缺失。Electron清理TypeError、Source/Electron数值exit/signal unknown、Gateway0/signal null及缺终态截图全部保留。此前“预算0/未验收”段落记录准备历史。MC04b的MC04a依赖满足，但MC05/07/08依赖与其它MC/B/S1范围不变。

当前相关状态：MC04aComplete=true、MC05Complete=false、MC06ProductionUnlocked=false。
