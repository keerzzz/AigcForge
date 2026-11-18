# P2.2N Workflow 声明资产 GUI 检查点

2026-10-28，Asia/Shanghai。工作区 `/home/keer/workspace/aigcfroge-v2`，分支 `v2-dev`，起点 `d8769398cacc19a4684a5b16e8e69fff27041489`，固定上游 `4617210822bdbb31e5749751afbfb4584ccedac8`。本片交付 Workflow 声明审阅与保存；后端沿用已提交的 P2.2M。

## 行为与复用决定

既有 Session 新增 Workflow 页签、命令、header/窄屏入口及恢复预载。用户可审阅完整原 YAML，取消、确认保存，遇到 409 时读取当前声明，再明确确认覆盖。当前和保存后视图展示 version、triggers、全部 steps。界面说明保存不会执行 steps、启动 triggers 或创建子 Session，已有运行使用冻结定义。

[read](../../packages/gui-extensions/src/skill-proposals/proposal.ts:149) 从真实完成工具名确定 `assetKind`，七类资产经 Ready 传递身份。合法 Workflow `Review.plugin` 的路径为 `Review.plugin.yaml`；旧 Plugin 形状判断已删除。[current](../../packages/gui-extensions/src/skill-proposals/proposal.ts:326) 决定目标路径、invalid、同名冲突及 Summary/Info revision、name、description 的一致性；[applied](../../packages/gui-extensions/src/skill-proposals/proposal.ts:391) 按相同族别核验路径、名称、描述和原文。Workflow 使用 canonical JSON codec，不另写 YAML 解析或图验证。

[保存分派](../../packages/gui-extensions/src/skill-proposals/panel.tsx:256) 和冲突读取采用穷尽 Effect Match，保留候选类型收窄、AbortSignal 与 await 后的 live 守卫。[sameScope](../../packages/gui-extensions/src/skill-proposals/panel.tsx:806) 保留 Session、visit、Location、client/data 和连接身份的失效规则。Prompt 插入调用已同步传完整 Ready。Workflow 保存不刷新 native Skill、不发送草稿，也不请求 Workflow/Composition 执行。

[WorkflowDeclaration](../../packages/gui-extensions/src/skill-proposals/panel.tsx:749) 复用既有 dl/dt/dd/pre 与面板样式，显示完整 StepDef 和独立原文。三个纯测试 DOM 属性已删除；测试通过真实 Version、Triggers、Steps 标签的相邻内容定位。renderer 仍使用既有 lazy panel 与 idle/restored preload，宿主未增加专属分支。

方案对比：本片选择扩展现有 owner 的显式分派，复用 canonical Schema、生成客户端、确认/CAS 状态机和 keeper。没有足够消费者证明需要另建跨资产框架。保留的技术债是多处资产族分派需同步维护，已登记账本。

## 验证记账

[验证 manifest](evidence/v2-workflow-gui-2026-10-28/validation-manifest.json) 自动记录命令、cwd、退出码、日志哈希、源码哈希、实际 tally 及与最终源码的差异。验证副本为 `/home/keer/task-backups/v2-agent-backend-validation-20261027`，最终候选树 `39b0a4a94d9180cfa6938484736ada1d261b70fa`；十个源码/测试文件与主工作区逐字节一致。固定 Bun 1.4.2；所有检查由 root 包内串行执行。

| 检查                          | 实测结果及适用版本                                                                                         |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------- |
| GUI 全包                      | 258 pass / 1 skip / 0 fail；991 expects；33 文件。最终记录 `gui-tests-dom-final`。                         |
| GUI / E2E 类型                | `gui-types-dom-final` / `e2e-types-dom-final` 各 exit 0，绑定最终源码。                                    |
| 侧栏 keeper                   | `side-panels-final`：35 passed，workers 1 / retries 0，153.93s；含新增 Workflow 四项及已有 Prompt 等回归。 |
| 增量 lint / AST / 格式 / diff | 最终记录各 exit 0；lint 检查 9 个 TS/TSX，AST 检查 5 个生产 TS/TSX，格式覆盖 10 文件。                     |
| 普通 App 构建                 | `app-plain-build` exit 0；3156 文件，只有 index.html，无三个 fixture HTML。                                |
| 普通产物真实链                | `real-chain-ready`：1 pass / 0 fail / 121 expects；2 primary / 0 title。                                   |
| SDK 文档                      | exit 0；155 declarations、645 members、191 parameters、15 guide blocks，0 problems。后续仅删除 DOM 属性。  |

以下是本片较早版本的真实通过结果，未冒充最终源码全包复验：App unit 742 pass / 0 fail / 2232 expects（107 文件），browser 168 pass / 0 fail / 1778 expects（38 文件）；host/graph 25 passed。这两轮早于最终 Effect Match 分派及 DOM 属性删除。App `tsgo -b` 在 Match 后通过，随后仅删除 DOM 属性；E2E 类型、GUI 类型和受影响侧栏流程已在最终源码复验。既有 WSL skip、AST binary resolution warning 与构建 chunk/Sentry 警告保留，不计作错误消失。

早期失败分别保留：错误 wrapper 参数次序仅输出帮助，exit 0 也不算测试；真实 parser red 在旧实现得到 68 pass / 5 fail / 338 expects，新增五项全红。首轮类型发现 Prompt 调用遗漏及五处测试 canonical/generated 类型不匹配，修正未放宽生产类型。lint 的 35 处空行与两处链式分派已修复。各轮数字不累计。

## 真实链与性能

[真实链摘要](evidence/v2-workflow-gui-2026-10-28/real-chain-summary.json) 绑定普通构建的全部产物 hashes。真实 GUI 发一次 prompt，runner 将 proposal input/facts 存入 SQLite；取消零写入，确认保存完整 BOM/CRLF 原 YAML。受控另一客户端修改 version、description、timeoutSeconds 后，旧 proposal 收到 409；界面读取完整当前声明，再经单次明确确认以新 revision 恢复原文。原 proposal 和未提交草稿保留。

每个阶段读取真实 WorkflowRunTable、WorkflowStepRunTable 与 SessionTable：无 run/step rows，只有原 Session。新增 LLM 请求只属于创建提案的两次调用，保存未提交草稿。此链使用 bounded TestLLM，不证明实际 provider、Workflow 执行/恢复、Composition 产品选择或 packaged Desktop。

首轮真实链在提交前失败，0 pass / 1 fail / 15 expects，未发 prompt POST，primaryCalls=0。trace 的 after@call@29 显示 “Select an agent and model”；[currentSelection](../../packages/app/src/composer/submit.ts:316) 在模型/agent 未就绪时拒绝提交。harness 改为等待真实模型标签、草稿和发送按钮，再按一次 Enter；未增加超时或重试动作。原失败及后续成功各自归档，见 run-notes.json 和 real-chain-failed-archive.json。

成功归档 `/home/keer/task-backups/v2-workflow-plain-real-chain-20261028T011347Z`，4225 文件逐个复制回读；598 源码与 3156 服务产物运行前后不变，完整产物 map 匹配普通 build。归档 manifest SHA256：`192d6c0c9b67fc73084f78bf43d59f499afa29756001d2b0d24cc8657309f000`。截图包含宽屏原文审阅、600px 暗色键盘替换及真实链各阶段；完整中文长注释换行，替换/取消按钮可达。未作自动化对比度或最大文件 GUI 性能验收。

前后各三路、每路五个 fixture-enabled production-build 样本均通过。稳定时间 median：cold Session 897.9→858.2ms；Home→new 501.7→468.2ms；Session→new 206.9→154.7ms。仅描述样本，不能归因或宣称无性能回归；P6 保留配对 profiling 与平台验证。原样本见 [performance-summary.json](evidence/v2-workflow-gui-2026-10-28/performance-summary.json)。

## 独立复审、剩余范围与现场

[独立复审](evidence/v2-workflow-gui-2026-10-28/independent-review.md) 由未编写本片实现的子智能体完成，绑定最终十文件及真实链 harness hashes。其发现的 Prompt 调用遗漏、结构化 Info 断言盲点、文案漂移及纯测试属性均修复；最终运行证据由其核对。

唯一账本仍为 `docs/technical-debt.md`。默认 Project/显式 global 落盘、导入编辑/引用删除、Workflow 运行/取消/恢复/通知 UI、组合选择、controller-generation/Location 移动专项、冷恢复/外部 provider/Desktop/跨平台与 P6 均保留 owner 和解除条件。保存成功不等于这些范围已验收。

用户于 2026-10-28 明确 Project 各 worktree／clone 独立，使用当前工作副本根；[裁决记录](evidence/v2-workflow-gui-2026-10-28/project-placement-decision.json) 与[下一片预检](evidence/v2-workflow-gui-2026-10-28/next-placement-preflight.md) 已更新。该语义用于下一片，不将本片 Location-only 保存改称 Project/global 已完成。

本片保护 64 个既有 tracked WIP hashes。技术债工作文件保留全部既有字节，只追加本片；提交账本使用 HEAD 加本片 appendix 的独立 blob。限定范围本地提交已获授权；不 push、merge、发布或重启用户服务。
