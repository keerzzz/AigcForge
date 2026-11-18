# P2.2R Command Project/global GUI 限定检查点

日期：2026-10-28。实施仓 `/home/keer/workspace/aigcfroge-v2`，分支 `v2-dev`；参考仓保持只读。基线为 `52e9848df27d9279324aba9a1a77c909571eb100`。本片承接 P2.2Q 后端，单一计划仍为 [next-gui-implementation-plan.md](evidence/v2-command-placement-backend-2026-10-28/next-gui-implementation-plan.md)。

## 行为与边界

Command 新提案默认当前 worktree/clone 的 Project，持久完整 canonical Inspection。用户显式选择 global，每次保存确认前重新 inspect。历史没有自有 target 的五 facts 仍按 Location 审阅；畸形自有 target 不回退。原 source、invocation 和 args 的缺失/空串区别保留，旧 API 的省略语义不变。

实现复用既有 TargetReview、请求 token 和 keyed 生命周期。CAS 的 list/content 和保存回包须属于本次审阅目标；删除使用当前 saved Info 的 target/revision。目标相等由 [sameTarget](/home/keer/workspace/aigcfroge-v2/packages/gui-extensions/src/skill-proposals/proposal.ts:576) 和服务端 [targetMismatch](/home/keer/workspace/aigcfroge-v2/packages/core/src/asset-placement.ts:74) 的 scope/root 比较决定。相同 revision 不替代 owner 身份。异步归属由 [sameScope](/home/keer/workspace/aigcfroge-v2/packages/gui-extensions/src/skill-proposals/panel.tsx:972) 决定；取消观察不代表撤销已发送的文件写入。

没有新增状态仓库、混合资产目录、别名或自动执行流程；contract.ts、panel.css、App 生产 owner、Schema/Protocol/Client 生成物保持本片基线。九个源码/测试文件的最终 SHA 见 [final-source-pins.json](evidence/v2-command-placement-gui-2026-10-28/final-source-pins.json)。

## 已执行验证

所有检查由 root 在隔离验证仓串行运行。固定 Bun 为仓库 `script/bun`；测试在所属包目录，类型走包脚本及资源限制。每轮退出码、实际命令、cwd、日志 SHA、该轮源码 pins 与最终字节差异见 [verification-summary.json](evidence/v2-command-placement-gui-2026-10-28/verification-summary.json)。原始日志与完整本地逐轮快照保留；不把不同轮次合计为额外测试覆盖。

| 执行面                                          | 实际结果                                                                |
| ----------------------------------------------- | ----------------------------------------------------------------------- |
| Server Command keeper                           | 15 pass / 0 fail / 704 expects                                          |
| Core 资产、迁移、命令和 Composition 相关 keeper | 156 pass / 0 fail / 1173 expects，7 个文件                              |
| Client 整包                                     | 229 pass / 0 fail / 968 expects                                         |
| GUI 整包（含最终 parser）                       | 372 pass / 1 既有 skip / 0 fail / 1349 expects                          |
| App unit / browser                              | 分别 742 pass / 0 fail / 2232 expects；168 pass / 0 fail / 1778 expects |
| 最终七族侧栏                                    | 69 passed，workers=1、retries=0                                         |
| 宿主组件与扩展图                                | 25 passed，retries=0                                                    |
| Core、GUI、Server、App、App E2E 类型            | exit 0；E2E 类型后仅补两处空行，有机械等价记录                          |
| scoped lint / lint:changed                      | 0 warnings、0 errors；实际 7 个 changed code files，0 problems          |
| AST / Prettier / diff --check                   | exit 0；AST 工具的 postinstall 提示单独保留                             |
| 普通 App 构建                                   | exit 0，3156 个最终产物；已有 chunk/timing 提示保留，不作性能无回归承诺 |

GUI 跳过项为既有 WSL inline-script 测试。类型检查与旧轮次的空白差异由 gui-spacing-repair.json、e2e-spacing-repair.json 记录；最终 side-panels、构建与真实链均绑定最终九文件字节。

## 真实普通 GUI 链

light 与 dark 各 1 pass / 0 fail，launcher `verified=true`、`chainCompleted=true`，源码和被服务的产物均未变化。使用普通 App 构建、真实认证 TCP router、SQLite、文件系统、原生 watcher 和有限 TestLLM。归档见 [light](evidence/v2-command-placement-gui-2026-10-28/real-chain-light-artifacts/launcher-result.json)、[dark](evidence/v2-command-placement-gui-2026-10-28/real-chain-dark-artifacts/launcher-result.json) 与 [产物 hashes](evidence/v2-command-placement-gui-2026-10-28/production-artifact-hashes.json)。

每路均完成：

1. 真实 Session owner 准备已有 Chat；普通路由、实际模型控件和 composer 自然就绪。浏览器只 seed server/locale/theme，没有注入 Session、metadata、ready 或手工 prepare。
2. 普通 composer 生成两个同 name/description、不同 source 的真实提案，两个持久 target 初始都为 Project。第二页通过可见 Global 控件显式改选。
3. Project/global 各取消一次保存后确认；两次 GUI apply 的完整候选、target、磁盘 codec bytes 与 revision 精确匹配。两页分别保留有效 saved 卡，取消删除后再各确认一次，合计四次 GUI 写删。
4. 每次写删前安装两个实际 Location 的 Command.Updated listener，验证仍存活 watcher 的根、directory/workspace 和 ignore，单次写入后要求真实 changedPath。每路记录四阶段、八个对应原生事件；没有探针写入、手动 reload 或重试写催发现。
5. 原 Session 通过实际注册名称三次调用普通 composer command，HTTP 204，分别消费 Project、仍为 Project、删除 Project 后 global 的精确新 user 正文。只比较本次新 input 和最后模型请求的最后 user；不是从历史搜索已经存在的 source。
6. 主 checkout 同名 sentinel 始终未变；删除 Project 不改变 global bytes，删除 global 后两个 Location 的原生名称消失。最后直接 TCP command 404 仅是独立后端负例，不冒充 GUI 删除。
7. live 图及 watcher 释放后，用同 SQLite 建新图，完整读回原 Session、五个 completed input、两份 metadata、全部历史和删除状态；模型调用仍为 7 primary / 0 title。只证明同进程冷图回读，不称进程崩溃恢复。

原生遮蔽由 [Config.load](/home/keer/workspace/aigcfroge-v2/packages/core/src/config.ts:230) 的来源顺序、[ConfigCommandPlugin](/home/keer/workspace/aigcfroge-v2/packages/core/src/config/plugin/command.ts:73) 的注册顺序和 [Command editor.add](/home/keer/workspace/aigcfroge-v2/packages/core/src/command.ts:61) 的 Map.set 决定。本链排除了更高优先级的同名显式来源。面板的名称/description 就绪提示仍只说明名称存在；正文赢家另由上述真实消费证明。

root 实际查看了两主题的窄屏目标/长 source 与删除确认截图，结果及限制见 [visual-review.json](evidence/v2-command-placement-gui-2026-10-28/visual-review.json)。

## 红证据与修正

- Server 旧版 13 pass / 2 fail：旧 proposer 产生五 facts、并进入 legacy migration。改用 canonical Inspection 与 inspect(project) 后，同 keeper 15 pass。
- Parser 旧版 171 pass / 24 fail：target 解析、Inspection 和 owner 校验缺口。扩现有族别分派后初绿 195 pass；最终整包 keeper 继续包含这些断言。
- UI 旧版三条失败：Project 按钮缺失、初始 root 未显示、target_mismatch 未重检。第二条当时未执行到后续迟到回复，不能称全部 race 有红证据；最终完整 69 项均执行通过。
- 自然入口首次因夹具模型预期缺 default variant 而失败，修正后真实 prompt 200、completed input、两次 primary 请求成功，再在旧 metadata 缺 target 处有效红。
- 独立审查在实跑前发现 Session-owned prompt/command 被夹具错误要求 Location query。仅修 harness：Session 接口要求无 query 并回读原归属；asset 接口继续精确核目录。
- GUI 类型首轮的 Skill test 对联合 candidate 未收窄；补 assetKind 守卫，保留原正文断言。Lint 34→2→0 分轮留证，没有把带 warning 的 exit 0 当作过关。

## 未交付范围与下一步

本片关闭 Command 所选目标的提案、确认保存、普通删除与实际正文消费子范围。U4 并非完整关闭：incompatible 真实 provider 路径未接通；已执行的组合也不是全部请求与全部 owner 变更的笛卡尔积。目标变化覆盖全部列出的异步阶段；换卡/Session/server/卸载为 held apply，断连重连为 held inspect。剩余组合及解除条件已写入唯一 [technical-debt.md](/home/keer/workspace/aigcfroge-v2/docs/technical-debt.md)，不以宿主通用测试补足专项结论。

其余五族 placement、引用感知删除/编辑/导入、Custom/Workflow 用户链、模式创建 UI、外部 provider、packaged Desktop、跨平台、完整无障碍、进程崩溃恢复和性能归因仍保留各自 owner。下一片先推进 Prompt selected-owner 后端，再同步 proposer 与精确插入 GUI；不由 placement 自动扩大成跨 owner 引用或新的删除产品流程。

原 64 项 tracked WIP 的字节备份及 pins 保留；唯一账本只在原 WIP 前缀后追加本片结果。限定提交只收本片九文件、账本基线加 appendix 和明确证据。独立审查见 [independent-review.md](evidence/v2-command-placement-gui-2026-10-28/independent-review.md)。提交列表仅由提交后的 `git log --oneline <base>..HEAD` 生成，见 local-commit.json；未 push、merge 或部署。
