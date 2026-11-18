# P0.3 当前源码 Desktop 必要闭包检查点

日期：2026-10-25（证据UTC）。状态：主线实际同源构建与本地运行验收全绿，独立复审和限定协议审批待完成。本检查点不代表 installer/updater、其他平台、旧库升级、完整产品或最终切换通过。

唯一实施目录 `/home/keer/workspace/aigcfroge-v2`，分支 `v2-dev`，HEAD `251c0fe38041a326e624db464d1ee0efd1522881`；固定上游 `4617210822bdbb31e5749751afbfb4584ccedac8`。主线独占资源，逐阶段串行执行；未提交、推送、合并、安装或发布，未修改用户现用服务与数据库。

## 本轮来源与实际运行

[机器索引](evidence/v2-desktop-p0.3-2026-10-25/desktop-same-source-acceptance-202610251842.json) 保存全部阶段命令/cwd/exit、日志与raw哈希、三份CLI和App资产身份、截图与冻结源码副本。运行目录 `/home/keer/.codex/backups/aigcfroge-v2/p0.3-artifacts/final-source-202610251842`，CLI构建tag `0.0.0-dev-202610251842`。Desktop的实际package/appVersion为 `2.0.26`；它与CLI tag是两个字段，同源关系由freeze与产物字节决定，未宣称版本字符串相等。

- CLI从真实包执行固定Bun1.4.2完整build，Linux x64 baseline、skip-install，未skip-web-ui；重建App production assets并嵌入archive，exit0。
- Desktop build显式CLI_DIST指向本轮CLI；Linux x64 unpacked package使用已有Electron44.4.5，publish never；两个阶段各exit0。Worker编译exit0。
- Identity **11 pass /0 fail**：三份CLI均232441312 bytes、SHA `428586c7fbb5956e4b96148720f4b2c62852a1bae5fb57c1c0354d2d3b3f1a29`，各CLI版本、完整out/ASAR逐项字节和FD修复存在、App生产输出均通过。
- Development **17 pass /0 fail** 与 Linux packaged **17 pass /0 fail** 分开计账：实际cold/warm、isPackaged、路径稳定、401/renderer200、凭据preload边界、关闭后服务存活、同namespace PID复用及私有清理。
- Native **23 pass /0 fail**：实际从本轮packaged resource CLI启动，proc/exe哈希与CLI一致；真实Session创建/读取/重启读取，原生PTY `/dev/pts`、materialized binding身份和双向输入输出；service stop/handoff后原terminal ID/PID/screen保留并再次收发。服务PID在私有namespace中17→58，terminal PID40保持。实际HTTP HTML/一个JS/一个CSS响应哈希匹配本轮App dist。
- Closure exit0：九阶段全接受，7440 source输入、10 named runtime/binding及记录产物哈希始终匹配。上述四种tally各自保留，不相加；原旧CLI下两份17与旧native17仍属于各自历史轮次。

HOME字符串保持原值，bwrap使用私有HOME挂载及PID/net namespace，仓库和产物只读，测试结果单独可写；无宿主凭据或现用服务覆盖。raw运行日志未输出鉴权值。主线实际查看packaged warm截图，V2新Session/composer已渲染；截图不能替代产品功能验收。

Freeze为输入manifest，不是完整WIP/依赖备份。主线随后保存 `frozen-source-inputs.tar.gz`，32727478 bytes、SHA `23b6f4221d4a5b759c856222e75f1ded21bfd498e8517a2fb83969c62c04cd49`；归档7440项逐SHA与freeze完全匹配，保存前后source未变。本轮没有.env输入。它只保存冻结源码输入，不扩大为整机/runtime依赖快照；原完整初始WIP备份 `p0.3-20261025T100410Z` 保留其自身范围。

## 恢复范围与关系依据

[最终恢复清单](evidence/v2-desktop-p0.3-2026-10-25/restoration-final-input-manifest.json)、[真实差异](evidence/v2-desktop-p0.3-2026-10-25/restoration-final-input-diffs.json) 与 [理由](evidence/v2-desktop-p0.3-2026-10-25/restoration-final-input-rationale.md) 从固定Git blob登记815项：390 raw相同、416只品牌归一化相同、9其他文本差异；缺失0，与initial-adapted变化12项。全部untracked仍是已编辑现场，不等于原样。主线核current/freeze/final manifest的815项SHA均匹配。

完整CLI恢复来自 [DesktopCli.resolveBundled](../../packages/desktop/src/main/service/desktop-cli.ts:77)、[prebuild](../../packages/desktop/scripts/prebuild.ts:16) 和 [buildAppArchive](../../packages/cli/script/app-assets.ts:8) 的真实消费者。声明runtime闭包17包、实际App/Script构建根21包、dev声明超集23包；SDK无此闭包消费者，因此未恢复独立SDK。关系由当前package.json依赖固定点与真实build调用决定，不按旧文件缺失数量恢复。

Merman G已有 [限定审批](v2-merman-p0.3-approval-2026-10-25.md)，505 pass /0 fail、15 snapshots，317来源/321次0结构违规，原预算和golden保留。当前91输入与有效G记录相同，27保护输入匹配冻结值；其中24 raw、3品牌输入。旧G review里的一个baseline例子由 [勘误](evidence/v2-desktop-p0.3-2026-10-25/restoration-final-input-g-review-erratum.md) 核正：decision-loops/lr-long@80为E23→G23 bends，不能引用其他方向的E22。RL/BT长度160→192、bends12→10、crossings2→1取舍保留；未采集G321逐行输出，不声明全case全维改善。旧review/approval原SHA保留。

Client FD修复236 pass /0 fail、type/lint与独立复审保持已核证据；本轮实际资源CLI和Desktop原生运行已使用该源码，不借旧CLI替代本轮验证。Core Cause/idle123及反向124分别有 [限定审批](v2-recovery-p0.4-approval-2026-10-25.md)；本轮输入包含当前三生产SHA，不能称P0.4完整成功链或崩溃矩阵已关闭。

## 未交付边界

AUDIT-V2-DESKTOP-CLOSURE保持Open的范围由Desktop/Release、Client/Merman负责人和主智能体拥有：独立TUI/CLI/SDK发布形态、Windows/macOS与其他Linux变体、installer/updater/升级/跨版本服务接管、旧库副本与配对性能。Linux FD scan→spawn线程窗口、O(maxFD)槽位成本与procfs依赖仍按原review保留。解除条件是各自真实产物和运行证据，不由本次unpacked package或hash通过替代。

P0.3本地必要闭包待独立复审与主线协议审批后才能关闭；其余边界在canonical debt继续跟踪。`git log --oneline 251c0fe38041a326e624db464d1ee0efd1522881..HEAD`当前输出为空；没有手写commit列表。


**最新限定审批已完成。** 2026-10-25T19:31:15.828741+00:00主线再核所有输入、日志与产物，依据 [独立复审](evidence/v2-desktop-p0.3-2026-10-25/desktop-final-source-independent-review.md) findings=[] 完成 [本地闭包审批](v2-desktop-p0.3-approval-2026-10-25.md)。前文“待审批”保留准备时点。冻结source副本7440项和可变输出副本5378项已保存；后者主线实际逐项验证，复审仅核归档整体SHA/记录。外部两份CLI与ASAR仍在owned run目录，development CLI原字节可由已核相同的primary artifact保留。TEAM在7440之外另行pin，只影响本轮构建日志；未扩大完整input/dependency/WIP快照。
