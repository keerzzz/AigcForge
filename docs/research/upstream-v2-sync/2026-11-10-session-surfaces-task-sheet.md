# 会话内容、回答操作与侧聊执行任务单

本任务单固定SC00的实施合同、文件owner和后继验收。依据是[已批准计划](/home/keer/workspace/aigcfroge-v2/docs/research/upstream-v2-sync/2026-11-10-side-chat-subagent-implementation-plan.md)及[审批](/home/keer/workspace/aigcfroge-v2/docs/review/v2-implementation-approval-2026-11-10-session-surfaces.md)；计划SHA-256为`b6680319d1c46481e6557e8067effa87ceaa698567f2ca56df2f0f9217ee012b`。拟新增类型和API在相应片落地，本文不授予功能已实现状态。未交付状态只维护在[原账本](/home/keer/workspace/aigcfroge-v2/docs/technical-debt.md)。

## 1. 基线、授权与文件保护

| 项目         | 实际基线                                                                                                                                                                                                                                                              |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 工作区与分支 | `/home/keer/workspace/aigcfroge-v2`，`v2-dev`                                                                                                                                                                                                                         |
| HEAD         | `0a09f6bccdb71f1234eea759eb99e8a336d1d4da`，与批准基线一致                                                                                                                                                                                                            |
| 暂存区       | 空；本片不提交、切分支或新建worktree                                                                                                                                                                                                                                  |
| 原WIP        | ARCHITECTURE、DESIGN、总对齐计划、migration-session-prompts、shared-foundation-decision、desktop-startup independent-review六份；与[原快照](/home/keer/.codex/outputs/2026-11-10/side-chat-plan/before.json)的内容哈希一致                                            |
| 本片现场证据 | [before.json](/home/keer/.codex/outputs/2026-11-10/session-surfaces-sc00/before.json)、[摘要](/home/keer/.codex/outputs/2026-11-10/session-surfaces-sc00/baseline-summary.json)、`/home/keer/.codex/outputs/2026-11-10/session-surfaces-sc00/before-files/`修改前副本 |
| 保护范围     | 完整历史未跟踪库存只记录一次；后继只核该片实际编辑/生成路径、原WIP和冻结输入，不重复扫描历史证据                                                                                                                                                                      |

SC00只改本任务单、DESIGN请求/会话内容段、ARCHITECTURE目标接缝段、GUI AGENTS的Timeline旧句和原账本的本轮登记。批准计划、审批文档和其余四份原WIP保持。后继顺序为SC01→SC02→SC03→SC04→SC05→SC06→SC07→SC08→SC09；每片交回Root审查，收到明确派发才开始下一片。一个文件一个写入owner；只读分析可以并行，测试/构建槽由实施会话串行持有，Root验收时交回。

## 2. 第一性依据与方案选择

| 层             | 可追溯判断                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| fact           | [ServerRef/SessionRef](/home/keer/workspace/aigcfroge-v2/packages/gui-extensions/src/sdk/host-apis.ts:13)分别表达live服务器与真实Shell所有权；[host的key构造和tab筛选](/home/keer/workspace/aigcfroge-v2/packages/app/src/runtime/extension/host-apis.tsx:458)决定跨server身份。[Tab关闭](/home/keer/workspace/aigcfroge-v2/packages/app/src/shell/tabs/tabs.tsx:203)调用原memory.remove；[memory owner](/home/keer/workspace/aigcfroge-v2/packages/app/src/shell/tabs/memory.ts:9)尚无多视图持有。 |
| hypothesis     | 把主SessionScreen直接装进Panel会把草稿、请求和附件继续绑到主路由；关闭真实Shell可能释放仍被Panel使用的草稿。                                                                                                                                                                                                                                                                                                                                                                                        |
| inference      | [Composer adapter](/home/keer/workspace/aigcfroge-v2/packages/app/src/session/composer/adapter.ts:9)和[请求model](/home/keer/workspace/aigcfroge-v2/packages/app/src/session/requests/model.ts:15)仍读取route providers；只换Timeline的sessionID不足以绑定交互目标。新多视图寿命属于本轮场景，须由原owner的定向工件裁决。                                                                                                                                                                           |
| recommendation | 参数化现内容owner，保留stable Session ID和source布局，复用现Panel、Data、SSE、Composer持久键；先让主root和真实child两个消费者运行，再接独立root侧聊。                                                                                                                                                                                                                                                                                                                                               |

咨询方案比较：单次`Bus.publishAll`可以原子提交同aggregate事件，但普通prompt hook拥有真实`session.get`，提前prepare会改变其读取语义。采用两阶段：同事务Created＋咨询归属，随后普通prepare，再同事务首问准入＋归属更新。另建虚拟Session读取层、参考服务或模型循环没有已验证第二用例。

技术债：阶段A成功而阶段B失败会留下可重试的待首问root；正常压缩后参考可能退出当前模型窗口，精确原文沿保存输入/咨询记录查看。后继已有会话选择器复用本期target接缝，由原账本登记；本期先接主root、独立root和真实child。

## 3. 显式目标、source与草稿寿命

以下SDK合同为拟新增，SC03在原[host-apis](/home/keer/workspace/aigcfroge-v2/packages/gui-extensions/src/sdk/host-apis.ts:38)及App宿主实现，TSDoc和README同片更新。

```ts
interface SessionTargetRef {
  readonly key: string
  readonly id: string
  readonly server: ServerRef
  readonly location: LocationRef | undefined
}
```

`key`严格沿`${server.id}\n${id}`，`id`在该server内解释；`server`是既有已注册live引用，`location`读取该目标的实际保存值，未知时为undefined。该类型不含tab、parentID、controller或执行能力字段。草稿阶段尚无持久Session时仍使用原Draft身份，不把预留创建ID当成已存在target。

拟新增`Sessions.target({server, sessionID})`只取得目标引用；宿主`Sessions.content({source, screen, target, active, interaction})`渲染共用内容。`source: MountedSession`与`screen: SessionScreen`来自真实Panel输入，`target: SessionTargetRef`来自明确绑定，`interaction`为`interactive|readonly`。readonly只减少视图操作；原权限和child控制仍由领域owner决定。主会话通过相同内容路径显示；现`Sessions.current()`和`Screen.current()`继续表示主路由。实际复用部分在两个真实消费者验证后形成，SC01不先发布未使用的通用接口。

| 责任                                                                             | 精确目标                                                                                                                              |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Panel登记、条带、标题、选择、关闭与持久绑定                                      | source工作区；现PanelTab/Store保存target的serverID/sessionID及必要偏好                                                                |
| Timeline、消息分页、附件读取、模型/Agent、输入、队列、询问、权限、停止、回答动作 | target的live ServerRef、保存Location和Session                                                                                         |
| 草稿数据与附件引用                                                               | [原Composer target](/home/keer/workspace/aigcfroge-v2/packages/app/src/composer/state.ts:62)的server scope＋Location＋Session/Draft键 |
| 焦点、编辑DOM、滚动与未读展示                                                    | 各view owner；不复制同target的持久草稿                                                                                                |
| 显式“打开为主会话”                                                               | 原导航owner，绑定确切target；普通attach/restore不导航、不准入或interrupt                                                              |

同source同target复用原标签；不同source可以各有view，同server仍共用Data。A→B替换释放A的view持有，旧异步响应只归A；目标Location变化按实际target重新绑定，源目录不覆盖目标目录。source移动后的Panel绑定恢复沿原布局/Store机制，等待IPC load，不用默认空值覆盖保存内容。

草稿在原[ComposerPersistence](/home/keer/workspace/aigcfroge-v2/packages/app/src/composer/persistence.tsx:113)/Tab memory owner补最小retain/release：每个仍使用目标内容的view持有其共享memory；关闭Shell只撤销Shell的持有，最后持有释放才清内存。现私有Tab描述符仍可用于存储寻址，不能对外假造SessionRef.tab。B在自己的Shell和A侧栏同时显示时，关闭B Shell后侧栏B仍能编辑、处理请求；最后关闭view后原草稿和附件可恢复。关闭source工作区不删除独立target。

## 4. 请求响应面与回答Slot

### 4.1 请求归属

现[sessionTreeIDs/sessionTreeRequest](/home/keer/workspace/aigcfroge-v2/packages/app/src/session/requests/session-request-tree.ts:20)决定真实parentID树的root优先顺序；独立侧聊没有伪造parent关系。

同窗口的互斥选择按交互target的完整key计算：target是当前主会话时，响应owner为主Composer；否则由当前source中选中且可见的该target侧聊Composer响应；其余view只显示等待和拥有者跳转。主Composer继续处理其原真实子树，独立root按自己的树处理。请求提交携带原request.sessionID/requestID，不能把child请求改成source ID。只读child不给第二个响应表单。没有可见响应面或表单最小化时，持久请求与blocked状态保持；Question/WebSearch互斥，Permission可同时存在。目标打开为主会话及切回时只变view响应owner，权限不变。

### 4.2 `session.response.actions`的拟新增输入

该位置加入原[SlotMap](/home/keer/workspace/aigcfroge-v2/packages/gui-extensions/src/sdk/registries.ts:549)，沿原[ExtensionSlot](/home/keer/workspace/aigcfroge-v2/packages/app/src/runtime/extension/render.tsx:33)排序、卸载和错误边界。

| 字段                                              | 固定含义                                                                              |
| ------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `screen: SessionScreen`、`source: MountedSession` | 常量source screen及其live source输入；只处理工作区布局                                |
| `session: SessionTargetRef`                       | 正文的实际target，包含确切server/session/Location；该新Slot不要求MountedSession.tab   |
| `active: boolean`                                 | 该内容view当前选中且可见；缓存/隐藏view为false                                        |
| `userMessageID: string`                           | 该回答组所对应的真实user消息                                                          |
| `assistantMessageID: string`、`contentID: string` | 被点击文本所属的真实assistant及Timeline内容条目ID                                     |
| `text: string`                                    | 被点击的普通文本块；不是reasoning、工具UI或整轮日志                                   |
| `completed: boolean`、`latest: boolean`           | 回答组已结束、是否为target最新回答组；资产入口另读target真实idle与mode                |
| `boundary: SessionFork.Boundary \| undefined`     | 已完成组为`{type: "through", messageID: 整组最后已完成持久消息ID}`；未完成时undefined |

当前[copyContentID](/home/keer/workspace/aigcfroge-v2/packages/session-ui/src/timeline/session-timeline-row.tsx:128)仅定位最后非空文本，不能作为整轮截断。SC05在原Timeline projection/row owner按同user组和持久顺序决定结束边界，保留最后文本后面的工具/assistant消息；边界合法性和settled过滤仍由[Core projectFork](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/projector.ts:118)裁决。UI“回答整轮”是展示单位，不新增durable turn对象，也不将一个logical Step称为provider turn。不得以当前已加载的下一user推算服务边界。

沿`createSessionTimelineRowRenderer→SessionAssistantContent→AssistantTextContent`传附加renderer，App接Slot，GUI不导入App。动作render只读传入及共享缓存事实；点击同步捕获target、消息ID、文本与边界，再异步提取/调用。每行不开连接、订阅、解析器或模型工作；对象和组件在token更新时保持稳定。复制仍沿原按钮反馈，新的Fork/资产/侧聊分别贡献动作。

普通资产捕获由非Chat最新已完成且target idle的回答提供；点击按精确assistant读取非synthetic/ignored文本，在await前固定正文/来源，复用同server和保存Location的Chat Draft owner。草稿准备不发模型；用户发送后沿原七类propose→inspect→确认/CAS/apply→发现/显式采用。已完成工具提案直接跳原候选Panel。历史回答的Fork/引用保留各自条件。

图标由[isIconName/getIcon](/home/keer/workspace/aigcfroge-v2/packages/ui/src/icons/catalog.ts:308)比较和读取primary/additional，primary优先；`bubble-5`在[additional目录](/home/keer/workspace/aigcfroge-v2/packages/ui/src/icons/icon/additional-icons.ts:8)，`folder-add-left`在[primary目录](/home/keer/workspace/aigcfroge-v2/packages/ui/src/icons/catalog.ts:45)。Fork复用现`branch`，不复制sprite。

## 5. 咨询操作与参考持久合同

### 5.1 操作、请求和响应

拟新增Core方法`Session.createConsultation`，Protocol ID为`session.createConsultation`，HTTP为`POST /api/session/:sourceSessionID/consultation`。该API仅在当前server创建target；跨server查看使用各自ServerRef。公共字段复用[PromptInput](/home/keer/workspace/aigcfroge-v2/packages/schema/src/prompt-input.ts:29)、[Prompt.FileAttachment](/home/keer/workspace/aigcfroge-v2/packages/schema/src/prompt.ts:26)和[Session.ForkBoundary](/home/keer/workspace/aigcfroge-v2/packages/schema/src/session-fork.ts:6)。

| 请求字段                              | 固定合同                                                                                         |
| ------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 路径`sourceSessionID: Session.ID`     | 首次操作的实际来源；恢复时与持久owner比较                                                        |
| `id: Session.ID`                      | 必填稳定target ID；首次发送前保存，重试复用                                                      |
| `boundary: Session.ForkBoundary`      | 必填before/through的`type＋messageID`；首次创建冻结，重试读取已保存值                            |
| `agent: Agent.ID`                     | 必填明确普通Agent；实际Location插件激活后必须解析出Info，沿原根可选/control规则保证普通Chat root |
| `model?: Model.Ref`、`title?: string` | 普通目标选择；不复制源controller/executor身份                                                    |
| `prompt`                              | 必填`id: SessionMessage.ID`及现text/files?/agents?/skills?/metadata?/delivery?；id为稳定首问ID   |
| `resume?: boolean`                    | 默认true；false为admit-only，只决定仍pending首问的advisory wake                                  |

body不接收权威Location、parentID、controller或服务参考正文/digest。新建时从source保存Location建立`mode=chat`普通root；后续prepare始终按target实际Location。optional字段在wire省略，沿Schema包既有codec，不以null替代。

成功沿`{data: ...}`返回：`session`为现PublicSessionInfo；`reference`包含不可编辑provenance（sourceSessionID、冻结boundary/boundarySeq、sourceMessageIDs、digest、实际未包含项），`reference.file: Prompt.FileAttachment`为从row或实际inbox/User读取的冻结参考；`admission`为以下闭集。

| admission                                         | 输入与副作用                                                           |
| ------------------------------------------------- | ---------------------------------------------------------------------- |
| `{state: "pending", input: SessionInbox.User}`    | 返回原pending输入的首次payload及当前delivery；resume允许时可补wake     |
| `{state: "promoted", input: SessionMessage.User}` | 返回实际User；HTTP重试零wake/零provider重启                            |
| `{state: "cancelled", id: SessionMessage.ID}`     | 返回原首问取消事实和保存参考；已删问题正文不伪造为User；HTTP重试零wake |

创建/准入失败沿现typed错误返回；成功不虚构reserved admission。目标已存在而无匹配咨询owner、source/firstID冲突或阶段与carrier不一致返回409；源/边界新建时不存在为404，跨源或未完成边界、非普通Agent、非法参考为400。handler按原错误映射薄接线。

### 5.2 一个Session-owned记录与两阶段

拟新增public provenance位于`/home/keer/workspace/aigcfroge-v2/packages/schema/src/session-consultation.ts`；持久sidecar由原`core/src/session/sql.ts`和投影owner持有。记录包含`session_id`主键、`source_session_id`、唯一`first_message_id`、冻结boundary/seq/message IDs/digest、`phase: reserved|admitted|cancelled`、`reference_carrier_id`及`reference_file`；真正target删除清理该记录，source删除保留独立target。metadata仅作检索镜像，不能改写归属。

1. **恢复优先**：先按target id查咨询owner，并比较source id＋firstID。匹配后从target和保存参考读回，不要求source仍存在或Location未变。只有没有owner的新操作才读source、核边界和冻结前缀。Location/middleware接线必须允许这一顺序，不能在owner前按source路径强制404。
2. **阶段A**：原[Created commit接缝](/home/keer/workspace/aigcfroge-v2/packages/core/src/session.ts:884)在同target aggregate事务保存普通Chat root、不可编辑owner(reserved)和已物化参考。source rows与不晚于上界的compaction在同一读快照冻结。事务失败/提交前取消不留本次target；提交后取消保留真实reserved目标。
3. **阶段B准备**：读取真实target；普通首问与用户附件执行[SessionPrompt.prepare](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/prompt.ts:30)。hook可以[get目标](/home/keer/workspace/aigcfroge-v2/packages/plugin/src/effect/session.ts:153)并修改普通prompt/meta/delivery；hook完成后由咨询owner附服务参考/provenance，digest按实际保存UTF-8 bytes计算。承载选择和准入在prepare之后的原短事务/serialized边界完成，不跨hook持有inbox锁。
4. **阶段B提交**：复用原InboxEnqueued projector和同aggregate事务，在准入首问的commit内更新匹配owner。first-admission-wins保留首次实际payload；不能串联两次HTTP调用宣称原子。owner仍reserved而firstID已被普通prompt占用时返回Conflict；只有另一匹配咨询已在同事务改为admitted才可读回，普通reconcile不授予咨询归属。
5. **wake/冷恢复**：首问准入提交后只对仍pending补原advisory wake；promoted/cancelled只读。reserved冷重开不自动prepare、没有inbox/claim，明确同请求重试才继续阶段B。已运行claim的启动恢复继续原SessionExecution；咨询重试不另建恢复循环。

[Bus.publishAll](/home/keer/workspace/aigcfroge-v2/packages/core/src/bus.ts:533)的同aggregate事务能力保留，但不能让普通hook读到尚未提交Session，因此本期采用上述两阶段，不改Bus实现。

### 5.3 取消、继续侧聊与参考承载

参考在reserved时由咨询row的`reference_file`承载；准入后由真实pending/User.files承载。取消当前参考carrier时，原[InboxCancelled投影](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/inbox.ts:343)必须在同事务先把实际服务参考转回该row，再删除pending；cancelled允许保留参考正文。已promoted参考继续由User.files读取，不从后来source重算。

原首问取消后，`phase=cancelled`持续保存firstID终态。继续侧聊创建**新User ID**，沿target的普通prompt owner执行prepare，再附保存参考并原子准入；当前carrier按实际新inbox/User记录，继续取消时同样保留参考。通用Session.prompt的唯一准入边界对该咨询已取消firstID拒绝复活，reserved firstID仅允许咨询operation携带其冻结参考准入；[普通其它输入取消后重用ID的keeper](/home/keer/workspace/aigcfroge-v2/packages/core/test/session-prompt.test.ts:1140)保持。新问题不调用createConsultation复活旧firstID。

固定`reference_carrier_id`指向实际pending/User；它是字节读取定位，phase只记录首问状态。row有参考时，新User准入在同事务将它转到该User.files、写carrier ID并清row正文。取消pending carrier同事务转回实际参考并清carrier ID，若它也是firstID则保持cancelled首问终态。保存原文在row或实际input中必须始终存在一个可回读承载；并发准入/取消不能清除最后一份。SC04在原Session事务owner实现，SC07以取消→重开/查看→新问题验证。不永久复制整份首问，不让每个Panel保存一份参考。

| carrier读取状态                               | 新User的参考准入                                                                                            |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| row持有`reference_file`                       | prepare后附该实际文件，同事务准入并建立carrier                                                              |
| 尚无已promoted carrier，参考仍在pending inbox | 从实际pending files读取冻结参考，prepare后也附到新User；pending不是模型已读历史                             |
| 已有promoted carrier                          | 后续模型消费服从正常History、压缩与回退，不自动给新User再次附原文；持久User.files可查看，重新引用走显式动作 |

首个实际携带该冻结参考的User投影时，原InboxDelivered事务将其设为promoted carrier；已经有promoted carrier时保留它，后到pending副本不替换该事实。取消其它pending副本只保持firstID终态与现有效carrier，不清除promoted User。若当前仍只有pending carrier或row文件，取消当前carrier先转回实际bytes。参考副本按保存digest/服务provenance辨认，metadata不决定权威。

[nextPromotable](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/inbox.ts:412)及[promote](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/inbox.ts:529)保留steer优先、queue逐项的现顺序。`resume:false＋delivery:queue`首问仍pending时，随后steer新User先执行也必须携带固定参考；不禁止queue/admit-only，不强制提前执行首问。首次参考尚未promoted时，多个已准入输入可以各含同一参考字节；这项存储/请求重复是采用最简单兼容方案的明确技术债，payload不在准入后被改写，有promoted carrier后停止新增副本。正常压缩可能让参考退出当前模型窗口，精确原文仍沿持久材料查看；本操作不提供自动重新注入或覆盖用户History/revert选择的常驻上下文。

### 5.4 边界与内容

[原History](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/history.ts:28)的boundary是压缩兼容选择；新引用上界必须同时约束rows与latestCompaction。before使用严格前缀，through包含边界；边界属于真实source且引用已完成前缀。服务参考覆盖选择范围的用户/助手正文、工具及结果、附件来源与压缩说明；binary/native checkpoint不能渲染的部分明确记录，不能标成完整原文。

新问题保留在text，参考是服务生成的text/plain inline附件，作为参考数据进入原模型转换；源系统指令、权限和执行身份不成为target权威。超出既有物化/存储/请求/模型约束时返回可解释错误并允许缩范围，不静默截断。原文查看不依赖retained Bus或源会话仍存在。

## 6. 原Fork的through兼容

原`POST /api/session/:sessionID/fork`body只增加`through?: SessionMessage.ID`，保留before?、control?、model?、executorPreference?及expectedSource?。同一Core owning boundary一次拒绝before/through并存，再转换为现ForkBoundary交原projectFork。before与省略边界的现语义保持；正式生成Client，不手改生成面。

`U1→A1→U2→A2`点击完成A1得到`U1→A1`，包括A1轮的末尾工具/后继assistant，排除U2/A2，不自动prompt。旧问题动作仍`before:U1＋恢复U1草稿`。普通Fork继续原继承及Meta限制，默认打开主会话，侧栏查看复用target导航而不再创建Fork。

## 7. SC01–SC09文件、keeper与交付

路径均以`/home/keer/workspace/aigcfroge-v2/`为根。每片由实施会话持有共享接缝写入和测试槽；表内领域owner决定修复位置。新增文件已标“拟新增”，其余为实际存在owner。红证/绿证只在该片派发后运行；同一合同沿最强owner验证一次。

### SC01共享数据与显式目标

- **写入owner**：Client `packages/client/src/solid/data.ts`；App `packages/app/src/session/session-resolution.ts`、`runtime/server/runtime.tsx`、`runtime/server/client.tsx`及必要的`runtime/server/global-sync/child-store.ts`。现SharedEvents/connection不因架构图而改动。
- **nearest keeper**：[shared-events](/home/keer/workspace/aigcfroge-v2/packages/client/test/shared-events.test.ts)、[solid-connection](/home/keer/workspace/aigcfroge-v2/packages/client/test/solid-connection.test.ts)、[solid-inbox-race](/home/keer/workspace/aigcfroge-v2/packages/client/test/solid-inbox-race.test.ts:44)、[App server client](/home/keer/workspace/aigcfroge-v2/packages/app/src/runtime/server/client.test.ts:25)和[session-resolution](/home/keer/workspace/aigcfroge-v2/packages/app/test-browser/session-resolution.test.ts:74)。现inbox keeper已覆盖晚快照不能复活delivered/cancelled及并发enqueue/delivery，不重复另造测试。
- **红证→绿证**：旧API message/pending快照晚到、多目标重连、晚订阅与释放一目标保留其它。现[message.sync](/home/keer/workspace/aigcfroge-v2/packages/client/src/solid/data.ts:2210)与[session.readback](/home/keer/workspace/aigcfroge-v2/packages/client/src/solid/data.ts:2161)的API/current差额在Data owner修。观测同窗口同ServerRuntime主＋两root＋child一条底层SSE、一个Data reducer；别把不同server/window算重复。API对象/生命周期共同校验，attempt复位值不是单独epoch。
- **依赖/产物**：依赖SC00；Client/App类型及原keeper，SC03/07再验证实际多view；本片涉及Session代码先保存同条件production baseline。

### SC02真实协作

- **写入owner**：`packages/gui-extensions/src/session-management/renderer.tsx`、`delegation-panel.tsx`及其i18n；必要映射落原Client Data读取owner。
- **nearest keeper**：[subagent-child-navigation](/home/keer/workspace/aigcfroge-v2/packages/app/e2e/regression/subagent-child-navigation.spec.ts)、[Core tool-subagent](/home/keer/workspace/aigcfroge-v2/packages/core/test/tool-subagent.test.ts)、[subagent-lifetime](/home/keer/workspace/aigcfroge-v2/packages/core/test/subagent-lifetime.test.ts)、[delegation-execution](/home/keer/workspace/aigcfroge-v2/packages/core/test/delegation-execution.test.ts)。UI列表沿App，领域控制不重复在UI模拟证明。
- **红证→绿证**：普通child和正式Delegation同时可见，运行/等待/失败/结束来自实际Session、Job和交付；Job ended不覆盖Session running。控制命中原generation/participant/turn。[addParticipant](/home/keer/workspace/aigcfroge-v2/packages/core/src/delegation/service.ts:791)、[deliveryKey](/home/keer/workspace/aigcfroge-v2/packages/core/src/delegation/fold.ts:209)、[receipt.matches](/home/keer/workspace/aigcfroge-v2/packages/core/src/delegation/receipt.ts:425)决定关系，UI不按标题或childID替代完整键。
- **依赖/产物**：依赖SC01；GUI/App/E2E类型及原keeper；retained Bus/source问题仅阻挡对应真实执行接受，原owner负责，读列表不因此延期。

### SC03共用内容、挂载与草稿寿命

- **写入owner**：App `packages/app/src/session/{screen.tsx,model.ts}`、`runtime/extension/{host-apis.tsx,mounted-session.ts}`、`session/composer/adapter.ts`、原Composer/Tab memory；GUI `packages/gui-extensions/src/sdk/host-apis.ts`、session-management child入口、README及TSDoc。
- **nearest keeper**：[extension-host](/home/keer/workspace/aigcfroge-v2/packages/app/component-tests/extension-host.spec.ts:245)、[extension-graph](/home/keer/workspace/aigcfroge-v2/packages/app/component-tests/extension-graph.spec.ts)、[session-ownership](/home/keer/workspace/aigcfroge-v2/packages/app/src/session/session-ownership.test.ts)、[tabs](/home/keer/workspace/aigcfroge-v2/packages/app/src/shell/tabs/tabs.test.ts:154)、[composer组件](/home/keer/workspace/aigcfroge-v2/packages/app/component-tests/composer.spec.ts)、原child导航keeper。
- **红证→绿证**：主root、独立root、只读child共用内容；同ID跨server隔离、不同source同target、A→B迟到、不同Location附件/草稿、B Shell关闭但Panel B存活、最后释放后恢复；重复打开复用标签，关闭零interrupt/create/prompt。目标缺失/server不可用显示可重试状态，不创建同ID替身。
- **依赖/产物**：依赖SC01/02；GUI/App/E2E类型、host/graph、sdk-docs及streaming/tabs同条件production样本。布局S1和原Files/Review债保持原owner。

### SC04持久咨询

- **写入owner**：拟新增`packages/schema/src/session-consultation.ts`，现`schema/src/session.ts`及必要事件公开面；`protocol/src/groups/session.ts`、`server/src/handlers/session.ts`及实际Location绑定接线；Core `src/session.ts`、`src/session/{sql.ts,history.ts,prompt.ts,inbox.ts,projector.ts,session.ts}`及必要migration。生成路径由正式Client/Protocol生成器产生。
- **nearest keeper**：[session-create故障](/home/keer/workspace/aigcfroge-v2/packages/core/test/session-create.test.ts:280)、[session-prompt](/home/keer/workspace/aigcfroge-v2/packages/core/test/session-prompt.test.ts:233)、[session-inbox-admission](/home/keer/workspace/aigcfroge-v2/packages/core/test/session-inbox-admission.test.ts:116)、[Server session-create](/home/keer/workspace/aigcfroge-v2/packages/server/test/session-create.test.ts:35)。创建触发器回滚与first-admission-wins已存在；新咨询表格用例附在最近Session owner。
- **红证→绿证**：两阶段失败/取消、hook内get/修改普通问题而参考不变、普通prompt占firstID、source未来compaction、pending补wake、promoted/cancelled零wake；首问取消后参考原文可读、源删除/移动后的owner恢复、新ID重新带参考、通用prompt拒绝已取消咨询firstID且普通cancel/readmit保持。补queue首问admit-only→steer新User先执行的受控请求：观察首个steer请求时含相同冻结参考、firstID仍pending且未被强制执行；首个实际User成为可读carrier，副本取消不丢原文。真实SQLite冷重开同归属；源inbox/claim/模型数不增加。
- **依赖/产物**：依赖SC03的目标合同；Schema/Core/Server/Client/Protocol定向检查、正式generate和Protocol check:generated、当前/旧库migration。受控模型请求验证参考编码；真实provider预算由Root明确后执行。

### SC05回答操作与Fork

- **写入owner**：GUI `src/sdk/registries.ts`及typecheck/TSDoc/README、session-management动作；App Timeline桥接；SessionUI `src/timeline/session-timeline-row.tsx`、`src/message/{current-message.tsx,message-content.tsx}`；原Core fork、Protocol/Server fork和正式Client生成。
- **nearest keeper**：**[new-session.spec.ts Fork keeper](/home/keer/workspace/aigcfroge-v2/packages/app/e2e/regression/new-session.spec.ts:61)**（实际位于regression，保留ordinary Build/Plan和managed继承断言）；[Core持久Fork](/home/keer/workspace/aigcfroge-v2/packages/core/test/session-create.test.ts:1586)、[SessionUI timeline组件](/home/keer/workspace/aigcfroge-v2/packages/session-ui/component-tests/session-timeline.spec.ts)、原host/SDK registries typecheck。
- **红证→绿证**：U1/A1/U2/A2、A1最后文本后有工具/后继assistant、隐藏/未完成组无动作、两server和侧target；before、through、无边界及both非法；新root持久/导航、无自动prompt、旧问题草稿恢复及原复制反馈。SDK Slot input必须捕获点击target和真实组末ID。
- **依赖/产物**：依赖SC03/04共享文件顺序；正式Client/Protocol生成、相关类型/sdk-docs、原streaming三场景和按钮挂载观测。GUI Timeline旧句的许可修订已在SC00完成，性能约束继续生效。

### SC06存为资产

- **写入owner**：GUI `packages/gui-extensions/src/skill-proposals/{renderer.tsx,proposal.ts,panel.tsx}`中实际需要的贡献与i18n；App `packages/app/src/new-session/`及原draft owner；SDK若缺目标draft能力，仅补确切target/来源的最小接缝并同片文档。
- **nearest keeper**：原[side-panels](/home/keer/workspace/aigcfroge-v2/packages/app/e2e/regression/side-panels.spec.ts)、new-session/composer keeper及七类候选服务keeper；保存CAS/路径/读回沿既有资产owner，不重做旧默认工作区测试。
- **红证→绿证**：非Chat最新已完成条件、精确正文/目标/Location→Chat Draft→用户编辑/发送→原提案→确认保存；点击前后新输出、跨server及主/side目标、工具提案定位、取消与冲突。准备草稿/打开候选模型0；保存/发现与采用维持原明确动作。
- **依赖/产物**：依赖SC05；GUI/App/E2E类型和原资产/草稿keeper；使用同源受控提案数据，实际模型与文件保存验收按Root片预算。

### SC07持续侧聊与旧记录

- **写入owner**：原`packages/gui-extensions/src/btw/{index.ts,model.ts,renderer.tsx}`与i18n/Store/Panel/MenuItem/Command及回答Slot贡献；App target Composer的persistence、adapter、selection、requests、queue和必要SDK操作。
- **nearest keeper**：**[btw-sidebar.spec.ts](/home/keer/workspace/aigcfroge-v2/packages/app/e2e/regression/btw-sidebar.spec.ts:8)**、[session-request-docks](/home/keer/workspace/aigcfroge-v2/packages/app/e2e/regression/session-request-docks.spec.ts:130)、[composer](/home/keer/workspace/aigcfroge-v2/packages/app/e2e/regression/composer.spec.ts)、原host/graph、Desktop storage、草稿附件keeper。
- **红证→绿证**：旧一次性generate/无输入框/关闭删除断言不再套新侧聊。旧question/answer和失败记录从旧storage读取，打开/restore零generate/prompt；显式继续才将旧材料标为来源参考并创建新root，不把客户端旧答称为服务核源。新记录验证两持久侧聊持续输入、附件、流式、自己的停止、请求/队列、未读、关闭保留Session、迟到创建ACK只保存绑定不重开、重连/恢复不执行。取消首问→重开/查看保存参考→新ID问题消费参考；已取消原firstID重试零wake。
- **交互验证**：B打开为主再切回侧栏，互斥请求最终完成；插入源草稿捕获source server/session，保留原附件与光标，用户自行发送；source路由已切换时不调用route-following composer。窄标签X、长标题、中文IME、明暗、键盘和RTL混排沿原组件验证。
- **依赖/产物**：依赖SC03–06；SC04定义的参考承载/恢复由Session owner完成，Panel不补第二缓存；GUI/App/E2E类型、原keeper、main＋两side同时streaming production样本；同源隔离桌面/模型由Root具体任务单派发。

### SC08Meta与模式入口

- **写入owner**：GUI `packages/gui-extensions/src/session-management/meta-agent-panel.tsx`、原协作/Workflow/Artifacts导航及panel-launcher可用性；不另建Meta状态树。
- **nearest keeper**：原subagent-child-navigation、side-panels、extension-graph和Core Meta/Delegation/Workflow keeper。
- **红证→绿证**：真实controller关系与Task/Subagent/Workflow来源、普通child/正式Delegation/外部participant各到原详情/结果；按实际五模式和内容筛选，Task维持输入框上方智能体自动只读dock。空/等待/失败/完成显示实际事实，外部transport只提供其实际操作。
- **依赖/产物**：依赖SC02/03/07；GUI/App/E2E及相关原领域keeper，真实来源链仍受原retained Bus/source项的对应执行验收约束。

### SC09集成、性能与同源桌面

- **写入owner**：原账本与本轮验收证据，必要修复交回对应片owner；CLI `packages/cli/script/build.ts`、Desktop `packages/desktop/scripts/prebuild.ts`和发布输入只按实际构建差额处理。
- **nearest keeper**：所有受影响片的最终定向工件、[production timeline benchmark](/home/keer/workspace/aigcfroge-v2/packages/app/e2e/performance/timeline/session-timeline-benchmark.spec.ts)、tabs/entry现performance场景、原隔离native验收骨架。已通过且输入未变的合同复用工件，不按模块重复整套。
- **真实接受**：当前源码同次CLI＋App＋Electron，Desktop prebuild的`AIGCFROGE_CLI_DIST`指向确切新CLI，记录构建源码/依赖/产物哈希、Source和隔离profile/数据库/端口。Root给出明确模型、请求预算及实际用户链；主流持续运行时侧聊发送/停止/关闭/恢复，普通subagent、正式Delegation和Meta结果进入原父消费。旧成功工件和新受控/真实结果分别记账。
- **性能/收口**：production同条件streaming三场景、main＋两side同时流、tabs/entry按影响测原始样本；观测订阅、组件挂载、历史高度/抖动及草稿焦点，不设机器阈值或用少量样本声称显著改善。原retained Bus/source错误沿原owner取有效启动值、失败→修复→真实工具消费；对应接受完成后才能关闭该账本项。其余未交付范围保留owner和解除条件。

## 8. 验证入口、协议差额与本片验收

[docs/testing.md](/home/keer/workspace/aigcfroge-v2/docs/testing.md:5)和[实际manifest快照](/home/keer/.codex/outputs/2026-11-10/session-surfaces-sc00/manifest-inventory.json)决定命令。以下均为后继入口，SC00不执行产品命令；cwd统一显式为`/home/keer/workspace/aigcfroge-v2`，每条独立、串行执行，定向测试按实际脚本传文件和筛选。

```bash
/home/keer/workspace/aigcfroge-v2/script/bun run --cwd=packages/core test --timeout 30000
/home/keer/workspace/aigcfroge-v2/script/bun run --cwd=packages/core typecheck
/home/keer/workspace/aigcfroge-v2/script/bun run --cwd=packages/client generate
/home/keer/workspace/aigcfroge-v2/script/bun run --cwd=packages/protocol check:generated
/home/keer/workspace/aigcfroge-v2/script/bun run --cwd=packages/app typecheck
/home/keer/workspace/aigcfroge-v2/script/bun run --cwd=packages/app typecheck:e2e
/home/keer/workspace/aigcfroge-v2/script/bun run --cwd=packages/app test:unit --timeout 30000
/home/keer/workspace/aigcfroge-v2/script/bun run --cwd=packages/app test:browser --timeout 30000
/home/keer/workspace/aigcfroge-v2/script/bun run --cwd=packages/app test:components --workers=1 --retries=0
/home/keer/workspace/aigcfroge-v2/script/bun run --cwd=packages/app test:e2e:built e2e/regression/new-session.spec.ts --workers=1 --retries=0
/home/keer/workspace/aigcfroge-v2/script/bun run --cwd=packages/cli build --single --skip-install
```

Core用包wrapper，Protocol没有test，App的E2E类型单独运行；Client check:generated会生成且有写入，执行前按实际生成路径保护。GUI SDK改动同片TSDoc/README并用原`script/sdk-docs.ts`门禁；其余包只用manifest存在的test/typecheck。E2E依原utils readiness、role/label及动作前network等待，不固定sleep，不重试状态变更。性能用production、workers=1/retries=0；真实native隔离目标与预算由Root在相应片冻结。

| 协议差额                              | 本片裁决与影响                                                                                                                                                                      |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DESIGN请求“留中间Composer”            | 窄化为实际交互target自己的Composer；主原子树顺序和权限不变，SC07验证互斥响应面                                                                                                      |
| GUI Timeline仅header旧句              | 本片按明确派发先行允许轻量response Slot；原无逐行订阅/后台/模型工作和稳定挂载约束保持，SC05行为验证                                                                                 |
| 一般English-only规则与用户中文要求    | 沿批准要求恢复简体中文及旧locale，去中英文边界空格；普通技术token不改名，不把翻译门禁用作本需求阻挡                                                                                 |
| 历史默认仓main/SDK路径/重试术语       | 实施目录和分支以本任务V2为准；使用当前Schema/Protocol、first-admission-wins、logical Step及launcher，不复制旧SDK/运行时或exact-payload retry                                        |
| 现普通cancel/readmit与咨询firstID终态 | 唯一准入owner按咨询持久归属拒绝已取消firstID复活、reserved firstID被普通输入占用；普通其它输入原keeper完全保持                                                                      |
| 已知retained Bus/source失败           | 原[唯一账本条目](/home/keer/workspace/aigcfroge-v2/docs/technical-debt.md)保留fact/hypothesis/inference/recommendation；非保留Bus是待查输入，仅阻挡对应真实执行，不阻挡SC00或只读UI |

SC00验收由[可重跑文档核验脚本](/home/keer/.codex/outputs/2026-11-10/session-surfaces-sc00/validate-sc00.py)生成[document-validation.json](/home/keer/.codex/outputs/2026-11-10/session-surfaces-sc00/document-validation.json)：新引用/行号/锚点、实际manifest、协议差额、允许文档变换、原WIP内容隔离及HEAD/暂存区。行为未自动验证，后继外部验证路径是各片nearest keeper和同源真实链；文档通过不取得生产行为信用。Root预审的取消参考、source恢复、通用准入与Queue/steer接线在本片固定并由SC04/07定向证明。

[后端合同输入](/home/keer/.codex/outputs/2026-11-10/session-surfaces-sc00/backend/backend-contract.md)保存决定函数和普通hook依据，[Root后端预审](/home/keer/.codex/outputs/2026-11-10/side-chat-plan/sc00-backend-review.md)保存实际纠正项；[UI有限终稿复核](/home/keer/.codex/outputs/2026-11-10/session-surfaces-sc00/ui/ui-final-review.md)绑定已读UI段落及keeper路径。原错误候选报告和首轮文档核验分别保留，最终合同以本任务单和Root接受为准。
