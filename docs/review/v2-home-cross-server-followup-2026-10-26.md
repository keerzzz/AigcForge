# Home 跨服务器筛选跟进检查点

2026-10-26，`/home/keer/workspace/aigcfroge-v2`，`v2-dev`，HEAD `251c0fe38041a326e624db464d1ee0efd1522881`，固定上游 `4617210822bdbb31e5749751afbfb4584ccedac8`。本次只新增一个 Home keeper，production 未改。完整 P0–P6 未完成。

`packages/app/e2e/regression/home.spec.ts:439` 驱动 A → B → reload → A。`:463` 的 `expectList` 检查请求 origin、limit/order/parentID/mode；`:474` 的 `expectHome` 检查 Work 选择、对应 Session 行和保留 tab 地址。真实 App 由 built Playwright 配置启动；`packages/app/e2e/utils/mock-server.ts:382` 的 page.route 与 `:416` 的 scripted handler 决定后端仍是 fixture。

最终单源、三记录见 [final input](evidence/v2-command-resume-2026-10-26/continuation/home-followup-final-input.json)。全 Home 19 passed，Chromium、workers=1、retries=0；App E2E 类型与显式 HEAD 基线的增量 lint 均退出 0。lint 实际检查 42 个 GUI 文件，不是全仓检查。失败的首轮空行诊断继续保留，数字不累计。独立 [复审](evidence/v2-command-resume-2026-10-26/continuation/home-followup-independent-review-recovery.md) 核对当前源、三个记录及日志的 hash、cwd、argv、exit。最终 [限定本地审批](evidence/v2-command-resume-2026-10-26/continuation/protocol-approval-home-followup.json) 已签发。

P21C-CROSS-SERVER-PERSIST 的前端契约子范围关闭。两个 live Core/TCP 后端、安装版 Desktop、跨服务器 tab 实际打开执行仍需验证；持久删除归 P21C-DURABLE-DELETE，剩余全局搜索归 AUDIT-V2-GLOBAL-PARITY。Owner 为主智能体及 App/Core/Server/Desktop；解除条件是相应真实入口与持久结果。原 Command/Skill/Home 审批保留各自限定范围。

本轮未提交，提交列表由 `git log --oneline 251c0fe38041a326e624db464d1ee0efd1522881..HEAD` 生成，见 [commits](evidence/v2-command-resume-2026-10-26/continuation/home-followup-commits.txt)。此前 WIP 与备份保留；本轮没有切换分支、启动或重启用户服务、推送或合并。
