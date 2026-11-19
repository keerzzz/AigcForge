# P2.2D Command GUI 与真实消费链

状态：实现与适用验证已完成，独立最终复审 findings=[]，已获 [主智能体本地限定协议审批](evidence/v2-command-resume-2026-10-26/continuation/protocol-approval-command-gui.json)。实施目录 `/home/keer/workspace/aigcfroge-v2`，分支 `v2-dev`，HEAD `251c0fe38041a326e624db464d1ee0efd1522881`，固定 upstream/v2 `4617210822bdbb31e5749751afbfb4584ccedac8`。未提交，完整 P0–P6 保持开放。

复用现有 `skill-proposals` 扩展，加入 Command 页签与头部入口。候选的 source、invocation、可选 args 与五个持久事实来自原 tool input/metadata；[read:54](../../packages/gui-extensions/src/skill-proposals/proposal.ts:54) 不推断缺失事实。[current:152](../../packages/gui-extensions/src/skill-proposals/proposal.ts:152) 核权威 catalog/content 与当前 revision，[applied:191](../../packages/gui-extensions/src/skill-proposals/proposal.ts:191) 核保存回读字段。保存、覆盖、删除各自确认；取消不写。删除传已回读 revision，后端省略 revision 的既有无条件语义没有改变。

双面板的实例关系由 [RegionContent:256](../../packages/app/src/runtime/extension/panels.tsx:256) 的未分组 keyed mount 决定。确认状态和 AbortController 各属于一次 mount；[sameScope:549](../../packages/gui-extensions/src/skill-proposals/panel.tsx:549) 核 Session、Location、当前 client/data 和连接状态，await 后只更新当前 owner。已有 Skill 的 46 条英文保留。没有新 Store、provider loop、API 或七族通用框架。

实际回归发现空 args 序列化错误：[argsLine:233](../../packages/core/src/command-asset-service.ts:233) 原 truthiness 判断省略已提供空值。改为 `!== undefined` 后写出 `args: ""`。复用原 Server 真实 HTTP/磁盘/watcher/同 Session 用例，0 个新增测试声明。触碰文件的只用于类型的别名导入改为直接 Candidate 类型导入；原规则报错与修正分别保留。

## 红测、修复与最终门禁

- tests-only 纯合同红：21 pass / 5 fail；生产 keeper 红：1 fail，缺少 Command proposals 按钮。它们是当前功能缺口，原日志和产物保留。
- args tests-only 红：0 pass / 1 fail / 38 expects，HTTP SchemaError 指向 args。不是候选预测的 undefined 断言。修复后同例 1 pass / 0 fail / 51 expects。
- GUI 全包：203 pass / 1 skip / 0 fail，33 文件、584 expects；GUI/App 类型与 App E2E 类型分别 exit 0。所有 GUI 路径匹配最终字节。
- App 单元 756 pass / 0 fail，browser 168 pass / 0 fail；production side-panels keeper 17 passed；真实 window host/graph 25 passed，均单 worker、0 retries。宿主合同由 Storybook renderer 验证，不能称 installed Desktop 验收。
- args 修复后的 Server 全包 155 pass / 1 skip / 0 fail，发生在仅类型导入清理之前。清理后 Server 相关 3 pass / 0 fail / 57 expects，Core 相关四文件 44 pass / 0 fail / 86 expects；Core/Server 类型再次 exit 0。两批不相加成新的全包数字。
- 本轮 12 文件格式、8 个生产/fixture AST、Core/Server 两文件定向 lint 均 exit 0。GUI incremental lint 为 42 changed files / 0 problems；21 个空行问题、旧 alias AST failure 与 postinstall fallback warning各自保留。不替代全仓 lint 或全仓 typecheck。

[最终输入](evidence/v2-command-resume-2026-10-26/continuation/final-input-recovery.json) 绑定 12 个 scoped 文件、15 个命令记录和下面的真实链。GUI/mock gates不运行 Core，由 GUI 文件比较决定可复用范围；最终 Core gate 和新真实链绑定 Core owner。不是用旧全树绿记录掩盖字节变化。

## 真实消费与窄屏键盘

[v4 结果](evidence/v2-command-resume-2026-10-26/continuation/real-chain-narrow-v4/launcher-result.json) 为 exit 0、1 pass / 0 fail / 75 expects，无 timeout/interruption，593 源 pre/post 与当前匹配，3172 build/served artifact pre/post 匹配。App 来源为同源码 keeper 的生产 build。临时服务使用独立 loopback TCP、隔离项目/SQLite/浏览器与现有 TestLLM 边界；保留 HOME，不碰现用服务。

生产 renderer 创建 Chat → 真实 prompt/tool 持久事实 → 用户确认 → authenticated HTTP apply → 磁盘 readback/原生 watcher → 现有 composer Command → 同 Session 模型请求。最后 user 为独立字面值 `Review actual diff.`，两个准确输入完成、pending inbox 0。删除经过独立确认，磁盘、catalog 和 native 名称均消失。两次 asset mutation，没有外部请求或额外写入。

390×844 深色主题通过 More 菜单的键盘选择、确认与 Cancel。窄屏截图已目视检查。旧 v3 脚本因两处变量重复声明在解析期失败，0 个产品用例执行；v4 只修名字，先 Bun parse/build 后运行。这不是产品红态。英语与中文翻译全矩阵、所有窗口恢复与 generation 竞态没有宣称覆盖。

## 保护、裁决与开放范围

完整仓外 WIP 备份 2871 路径/293184465 bytes已读回；本轮十二路径之外，原文件 0 changed / 0 missing，见 [保留核验](evidence/v2-command-resume-2026-10-26/continuation/wip-preservation-recovery.json)。提交列表由 `git log --oneline 251c0fe38041a326e624db464d1ee0efd1522881..HEAD` 生成，当前为空。

用户于 2026-10-26 确认：[资产默认当前 Project、个人全局显式选择；Task 固定时区、缺省保存用户当前时区](../research/upstream-v2-sync/p1-product-decisions-2026-10-26-followup.json)。Project 不自动等同每个 worktree/Location；当前链明确展示临时 Session Location，后续默认 Project 解析与 global 目标仍须接线。

`AUDIT-V2-ASSET-CONSUMER` / `V2-SERVER-LEGACY` 保留五族、导入/完整编辑/引用删除、Project/worktree/default/global、alias/危险 shell、unknown outcome、磁盘冷重开、外部 provider/installed Desktop/PWA 和 P6。Owner 及 unlock 位于 canonical technical-debt 的 P22C 子范围。本审批不结束完整迁移。
