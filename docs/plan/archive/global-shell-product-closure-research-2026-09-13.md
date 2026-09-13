# 全局壳与五模式产品闭环：调研与对账归档（2026-09-13）

> **性质**：从主实施计划移出的事实调研、代码地图和长表，不是第二份实施计划。
> **权威执行入口**：[`../global-shell-product-closure-2026-09-13.md`](../global-shell-product-closure-2026-09-13.md)。节点、审批、顺序和 Definition of Done 以主计划为准。
> **归档原因**：减少审批文档长度，同时保留 2026-09-13 的证据链、文档漂移和 GitHub Issue 对账。

## A. 原审批摘要与调研证据

### 0.1 报告总结：已经证明什么、尚未证明什么

最新报告不是“全局壳 50/50 通过”的单一结论，而是扩展成了路由、五模式详情、Settings、多角色和 E2E 可信度审计。其有效结论分四层：

1. **已闭环的壳层问题**：顶部 Tab 关闭事务与 Dirty Guard、状态栏权威来源与虚拟锚点、Help/Debug 隔离、Home 项目优先、Chat 三区导航均已在前序计划实施；`BOT-04` 仅删除了错误的 message 启发式统计，等待 Core 共享 delegation projection。
2. **较强的 E3 证据**：大量 Playwright 用例能稳定验证浏览器 UI 状态机、路由壳、mock HTTP/WebSocket 契约、Draft 恢复、权限取消、Settings Web 持久化与 200% 等效布局。
3. **不足的 E4 证据**：`packages/app/e2e/regression` 仍以 `mockAigcfrogeServer` 为主，普通配置只启动 Vite；真实 durable admission、provider/SSE/tool、真实文件和 PTY、重启恢复、offline/reconnect、Electron IPC 没有成为发布门禁。
4. **产品闭环缺口**：Work 缺任务合同/产物 revision 身份，Assistant 缺 personal/project scope 身份，Custom 真实服务仍受 kill switch 阻断且 capability 原因未形成统一投影；Work Artifact 与 Assistant 面板在窄屏没有等价入口；路由 404/未知 server/legacy/Draft query 仍有失败恢复和隐私问题。

报告中的 discovery 数字必须按时间读取：历史 `50` 是旧版全矩阵实例，历史完整基础 Chromium 为 `179/188`；2026-09-13 当前 discovery 是 `50 files / 198 tests`，但没有 `198/198` 完整绿色证据。实施期以 Slice 0 重新发现的 `N0` 为唯一基线。

### 0.2 根因收敛

本计划不按页面逐个补按钮，而将报告缺口收敛为五个共同根：

| 根因面     | 共同前提缺口                                     | 典型现象                                                                        | 一击修复方向                                                             |
| ---------- | ------------------------------------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| F0：证据层 | E3 mock 被当成 E4 产品闭环                       | Composer/Files/Terminal 用例通过，但真实 provider、磁盘、PTY 未验证             | 建立隔离的 real-backend smoke harness 和分层 coverage manifest           |
| F1：身份层 | Session 的公共身份与模式专属合同没有统一只读投影 | Work 无 preset revision；Assistant 不显示 scope；Custom disabled 原因分散       | Core/Server 组合 `SessionProductIdentity` 读模型，UI/Header/门禁共同消费 |
| F2：恢复层 | 路由解析和错误映射存在 fail-open/静默 fallback   | unknown server 回退到当前 server；404 留白；Prompt 留在 URL                     | 单一 route resolution + typed recoverable error，先解析后挂载 Session    |
| F3：产品层 | 模式业务对象只完成局部 UI，没有耐久生命周期      | Work 无交付 revision/Reviewer；Assistant 无投递重试/隔离；Custom 无真实运行证据 | 在共享身份和 E4 harness 上按模式建立垂直闭环                             |
| F4：交付层 | Web 桌面 viewport 被误当成 Desktop/跨平台证据    | Electron IPC、native picker、DPI/zoom、WSL、更新器未验证                        | 独立 Electron smoke 与平台矩阵，不复用 Web 结论冒充原生通过              |

依赖顺序是 **F0 → F1/F2 → F3 → F4**。在 F0 前继续堆 mock spec，只会增加测试数量；在 F1 前逐页补模式文案，会产生新的第二真源。

### 0.3 当前代码调研结论

已核验的 Owner 与现状如下，实施不得另造平行基础设施：

- `packages/schema/src/session.ts`：`SessionV2.Info` 已持有 `mode`、`presetCategoryId`、`location`、`agent`、`model`、`permissionTier`；解码/构造后 `mode` 是必有值。
- `packages/schema/src/product-mode.ts`：固定五值为 `chat | coding | work | assistant | custom`，默认值是 **`coding`**；通用创建只允许前四种，Custom 必须走 composition snapshot 原子创建。
- `packages/core/src/session.ts`、`session/info.ts`、`session/sql.ts`：Session 是耐久身份 owner；Work 当前只把 `presetCategoryId` 放进 metadata，没有 preset ID/revision/合同版本。
- `packages/core/src/database/...session_composition_snapshot` 与 Custom create/upgrade handlers：Custom 已有独立不可变 Snapshot 真源，不能复制到 Session metadata。
- `packages/app/src/pages/mode-workspace.tsx`：五模式共享 render-all + `display:none` 外壳；inactive side effect 已有 active gate，不得拆成五套 route。
- `mode-workspace-slots.tsx`、`assistant-dashboard.tsx`、`work-artifact-*`、`custom/*`：已有 Chat 资产、Work 产物、Assistant reminder/memory/KB、Custom plan/snapshot UI，问题是 owner 拼接和闭环不足，不是“没有实现”。
- `packages/app/src/app.tsx`：canonical Session route 已用 server + session ID 获取 placement 并以服务端 `session.mode` 激活模式；404 与未知 server 的恢复仍不完整。
- `packages/app/src/utils/server-scope.ts`：负责 client-side scope key，不应承担远端 server 是否存在的业务判定。
- `packages/app/e2e/utils/mock-server.ts`：是 E3 contract fixture；不得扩展成伪真实后端。
- `packages/http-recorder` 与 LLM recorded/scripted 测试设施可用于确定性 provider 流量，但必须放在测试 harness，不给生产服务增加绕过权限或隐藏后门。
- `.github/workflows/test.yml`：现有 E2E 在 Linux 跑五 presentation projects、Windows 跑基础 Chromium，但没有启动真实 backend，也没有 Electron E2E job。

### 0.4 文档事实纠偏（审批后必须同步）

代码核验已经发现文档漂移。以下内容不能继续作为实施假设：

| 文档陈述                                                                  | 当前代码事实                                                           | 同步动作                                           |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------- |
| E2E 报告 §20.2 写数据库默认 `chat`                                        | `ProductMode.Default` 与 Session SQL default 均为 `coding`             | 在 Slice 12 给报告追加 erratum，不改写历史证据正文 |
| E2E 报告 §20.3 写 capability `custom-v1`                                  | 当前常量是 `product-mode-custom-v1`                                    | 追加精确名称与兼容说明                             |
| `CONTEXT.md` 仍称生产词汇只有四模式、Custom 等待 M0 Phase B               | Schema/Core/App 已含五模式，Custom M0–M3 已落地但默认 kill switch 关闭 | 更新术语为“已实现、默认不启用”，保留 rollout gate  |
| `docs/architecture/pages/chat.md` 仍写“当前代码库无实现/6 大资产 PLANNED” | 当前已有七类资产（含 plugin）、资产工作台与会话导航                    | 重写为 current/target 分栏，不再把历史规划冒充现状 |
| `docs/architecture/pages/work.md` 只写 M1–M3.5 已实现                     | E4 表明 preset contract、revision/review/窄屏仍 PARTIAL                | 增加可验证边界和未闭环项                           |
| ADR-15 附录仍以四个 slot 表述                                             | `MODE_SURFACES` 与 `ALL_SLOTS` 已含 Custom                             | 仅做事实性 amendment；不改 ADR 原始决策语义        |

Work 用户自建预设、Assistant scope、Custom 模式中心属于产品/架构裁决，不在审批前直接回写权威 PRD。先通过 D1–D5，再在 Slice 1 形成 ADR/PRD amendment。

### 0.5 方案对冲

**简单实现**：继续读取 `metadata.presetCategoryId`、当前 URL、左栏选择态和各面板请求结果，在 App 内拼一组 mode-specific 标签与 disabled 文案。

- 优点：改动小、短期可见。
- 缺点：刷新/跨 server/历史 Session 会漂移；Custom Snapshot、Assistant scope 和 Work revision 仍由不同 UI 猜测；测试只能证明页面恰好显示，不能证明耐久身份一致。
- 技术债：新增第三套产品身份真源，违反 ADR-11、ADR-14 与本报告根因结论。

**健壮实现（本计划选择）**：保留各领域耐久 owner，以 Core/Server 组合一个 discriminated、只读的 `SessionProductIdentity` 投影；公共字段来自 `SessionV2.Info`，模式专属字段引用 Work contract、Assistant scope、Custom Snapshot/Policy，App 只消费投影和 typed gate。

- 不把 Custom Snapshot 正文复制进 Session。
- 不用一个巨型 JSON 取代领域表。
- 不让 Header 成为状态 owner。
- API/schema 变更必须先过 ADR、兼容与 SDK 生成门禁。

该方案改动更广，但修一个 owner 可同时收敛 Header、disabled reason、刷新恢复、窄屏入口、列表状态和 E2E 断言；因此不选择简单实现，也不存在需要披露的“先写死后偿还”技术债。

---

## B. 文件级实施范围

### 18.1 共享契约与服务

- `packages/schema/src/session.ts`、新增 product identity schema、相关 schema tests。
- `packages/core/src/session/*`、Work contract/Assistant scope/Custom projection adapters、migration（仅 ADR 批准后）。
- `packages/server/src/groups/session.ts`、`handlers/session.ts`；legacy surface 复用同一 Core service。
- `packages/sdk/js/src/**/gen/*` 仅脚本再生。

### 18.2 App

- `packages/app/src/app.tsx`、server/route resolution、error page。
- `packages/app/src/pages/session*`、共享 Header、side panel/narrow contribution。
- `mode-workspace*`、`home-*`、Coding project/location owners。
- Work/Assistant/Custom 既有组件与纯模型；不新建平行页面外壳。
- `packages/app/e2e/real/**`、coverage manifest、现有 focused regression specs。

### 18.3 Desktop/CI/Docs

- `packages/desktop/src/main|preload|renderer` 仅沿既有 IPC 边界扩展测试性和 smoke。
- `.github/workflows/test.yml` 或独立 real/desktop workflow。
- `CONTEXT.md`、`ARCHITECTURE.md`、ADR/PRD/pages、review、technical debt、本计划。

### 18.4 禁止改动/禁止做法

- 不手改 SDK generated、migration index、schema.gen。
- 不把 `mockAigcfrogeServer` 变成 E4 backend。
- 不添加 production E2E bypass、万能 admin token、外部网络调用。
- 不复制 Custom Snapshot、Memory/KB/Artifact 正文到 Session identity。
- 不引入裸 localStorage 作为业务真源。
- 不用 `globalThis` mock、固定 sleep、catch-all error swallowing、`any` 或未解释 alias/star import。

---

## C. 技术债与远程 Issue 对账

当前分支 `global-shell-e2e` 相对 `origin/main` 为 `ahead 9 / behind 0`，但 worktree 含用户未提交修改。下表的“可在当前分支”只表示技术范围匹配，不表示已获准实施；生产代码、远程 Issue、commit/push/PR 均继续等待 Owner 审批。

| 来源/事项                                                                    | 对应 Slice        | 当前分支判定                | 实施/Issue 处置                                                                                                                                              |
| ---------------------------------------------------------------------------- | ----------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| §7 Chat 资产列表双路读取                                                     | S3                | **是，独立提交**            | 归并到既有资源 owner，以请求计数和 A→B→A 恢复测试放行。                                                                                                      |
| §7 Playwright HMR/产物竞争、Bun mock 互染、冷编译                            | S2/S3             | **是**                      | 先修隔离、冻结源码和 fixture owner；不以加 timeout 掩盖。                                                                                                    |
| §8 canonical/legacy/Draft/unknown route 债                                   | S4                | **是**                      | 本分支主责：fail-closed、typed recovery、query/hash 白名单与 prompt URL 清理。                                                                               |
| §8 Composer、Files、Terminal、真实后端门禁                                   | S2/S5             | **是**                      | 建 real-backend E4 harness；mock 只保留 E3 合同证据。                                                                                                        |
| §8 focused/full-suite、五 project 重复                                       | S3                | **是**                      | 基础 Chromium 跑业务全集，presentation 只跑差异矩阵。                                                                                                        |
| §8 Settings 深层、Desktop IPC/原生能力                                       | S10/S11           | **否，后续独立 PR**         | Web 可达性可先补；packaged Electron 与平台矩阵独立签字。                                                                                                     |
| §2 Assistant `global\|project` scope                                         | S1/S6/S9B         | **否，后续 schema/core PR** | 先 ADR + durable scope contract，再实现 UI；不得仅补 selector。                                                                                              |
| §7 状态栏 delegation 投影                                                    | S6 或独立 PR      | **条件性后置**              | 仅在 Core 已提供 Session/Location scoped projection 后消费；不得恢复消息启发式。                                                                             |
| §1 权限/break-glass、§3 Custom M2/M3、Work durable migration、全仓 import 债 | 非本分支主线      | **否，分别立项**            | 避免把安全、迁移和全仓重构塞进 E2E 分支；Custom 本计划只验证既有 snapshot/gate。                                                                             |
| `showToastV2` ownerless memo、directory picker rejection                     | S10/S11 前置小修  | **可做，但独立小 PR**       | 根因已知、改动小；分别补 owner 生命周期与 reject 回归，不与 route diff 混合。                                                                                |
| codegraph watcher 泄漏                                                       | 外部/本地工具基建 | **不在本仓库认领**          | 只在 S0 做环境门禁和证据记录；确认 owner 仓库后另报，不能宣称本计划修复。                                                                                    |
| Issue #44 Custom M1                                                          | S9C 仅验收残余    | **无需重实现**              | PR #45 已于 2026-08-20 合并（`f4556bc000c5162acf6d0000e085bfd151248ec2`）；建议获批后以合并证据关闭 #44。                                                    |
| Issue #40/#41/#42 Gemini bot 验证                                            | 本计划外          | **不适合本分支**            | #40/#41 的 triage run 失败，#42 的 run `32046128683` 已成功；它们是运维验证票，建议获批后合并结论并关闭，持续保障另建 deterministic workflow contract test。 |

现有开放 Issue 没有覆盖本计划的 P0 主线。若 Owner 要求 issue linkage，建议只为 S0–S5 新建 `test(app): establish real-backend product closure gates`；S6 之后按 Core identity、模式业务和 Desktop 分票，避免一个 Issue 吞掉八个 PR。创建/评论/关闭任何远程 Issue 都属于单独审批动作。
