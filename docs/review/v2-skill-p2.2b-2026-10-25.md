# P2.2B 基础 Skill GUI 检查点

实现与适用门禁已完成，独立复审已FINAL冻结；于 2026-10-25T23:44:50.051736+00:00 获 [限定协议审批](evidence/v2-skill-p2.2-2026-10-25/protocol-approval-skill-gui.json)。记录日期 UTC 2026-10-25。唯一实施目录 `/home/keer/workspace/aigcfroge-v2`，分支 `v2-dev`，HEAD `251c0fe38041a326e624db464d1ee0efd1522881`，固定上游 `4617210822bdbb31e5749751afbfb4584ccedac8`。本地未提交，没有远程动作。

GUI 在既有 shipping Extension/Panel/Command/header 中提供基础 Skill 候选审查，复用 ToolDisplay、Client/Data 和原 SkillAsset owners。选择候选不写入；取消零写；save 与每次当前 revision 的 replace 分别确认。原 tool input 保存正文，持久 metadata 只提供五个事实。旧消息缺 facts 仍可见，但不能保存。

真实关系由 [read](../../packages/gui-extensions/src/skill-proposals/proposal.ts:34) 校验 input/facts、[current](../../packages/gui-extensions/src/skill-proposals/proposal.ts:107) 比较 content/catalog/revision/name、[applied](../../packages/gui-extensions/src/skill-proposals/proposal.ts:143) 比较服务回读、[native](../../packages/gui-extensions/src/skill-proposals/proposal.ts:161) 匹配 canonical path/name/description/body，显示 native 实际 ID。过期观察由 [sameScope](../../packages/gui-extensions/src/skill-proposals/panel.tsx:408) 与 keyed 子树/cleanup 决定；路由迟到回复已真实 keeper 驱动，专门的 Client/Data generation 场景仍未验。

独立复审指出同类五种测试专用 DOM 标记及 restored-tab idle-only preload。主线删除这些标记，keeper 读可见 pre/current/status，同时保留实际 HTTP CAS body 断言；CSS/宿主 aria 标记保留。恢复预载复用 [renderer createKeyed](../../packages/gui-extensions/src/skill-proposals/renderer.tsx:11) 和 [Layout.stored](../../packages/app/src/runtime/extension/host-apis.tsx:812) 的 stripped main ID，header 不扫描消息，panel 保持独立 Suspense。

复审另证实合法 Session ID 与 asset path 可以同为 `ses_collision.md`。原 placement 409 错入 CAS 分支；新增既有 keeper 表格案例得到1 failed，实际 error-context 显示 Current content/Replace。主线在 [冲突分类](../../packages/gui-extensions/src/skill-proposals/panel.tsx:202) 先阻断 Session ID；等值歧义显示既有 generic save error，零 catalog/content 读取，不提供 Replace；普通 asset CAS 保留。这类合法碰撞的 CAS 覆盖仍不支持，Owner/解除条件登记在唯一资产债项。

扩展 graph 首轮24 pass/1 fail，cold诊断又1 fail。实际 Storybook Vite7.3.6 的 needsReload/fullReload 源码、DEBUG 依赖发现日志与同模块 query/reconnect trace 支持 optimizer reload 根因推断；原 cold 缺5 owner contemporaneous pins，也没有直接 WebSocket reload frame，未补写旧记录。修复 [Storybook config](../../packages/storybook/.storybook/main.ts:64) 复用官方10.4.4 optimizer，并增加真实 host.fixture/built-in renderer 两个 scanner roots。合并关系由安装的 builder-vite chunk-X23VLN2Z.js:203决定；避免手写依赖名清单。原 suppression 原因仍未知。

最终 [p22-gui-final-input.json](evidence/v2-skill-p2.2-2026-10-25/p22-gui-final-input.json)，SHA256 `c44d357e3df8eda3df62827118de2bca30de48de7545f9fabe562012a29afb33`，冻结51显式源/13changed files/12独立门禁 records与logs。所有 final-v5命令前均捕获51当前 pins；每项分别exit0：

- GUI 198 pass / 1 skip / 0 fail / 565 expect / 33 files。
- App unit 756 pass / 0 fail / 2272 expect / 107 files；browser 168 pass / 0 fail / 1778 expect / 38 files。
- GUI/App/E2E 类型分别通过；canonical changed lint 0 problem/30 files；Storybook scoped lint 1 file/1 rule通过；GUI AST与13file格式通过。
- 真正冷缓存 full host/graph 25 passed；production side-panels keeper 14 passed。workers=1、retries=0，各轮不累计。

碰撞修复后的最终真实 run `/tmp/aigcfroge-p22-gui-hug1pau4` 对应 GUI Chat 创建→当前 runner proposer→磁盘 SQLite持久 metadata→取消零写→确认一次真实 TCP HTTP写→native watcher/event→composer @Skill→同 Session 新精确 input完成。实际1 pass/0 fail/63 expect，3 primary+1 title，outside-browser requests/page errors为空。599 pre-run源、615 source copies、3175 App artifact、4242 run regular files已归档并完整回读核验；构建日志绑定本次final-v5 keeper；主线复查03/05截图可读。详见 [real-gui-final-archive.json](evidence/v2-skill-p2.2-2026-10-25/real-gui-final-archive.json)，SHA256 `a85c3374025504d06cca31319dc8ab73d1ae3ef9c54415e018688f918484a4c4`。这是有界 TestLLM/隔离TCP/磁盘真实链，非外部provider/新Desktop/PWA或全量不可变WIP/dependency/runtime快照。

所有旧红测、99→6→0 lint、类型/格式、fixture FS列表边界、cold failure、碰撞 red、v4三空行lint失败及v1/v2/中间green各自保留原来源和绑定。v5不把旧结果重绑为当前通过。App intentional disk-full/ECONNRESET、NO_COLOR/FORCE_COLOR、Vite native-loader和AST runtime-resolution warning保留。

完整P2.2/P6仍开放。AUDIT-V2-ASSET-CONSUMER Owner Core/Server/App、主智能体：合法等值ID/path CAS覆盖需真实canonical Session placement回读或明确区分合同；narrow/mobile与专门generation驱动、缺roots/禁用watcher、路径秘密、完整删除/Profile/history/重载、slash/triggers/tags扩展、其余六族/导入、外部provider/新Desktop/PWA/旧库/P6需各自真实生产验收。AUDIT-V2-DOCUMENT-AUTHORITY Owner App/Storybook、主智能体：evaluate-only roots变更时更新这两个扫描入口；集合扩大再归并声明。基础subset目前明确拒绝slash/triggers/tags扩展。
