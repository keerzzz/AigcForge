# P2.2T Prompt Project/global GUI 限定检查点

日期：2026-10-28（UTC；本节跨北京时间 10 月 28–29 日）。实施仓 `/home/keer/workspace/aigcfroge-v2`，分支 `v2-dev`；参考仓只读。基线 `28b73ea65ddc5f19b61550b999f65d7cc22c9ee8`，固定上游 `4617210822bdbb31e5749751afbfb4584ccedac8`。范围和 11 个源码/测试文件见 [scope](evidence/v2-prompt-placement-gui-2026-10-28/scope.md) 与 [files](evidence/v2-prompt-placement-gui-2026-10-28/files.json)。

## 已交付行为与决定函数

新 Prompt proposer 使用 canonical Inspection，默认当前 worktree/clone 的 Project；各副本独立，global 必须显式选择。历史无 target 提案保留 Location 审阅。GUI 复用 TargetReview，每次确认前重新 inspect；保存带 target，冲突 list/content 带 scope。没有新增资产注册表、Prompt GUI 删除或模板展开。正式 Client 沿用前片生成字节，32 个冻结边界保持原 pin。

目标相等由 [sameTarget](/home/keer/workspace/aigcfroge-v2/packages/gui-extensions/src/skill-proposals/proposal.ts:595) 的 scope/root 比较决定，同 revision 不代表同 owner。[applied](/home/keer/workspace/aigcfroge-v2/packages/gui-extensions/src/skill-proposals/proposal.ts:481) 将保存和回读各自与固定 proposal 的完整候选及 target 比较；[insert](/home/keer/workspace/aigcfroge-v2/packages/gui-extensions/src/skill-proposals/panel.tsx:591) 用 saved Info 的 path/scope 发 GET，再比较 saved revision。两次 applied 与同一个 target 的关系提供 owner 一致性，没有声称存在另一条 saved/current 显式 target 比较。

[sameScope](/home/keer/workspace/aigcfroge-v2/packages/gui-extensions/src/skill-proposals/panel.tsx:990) 比较 Session、visit、route/Location/workspace、client/data、连接及兼容状态；keyed owner 与 AbortController 使迟到回复失效。实际覆盖组合和未覆盖范围分列于账本。

真实测试暴露共享编辑器两条路径：active 重建后被 collapse(false) 移到文末；inactive 重建后普通 focus 使后续键入落到文首。现在 [renderComposerEditor](/home/keer/workspace/aigcfroge-v2/packages/app/src/composer/editor/editor.tsx:433) 复用 setCursorPosition；失焦重建只留一次恢复标记，在现有 [onFocus](/home/keer/workspace/aigcfroge-v2/packages/app/src/composer/editor/editor.tsx:305) 同步读取持久 cursor。原 [addText](/home/keer/workspace/aigcfroge-v2/packages/app/src/composer/editor/actions.ts:62) 本来已正确推进 cursor，未改动。没有新 RAF、主动抢焦点或 Prompt 专用编辑器。

## 命令验证

root 独占隔离仓，使用固定 Bun 1.4.2 串行执行。测试均在包 cwd；类型走包脚本与资源限制。原始命令、cwd、退出码、tally、日志 SHA 和各轮相对最终源码的差异见 [validation-manifest](evidence/v2-prompt-placement-gui-2026-10-28/validation-manifest.json)。实际执行权威为前后工作字节；sourceTree 只是较早的普通 index reference。

| 执行面 | 机械提取原始结果（不累计重跑） | 日志 label |
| --- | --- | --- |
| Core 相关 8 文件（Core 生产最终字节） |  212 pass;  0 fail;  1687 expect() calls; Ran 212 tests across 8 files. [10.79s] | `core-related` |
| Server 全包（后续仅测试期望/格式变化） |  192 pass;  1 skip;  0 fail;  8991 expect() calls; Ran 193 tests across 44 files. [115.43s] | `server-full` |
| Server Prompt 最终测试 |  11 pass;  0 fail;  346 expect() calls; Ran 11 tests across 1 file. [13.17s] | `server-proposer-final` |
| GUI 全包最终测试 |  423 pass;  1 skip;  0 fail;  1505 expect() calls; Ran 424 tests across 33 files. [1.80s] | `gui-tests-final` |
| App unit 与 browser 最终测试 |  742 pass;  0 fail;  2232 expect() calls; Ran 742 tests across 107 files. [3.33s];  168 pass;  0 fail;  1778 expect() calls; Ran 168 tests across 38 files. [5.53s] | `app-tests-final` |
| 七族侧栏、composer、mobile focus 最终回归 | [WebServer] Found 2 warnings while optimizing generated CSS:;   107 passed (5.1m) | `side-composer-closed` |
| Host/graph（光标修复前，非最终光标证据） |   25 passed (1.2m) | `host-graph` |
| Core 类型（Core 生产最终字节） | exit 0 | `core-types` |
| Server 类型 | exit 0 | `server-types-formatted` |
| GUI 类型 | exit 0 | `gui-types-final` |
| App 类型 | exit 0 | `app-types-final` |
| App E2E 类型 | exit 0 | `app-e2e-types-final` |
| 11 文件 scoped lint | Found 0 warnings and 0 errors. | `lint-clean-final` |
| GUI lint:changed，显式本片基线 | lint:changed: 0 problem(s) in 0 of 9 changed files since 28b73ea65d | `lint-changed-final` |
| 11 文件 AST | exit 0 | `ast-clean-final` |
| 11 文件格式 | All matched files use Prettier code style! | `format-clean-final` |
| 限定 diff --check | exit 0 | `diff-clean-final` |
| SDK 文档 | sdk-docs: 155 declarations, 645 members and 191 parameters documented in 10 files; 15 guide blocks match their source; 0 problem(s) | `sdk-docs-final` |
| 普通 App 最终构建 | Found 2 warnings while optimizing generated CSS: | `app-build-final` |
| 真实 GUI light/worktree |  1 pass;  0 fail | `real-chain-light-final` |
| 真实 GUI dark/clone |  1 pass;  0 fail | `real-chain-dark-final` |

Server 的 hg skip、GUI 的 WSL skip 为各自既有跳过。Server 监听器、Vite 配置/构建以及 AST binary fallback 等环境警告保留，未声明全轮无警告。Server 全包后仅测试 canonical 期望与格式变化，最终 Prompt keeper 和 Server 类型已复验。Core 生产未再变化，因此保留已有相关测试与类型结果；Host/graph 是较早字节，最终光标证据是 active/inactive keeper、107 项回归、App 测试及两条真实链。

## 普通 GUI 真链与视觉

最终普通 App 的 3156 个文件经 manifest 固定，light/linked worktree 与 dark/independent clone 各 1 pass / 0 fail；源码、harness、served artifacts 前后一致，bodyStatus=completed 且 stage=chain-completed。原始归档见 [chain-evidence-manifest](evidence/v2-prompt-placement-gui-2026-10-28/chain-evidence-manifest.json)。

每路均由普通已有 Chat 产生两个真实提案，分别取消再确认 Project/global 保存。两份实际文件 bytes/SHA 相同而 owner 不同；主 checkout 与 child/peer Location 哨兵不变。普通附件入口实际上传、键盘 file mention、中间光标和插入后键入均通过；服务器收到的字节、预期及磁盘文件一致。Chromium/CDP 未提供 Blob 请求体时 Playwright 值保留 null，证据明确记录服务器 Request.clone 观察来源。

每路 28 组零发送动作的 GUI POST、Session input/inbox、primary/auxiliary/total 及完成流前后相等。只有两次提案和两次显式发送增加用户输入：最终 4 GUI POST、4 input、6 primary、0 auxiliary、6 total/6 completed。两次显式发送逐字核对新 user 和最后模型请求的新 user 正文、附件及 mention 偏移；占位符保持字面内容。另一个 Location 服务改写 global revision 后，原 saved 卡拒绝插入并保持草稿。释放 GUI/TCP/Location 后同 SQLite 新图回读 4 input、两份 metadata 和当前文件，不增加模型请求。

root 实际打开了 light 插入、dark 760px 审阅和 dark changed 拒绝截图，见 [visual-review](evidence/v2-prompt-placement-gui-2026-10-28/visual-review.json)。窄屏覆盖选择、审阅及截图；保存、插入和后续链在桌面同一卡片完成。布局切换分别由 [MobilePanel 分支](/home/keer/workspace/aigcfroge-v2/packages/app/src/session/screen.tsx:330) 和 [SideRegion](/home/keer/workspace/aigcfroge-v2/packages/app/src/runtime/extension/side-region.tsx:82) 决定挂载；SkillReview 的 createVisitState 为局部实例，不能宣称跨布局保存状态持久化。两个主题/拓扑组合不代表四格全矩阵。有限 TestLLM、同进程 peer 和新图回读不代表外部 provider、跨进程操作者或崩溃恢复。

## 留存失败与修正

保留每轮原始红日志，没有覆盖或累计通过数字：旧 producer metadata 缺 target、parser 及 Project 控件先留红；自然已有 Chat 入口已通过后才解冻生产。扩展矩阵 24 pass / 1 fail 揭示 active caret；真实链揭示 inactive caret，新 keeper 先 1 fail 再修复。

真链夹具的独立问题也分别留证：optional Request.id 被 Set 合并，改为每次 responder sequence 并独立比较真实 requests 总数；附件菜单 accessible name 带快捷键，改为唯一真实菜单项定位；上传 Blob 的 Playwright postDataBuffer 为 null，改用真实 TCP 收体与磁盘交叉观察；Bun 默认空闲断连早于 15s SSE heartbeat，沿现有测试服务器关闭 idleTimeout，总 deadline 不变。窄屏保存后再换桌面会销毁 saved 卡，最终改为窄屏先审阅、桌面新 owner 重新显式选择并确认后才保存。没有模拟 asset/Session 成功、注入私有 ready、重试写操作或放宽字面断言。

类型失败使用 canonical 编解码期望与可变 tuple 输入修复；未使用 any 或削弱品牌断言。lint 从告警轮修至 11 文件零告警和显式基线的 9 个 GUI changed 文件零问题；新增 inactive keeper 后的单条 spacing 和 Prettier 失败也保留，最终已复验。

原始 saved Prompt 文件故意含 BOM/CRLF/尾随空格，Playwright error-context 也含原始源码摘录。首次提交差异检查只在这些原始证据上报空白问题；源代码定向检查已通过。为保留精确字节，将这 9 份原始文本以确定性 gzip 存入提交，原文件本地不变，逐份解压回验相等，见 [artifact-encoding](evidence/v2-prompt-placement-gui-2026-10-28/artifact-encoding.json)。没有规范化测试输入或删除失败证据。

## 保留工作、复审和停止位置

原 64 tracked WIP 保留：63 项字节不变，账本保留原始完整前缀再追加本节。32 个冻结边界在工作与隔离仓均匹配；11 源码/测试两仓字节一致。普通 index 在准备提交前为空，见 [WIP 记录](evidence/v2-prompt-placement-gui-2026-10-28/wip-preservation-final.json)。提交使用临时 index、隔离源码和 HEAD 账本加本片 append，未整仓 add。

独立终审以 [independent-review](evidence/v2-prompt-placement-gui-2026-10-28/independent-review.md) 最终段为准；实际提交列表由 `git log --oneline 28b73ea65ddc5f19b61550b999f65d7cc22c9ee8..HEAD` 生成，不手写。未 push、merge 或部署。按用户要求本节闭环后通知并启动桌面端，本轮不进入下一资产小节。桌面从 v2-dev 当前工作副本启动，含原 WIP，与隔离验收源分别记录。

未交付的实际 incompatible 入口、同 Session ID controller / 同 server ID client/data 重建、请求×owner 全组合、编辑/导入/引用删除、其余四族、Custom/Workflow、跨布局状态、外部 provider、packaged Desktop、跨平台、崩溃恢复、无障碍/性能及有限族别分派维护债，均有 owner 与解除条件，登记在唯一 [technical-debt.md](../technical-debt.md) 本片追加。
