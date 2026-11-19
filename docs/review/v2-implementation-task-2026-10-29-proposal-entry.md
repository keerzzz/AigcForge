# P2.2T / S1：候选入口归入 V2 共用会话侧栏

状态：**源码已交付冻结，真实窄屏验收失败，尚未关闭**。五文件交付见 `/home/keer/task-backups/v2-s1-sol-20261029-igokfx6y/handoff.json`；共享 Panel 身份修复的[补充任务](v2-implementation-task-2026-10-29-mobile-panel-identity.md)待独立审查后派发。以下为原 S1 实施范围及历史记录，不构成当前继续写入权。

调度更新：原实施对话 `01a17c6a-ea92-72e3-92db-9cc773732f15` 连续三次模型HTTP400后已确认failed/systemError，S1写入授权撤回。当前仅替代对话 `01a185ee-a3c9-7912-b3cb-5b3a4b3e5179` 可在正式开工消息后实施，见[当前实施者记录](v2-implementation-owner-2026-10-29.json)。旧fixture交付仍有效，技术范围不扩大。

最新调度覆盖上一段：替代对话也已确认HTTP400终止，允许文件无任何变化，其写入授权同样撤回。为继续已授权任务，当前唯一实施者改为主会话的 `/root/global_ui_status` 子智能体，具体以[实施者记录](v2-implementation-owner-2026-10-29.json)为准。两个App对话保留历史并停止写入，技术范围和所有验证门禁不变。route_review承担后续独立差异复审，主会话仍负责桌面验收。

最终交接：用户随后明确指定新关联对话使用gpt-6.1-sol/max。新对话 `01a185f9-7b3d-7e71-ad41-cd3fcb9b3b88` 已正常完成只读核对；主调度在无S1源码改动、无测试作业时中断原实施子智能体，现将唯一S1写入权转交该新对话。原子智能体恢复只读底栏调查。所有技术范围和验收要求不变，以[实施者记录](v2-implementation-owner-2026-10-29.json)为准。

依据：[唯一现行计划 §0](../research/upstream-v2-sync/2026-10-25-v2-alignment-execution-plan.md)、[统一底座架构记录](../research/upstream-v2-sync/2026-10-29-shared-foundation-decision.md)、默认 CLAUDE 协议及目标包规则。当前实施对话 `01a185f9-7b3d-7e71-ad41-cd3fcb9b3b88`；规划与最终验收对话 `01a1850f-5d8a-70a3-98e7-c22e4346e8e0`。

## 目的与用户行为

Session 详情标题没有任何资产入口。用户从既有右侧面板的“+”菜单选择七类候选面板；已有桌面命令和移动端面板菜单继续原接线。候选审阅、确认/取消、保存、插入和显式发送继续原业务链，不能因入口移动新增写操作或自动发送。

本节是共享GUI接入的纵切，不交付资产管理中心。Home、模式工作区、全局导航与底栏由主会话继续调研，本实施方不得扩项。

## 现场与只写范围

- 仅 `/home/keer/workspace/aigcfroge-v2`、`v2-dev`、HEAD `9e2c6577ef6dd65c8f01ff94d46da0142bcb877c`；固定上游 `4617210822bdbb31e5749751afbfb4584ccedac8`。
- 默认工作区只读。既有大量 WIP、DB五文件、fixture两文件与所有历史证据保留。
- 允许修改生产：`packages/gui-extensions/src/skill-proposals/renderer.tsx`。
- 允许修改已有 E2E：`packages/app/e2e/regression/side-panels.spec.ts`、`session-header.spec.ts`。
- `packages/app/e2e/regression/timeline-stream.spec.ts` 仅允许撤销主对话先前两处未提交几何测量调整，恢复 HEAD 的原始断言；禁止阈值/viewport/动画生产代码调整。原差异仅位于约1143与1344行，先保存差异后精准还原。
- 如现有utils没有合适的共用打开面板操作，允许一个 `packages/app/e2e/utils/side-panel.ts`：仅组合真实 Toggle review / 侧栏“+” / 菜单动作，复用既有fixture，不加入生产测试接缝。先报告复用候选。
- 任何其它文件需求先回报主调度，不自行修改。禁止改生产CSS/Session/Timeline/Shell/Routes/SDK/Core/Schema/权限、生成文件、锁文件、计划、账本和DB；不提交、不推送、不进入下一节。

## 已查接线与实施约束

1. `skill-proposals/renderer.tsx` 已集中注册七类 Command/Panel/mobile；删除它对 `session.header` 的全部资产 Slot，移除因此无用的 Button/Slot import。
2. 使用现有 SDK `MenuItem`，`menu: "session.panel"`。参考 Coding file extension `file/renderer.tsx:368` 和 browser extension 的可用性登记；宿主 `app/src/runtime/extension/side-region.tsx:72` 汇集并排序，AddMenu 调用现有 run。
3. 每个菜单动作通过既有 `ctx.sessions` / `ctx.screen` / `ctx.layout.open` 到现有 Panel；不发明缓存、selection owner或第三方菜单。`SessionPanelMenuItem`没有enabled字段：用已有响应式 `ctx.add(MenuItem, () => ...)` 在当前session/screen不可用时返回undefined，参考browser renderer；动作执行时重新读取当前Session，不保留旧菜单闭包身份。保持七个已有Panel ID、DOM contract、Command ID、i18n文案和mobile声明。
4. 七类共用登记可以使用文件内已有模式或必要的有限描述表，但不引入跨包万能资产框架、平行注册器或新的运行态。全部挂载、切换、恢复仍由V2宿主处理。
5. 普通模式不得被编码成Coding-only。不得从项目名、导航模式或草稿状态推断已有Session身份；不得将当前Session候选当成项目/系统资产库存。
6. 保留lazy panel加载、当前session/Location/data/client归属检查、迟到结果失效、取消不写、保存CAS、插入只更新指定composer等既有合同。生产panel/parser/request/事务均不在本节修改范围。

## 实施前证据

- 已完成的fixture两文件：timeline.ts SHA `006b4cf8678a91584192f6a67bfbcb0230ef3ef52f5b9c293cd67410ff37d15a`；fixture.test.ts SHA `8ad8e56359580c8d9bab56f161b5377a2f1eb0b5642c489e762dde61ba593d69`。本节不再改它们。
- 原几何调整未被认可为等价断言。恢复原断言后再跑；若入口修复后仍失败，保存失败与源码交回，不通过换测量坐标、裁剪Range或放宽数值掩盖。
- 主对话已在生产构建执行3次40 history/40 delta/CPU1/minimal基准，记录在 `/home/keer/task-backups/shared-foundation-review-20261029/benchmark-before.json`；after由主对话执行。

## 测试与质量门禁

先读 `packages/gui-extensions/AGENTS.md`、`packages/app/AGENTS.md`、`packages/app/e2e/AGENTS.md`、`packages/app/e2e/performance/AGENTS.md` 与官方Playwright best practices/actionability/assertions；源级grep不代替用户行为测试。

- 新增或扩展已有keeper证明：标题区域无七类资产按钮；同一侧栏菜单可逐项打开七类面板；开启/关闭/再次选择没有重复tab；切换Session正确归属。用已有参数表与fixture复用，不复制测试实现。
- 迁移 side-panels keeper 的旧标题按钮操作到真实公共入口。保持原确认/取消、缺失/错误、保存/插入、迟到响应、跨Session/server、卸载/重连等断言。不得删除原业务断言来减少失败。
- 窄屏继续走原mobile panel菜单；至少保留原窄屏候选链；不要让桌面helper用于隐藏的SideRegion。
- 已有窄屏Command经layout.open可能错误选择本扩展首个Panel，属于静态发现、尚未实测的host独立范围，已登记账本。本节不宣称七类窄屏Command正确，也不为它修改host或删命令；原mobile菜单逐Panel选择是本节要求的窄屏路径。
- 先用旧renderer得到新增“无标题资产入口”用例的红证，再恢复实现跑绿；保存红/绿源码hash和结果，不能在旧实现根本未执行用例时声称红测。
- 串行运行：GUI相关单元测试（仅受影响范围），GUI typecheck，App typecheck与typecheck:e2e，side-panels与session-header keeper，恢复原断言后的timeline-stream keeper和既有geometry keeper；真实extension host/graph component suite按包规则运行。没有变化的后端无需全包重跑。
- 所有执行使用 `/home/keer/workspace/aigcfroge-v2/script/bun`，包cwd，workers=1、retries=0。Playwright可管理独立临时测试webserver（建议3297；组件按既有3294），不得操作验收5173/3084/9222或默认服务。不与主对话构建/性能运行重叠，开跑前交接时间窗。
- 对修改文件执行Prettier check与原 `script/lint-changed.ts 9e2c6577ef`；触碰文件整文件无未解释告警。禁止关闭规则、重命名类型或断言绕过。

## 交付与根会话桌面验收

交付文件diff、基准HEAD、逐文件SHA、命令/cwd/exit、原始失败与最终日志路径、未完成范围；冻结源码后停止。不得将多轮数字相加作为一次全绿。辅助方的包级检查不代表本节桌面验收通过。

主会话验收：打开隔离Electron，确认当前server/session/mode与DeepSeek Flash；标题无资产入口；桌面侧栏菜单七类可达；真实对话产生Prompt候选后取消/确认/保存/插入/显式发送，核对真实回复；切Session与回Home再返回不串候选；检查长标题、子Session标题与窄屏移动入口。复用既有测试项目和显式命名资产，不触及用户原始数据库。对照同条件生产基准并保存产物/源码身份。

遇到范围外失败，回报根因与最小需要范围，不自动扩写。真实桌面失败退回本节修复；通过后由主调度更新现有账本并下发下一节。
