# Custom Mode M0 Phase A 整改复审报告

> 日期：2026-08-18
> 分支：`custom-governance`
> 基线：`main@a4ffba0b3d22bae564f6616f0f84fe8ead8342fc`
> 前轮报告：[AigcForge_CUSTOM_GOVERNANCE_DIFFERENTIAL_REVIEW_2026-08-18.md](AigcForge_CUSTOM_GOVERNANCE_DIFFERENTIAL_REVIEW_2026-08-18.md)
> 结论：**CHANGES REQUESTED - 不批准进入五方签字，不批准 Phase B**

## 1. 整改状态

| 前轮 finding                              | 状态               | 证据                                                                                           |
| ----------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------- |
| PRD Gate 循环依赖                         | 已关闭             | PRD §17.1 实施准入与 §17.2 Rollout Exit 已拆分，50 次基线不再阻塞 Phase B                      |
| Tool materialize / fingerprint 不一致     | 部分关闭           | options object 和字段已同步，但 aggregate catalog digest 仍被错误建模为单工具 fingerprint 字段 |
| Profile Schema / Agent config Schema 混写 | 已关闭             | `CustomProfile` 独立 Schema 与 `ConfigAgent.Info` 边界已写明                                   |
| schema changelog 缺失                     | 已关闭但引入新冲突 | 已增加 Proposed/Not Implemented 预告，但内容与总计划契约不一致                                 |
| 四方/五方 owner 不一致                    | 已关闭             | 总计划、Roadmap、ADR/PRD 均使用五方口径                                                        |
| 无关表格格式化                            | 未关闭             | `ARCHITECTURE.md`、ADR-15、technical debt 仍有大段 mechanical formatting                       |

## 2. 新增阻断发现

### P1：ADR-17 被重复插入并损坏 Markdown 结构

**证据**：

- `docs/architecture/adr/ADR-17-custom-mode-composition-platform.md:85-130` 已包含完整 Snapshot、核心裁决和 Resolver 章节。
- `:134` 使用错误的四反引号围栏 ` ````text `。
- `:141` 出现损坏文本 `````ion_snapshot` 数据表：``，随后从 `:143-183` 再次重复 Snapshot、核心裁决和 Resolver。
- `:187-194` 又出现第二份数据流，并以四反引号关闭。

**影响**：ADR 的核心真源重复且部分落入错误代码块。Markdown formatter 仍可通过，但读者和智能体会看到两套重叠内容，后续引用行号、章节和实现边界均不可靠。

**整改**：保留唯一一份 `2.4 -> 2.5 -> 3`，数据流使用一对标准 ` ```text ` 围栏；删除 `:141-194` 的重复/损坏内容。修复后重新通读整份 ADR，不只运行 Prettier。

### P1：schema changelog 与总计划定义了不同的 Snapshot/API 契约

**证据**：

- Changelog `specs/v2/schema-changelog.md:20` 定义 `id PK + session_id UNIQUE + profile_id + snapshot_json + fingerprint_digest + created_at`。
- 总计划 `docs/plan/custom-mode-composition-platform-implementation.md:274-283` 定义 `session_id PK + version + digest + profile_path + profile_revision + data + time_created`。
- Changelog `:24` 指定 `unsupported_mode` 为 HTTP 400；总计划 `:369` 建议 typed `UnsupportedProductMode` HTTP 409。
- Changelog `:25` 发明 `/custom-composition/profiles` CRUD；总计划 `:499-506` 使用 `/custom-profile`、`/content`、`/apply`、`/delete` 与独立 composition endpoints。
- Changelog `:31` 发明 `custom.composition.created.1` / `custom.profile.updated.1` 事件；总计划尚未批准这些 event names。
- Changelog `:9` 将 ProductMode target 写为 `packages/schema/src/session.ts`，当前 owner 与总计划均指向 `packages/schema/src/product-mode.ts`。
- Changelog `:15` 将 composition target 合并为 `custom-composition.ts`，总计划 `:233-240` 明确拆为 `custom-profile.ts` 和 `composition.ts`。

**影响**：Phase B 的执行智能体无法判断哪个表、路径、状态码、endpoint 和 schema owner 是真源。PR 0 预告不得创造一套与已审批计划竞争的新接口。

**整改**：changelog 只引用总计划已确定的目标，不自行发明字段、路由、状态码或事件名。尚未定案的事件和 HTTP status 标成 `TBD in Phase B contract review`。Snapshot 表、Schema 文件和 API 路径必须逐字对齐总计划，或先修改总计划并完成五方复审。

### P1：实际审批模板不是用户提交的统一详细模板

**证据**：

- ADR-17 `:461-469` 和 PRD `:398-406` 仍是上一轮的简略单行模板。
- Product 行没有“PRD Gate 拆分”；Security 行没有明确五字段/Provider Turn 重验；Schema+SDK 行没有 `ToolRegistry.materialize(...)`。
- 用户提交的编号审批项没有落入仓库，因此 ADR 与 PRD 不能被称为“正式对齐并固化”。

**整改**：将用户给出的五方编号模板逐项写入 ADR-17 与 Custom PRD，或定义一个唯一审批记录文档并由两者引用。不要维护两份内容不同的模板。

### P1：stable fingerprint 层级仍与总计划不一致

总计划 `:449-451` 将单工具 fingerprint（placement、name、规范化 definition/schema digest、InstallationVersion）和 aggregate catalog digest 分开保存。整改稿把 `aggregateCatalogDigest` 作为每个 Native-tool Fingerprint 的第五字段，造成每个工具 identity 依赖整个目录，任何无关工具变化都会让所有工具 identity 漂移。

**整改**：

- `ToolRegistrationFingerprint`：placement、name、normalized definition/schema digest、installationVersion。
- `ToolCatalogDigest`：对当前 effective registration set 单独计算和存储。
- Provider Turn 前同时重验 selected tool fingerprints 与 catalog digest；定义 drift 分类和 fail-closed 行为。

## 3. 仍需处理的非阻断项

### P3：mechanical formatting 仍未清理

`git diff -w --stat main` 仍显示 22 文件 `+316/-121` 的语义差异，但普通 diff 为 `+444/-249`，说明仍有较多格式噪音。它不单独阻塞五方签字，但必须在 PR 描述中明确，最好在提交前缩小。

## 4. 已通过检查

```text
git diff --check main                                      PASS
之前复跑的 Prettier / check-refs / lint-changed           PASS
生产代码                                                   0 files changed
```

Prettier 通过不能发现 ADR-17 的四反引号与重复内容，因此需要增加人工结构检查或 Markdown AST/lint 检查。

## 5. 审批结论

- **不批准进入五方签字**：签字对象当前仍包含损坏 ADR 和冲突契约。
- **不批准 G0-A / Phase B**。
- **不批准 commit、push、PR**。
- 修复 4 个 P1 后重新复审；复审无阻断后，本审查人最多批准“治理包可提交五方签字”，不能代替五个领域 owner 的真实签名。

## 6. 审查方法

- 覆盖：22/22 份整改文件，重点核查前轮 6 项 finding。
- 方法：完整 diff、`git diff -w`、契约交叉对照、章节重复/围栏扫描、独立机械验证结果复核。
- 置信度：高。
