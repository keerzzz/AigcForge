# Custom Mode M0 Phase A 治理审批记录

> 日期：2026-08-18
> 分支：`custom-governance`
> 分析基线：`main@a4ffba0b3d22bae564f6616f0f84fe8ead8342fc`
> 审批方式：用户明确授权 AI 代理代行 Product / Core / App / Security / Schema+SDK 技术审批
> 结论：**批准 ADR-17 / Custom PRD 进入 M0/M1 实施；用户追加批准 M0 Phase A-F 连续执行，M0 完成后统一复审**

本记录是当前最终审批结论，覆盖并 supersede 同目录两份修复前的 `CUSTOM_GOVERNANCE_DIFFERENTIAL_REVIEW` / `CUSTOM_GOVERNANCE_REREVIEW` 历史结论；旧报告仅保留审查轨迹，不再代表当前 Gate 状态。

## 审批边界

本记录是用户授权的 AI 代理技术签字，不冒充五位真人领域负责人签字。批准对象是治理契约和 M0 实施准入，不代表生产运行时已经完成。

已批准：

- ADR-17 Accepted for M0/M1 implementation v1.2。
- Custom PRD Approved for M0/M1 implementation v1.2。
- M0 Phase A-F 在一个本地实施窗口内按顺序执行。
- 每个 slice 完成后执行 TDD、CLAUDE.md 改完即审和测试验证，验证全绿后自动继续，不设置中间审批点。

未批准：

- M1 及 M2-M5 实施。
- M0 中创建 Custom Session、Snapshot 表/migration、start/upgrade、Runner、Tool allowlist runtime、Custom UI。
- commit、push、远程 PR 或任何远程交付动作。

## 五方代签

| 领域         | 审批人           | 状态           | 日期       |
| ------------ | ---------------- | -------------- | ---------- |
| Product      | 用户授权 AI 代理 | 已批准（代签） | 2026-08-18 |
| Core         | 用户授权 AI 代理 | 已批准（代签） | 2026-08-18 |
| App          | 用户授权 AI 代理 | 已批准（代签） | 2026-08-18 |
| Security     | 用户授权 AI 代理 | 已批准（代签） | 2026-08-18 |
| Schema + SDK | 用户授权 AI 代理 | 已批准（代签） | 2026-08-18 |

详细决策项以 ADR-17 和 Custom PRD 的五方审批表为唯一真源。

## M0 执行流程

```text
Phase A -> Phase B -> Phase C -> Phase D -> Phase E -> Phase F
每个 slice：红 -> 绿 -> 重构 -> CLAUDE 复查 -> 测试验证 -> 小结 -> 自动继续
M0 完成：输出 M0 completion report -> 停机 -> 高级全栈顾问统一复审
```

M0 统一复审未通过时不得进入 M1。统一复审通过后仍需由用户确认 commit、push、PR 和 M1 开工。
