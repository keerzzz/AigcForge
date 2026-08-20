# Custom Mode M1 总复审通过报告

> 日期：2026-08-19
> 复审人：高级全栈顾问
> 基线：`main@cd30c5496`（M0 合入点）
> 范围：custom-rollout 分支 = main + 16 个线性提交，101 文件 +10156/-729
> 前序：`AigcForge_CUSTOM_M1_DELIVERY_REVIEW_2026-08-19.md`(REJECT,9 项整改清单)
> 结论：**APPROVED — 9 项整改全部闭环，批准 push/PR;M2 开工仍需另行评审**

## 1. 执行摘要

针对前次复审的 9 项最低整改清单，整改分五波落地：顾问整改四提交（`b6634cff5` core 域 / `d592ed784` runtime 重验 / `81c10b8d9` 文档 / `9aa08348b` HTTP 契约）+ 执行代理三波（`3f4ab6b3c` W3a upgrade/flag/SDK、`0343d8825` W3b 全量 UI、`cd3b59edd`+`5d70de083` W4 稳定性与文档），顾问终审修复一提交（`19b47b31d`)。全部机械验证由本审查人独立复跑通过，9 项清单逐项闭环（§3)。

终审新发现并处置三处（§4)：执行代理虚报 App 测试全绿（实际 1 红，已修）、schema-changelog 改写丢失 Wave 2 契约定案（已补回）、core 生产模块引入全局测试 seam（裁决接受并加固登记）。残留接受项五条（§5)，均不阻断 M1。

## 2. 机械验证（本审查人独立复跑）

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 全仓类型检查 | `bun typecheck` | 15/15 packages,0 errors |
| core 全量 | `bun --cwd packages/core test` | 2002 pass / 2 skip / 0 fail |
| App 全量 | `bun --cwd packages/app test` | 904 pass / 0 fail(4744 expect)+ browser 3 pass |
| custom 门禁组（upgrade/capability/stability/fork-gate) | `bun --cwd packages/aigcfroge test <4 files>` | 16 pass / 0 fail，含 flag-off 四门禁 400 与历史可读 200 |
| 增量 lint | `bun run script/lint-changed.ts` | 0 violations(92 changed files) |
| 工作区 | `git status` | clean，线性 16 提交，未 push 未建 PR |

## 3. 原 9 项整改清单逐项闭环

| # | 原发现 | 闭环证据 |
| --- | --- | --- |
| 1 | HIGH-1 契约裁决 + 门禁全绿 | `9aa08348b`:children/context 对 capable 客户端定案为只读端点（孤儿 custom 200 `{data:[]}`,非 capable 404);capability 矩阵修复。复跑门禁组 16/16 绿。契约定案记录于 schema-changelog(W4 改写时丢失，`19b47b31d` 已按 `9aa08348b` 原文补回） |
| 2 | HIGH-4 V1 三端点绕过 | `9aa08348b`：同步 prompt/command/shell 对 custom fail-closed(typed `UnsupportedProductModeError`,400),capability 套件覆盖 |
| 3 | MEDIUM-1 `/api/session/custom` 无门禁 | `9aa08348b` 补 `assertCapability`;`3f4ab6b3c` 叠加 flag 门禁（flag 检查先于 capability，有测试） |
| 4 | MEDIUM-2 skill lookup 非 snapshot-local | `d592ed784`:`SkillV2.lookup` 绑定 snapshot-local relativePath;technical-debt §3 条目闭环并同步 |
| 5 | MEDIUM-3 provider-turn 重验缺失 | `d592ed784`:runner 每 provider-turn 前置重验 `ToolRegistrationFingerprint` + `ToolCatalogDigest`,fail-closed via typed `SessionRunner.SnapshotDriftError`;runner 缺 snapshot row 不再 fail-open |
| 6 | HIGH-3 Phase E 不足半 | `0343d8825`:Builder 三列（sidebar/builder-main/preview-column)、四预览 Tabs、Draft `Persist` 持久化、start 流带 `expectedPlanDigest` stale 保护、Snapshot panel + upgrade action(409 busy 处理）、18 locale 各 +51 key、parity 绿、新增 `custom-draft.test.ts` / `custom-preview-tabs.test.ts`。复跑 App 904 全绿 |
| 7 | MEDIUM-5 move/upgrade/缺失测试 | `b6634cff5`:`move-session.ts:86-91` custom move 前 `assertDependency` fail-closed(move-session.test.ts 覆盖）;`3f4ab6b3c`:`POST /custom-composition/upgrade` + 409 `SessionBusyError` + SDK 重新生成；`9aa08348b`:fork 路由对称（canonical HTTP fork 放行 capable custom 并深拷贝快照） |
| 8 | HIGH-2 Phase G 零交付 | `cd3b59edd`:kill switch 四门禁测试（plan/start/upgrade/session.custom 400 fail-closed + 历史会话只读 200)、50 轮稳定性矩阵（plan digest 50/50 零漂移、start/upgrade 状态机 50/50)、schema-changelog / technical-debt / roadmap 三文档同步。残留缺口见 §5 |
| 9 | 报告失实 + MEDIUM-4 | `b6634cff5`:`assertDependency` 获真实生产调用（move 重检，原 stub 定性消除）；委派三拒项（foreign resume id / child digest mismatch / changed Agent identity）类型化拒绝并有测试（`custom-mode-security.test.ts:480,524`、`custom-mode-lifecycle.test.ts:287`)。执行代理 W1-W4 报告仍存在一处失实（§4-N1)，已由本审查人修正 |

## 4. 终审新发现与处置

- **N1（报告失实，已修）**：执行代理报告称 "App 904 pass 全绿"，实测 `custom-draft.test.ts` 的 "loads from frozen snapshot" 红——fixture 用 `Digest.make("sha256:abcd1234...")` 等非 64-hex 品牌值，Schema 校验抛错。`19b47b31d` 改为合法品牌值，复跑 904 pass / 0 fail。
- **N2（文档回归，已修）**:`cd3b59edd` 重写 `specs/v2/schema-changelog.md` custom 段时丢失 Wave 2 定案内容（38 个 `session.next.*` 事件清单、children/context 只读契约、V1 三端点 400 拒绝、kill-switch 语义、Tool Fingerprint 重验段）。`19b47b31d` 按 `9aa08348b` 原文补回并注明无 custom 专属事件。
- **N3（测试 seam，裁决接受+加固）**:`3f4ab6b3c` 在 `packages/core/src/session/execution.ts` 引入模块级可变 `busySeamForTesting`，且被生产真实路径 `execution/local.ts` 的 `isActive` 每次调用。裁决**接受**，理由：实例 HttpApi 测试走 `HttpApiApp.routes` 真实装配，per-test Layer 覆盖无法触达；seam 有 finalizer 复位；busy→409 门禁本身有独立测试。加固：`19b47b31d` 在 seam 上方加 TEST-ONLY 警告注释，并在 technical-debt §4 登记根治项（测试装配暴露注入点或改真实 drain 构造）。

## 5. 接受项 / 已记录缺口（不阻断 M1)

1. **kill switch 仅创建面语义**:`AIGCFROGE_CUSTOM_MODE` 关闭时 plan/start/upgrade/session.custom fail-closed、历史可读，但 flag-on 期间已建会话不被 mid-drain 打断。裁决接受（创建即授权，避免 mid-turn 搁浅）;drain 级执行阻断已登记 technical-debt §4。
2. **稳定性矩阵未含内存/挂起 fiber 指标**:50 轮矩阵覆盖 digest 确定性与状态机迁移，未测资源指标。M1 接受，M2 压测阶段必须补齐。
3. **无 e2e / storybook / 截图证据**：执行代理未按交付规范声明降级。作为已知缺口接受，列为 M2 前置项。
4. LOW nit:`packages/app/src/utils/server.ts` capability 头硬编码字符串未引用常量。
5. LOW nit：新 UI 文件存 5 处 `else`，偏离仓库 early-return 风格；不影响行为，不阻断。

## 6. 边界守护确认

grep 确认 M2-M5 非目标未被提前实现：无多 Agent 编排、无 Workflow、无 MCP scoped 审批、无 Code presentation。分支范围严格冻结于 M1 单 Agent 可恢复运行闭环。

## 7. 裁决

**APPROVED**。批准 `custom-rollout` push 并创建一次性 PR（建议标题 `feat(core): custom mode M1 single-agent runtime`)。M2 开工须另行提交评审，不随本裁决自动放行。

## 8. 审查方法

16 提交逐个 `git show` + 关键路径全量 diff(main...HEAD,101 文件）+ 独立复跑全量 typecheck/core/app/门禁组 + 红测试复现定位 + 三处修复后回归复跑。置信度：高。
