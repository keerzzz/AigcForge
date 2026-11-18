# P2.1B — 四 generic 模式的 Draft 与新建会话 UI

状态：实现、适用验证和独立复审完成；主智能体于 2026-10-25T21:44:09.867230+00:00 通过 [限定协议审批](evidence/v2-mode-p2.1b-2026-10-25/protocol-approval-mode-ui-review-erratum.json)。取证日期采用 UTC 2026-10-25，用户时区 Asia/Shanghai 为 2026-10-26。

工作区 `/home/keer/workspace/aigcfroge-v2`，分支 `v2-dev`，HEAD `251c0fe38041a326e624db464d1ee0efd1522881`，固定上游 `4617210822bdbb31e5749751afbfb4584ccedac8`。本切片仍为未提交 WIP；旧产品目录只读。计划关联 [P2.1](../research/upstream-v2-sync/2026-10-25-v2-alignment-execution-plan.md) 与唯一债 `AUDIT-V2-MODE-META`。

## 行为与复用

新建会话页提供 Coding、Chat、Work、Assistant 四个既有 generic 模式。选择只写当前 Draft；刷新后恢复选择。提交捕获当次模式，等待工作区或 MCP 期间的新选择不改变已发起的 create。缺失模式保留既有 Coding 默认；显式 Custom、未知值、null 等不被降级成 Coding，提交在 worktree、MCP 和 create 副作用之前失败。

生产改动为既有五文件：`src/shell/tabs/schema.ts`、`src/new-session/screen.tsx`、`src/new-session/view.tsx`、`src/new-session/composer-adapter.ts`、`src/runtime/i18n/en.ts`。复用当前 Draft schema/owner、ProductMode、Select/i18n 及已批准的 Data→Client→Protocol→Server→Core create 链。测试改动为 tabs.test.ts 与 new-session.spec.ts；benchmark 只在既有方法判断中精确单列现有库存刷新。共用 e2e/utils/app.ts 已精确恢复 baseline 字节，不添加平行 fixture 入口。

关系决定函数：

- [genericMode](../../packages/app/src/shell/tabs/schema.ts:78) 先读取 mode 建立 Solid 依赖，再以 own-key 区分缺失与非法，并复用 ProductMode 校验。初版先 hasOwn 导致首次新增键不订阅；由真实 E2E 复现后在此 owner 一次修复。
- [模式选项](../../packages/app/src/new-session/view.tsx:49) 从既有 generic creation 谓词取四模式；[选择回调](../../packages/app/src/new-session/screen.tsx:118) 仅更新 Draft。
- [start](../../packages/app/src/new-session/composer-adapter.ts:51) 决定当次提交快照与 guard 顺序，随后才进入原工作区/MCP/create 路径。
- [benchmark 请求分类](../../packages/app/e2e/performance/timeline/session-entry-benchmark.spec.ts:33) 只接受精确 POST/path/唯一字段 projectID 的既有 worktree.refresh，其他写请求仍断言为空。此 refresh 在 Core 中 reconcile 库存并写投影，不称为只读。

简单方案若只加选择器，无法保证首次选择订阅、持久 Draft 与异步提交一致。本实现扩展原 owner 并用真实生产页面验证；第五 Custom 用户入口、模式过滤及完整能力行为继续登记为技术债，不新增模式 registry 或 runner。

## 实际验证

固定 `script/bun` 1.4.2；所有产品测试与构建由主线串行运行。完整命令、cwd、退出码和源码/日志 SHA 见 [最终输入包](evidence/v2-mode-p2.1b-2026-10-25/p2-ui-final-input.json)。当前九个显式源 pin 与八份记录/日志哈希已重新核对。它们限定当前切片，不是完整不可变 WIP/runtime 快照。

- App test:unit：756 pass / 0 fail，2272 expect，107 files。
- App test:browser：168 pass / 0 fail，1778 expect，38 files。
- production new-session E2E：23 passed，Chromium、workers=1、retries=0。
- App typecheck 与独立 typecheck:e2e：分别 exit 0。
- canonical lint:changed 指定 HEAD 基线：0 problems，20 changed files。此命令范围按 GUI lint 实现，不代表 Core 或全仓 lint。
- 五生产文件 AST 与八触碰文件格式检查：分别 exit 0。

Unit 的 disk-full/ECONNRESET 输出来自已有故障夹具，记录原样保留，不以通过 tally 宣称日志无 error。E2E 证明真实 frontend、浏览器 storage 与受控 HTTP，不证明 live Core/provider、Desktop 或全五模式产品链。

失败单独保留：Bun 指纹 preflight 失败；原 entry 40 fail 与 2-case 诊断；UI unit red 0 pass /14 fail、缺控件 browser red；首 E2E 19 passed /4 failed；增量 lint 48 项失败。第一次首次选择故障在 genericMode owner 修复；lint 通过复用/删除共享 helper 扩展和修正新增代码取得绿，不削弱断言。前格式化/前 lint 的中间成功不绑定到最终源码。

## 入口测量边界

修改前 baseline-fixed 与最终 after-final 各 40 passed，Home/Session 各 20 个有效样本；运行期间源未变化，列出的 Bun/Node/Chromium/Playwright/kernel/runtime 指纹一致。原入口、milestones、metrics 与 repeats 未变，baseline 共用 helper SHA 为 78bb896c1bb43bc4a8747fffd8c9123561af1a1310930aa3131e6217c3f314d8。最终 benchmark 与已运行 baseline 只差空行，见 [夹具等价记录](evidence/v2-mode-p2.1b-2026-10-25/p2-entry-final-fixture-equivalence.json)；该记录在 final-after 前写入，其 pending 文字是记录时状态，最终 after 由独立 [完成记录](evidence/v2-mode-p2.1b-2026-10-25/p2-entry-after-final.json) 证明。

[完整数值及序号配对](evidence/v2-mode-p2.1b-2026-10-25/p2-entry-final-comparison.json)：Home 首正确 median 242.15→243.35ms、p95 252.30→255.00；Home stable median 407.85→411.20、p95 523.00→430.10；Session 首正确 median 116.10→125.70、p95 127.50→170.10；Session stable median 138.75→151.80、p95 251.70→303.30。

这是同环境序贯执行并按 repeat index 配对，未随机交错；不能归因或判显著性。Session 指标变慢已保留，P6 profiling/性能验收开放，不宣称性能闭环。测试产物与全部失败归档在 `/home/keer/.codex/backups/aigcfroge-v2/p2.1b-artifacts/`，各归档分别保留。

## 未交付范围与接续

`AUDIT-V2-MODE-META` 继续开放，Owner：Core/App/Meta；解除条件：五模式真实创建/继承/路由/缓存/过滤/能力、Agent/权限、Custom 入口与 Meta 持久身份/当前 Instructions 完整生产消费。`AUDIT-V2-ASSET-CONSUMER` 继续 P2.2 基础 Skill proposer→显式确认→HTTP apply→native registry→Session 消费；其余六资产、导入及 Custom 扩展继续各自原债。P0.4 完整恢复、其他平台、旧库、provider、性能与最终发布/Cutover 均不由本次验证关闭。

本切片复用 V2 owner；模式与 Agent 分类正交，选择不创建/重分类/恢复 Session。未执行 commit、push、merge、publish 或操作用户现用服务/数据库。提交列表必须由 `git log --oneline 251c0fe38041a326e624db464d1ee0efd1522881..HEAD` 生成，当前输出为空。

独立 [复审](evidence/v2-mode-p2.1b-2026-10-25/p2-ui-review.md) 在最终 packet 范围未发现 blocker；review SHA a59d8fa56d276eb74e645b265925da927e6febaa139eacdb272a29d03d15ff54。本审批仅覆盖上文四 generic Draft/提交的受控 HTTP 前端闭包；不关闭完整 P2.1、P6 或新 Desktop。

审批记录更正：主线在作者 FINAL 交付前写入了初次审批，作者随后修订 benchmark 配对措辞。保留 [原记录](evidence/v2-mode-p2.1b-2026-10-25/protocol-approval-mode-ui.json)，以 [更正记录](evidence/v2-mode-p2.1b-2026-10-25/protocol-approval-mode-ui-review-erratum.json) 绑定 FINAL 复审 md/JSON。原复审旧字节未另行归档，原审批旧哈希不能在当前路径再验证；当前九源、八门禁及FINAL复审已重新核读。源码/测试packet和限定结论未变。
