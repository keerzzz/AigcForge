# P0.2 Claude / 固定上游 V2 协议审批

日期：2026-10-25。结论：**批准 P0.2 普通 Coding 权限基线修复及其适用本地验证，允许进入 P0.3。** 由主智能体按用户本次明确委托完成审批；不再要求用户重复确认这项代理审批。

实施分支 `v2-dev`，HEAD `251c0fe38041a326e624db464d1ee0efd1522881`；上游固定为 `4617210822bdbb31e5749751afbfb4584ccedac8`。审批对象限于 [P0.2 检查点](v2-permission-p0.2-2026-10-25.md) 的五个产品文件与相关回归，未批准整体迁移、产品权限 UI、P0 完成、提交/推送/合并或发布切换。

## 协议依据与决定关系

Claude 的第一性原理、复用顺序、真实验证、关系决定函数、错误边界及未交付记账继续适用。固定上游 AGENTS、Session/Tools 规范及真实 Permission/SessionContext/Tool 源码已读取并保存，[来源与 SHA256](evidence/v2-permission-p0.2-2026-10-25/approval-protocol-sources.json) 指向固定 Git 对象，而非移动的远端引用。

- 上游 `Permission.evaluate/configured/evaluateInput` 的关系为配置最后匹配 → 配置 deny guard → saved → hook。当前 [evaluate:108](../../packages/core/src/permission.ts:108)、[configured:191](../../packages/core/src/permission.ts:191)、[evaluateInput:272](../../packages/core/src/permission.ts:272) 恢复普通 Coding、master=false 的该顺序，拒绝任一资源的配置 deny，不让 saved 或 hook 覆盖它。
- [compute:56](../../packages/core/src/permission/effective.ts:56) 的 ordered 分支不重放旧 Agent deny。上游工具的 captured execution 与每次调用权限检查继续由 [SessionContext.select:216](../../packages/core/src/session/context.ts:216)、[whollyDisabled:374](../../packages/core/src/tool.ts:374) 和原 registry/leaf 实现；没有新增权限映射、注册表或 runner。
- 无人值守 hook ask→deny 是已确认产品合同的增量，在 [evaluateInput:290](../../packages/core/src/permission.ts:290) 约束 hook 返回结果，不绕过 hook。Custom 冻结、显式 deny、master/档位、V1 包络仍作为已记录允许差异保留，不扩散为普通 Coding 的基线规则。
- 改动不涉及 inbox 准入、Step/Physical Attempt、Location 归属、Instructions 持久化、工具结果或 interruption 归属。没有重建第二执行循环，也没有改变公共 HTTP/Schema/生成合同。

## 验证与审批边界

主线重新核验了五文件 SHA256 与既有有效日志。可复用证据：14 文件 **176 pass / 0 fail / 839 expect**，Core 类型检查 exit 0，五文件定向 lint 0 warnings / 0 errors、exit 0。源码未变，按协议复用结果，不重复测试或累计早期绿测。有效红→绿、夹具/筛选错误、fixture 和未测范围见检查点；Core lint 当前仅一项规则，不称为全仓质量通过。

已完成的 `permission_review` 和 `permission_evidence` 独立复审继续有效，输入五文件哈希未变。新增 `p02_protocol_approval` 因代理 HTTP 400 失败，未计作通过；本次固定协议核对由主线完成。[审批记录](evidence/v2-permission-p0.2-2026-10-25/protocol-approval.json) 保存批准时的源码/日志身份。

AUDIT-V2-PERMISSION 的产品展示、master/档位/Scoped Grant/Break-glass 真实 UI 验收，以及 AUDIT-V2-CODING-PARITY 的增量目录仍开放。P0.2 本地基线可进入下一节，尚未切片提交。P0.3 按现行计划恢复真实内置 CLI/构建闭包；独立发布、真实 Electron/native PTY/旧库与最终切换仍按各自条件验收。
