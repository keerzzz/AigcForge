# B1 执行提示词重写与连续执行规则澄清

> 日期：2026-09-30
> 状态：APPROVED_EXECUTION_CLARIFICATION（仅执行流程澄清；不是 S00/B1 验收通过）
> 当前入口：[M4 式连续执行提示词](/home/keer/workspace/aigcfroge/docs/plan/agent-interaction-ui-execution-prompt.md)

## 1. 用户请求与改写依据

用户指出执行者反复停止询问，并要求按 [M4 提示词](/media/win_data/aigcfroge/docs/plan/prompt-todo-task-m4.md) 的逻辑重写。采用其认知加载、明确范围、复用资产、TDD Step 连续推进、数据流和里程碑结束审批结构；参考文本不是新任务授权，不继承其中的 M4 业务、旧分支、旧兼容要求、逐 Step commit 或历史绿灯。

此前提示词的缺口由主审承担：泛化“遇到歧义就停”、未明确首次创建与续跑、未把工作树依赖初始化写成可自行完成的准备步骤。执行报告把“已记录待执行”称为完成也不符合证据标准；本次纠正流程，不追认那些完成声明。

## 2. 不变与澄清

不变：R2 设计/测试范围、单版本无兼容、本地 main 起点、B1=S00+S01、批末审批、禁止自动提交/发布/清库/搬移用户工作。原计划和原审批/历史证据文件保持不动。

澄清：

- 当前有效 worktree 与 agent-ui-tdd 已创建，核验身份后续跑；不再因同名分支存在而重复请求创建许可。
- B1 内可自行完成锁定依赖初始化、真实 C、代码/测试/生成与适用验证；Step 完成直接继续。只有 B1 完成或具体需要额外决策的真实阻断才交回。
- S00 不改生产行为不等于不能安装开发依赖/运行基线。允许在实施 checkout 执行 `HUSKY=0 bun install --frozen-lockfile`；不修改锁文件、不全局安装、不提权、不复制另一分支 node_modules。
- 当前 package.json 的 prepare=husky 会配置共享 Git hooks；已核对现有 Husky 的 HUSKY=0 安装保护，因此该环境值仅限安装命令，避免修改共享 Git 配置，不代表豁免产品质量门禁。既有 postinstall 的 node-pty 处理仅调整依赖目录 helper 权限；不以忽略全部 scripts 代替完整准备。
- 只属于后续批次的 E4 依赖记录 X；本批必需 C/E3/benchmark 等门禁仍必须满足，不能降低验收或自切范围。

## 3. 实测根因与现状

主审已在 `/home/keer/workspace/aigcfroge-agent-ui-tdd-impl` 运行三组既有测试，关闭 Bun 自动安装：Core、App、TUI 均退出 1，分别缺少 drizzle-orm/工作区模块、happy-dom 注册模块、opentui preload。四处 node_modules 均不存在，属于依赖准备缺口，不是三套业务功能分别出错。原始命令与输出见 [持久化基线证据](/home/keer/workspace/aigcfroge/docs/review/agent-interaction-ui-s00-baseline-2026-09-30.json)。

主审未安装依赖、未改生产源码，测试前后 Git status 一致。**S00 仍未验收通过**；下一步由执行者初始化依赖后重新验证，不再重复仅有基线元数据的完成模板。

## 4. 版本绑定

```text
planSha256: 23ee8ddcc012a76fe72540ccbda0e5178cd2130c4e3c0db4daa8151dcee657c5
mainBaseCommit: 260e8275b9b0af9d0b445e5acfb6f4d3545eac7b
previousExecutionPromptSha256: 9f324efa019244e5004a236b9fee7f94b749538cc87013c11aa50a93f24318c5
executionPromptSha256: 5ec8c81e250226c9cfef90998dfe112c7a64e82600d34c86ce515b2b8121c345
implementationRoot: /home/keer/workspace/aigcfroge-agent-ui-tdd-impl
implementationBranch: agent-ui-tdd
firstAuthorizedBatch: B1 = S00 + S01
S00Acceptance: NOT_PASSED
B2Authorization: NOT_GRANTED
```

原审批校验 JSON 中的提示词哈希属于重写前版本，保留为历史记录；本节绑定当前执行提示词，不改写历史证据。R2 哈希完全不变，任何业务/架构实质变更仍需另审。
