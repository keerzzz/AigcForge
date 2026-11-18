# MC10 正式实施任务：完整合并验收

2026-11-08 当前状态：**MC10 原六类合并验收已闭环，后继进入原 B06 新 Custom。** [Root 最终接受](/home/keer/.codex/outputs/2026-11-08/mc10-runtime-root-v2/root-final-acceptance.json)与[六类证据对应](/home/keer/.codex/outputs/2026-11-08/mc10-runtime-root-v2/six-category-closeout-map.md)确认旧数据与身份、恢复与生命周期、retain/events/ACK/通知、当前规模采样、同源 CLI/App/Desktop 和已选模式/Meta 合并消费者均满足本节退出条件。工程新增两条既有 keeper，最终 2/0/31；原 13 条定向检查、Core 类型、格式和 oxlint 通过，一项原有 AST 诊断保持。两份历史副本、六次新进程冷读与 packaged dev 产物均已签收。

本次真实 v2 用 25.583 秒完成：父3/child1共4请求全部完整HTTP200；P2响应保持后关闭Native1、定向结束原Source，再由Native2/同库Source2恢复P3。原child/Task各一次，P2/P3均消费同一707 code point完整Tool，resume_attempts从1回到0、claim释放；中文PTY、IPC暖写/冷读和同次清理通过。controller、两Native和gateway退出0，两Source确认结束，detached数字退出保持unknown。独立复审核原账本、wire、DB及codec通过。

v1配置目录/取消时序失败及其原User保留，v1模型0；本节累计模型4、Native3、Source3、gateway2、Codex0，见[实际计账](/home/keer/.codex/outputs/2026-11-08/mc10-runtime-root-v2/root-runtime-v2-accounting.json)。`MC10EngineeringAccepted=true`、`MC10RuntimeAccepted=true`、`MC10Complete=true`。后继先用现有B01映射核B04.0基础组合/来源/绑定/权限/版本/显式采用差额，再派发B06第一条真实用户链；原B/P/S1及未支持能力继续按唯一债务账本的owner与退出条件推进。

已删除原范围可逆工程的逐文件/逐命令重复审批；常规修复、定向验证和私有构建按已授范围直接完成。真实模型费用、故障进程身份及现用服务保护仍按实际边界执行。下方旧状态保留为历史时点记录。

2026-11-08，Root delegated decision。MC09 已按原完整范围闭环：[最终接受](/home/keer/.codex/outputs/2026-11-08/mc09-ui-closeout-root-v1/root-final-acceptance.json)，SHA256 `815dd247b35419a92203b0391495e56514e0f00640f1b43ec759761d2fa3873b`。Root 正式派发 MC10 工程调查、一致副本准备和必要既有 keeper；该实施主聊天拥有串行工程检查槽。

实际仓 `/home/keer/workspace/aigcfroge-v2`，默认 `/home/keer/workspace/aigcfroge` 只读。模型 `gpt-6.1-sol / max`。保留 `v2-dev`、HEAD `9e2c6577ef6dd65c8f01ff94d46da0142bcb877c`、全部 WIP/staging/文件模式。工程输出 `/home/keer/.codex/outputs/2026-11-08/mc10-engineering-v1`。

首读本仓 CLAUDE、AGENTS、ARCHITECTURE、docs/testing、受影响包规则，以及[完整派发提示词](/home/keer/.codex/outputs/2026-11-08/mc10-stage-a-v1/prompt.md)。原六类目标全部保留：旧数据与身份、多领域恢复/生命周期、retain/events/ACK/通知、当前规模 profiling、CLI/App/Desktop 同源产物，以及已确定模式/组合与 Meta 合并用户链。复用 MC01–MC09 既有接受；不把一条崩溃用例作为完整 MC10。

主智能体可并行安排最多三个独立调查子任务：旧数据/迁移与身份，恢复/retain/通知，规模/产物/模式消费者。各子任务先给实际剩余项、决定函数和现有证据；共享源码单文件单写者，测试/类型/生成/构建由主智能体串行调度。本聊天直接完成原六类范围内的必要常规修复、定向测试、类型与差额静态检查、私有 CLI/App/Desktop 构建，以及已选历史副本的零模型进程级采样。发现真实 RED 时定位决定函数、保留失败并最小修复，交 Root 审查实际差额和结果；不逐文件、逐命令等待再次授权。业务范围、权限或不可逆动作发生实质变化时回传具体冲突。

Root 已选定两个一致副本目标，允许在以下新私有路径准备；复制前核实源文件及 WAL/SHM，复用已有 byte-copy / sqlite3.backup 方式，原库不写，凭据内容不输出：

- MC03 历史 V2 Meta 主源 `/home/keer/task-backups/mc03-pub-b62e24236435/data/aigcfroge/mc01.db` → `/home/keer/.codex/outputs/2026-11-08/mc10-engineering-v1/old-data/mc03-historical-v2.db`；历史主文件 SHA `69040764c4f739bb2f3b035a5d1829320ecbcd8a438d6022c0a21033b07df1b2`，复制时重新核身份。
- MC08 R1 Task/Delegation 源 `/tmp/aigcfroge-mc08-r1-20261108-v1/data/aigcfroge/mc01.db` → `/home/keer/.codex/outputs/2026-11-08/mc10-engineering-v1/old-data/mc08-r1-history-v2.db`；使用已有一致 backup 方案。

两个目标均位于工程输出目录。Workflow 复用 MC08 W2 接受；不要求所有非空域聚合到同一个旧库。`Database.layer → DatabaseMigration.apply/applyOnly` 才是数据升级入口；Core migration 脚本用于源码生成。保留普通 pre-V2 102 Session/245 消息的既有接受，不将历史 V2 Meta 副本称作 pre-V2 非空 Meta。

恢复主线复用已选 `P1/C1/P2-held/P3`：私有 http.response 门保持已完整计费的 P2，结束本轮自有 Source 后冷 P3 消费原完整 Tool；不重新添加 settled→publish 瞬时间隙前置。此处仅授权工程准备，具体四请求、Source 两次启动及其余资源由 Root 在实际运行前绑定。完整真实运行包冻结不作为工程开始条件。

按第一性依据复用、删除、归并，再考虑新增。每项防御关联实际触发与证据；不因报告格式、无依据的字段期待或旧 WIP 全局诊断阻断原任务。新真实模型/Source/Native/gateway/Codex 启动预算当前均为 0。Git 写入、依赖升级及用户现用服务操作保持原授权边界。

交付现有证据与新实际差额、必要命令/cwd/exit、两副本身份、有限运行候选和剩余原任务。Root 继续真实运行预算绑定、独立结果复审与最终签收；按原六类实际退出条件完成 MC10。

2026-11-08 调度修订：用户再次指出过度防御。原逐文件/逐命令工程交接被用于已授权、可逆、无新增风险的测试、构建与采样，造成重复等待；现删除这项前置。影响仅 MC10 原六类工程调度，单文件单写者、串行重检查、已有 WIP 与原库保全继续执行。真实模型费用、故障进程身份和现用服务保护沿具体运行边界判定。验证采用实际类型/测试/构建/采样工件，不再增加工程准备的审批层。
