# V2 续验收 · 2026-11-18

本轮离线工程验收通过，四个新增缺陷已修复并取得红绿证据。77文件、358个当前变更块的fixture/断言深审已由Root闭环：Core21 + Session28 + Schema14 + migration2 + Server12，源码SHA、完整变更块、生产决定函数与实际成功keeper范围全部匹配，缺失、重复和元数据缺口为0。工作区为 `/home/keer/workspace/aigcfroge-v2`，分支 `v2-dev`，HEAD保持 `0a09f6bccdb71f1234eea759eb99e8a336d1d4da`。

本轮复用现有owner和keeper：修正Task追加位置、调整恢复的清理顺序、按UI消费字段解码diagnostic，并使用已有依赖补丁机制修复Drawer收尾。简单实现保留了原持久化与UI状态owner。新增技术债是维护Corvu 0.2.4补丁；升级到已修复上游版本并通过原快速Escape/隐藏/焦点keeper后移除。

| 新缺陷                             | 可执行事实与修复                                                                                                                                                | 证据                                                  |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| CONT-01 错误坐标显示NaN            | 原file-tool观察到`[NaN:NaN]`；按message、severity与有限start坐标解码，保持severity=1、顺序、前3项和原disclosure                                                 | 原红/绿与最终33组件在机器索引                         |
| CONT-02 恢复提前中止待消费外部结果 | 原MC06-R1的Tool恢复后变为aborted；先恢复durable owner、排除deferred父子，再清理其余Step与恢复Goal                                                               | 原Core45红；最终Recovery5 254/0与Core45 1475/43skip/0 |
| CONT-03 删除间隙后Task附加顺序错误 | 原append使用row count；原read按position排序。使用末个保留position+1，既有重复attach、claim与删除约束保持                                                        | 原SC04 0/1红；最终Task/Recovery与Core45绿             |
| CONT-04 快速Escape后modal残留      | Escape时焦点已在Drawer内；关闭位移到达后无transitionend，内部open和焦点未收尾。检查延迟callback的当前意图，无直属running/pending transform过渡时复用closeDrawer | 原17/2与原时序5/1红；最终Composer19通过               |

fact、hypothesis、inference、recommendation与源码SHA分别保存于机器索引。三个Server增强keeper的坏owner负控都真实失败，随后owner逐字节恢复：behavior缺失、非法operation ID被接受、legacy_child公共目标被接受均被原keeper捕获。两处Server品牌断言只改为canonical expected constructors，精确相等断言保持，原17项回放与仓库类型检查通过。

| 验证范围                 | 原始tally                                    | 执行收据                                                                                                                            |
| ------------------------ | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Core 45文件              | 1475 pass / 43 skip / 0 fail / 13684 expects | [continued-core45-final](/home/keer/.codex/outputs/2026-11-18/v2-pr-review/continued-core45-final.json)                             |
| Core 原4文件             | 460 pass / 0 fail / 2805 expects             | [continued-core-four-depth-final](/home/keer/.codex/outputs/2026-11-18/v2-pr-review/continued-core-four-depth-final.json)           |
| Core 本地录制HTTP        | 2 pass / 0 fail / 18 expects                 | [continued-core-recorded-replay](/home/keer/.codex/outputs/2026-11-18/v2-pr-review/continued-core-recorded-replay.json)             |
| Core Recovery/Task 5文件 | 254 pass / 0 fail / 2234 expects             | [continued-core-recovery-task-fixed](/home/keer/.codex/outputs/2026-11-18/v2-pr-review/continued-core-recovery-task-fixed.json)     |
| Schema 全51文件          | 487 pass / 0 fail / 1995 expects             | [continued-schema-green](/home/keer/.codex/outputs/2026-11-18/v2-pr-review/continued-schema-green.json)                             |
| 旧库与V1迁移             | 51 pass / 0 fail / 237 expects               | [continued-core-migrations](/home/keer/.codex/outputs/2026-11-18/v2-pr-review/continued-core-migrations.json)                       |
| Server 全51文件          | 253 pass / 1 skip / 0 fail / 10327 expects   | [continued-server51](/home/keer/.codex/outputs/2026-11-18/v2-pr-review/continued-server51.json)                                     |
| Server 三keeper增强      | 22 pass / 0 fail / 516 expects               | [continued-server-keeper-strengthened](/home/keer/.codex/outputs/2026-11-18/v2-pr-review/continued-server-keeper-strengthened.json) |
| Server 两品牌断言文件    | 17 pass / 0 fail / 307 expects               | [continued-server-brand-keepers](/home/keer/.codex/outputs/2026-11-18/v2-pr-review/continued-server-brand-keepers.json)             |
| App unit                 | 814 pass / 0 fail / 2394 expects             | [continued-app-unit-final](/home/keer/.codex/outputs/2026-11-18/v2-pr-review/continued-app-unit-final.json)                         |
| App browser              | 172 pass / 0 fail / 1827 expects             | [continued-app-browser-final](/home/keer/.codex/outputs/2026-11-18/v2-pr-review/continued-app-browser-final.json)                   |
| Session UI unit          | 256 pass / 0 fail / 684 expects              | [continued-session-ui-unit-final](/home/keer/.codex/outputs/2026-11-18/v2-pr-review/continued-session-ui-unit-final.json)           |
| Timeline/Tool components | 33 pass                                      | [continued-timeline-components](/home/keer/.codex/outputs/2026-11-18/v2-pr-review/continued-timeline-components.json)               |
| Composer components      | 19 pass                                      | [continued-composer-components-fixed](/home/keer/.codex/outputs/2026-11-18/v2-pr-review/continued-composer-components-fixed.json)   |
| 严格GUI lint             | exit 0                                       | [continued-lint-fixed](/home/keer/.codex/outputs/2026-11-18/v2-pr-review/continued-lint-fixed.json)                                 |
| 仓库check                | exit 0                                       | [continued-repository-check-fixed](/home/keer/.codex/outputs/2026-11-18/v2-pr-review/continued-repository-check-fixed.json)         |
| E2E类型                  | exit 0                                       | [continued-e2e-types-final](/home/keer/.codex/outputs/2026-11-18/v2-pr-review/continued-e2e-types-final.json)                       |
| 最终App构建              | exit 0                                       | [continued-app-final-build](/home/keer/.codex/outputs/2026-11-18/v2-pr-review/continued-app-final-build.json)                       |
| production Timeline几何  | 8 pass                                       | [continued-timeline-geometry](/home/keer/.codex/outputs/2026-11-18/v2-pr-review/continued-timeline-geometry.json)                   |
| 三目标流式场景           | 1 pass                                       | [continued-three-target-final](/home/keer/.codex/outputs/2026-11-18/v2-pr-review/continued-three-target-final.json)                 |

SC02与Custom Group恢复请求已完成离线验收，见[本轮接受](/home/keer/.codex/outputs/2026-11-18/v2-acceptance-continued/session-boundaries/root-acceptance.json)。原两个keeper补足自然read→下一请求→cancel→idle的唯一终态，以及真实asset Custom child在live Group成员修改后的同ID恢复请求/物理API断言。最终串行完整两文件为185 pass / 0 fail / 1632 expects，Core类型通过，接续lint为0 warning/0 error；两个负对照各1 fail且生产SHA恢复。前三轮fixture修正及短暂检查槽重叠保留原记录，重叠轮不授最终信用。77文件集合保持；当前358块由Git重新生成，两文件信用由当前SHA审读及新完整串行keeper授予。

SC03 首次触发合同已定案并验证：启用 recurrence 时首次和后续均按 cron＋时区，dueAt 用于一次性规则。原协议的“dueAt 或 recurrence”与绝对到期字段含义支持这项选择；下界方案需要另添起始时间语义。协议说明见[§7.2](/home/keer/workspace/aigcfroge-v2/docs/research/upstream-v2-sync/2026-11-13-meta-cross-mode-goal-schedule-closure-plan.md:334)，取舍与独立审读见[Root接受](/home/keer/.codex/outputs/2026-11-18/v2-acceptance-continued/sc03/root-acceptance.json)。原Schedule keeper补充独立固定时间、早到拒绝、dueAt修改、周期关闭/移除、重试与resume断言；Schedule三文件51 pass / 0 fail / 201 expects，恢复后单文件12 pass / 0 fail / 92 expects，Core类型检查exit0，定向lint为0 warning/0 error。首次覆盖与起始下界两个负对照分别3 fail和2 fail，原生产SHA已恢复。原Core45回执对应此前版本；当前Schedule测试文件的新SHA由这两轮新回执授予信用，SC03时点的原77文件/355块计数保持。

重叠回放分别记账。严格lint为234文件0诊断；canonical check为24/24类型任务成功、1140条全仓warning、0 error。历史557/187诊断和本轮空行/类型失败保持在原收据。

最终App使用原Vite/PWA配置向仓外独立目录构建。3643项UI/client输入哈希匹配，3395个产物文件及root依赖控制输入另有SHA清单；现有App dist保持。三目标前后使用相同320历史/160增量每目标、CPU30、CPU/visual profile关闭设置。Source完成观测为10,471.8ms和8,486.4ms，各一次样本；该对照不授予统计性能提升。隐藏目标的几何、paint和瞬时替换仍沿原缺口登记。主Source的采样未观察到row/markdown替换，场景中的额外执行请求为空。

原始历史证据继续保留本地文件、完整仓外归档、逐文件验证收据和审查索引；原始`docs/review/evidence/**`在相对HEAD的暂存差分中为0个文件。完整PR还排除了历史已提交证据2,296个文件，保存在独立c309来源归档，不能与原13,048文件暂存归档混同；逻辑路径、来源树、整包／成员SHA及本地取包入口见[交付说明](v2-pr-publication-2026-11-18.md)和[历史归档索引](v2-committed-evidence-index-2026-11-18.json)。Root自有baseline/final静态服务及Playwright Storybook已退出，18441/18606端口空闲。

当前剩余项由最终机器索引与`docs/technical-debt.md`逐项持有：真实模型验收暂停、中文fallback译文、隐藏目标附加读取/paint及其它既有候选。SC02的旧await边已被实际调用链与ACK keeper反证；不将其写成已确认死锁。SessionWire使用受控Response验证原HTTP framing，recorded使用本地Bun HTTP；两条证据分别记账。

当前358块与77项来源计账见[Root闭环](/home/keer/.codex/outputs/2026-11-18/v2-acceptance-continued/session-boundaries/root-77-closure-current.json)和[独立一致性](/home/keer/.codex/outputs/2026-11-18/v2-acceptance-continued/final-77-reconciliation/reconciliation-consistency.json)。原冻结审读输入中的双迁移14块/503行、Schema19块/1068行与Session219块/11049行均有完整读取范围和SHA；本次Schedule五个增量块另由SC03审读和新回执绑定。非空command evidence识别已复用原Core Goal keeper绑定到本次5文件254/0回执；其受控Bus producer不授予原生命令执行。AC23以受控SQLite文件副本升级为范围，安装版App数据库升级继续由Core Database / Desktop验收owner负责，以备份安装库、执行真实升级并核历史/ID/回滚/重复打开解除。

当前暂存对象、tree、numstat、源码与成稿SHA由仓外[最终暂存收据](/home/keer/.codex/outputs/2026-11-18/v2-acceptance-continued/session-boundaries/final-index-receipt.json)持有。历史原始证据未重新暂存；本轮不创建提交或远程变更。

默认工作区整合顺序：当前默认目录在main，保留9个tracked未提交文件；V2在v2-dev，继承本地upstream/v2且已提交历史关系为0/146。本地v2和origin/v2尚不存在，shallow历史未取得main/V2共同祖先。后续先形成可审阅V2提交并明确本项目V2主线，再保存默认WIP并按V2 owner移植需要保留的能力，最后让默认目录检出已接受V2主线；真实整合前重新核对主线历史与最新状态。当前只读核对见[工作区状态](/home/keer/.codex/outputs/2026-11-18/v2-acceptance-continued/session-boundaries/default-workspace-state-before.json)。
