# V2 PR 交付检查点 · 2026-11-18

用户已选择草稿 PR `v2-delivery → v2-review-base`，目标仓为 `keerzzz/AigcForge`。审阅基线固定为 `4617210822bdbb31e5749751afbfb4584ccedac8`。默认工作区整合属于后续 Cutover。

上游 Git 传输未能补齐浅克隆祖先，目标仓 API 也拒绝引用不存在的461对象。远程审阅基线因此使用快照提交 `5afd079ae1a386cc0d289f205afca79806a0fdb5`，父节点为目标仓当前main `d11d3c7c16f0bcf318a0197bfb647c3cf81b06fd`。它与461具有相同树 `89f56b689675de8f6035ad3fd74375a50d324434`，`git diff --exit-code 4617210822bdbb31e5749751afbfb4584ccedac8 5afd079ae1a386cc0d289f205afca79806a0fdb5` 为exit0。调整范围是Git祖先和提交身份，固定源码基线与工作流内容不变；原461及开发历史本地保留。

## 来源与完整范围

原 `v2-dev` HEAD 为 `0a09f6bccdb71f1234eea759eb99e8a336d1d4da`。146 个源提交清单由 `git log` 生成，见[机器索引](v2-pr-publication-2026-11-18.json)。已验收暂存树为 `c309bfc7567e2913e31d4c663d233a8a6bc5bc9c`，相对源 HEAD 有 638 个文件变更。

排除 `docs/review/evidence/**` 后，完整源码迁移相对基线为 5,193 个文件、632,929 行新增、579,960 行删除。过滤时保留的 7,985 项 mode/type/blob 身份全部一致，包括 1,877 个测试路径和 371 个 fixture 路径。原开发提交、暂存修改和本地证据保留。

交付另改四个文件的格式：两个 TypeScript 文件只删除末尾空行；两个历史 Markdown 改用明确换行，保留原 7／4 个硬换行。TypeScript 原文与现文去除末尾空白后相同；既有 marked 渲染器比较的 HTML 仅有段落末空格差异。新增本报告、机器记录和历史归档索引，补充账本并修正一处历史证据引用，不改产品逻辑。最终交付身份由仓外收据记录，避免索引包含自身哈希。

交付使用独立快照提交，公开历史的二分定位粒度低于原 146 个提交；机器清单和本地原历史用于逐批追溯。

## 验证与审阅状态

| 工件                                                                     | 结果与范围                                                                                                                                       |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `./script/bun run check`                                                 | exit 0；24／24 类型任务成功，21 个缓存；lint 为 1,140 warning、0 error。命令在原开发工作区执行，保留源码身份与交付树一致，四个格式差异另行验证。 |
| `./script/bun run lint:changed 5afd079ae1a386cc0d289f205afca79806a0fdb5` | 实际PR基线范围；1,164 个 GUI 文件，181 个文件产生 685 项诊断。规则／路径清单见机器索引，严格门禁阻断合并。                                       |
| 原 HEAD 相对的严格 GUI lint                                              | exit 0；234 个文件、0 诊断，不覆盖完整迁移中的另外 930 个 GUI 文件。                                                                             |
| 完整补丁检查                                                             | 四个格式文件修正后 exit 0；早期空白检查和 Markdown 渲染失败保留在仓外收据。                                                                      |
| 原 Session 边界 keeper                                                   | 最终串行 185 pass、0 fail、1,632 expects；SC02／Custom Group resume 负对照失败并恢复原生产 SHA。                                                 |

原包级、组件、回放和产物结果按[续验收报告](v2-acceptance-continued-2026-11-18.md)各自范围读取。当前 77 文件／358 变更块的断言深审不授予完整历史迁移的逐行审阅信用。

GitHub 的 [PR files API 最多返回 3,000 个文件](https://docs.github.com/en/rest/pulls/pulls#list-pull-requests-files)，[单个 diff view 最多显示 300 个文件](https://docs.github.com/en/repositories/creating-and-managing-repositories/repository-limits#diff-limits)。完整审阅须拉取交付分支，在本地对固定基线执行 `git diff`。

## 原始证据与后续切换

原 `v2-staged-evidence.tar.gz` 保存暂存／未提交证据 13,048 个文件，SHA256 为 `d5a19988bcae287d3e4c37c20f9ac0dbc57a1877f37a5b5b7ad4dcc7500ec13c`。新增 `committed-raw-evidence-c309.tar.gz` 保存已验收树中的历史证据 2,296 个文件、98,983,357 原始字节，归档 SHA256 为 `c3f3b7eb8e88a6da84bd53b36fcca18610be8a6d70395a319545c43910dc6cd5`。独立验证 exact path、字节、SHA256、重算 Git blob SHA1 和 Git mode 全部 2,296／2,296 匹配，缺失／多余／不符为 0。

两份归档在仓库外保存。相同路径可以有不同历史版本，须按归档名、来源树和哈希定位，文件数不能相加为唯一文件数。保留文档中的本地原始证据路径供现场追溯，外部读者不能通过 PR 访问它们。历史归档的每个成员由[committed 索引](v2-committed-evidence-index-2026-11-18.json)保存路径、来源树、整包／成员 SHA 与本地归档入口。原12个 Markdown 原始证据链接中，11个已有明确归档版本；缺失的 `verification.json` 引用现已替换为实际存在且 exit0 的 lint／Prettier／diff 三份历史收据。

完整 GUI lint、历史迁移审阅和 Cutover 已在[技术债账本](../technical-debt.md)登记 Owner 与解除条件，历史证据引用修复独立记账。真实模型继续按 AC36／PMF-ACCEPT 暂停；安装版数据库升级、27／66 项中文译文及隐藏目标／相邻 Server oracle 沿原条目继续验收。

静态工作流核验显示 `v2-review-base` 和 `v2-delivery` 不匹配 push 工作流；PR 会匹配 test 及元数据工作流。源码中读取缺失 `dev` 的路径若被执行会返回404；[PR #142](https://github.com/keerzzz/AigcForge/pull/142) 初始HEAD `1361c7009e9b0d4ece1cf97a7e1ac6823e7f0cb2` 的实际 `check-standards`、`check-compliance` 和 `add-contributor-label` 均success，产品CI为queued。因此缺失dev不计为本PR已发生的CI阻断，当前合并阻断仍为完整GUI lint和历史迁移审阅。最终分支／发布范围与默认工作区切换按[执行计划 §10](../research/upstream-v2-sync/2026-10-25-v2-alignment-execution-plan.md#10-p6归一化数据库性能与-cutover)执行。

本轮四个格式修改属于低风险改动，压缩思考流程第 1—4 步；第 5 步由原文差分、marked 渲染比较及完整补丁检查授予验证状态。
