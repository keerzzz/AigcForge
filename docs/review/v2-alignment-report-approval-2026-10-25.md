# V2 完整调研报告复审与计划审批

日期：2026-10-25。结论：**报告经修正后通过，可作为现行实施计划依据；不批准产品问题已修复、整体迁移完成或发布切换。** 用户授权范围是复审报告、修改实施计划、生成新会话提示词，本轮未实施产品代码。

对象：[完整报告](v2-alignment-report-2026-10-25.md)。现行路线：[2026-10-25 实施计划](../research/upstream-v2-sync/2026-10-25-v2-alignment-execution-plan.md)。交接：[新会话提示词](v2-alignment-next-session-prompt-2026-10-25.md)。

## 协议与复审方法

已读取旧产品 CLAUDE.md 和目标 V2 AGENTS，按第一性原理、复用→删除→归并→重构→新增、真实验证、关系决定函数与未交付登记审查。旧协议参考可从同仓 `1a6b238d7bb73916c933d5c4715326d376a34805:CLAUDE.md` 恢复；目标当前运行合同按用户明确 V2 基准目标与 V2 规范核对，不以文档时点混用作实现依据。

首组三个长历史子任务均因代理 HTTP 400 失败，未计作完成。重新派出的 report_fact_review、remaining_scope_review、command_handoff_review 使用短任务完成只读复审；主线核对决定函数、证据与真实脚本，并在交付前检查修正文档。子任务没有产品文件修改或测试/构建。

## 复审发现与处理

1. **快照口径**：29 项含源码/测试、锁文件、文档、package.json、openapi.json；统一改称混合快照，补 [逐文件 SHA256](evidence/v2-alignment-review-2026-10-25/pause-snapshot-recheck.json)。它不是完整 WIP 备份。
2. **恢复前提**：补充旧库存在可折叠 EventTable 历史，能重建 internal participant/childSessionID/delivery。只有投影行不足以进入该风险路径。恢复 fiber 失败仍是有条件源码推导，本轮未实测。
3. **依赖方向**：分别写模块运行依赖、HTTP 消费与 compile(ClientApi) 生成关系。Client 不导入 Server/Core。
4. **协议时点**：补充旧 exact retry 与当前 first-admission-wins、旧自动恢复约束与当前 claimed Session 恢复、当前 Instructions；记录基准与合并目标的区别。明确人类要求有冲突时先登记并询问该项。
5. **权限 hook**：反例补 savedApprovals=[] 与 hook 不改判前提；compute 输出和快照分歧是静态证明，最终准入仍经 plugin hook。
6. **账本关联**：删除不存在的 V2-C-TASK 总 ID，映射现有 Task 子项；把 AUDIT 范围合入 canonical 账本，新增旧产品能力盘点范围，保留已关闭子范围。
7. **可执行交接**：明确 pinned Bun、Core test wrapper、Protocol 无 test、App e2e 独立类型检查、lint:changed 的 GUI 范围和 Client 生成检查的写入边界。原失败夹具依赖 cwd/eval，不能直接执行仓外路径。

最终交叉复审：report_fact_review 的实质证据修正通过，快照时点文字已落盘；command_handoff_review 的脚本/WIP/基准检查通过；范围复审的续跑曾因 HTTP 400 失败，未计作通过，重新派出的 final_scope_check 已确认范围与关闭状态通过。

上述修正不改变总体结论：保留已对齐 V2 基座与现有领域执行适配，停止旧文件回植路线，先修共用兼容与桌面闭包，再按真实用户链迁移。

## 审批边界与验证

- 保留既有 Task、Custom、Command、Workflow、Delegation 和分享已验证子范围；历史报告批准只对其当时范围/版本有效。
- codegen 历史本日单包 99 pass / 0 fail 与最小引用诊断 exit 1 分开保留，[运行记录](evidence/v2-alignment-review-2026-10-25/codegen-existing-tests.json) 和 [失败记录](evidence/v2-alignment-review-2026-10-25/codegen-reference-diagnostic.json) 已入仓镜像。日志不是本次文档复审新运行。
- 本轮文档改动不需要重跑产品测试或根 check。验证为：文档链接/精确行、账本与计划覆盖、旧计划 superseded、新提示词入口/命令一致、定向 git diff --check、受保护现有非文档文件 SHA256 与暂存区检查。
- 当前工作区保留原产品 WIP；没有切分支、提交、推送、合并、安装、服务重启或发布动作。新会话须完整备份 WIP 后开始 P0。

本报告的实现问题、配置/恢复边界、真实桌面、旧库与性能范围继续开放。审批通过意味着文档可执行，后续代码与产品仍按切片独立验收。
