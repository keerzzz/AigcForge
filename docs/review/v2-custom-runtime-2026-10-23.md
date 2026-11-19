# V2 Custom 运行消费与生命周期检查点（2026-10-23）

本批接住 `2c2b5f9081` 后中断的工作区，实施固定在 `/home/keer/workspace/aigcfroge-v2`、`v2-dev`。主参考仓的 `desktop-session-nav` 由其他任务维护。本批只做本地实现、验证和可恢复提交。

## 已实现行为与决定函数

- `SessionContext.select` / `load`（`packages/core/src/session/context.ts:149` / `:274`）按冻结消费者选择 Agent、Prompt、Skill 与工具。普通 Session 保留 live 选择；Custom 根必须为 meta，子 Session 必须为明确冻结 executor。身份规则由 `SessionComposition.selectSessionAgent`（`session/composition.ts:482`）决定。
- `CompositionCatalog.frozenSkills`（`skill/composition-catalog.ts:12`）从冻结正文构建 Skill catalog；ID 冲突由同函数判定。显式 Skill、prompt 附件和 Skill Tool 共用该选择。缺正文、binding 或冻结 executor 拒绝运行。
- `SessionRunner.runStep` 将冻结 Agent system 与 request body/headers 传给 `SessionModelRequest.prepare`；generate、compaction、title 的请求传递也已接线。AISDK 的 async request context 隔离同一 cached model 的每次 body overlay。
- `CompositionDigest.validateCurrentTools`（`composition/digest.ts:150`）决定当前注册与冻结捕获的关系；`SessionContext.select` 在权限裁剪前后校验 catalog，并比较同一 Tool state revision。CodeMode namespace guidance 已进入 fingerprint，MCP binding 使用既有 connection facts 和 leaf Permission。capability 沿用用户裁决，仅声明，不新增映射。
- `PermissionEffective.compute`（`permission/effective.ts:52`）区分 Agent fallback 与 Session override，保留 Session 的 last-match 顺序；`Permission.configured` 从快照读取 Custom Agent。只读白名单、审批、无人值守 ceiling 沿用现有 owner。
- `Session.startCustom`（`session.ts:392`）以 Created publication 的 commit 插入快照，同一个 Bus/Drizzle 事务完成 Session、event、snapshot。exact retry 的决定函数为 `retryCustom`（`:356`），同 ID 与冻结 input digest 采用首次结果；不同 digest 拒绝，不重新解析被删除 Profile。`upgradeCustom`（`:549`）每次建立独立 root，事务内重验普通 source 是否存在、移动或 busy。
- Custom child create 与 fork 在 publication commit 复制冻结快照；继承关系由 `adoptCustom`（`session.ts:337`）比较规范化 snapshot 内容。普通 Session ID 复用继续采用首次身份。HTTP upgrade 的归属由 `CustomCompositionHandler` 中 `locationRefForRoute` 规范化后比较，支持存量 `/.` 目录。
- Task/Subagent/Delegation 真实执行使用冻结池，工具点和 child 准入继续双层校验。未新增执行管理器，仍用 SessionExecution/Job。
- 运行开关检查覆盖 prompt、selection、fork/move/create/upgrade、runner 边界及低层 resume/wake。冷启动 `prepareResume`（`session/execution/restart.ts:85`）在计数或发布前跳过关闭的 Custom；pending background 检查父子 mode；`SessionStore.releaseChildClaims` 保留被关闭 Custom 的 child claim；Delegation recovery 在 settle/cancel/release 前退出。重新开启后沿用原预算和记录。
- HTTP Web/Node 审批测试夹具补齐真实冻结身份，验证能力客户端断连后注销应答者。移动态测试等待现有 `awaitIdle`，不以准入返回推断完成。
- Protocol/OpenAPI 与 Client 均通过官方生成器更新，生成客户端未手工编辑。

## 验证范围

每个命令的 cwd、argv、exit、日志哈希和运行时源码哈希保存在 [verification.json](evidence/v2-custom-runtime-2026-10-23/verification.json)。所有测试从单包目录运行，重型测试和类型检查按包调度；使用项目 `script/bun` 固定 Bun 1.4.2。Core/Client 全包使用隔离 network namespace 与 loopback。

已完成的单包结果：

- Core `core-full-slice-final`：exit 0，7299 pass / 365 skip / 0 fail。此命令早于最终低层 resume/wake guard 与 AISDK MutableJson 小改动；其后真实四文件回归 `core-coordinator-entry-green` exit 0，109 pass，AISDK 二文件 `aisdk-mutable-schema-green` exit 0，69 pass。最终全包 `core-full-checkpoint` exit 0：7299 pass / 365 skip / 0 fail，涵盖最终源码；不能将定向 tally 相加。
- Server `server-full-slice-green`：exit 0，128 pass / 1 skip / 0 fail。最终低层入口修改后的 `server-entry-regressions` exit 0，18 pass，实际执行两个存在的文件；命令另两个文件路径不存在，不计覆盖。保留 `MaxListenersExceededWarning`。
- Schema 全包：exit 0，359 pass / 0 fail。
- Client 全包：exit 0，224 pass / 0 fail。
- Plugin 全包：exit 0，9 pass / 0 fail。
- Core、Server、Schema、Protocol、Client、Plugin 分别 typecheck exit 0（以各 final 记录及源码哈希为准）。
- Protocol `check:generated` exit 0；Client 再次生成比较 11 个 tracked generated 文件，0 变化。
- Prettier 覆盖 83 个改动 TS/JSON；后续变更再做针对性 check。改动文件 oxlint 82 文件、0 warnings / 0 errors；该仓配置此范围仅启用 1 条规则，不能称全面 lint。Effect ast-grep 专项通过。
- `lint:changed` 只覆盖 GUI，本批输出空筛选；不把它当 Core/Server lint 证据。`git diff --check` exit 0。canonical 根 `check` 未运行。

## 失败记录与根因

历史失败和本批失败均保留原日志，不由最终通过覆盖：

- Core fixture 缺 Session/Composition/Plugin hold 依赖、生命周期 fixture 共享状态、非法 Custom Agent 先持久化、Skill 顺序断言、Optimize 入口；按 owner 与装配根修复，后续定向及全包覆盖。
- HTTP atomic 观测缺 Bus context、Custom 开关未显式开启、目录等价拼写以及路径品牌断言。真实 HTTP 最终通过。
- 冷恢复新增测试将 Bus.log Stream 当 Effect，随后缺少异步 resume readiness；分别改 Stream.runCollect 与 Deferred。保留两次 68 pass / 1 fail。
- Server 全包曾 126 pass / 1 skip / 2 fail，两个 transport 共享只改 mode 的 Custom fixture、缺 snapshot。修复完整冻结身份后 4 项定向与全包通过；过程中未声明的 drizzle import 与私有 global service lookup 也有失败日志。
- Effect 扫描命中 AISDK JSON.parse cast。用既有 Schema decoder 与 MutableJson 替换；第一次 immutable Json 类型不匹配，随后 typecheck 与 69 项测试通过。
- resume/wake 提前查询暴露移动测试未等结算，85 pass / 1 fail，独立单测也复现。用 SessionExecution.awaitIdle 观察真实移动后四文件 109 pass。
- 格式首轮 4 文件未通过，修复后 check 通过。

## 未交付及方案对冲

Owner 均为主智能体，解除条件已同步 [技术债账本](../technical-debt.md)：

- Command 已冻结 identity/source，但 `SessionCommand.execute` 仍走 live Command registry。下一切片按 M2 稳定指令模板合同，复用 ConfigCommand 的纯参数替换、按 consumer binding 准入；不能借用 live execute 闭包或隐式 shell interpolation。此范围未交付，明确登记 `V2-D-COMMAND`。
- Workflow、外部 CLI、attended/review/revision、TaskPanel/Work 调度、其他 reverse consumers 和产品 Custom UI 仍开放。
- 选用既有 Tool state identity 保证请求装配的两次捕获一致，未新增全 registry 事务。技术债：producer 闭包、raw Schema producer、Skill 资源文件和 ambient MCP/Web 并未不可变归档；运行时 leaf Permission 继续承担执行裁决。
- Profile watcher 与跨 owner capture 不具备强原子一致性；installationVersion 是 host build version，未证明独立 Plugin provenance。
- 未验证全产品 E2E、Electron 冷启动/PTY、真实外部 MCP/CLI、生产库或存量数据库副本升级。未推送、创建 PR、合并或发布。

## 提交核算

代码检查点由命令生成（范围固定到源码提交）：

```sh
git log --oneline 2c2b5f90818c77d8e20bf9426677cc8f473d96c1..5cba410d886f448467f38639b8d8dd4ef19bad2d
```

```text
5cba410d88 feat(core): consume frozen custom sessions
```
