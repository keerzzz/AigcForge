# Upstream-V2 迁移分支审批记录（2026-10-17）

**审批对象**：`v2-dev` 分支 · 提交区间 `8a9228bdb..c33ac20d1`（本次工具流大窗全部交付，紧接此前 R0→R2 各窗已验收内容）
**审批依据**：AigcForge 治理宪法（四绝八耻）+ `docs/research/upstream-v2-sync/2026-10-16-upstream-v2-desktop-alignment-plan.md`（唯一事实源）+ base 各域 AGENTS.md 规范
**审批人**：迁移执行代理（会话内审批功能）

---

## 一、交付清单（本区间 10 提交，106 文件，+13691/−482）

| 提交 | 内容 | 测试证据 |
| :--- | :--- | :--- |
| `8a9228bdb` | CLI 适配器叶簇 12 源件（cli-adapter/claude-code/codex/gemini/opencode/cli-config-adapter/cli-executable/cli-discovery/cli-timeout/delegation-parser/acp-client-update/process）+ `ConfigCliAgent` schema 归属正解 + core 门面 | 5 套 40/40 |
| `fc51db11b` | **MCP connection 链全量**：`mcp/connection.ts`（1005 行：stdio/remote wire、六态健康机、凭据分型、kill switch、连接锁、stderr 秘密扫描序）+ `tool/mcp-registration` 重生（canonicalToolName + fail-closed 冲突，Tool.Service 形）+ 双 node 入 instance 位置图 | 4 套 **52/52**（connection 44 + registration 5 + 隔离 2 + 守卫 1） |
| `9e675d48b` | ACP/SDK 客户端簇 9 源件（acp-client×3、acp、claude-code-acp/codex-acp、claude-code-sdk、codex-sdk、codex-app-server 898 行） | 4 套 27/27 |
| `9e9a93f36` | T1 工具批 15 源件（kb-tools/memory/propose-*/reminder-*/work-preset/list-assets）→ base Plugin 形 + 14 模块 node 导出 + internal Requirements 扩展 | 5 套 23/23 |
| `9b0455b4a` | T2 任务工具批 8 源件（task-*/taskwrite/todowrite/taskschedule/taskspawn） | 5 套 24/24 |
| `a251db78a` | **permission 全融合**：scoped-grant 咨询、ApprovalPresence 应答者门、AskExpired/Rejected 分型、TTL 界、effectiveV2 包络路由、session 三列 fromRow/projector 语义 | 7 套 **161/161**（含 fork 版 permission.test.ts 换血） |
| `04464540f` | tool-shell permission 测试悬挂修复（上一提交遗漏面） | 109/109 |
| `c33ac20d1` | **asset-migration 空条目 marker 缺陷修复**（本窗接线暴露的真实产品缺陷：物化缺失目录树 → location 假引导成功） | location-layer 净增 2 失败归零 |
| 文档×2 | §10.22–10.24 裁决记录（双仓镜像） | — |

另含 **T3 零回植判决**（bash/edit/read/glob/grep/write/question/skill/websearch/webfetch/apply-patch 11 件 M 文件逐断言仲裁：v2 全面更深，fork 差异全被 v2 既有测试钉死为已超越）——无代码变更，方法论记录于 §10.24。

## 二、关键裁决（审批复核通过）

1. **工具契约**（§10.23）：fork `tool.ts/registry/tools/application-tools/lifecycle-hooks` 不移植——base AGENTS 明令禁止第二注册表；全部 fork 工具改写为 base `Plugin{ctx.tool.transform}` 形。
2. **ADR-19 session 放置**不回植（无 v2 消费者，防臆测扩张）；MCP 工具 `codemode:false`（组合面键名语义）。
3. **CommitRejected 仲裁**：grant 消费提交冲突 = 竞态输家 → consultGrant 回落 ask 流（免动协议面）。
4. **凭据创建语义**：fork 替换制 vs v2 多凭据+激活制 → base 演化更深者胜，测试以 `credential.remove` 显式制造悬挂保产品保证。
5. **s2 守卫半部**：只移植源级唯一 Database.Service 构造守卫（运行时半部属 fork 事件管道形，v2 bus 契约已覆盖）。
6. **asset-migration 修复方向**：无条目即不动文件系统（同时纠正空 marker 永久抑制未来合法迁移的隐性错误）。

## 三、门禁证据

| 门禁 | 结果 | 判定 |
| :--- | :--- | :--- |
| root `bun run check`（19 任务 lint+typecheck） | exit 0 | ✓ |
| core 全量 | 7326 测 · 6927 过 · 34 败 | ✓（**与会前基线逐名同集，净回归 0**，经 worktree 基线 diff 实证） |
| server | 83 测 · 79 过 · 3 败 | ✓（=基线：HEAD download / canonical plugins ×2） |
| schema | 319/319 | ✓ |
| migration --check | 无 schema 漂移 | ✓ |

**基线 34 败分类**（全部会前存量，非本分支引入）：GitLab OAuth×11（网络/环境）· PluginSupervisor/watcher×10（插件加载环境）· Config×4 · Worktree/Git trees×3（其一为 git-locale 环境：建议 `worktreeRun` 加 `LC_ALL=C`）· SSE/ModelsDev/Bus-routing/location-normalizes/mcp-modern-protocol 各×1。挂账随上游同步窗口处理。

## 四、剩余范围（明示，不在本审批覆盖内）

**Phase C/D——R4 runner/LLM 收敛窗**（方案 §10.24 交接清单）：`delegation/{service,execution,recovery}` + `task-driver` 系 + `tool/task`/`share-tool` + `workflow/{runner,execution}` + `judge/catalog/share-summary/v2-runtime/composition-resolver` + skill Custom-Mode 组合面 + runner 融合本体（fork llm 门 → base `@aigcfroge/ai` 适配，§9 方针）。

## 五、审批结论

**批准（APPROVED，按上述范围）**。

- 本区间交付满足宪法全部红线：真实测试（累计 300+ 新测试用例全绿）、每窗口仓库全绿、根因收敛（asset-migration 缺陷为接线暴露的真实产品缺陷并已修复）、如实申报（基线 34 败逐一定性、Phase C/D 剩余明示）。
- 仲裁链完整可追溯：每项 fork↔base 冲突均有测试驱动或域规范依据，无臆测接口、无破坏架构（base Tool.Service 单注册表不变式经 11 件 M 件零回植判决验证）。
- 技术债申报：无新增未申报技术债；既有挂账（基线 34 + Phase C/D）已在方案文档中列明。

---
