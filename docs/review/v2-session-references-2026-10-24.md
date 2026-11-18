# V2 Session 快照反向引用检查点（2026-10-24）

实施目录 `/home/keer/workspace/aigcfroge-v2`，分支 `v2-dev`，接续点 `14401fbaaa`。本批接住上次中断留下的引用切片，完成独立复核、损坏 JSON 修复和本地交付。检查日志时间为 UTC；本报告日期使用 Asia/Shanghai。

## 已交付

现有 `GET /custom-composition/references` 保留 `profiles`，增加 `snapshots` 与 `snapshotsComplete`。查询覆盖六类冻结资产及全部 consumer bindings；目标删除、revision 改变、Session 移动、归档、child 或 fork 不改变冻结资产来源。每个 Session 返回一次摘要，Session ID 排序，不返回正文。

`CompositionReference.matches`（`packages/core/src/composition/reference.ts:26`）决定 kind + owner-relative path 身份，统一复用六个资产 owner validator。`paths`（`:32`）选择冻结依赖槽，`CustomProfile.referencesProfile`（`custom-profile.ts:153`）和 `SessionComposition.references`（`session/composition.ts:248`）复用该规则。没有资产根前缀别名，也不以任意指令正文中的字符串作为引用。

`CompositionResolver.freeze`（`composition-resolver.ts:709`）在新 JSON 快照内保存结构化 sourceLocation；copy/fork/child 原样继承，move 不重写。`sourceFor`（`session/composition.ts:278`）优先使用冻结来源，旧记录仅从保留的 Created/Forked 事实沿祖先恢复。无法恢复、损坏快照或 V1 Agent 路径信息不足时，保留有效结果并报告 snapshotsComplete=false；不推测当前位置或 Tool 字符串为来源。

独立复核发现 JSON 列在 Drizzle 整批解码时可能先失败，绕过逐行降级。`snapshotFields`（`session/composition.ts:23`）只在快照读边界选择原始 JSON；`decodeSnapshot`（`:133`）使用现有 Schema.fromJsonString 逐行解码，保留 typed SnapshotDecodeError，固定诊断不含正文。旧来源事件也在本边界逐行解码；未改变共享表或数据库全局 JSON 映射。真实原始 SQL 回归覆盖坏快照、坏 Created 和 Forked JSON。

方案对冲：本批复用既有 JSON 表和 owner，按次扫描快照；持久反向索引会增加写入、fork、删除和迁移的同步义务。当前按次扫描的技术债是成本随本地快照数量增长，以及 Profile watcher 与快照查询之间没有跨 owner 强一致事务。owner 与解除条件继续登记于 V2-D-REFERENCES；没有把读取切片当成全产品引用体系闭环。

## 验证

准确命令、cwd、退出码、源码和日志 SHA256、历史源码差异见 [verification.json](evidence/v2-session-references-2026-10-24/verification.json)。使用项目 Bun 1.4.2；重型检查按单包串行执行，Core 全包保留当前 UID 并隔离网络。

- Core 全包 references-core-full-closure：exit 0，7320 pass / 365 skip / 0 fail，364 文件。之后只格式化新测试文件；格式后的单文件为 8 pass / 0 fail。
- Server 全包 references-server-full-closure：exit 0，130 pass / 1 skip / 0 fail，35 文件；保留 MaxListenersExceededWarning。
- 坏 JSON 与相邻 owner 四文件：exit 0，71 pass / 0 fail。六类、binding-only、路径/修订、Location/workspaceID、move/archive/copy、历史 root/child/fork、未知来源、V1、坏 JSON、数据库重开均有回归。
- 真实 HTTP 回归纳入 Server 全包，覆盖 root/child/真实 fork、生产 move projector、目标删除、目录别名、鉴权、关闭 Custom 执行时读取、无 inbox/event/model 副作用。未用该 projector 测试冒充完整 move 执行验收。
- Protocol 全包：exit 0，10 pass / 0 fail；Core 和 Server 最终单包 typecheck exit 0。Protocol typecheck、Schema 全包 359 pass、Schema typecheck、Client 全包 224 pass 和 Client typecheck沿用本切片留存日志；这些包的输入未变。
- Protocol check:generated 与 Client 官方 generate exit 0。再次生成的两个客户端文件和 OpenAPI SHA256 均未变，见 generated-proof.json。
- 最终 Prettier、Effect ast-grep、git diff --check exit 0。13 个改动 TS 文件 oxlint 为 0 warning/error；当前该范围配置仅 1 条规则，使用 1 个线程。增量 lint 只筛 GUI，本批 0 文件，不作为 Core/Server lint 证据。

失败记录单独保留：最初类型品牌/服务图及 Layer fixture 失败；原 alias 导入命中静态规则，改为规范 Schema 命名空间后通过；新增测试首次格式检查失败，格式调整后通过。较早的成功日志与最终修复版本有差异，verification.json 明确列出，未以成功摘要覆盖失败。

独立 history_recent 子智能体审查了身份、来源、生命周期、HTTP 和最终 JSON 修复；初次发现上述缺口，修复后没有新阻塞。其他历史审查/下一切片子智能体多次遇到上游代理 HTTP 400 或流断开，主智能体已接管 12 个聊天及早期提示词读取，没有等待失败任务。

## 未交付

V2-D-REFERENCES 的 Session 快照读取子范围关闭；Workflow/Command/Plugin 的其他反向消费者、产品删除提示、watcher 强一致和规模性能仍开放。V2-C-WORKFLOW 的 runner/execution、生产执行/取消/重试/恢复及 UI，TaskPanel/Work 调度、外部 CLI/attended/review、AI 适配、其余 retained handlers、CI/发布和整体产品验收继续保留账本。

本批未运行 canonical 根 check、产品 E2E、Electron/PTY 或真实数据库升级；没有 push/PR/merge/release。历史旧快照来源缺失只报告不完整，没有修复用户数据。

## 提交核算

```sh
git log --oneline 14401fbaaa..HEAD
```

以下为代码提交后、报告提交前该命令的实际输出：

```text
9eb94dcd72 feat(core): expose frozen session references
```
