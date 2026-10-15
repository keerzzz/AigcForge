# 上游 opencode v2 调研与 AigcForge 同步方案（2026-10-10）

> 状态：调研结论 + 方案提案；**策略/范围已确认（2026-10-10，见 §9）：选项 A 全量 re-fork + 双周窗口 + 保留 llm + 维护改名桥**，待排期执行
> 数据快照：fork `main` @ `d5376379f` vs 上游 `anomalyco/opencode` `v2` @ `55dde88`（2026-10-10）
> 机器可读清单：本目录 `data/`；复现脚本：本目录 `scan-divergence.sh`

## 0. TL;DR

1. **本仓库就是上游 v2 的 fork**：初始提交（2026-06-25）的 25 个包中 24 个与上游 v2 分支 `116ac93`（2026-06-24）逐字节一致，此后改名（opencode→aigcfroge）+ 裁剪（25→18 包）+ 3 个月自研演进（1,184 个提交）。所谓"同步到 v2"实际是**追赶上游 v2 主线的 3.5 个月增量**。
2. **增量规模**：上游基线以来 4,517 个提交；双侧合计 751 个共有文件存在真分歧（归一化后 ~15.4 万行 diff）、fork 独有 2,501 个文件、上游新增 2,479 个文件（均含测试/配置/资源，非纯源码）。
3. **结构性裂变**（不只是版本号升级）：`llm`→`ai` 改名、`opencode` 入口包被移除（`cli` 成为唯一入口）、`protocol`/`client`/`httpapi-codegen` API 契约生成链拆分、SQLite 驱动内联进 core、TUI 重写、Effect beta.83→rc.118、bun 1.3→1.4。
4. **已确认策略（2026-10-10）：选项 A 全量 re-fork，以双周窗口渐进执行**（§5-§6）：在 `v2-sync` 长期分支上以上游 v2 HEAD 为基座（改名桥过桥），按桌面端闭包裁剪后的 **1,707 文件**自研面（§3.4）逐窗口移植，最后一个窗口 cutover 切换 `main`；估算 8-10 个窗口。
5. 范围决策已确认（§9）：策略 A、保留 fork `llm`、常态化双周窗口、维护改名桥，且**只同步桌面端产品的完整依赖闭包**（19 个上游基座包 + fork 资产；`tui`/`cli`/`sdk`/`enterprise`/SQLite 基础设施包不移植，见 §6 R0）。

## 1. 上游 v2 分支现状

### 1.1 仓库与分支模型

| 事实 | 值 | 证据 |
| --- | --- | --- |
| 仓库 | `anomalyco/opencode`，MIT，212k stars | GitHub API |
| GitHub 默认分支 | `dev`（V1 维护线） | GitHub API |
| **工作主线** | `v2`（AGENTS.md 明示 PR 一律 base `v2`） | 上游 `AGENTS.md`、`CONTRIBUTING.md` |
| 当前版本 | `2.0.26`（2026-10-08 发布） | 上游根 `package.json`、`CHANGELOG.md` |
| HEAD | `55dde88` "feat(sdk): seed host plugins before recovery…"（2026-10-10） | `git log` |
| 分支历史规模 | 18,887 commits | `git rev-list --count HEAD`（blob:none 全历史） |
| 发布节奏 | v2.0.x 高频小步；仓库 CHANGELOG 仅保留最新一版 | `CHANGELOG.md` |

### 1.2 包拓扑（35 个顶层包 + `sdks/vscode` + `services/`；`console`/`stats` 内含子 workspace）

上游 `CONTRIBUTING.md` 给出的分层：

```
schema   共享 wire/存储契约
core     领域行为 + 持久化
protocol 公共 API 定义（139 endpoint，openapi.json 2026-09-13 重生成）
server   HTTP 服务器 + 运行时组装
client   生成的 TypeScript 客户端（protocol/server HttpApi 变更后 bun run generate，禁止手改）
cli      命令行入口 + 服务生命周期（原 opencode 包已移除）
tui / app / desktop / plugin / session-ui / ui / storybook
ai       LLM 抽象（2026-07-15 由 llm 改名而来）
```

fork 没有的包（20 个）：`ai`、`cli`、`client`、`codemode`、`console`、`containers`、`function`、`gui-extensions`、`httpapi-codegen`、`identity`、`latex`、`merman`、`plugin-browser`、`posts`、`protocol`、`simulation`、`stats`、`theme`、`util`、`web`（另有 `sdks/vscode`、`services/{www,update,files}`）。上游没有而 fork 自有的包：`aigcfroge`（入口）、`llm`、`effect-sqlite-node`。

### 1.3 工程规约要点（同步时要遵守的上游新规约）

- 改公共 Protocol/Server `HttpApi` 后必须从 `packages/client` 跑 `bun run generate`；客户端生成物不可手改。
- 依赖方向：Schema→Core/Protocol→Server；client 不依赖 Core/Server；`sdk` 组合三者。
- 无 Changesets；分支命名/commit 规范与本 fork 现行 AGENTS.md 同源（fork 的规范文本即继承自上游）。
- TUI stories 机制（`packages/tui/src/feature-plugins/system/storybook`）、主题 token 按语义角色取用。
- 依赖代际：`@effect/* 4.0.0-rc.118`（fork 为 `4.0.0-beta.83`）、`bun@1.4.2`（fork 为 `1.3.14`）。

## 2. 基线考证（证据链）

fork 的来历用四步还原，每步都有树级证据：

| # | 提交 | 事实 | 证据命令 |
| --- | --- | --- | --- |
| 1 | `c51269f7e`（2026-06-25 00:56 +0800）"chore: initial commit (slimmed version)" | 上游 v2 快照。初始树含 25 个包；与上游 `116ac93ddbc3bb7a900468fba6980f5dce850fc5`（2026-06-24，#33686）比对：**除 `packages/opencode` 外的 24 个包逐字节一致**；`console`/`stats` 为基线有而初始树已缺（fork 后续也删了，无影响） | `git ls-tree` 双侧比对（§附录 A-1） |
| 2 | `83e3651f6` "migrate brand to aigcfroge" | 恢复完整包集（含 console/stats/web/cli/docs/slack），并做品牌三段 codemod | `git ls-tree 83e3651f6 packages/` |
| 3 | `b410869a9`（PR #28）"chore: slim monorepo to desktop-only architecture" | 真正的裁剪：删除 cli/containers/docs/function/identity/slack/web/console/stats，落定 18 包 | `git log -- packages/console` |
| 4 | 之后 1,182 个提交 | fork 自研演进（MetaAgent、Product Mode、外部 CLI 委派、资产系统、kb/schedule/observability…） | `git log --name-only` 热度统计（§3.3） |

**嫁接点（graft point）：`116ac93`。** 此后任何"上游在某包上做了什么"的查询都可以用 `git log 116ac93..upstream/v2 -- packages/<pkg>` 精确定位（需先 `git remote add upstream https://github.com/anomalyco/opencode.git && git fetch upstream v2`）。

**改名深度**（决定上游补丁能否裸合并）：

- core 内 `@opencode/` 字符串残留：**0**（服务标签全部改为 `@aigcfroge/*`）。
- 全仓 `OPENCODE_` 残留仅 5 个文件，全部是构建产物或上游生态快照（`desktop/out/**`、`aigcfroge/dist/**`、`models-dev.snapshot.json`——后者是上游生态的 provider 环境变量名，**不该**被改名）。
- 结论：源码级改名是彻底的。品牌干净是资产；但上游任何补丁/文件都必须先过"改名桥"（§7）才能进本仓库。

## 3. 差距量化

### 3.1 包级差异（`data/summary.txt` 原样输出，改名归一化后）

```text
server (fork) vs server (upstream): identical=0 rename-only=1 diverged=25 diverged-lines=2546 forkonly=29 uponly=66
storybook (fork) vs storybook (upstream): identical=6 rename-only=1 diverged=13 diverged-lines=392 forkonly=5 uponly=12
script (fork) vs script (upstream): identical=0 rename-only=0 diverged=3 diverged-lines=57 forkonly=6 uponly=1
schema (fork) vs schema (upstream): identical=0 rename-only=0 diverged=24 diverged-lines=1534 forkonly=62 uponly=97
desktop (fork) vs desktop (upstream): identical=160 rename-only=1 diverged=28 diverged-lines=2543 forkonly=60 uponly=167
http-recorder (fork) vs http-recorder (upstream): identical=1 rename-only=0 diverged=7 diverged-lines=274 forkonly=15 uponly=22
effect-drizzle-sqlite (fork) vs effect-drizzle-sqlite (upstream): identical=1 rename-only=0 diverged=0 diverged-lines=0 forkonly=24 uponly=1
app (fork) vs app (upstream): identical=22 rename-only=0 diverged=46 diverged-lines=6776 forkonly=603 uponly=758
ui (fork) vs ui (upstream): identical=1346 rename-only=32 diverged=106 diverged-lines=6114 forkonly=117 uponly=167
sdk (fork) vs sdk (upstream): identical=0 rename-only=0 diverged=0 diverged-lines=0 forkonly=47 uponly=34
session-ui (fork) vs session-ui (upstream): identical=9 rename-only=1 diverged=63 diverged-lines=10493 forkonly=34 uponly=108
plugin (fork) vs plugin (upstream): identical=1 rename-only=0 diverged=3 diverged-lines=75 forkonly=39 uponly=70
llm: UPSTREAM-MISSING llm
effect-sqlite-node: UPSTREAM-MISSING effect-sqlite-node
tui (fork) vs tui (upstream): identical=13 rename-only=37 diverged=120 diverged-lines=33210 forkonly=70 uponly=331
core (fork) vs core (upstream): identical=19 rename-only=5 diverged=288 diverged-lines=82529 forkonly=540 uponly=467
aigcfroge (fork) vs cli (upstream): identical=0 rename-only=0 diverged=25 diverged-lines=7041 forkonly=850 uponly=178
```

口径说明：`diverged-lines` 是归一化后双向 diff 行数合计，**只用于工作量分级，不是精确移植行数**；`aigcfroge↔cli` 是名义映射（血统不同，基线的 opencode 包 vs 基线的 cli 包），其数字说明的是"几乎不相交"而非合并难度；`sdk↔sdk` 结构不同（fork 的 `sdk/js` 是 OpenAPI 生成物，上游 `sdk` 组合生成的 client），该行数字无合并含义。

### 3.2 两侧演进热度（文件触达次数，衡量"谁在主导这个包"）

| 包 | 上游触达（基线→HEAD，4,517 commits） | fork 触达（rebrand→HEAD，1,182 commits） | 主导方 |
| --- | ---: | ---: | --- |
| app | 5,692 | 2,448 | **双高热** |
| core | 4,523 | 2,012 | **双高热** |
| tui | 1,720 | 100 | 上游 |
| session-ui | 918 | 114 | 上游 |
| ui | 733 | 156 | 上游 |
| desktop | 1,085 | 71 | 上游 |
| schema | 264 | 215 | 双中 |
| server | 467 | 63 | 上游（但已裂变为 protocol/client） |
| plugin | 341 | 17 | 上游 |
| sdk | 157 | 150 | 双低但结构不同 |
| llm / ai | ai 2,429 | llm 30 | 上游重写 + 改名 |
| script / storybook / http-recorder / effect-drizzle-sqlite | ≤60 | ≤23 | 低频 |
| enterprise | 48 | 46 | 双低 |

（fork 侧热度中的 web 1272 / console 554 / stats 78 / cli 30 / docs 24 / slack 8 为删除操作的记录，非开发量。）

### 3.3 core 子系统集合差

**fork 独有（26 个目录，需在同步中保留并回归验证）**：`meta-agent`、`agent-asset`/`prompt-asset`/`skill-asset`/`command-asset`/`mcp-asset`/`plugin-asset`/`workflow-asset`（资产系统）、`composition`、`control-plane`、`custom-profile`、`delegation`、`flag`、`grant`、`id`、`installation`、`kb`、`observability`、`acp-client`、`cache`、`share`、`system-context`、`workflow`、`public`、`agent`、`aisdk`。

**上游新增（15 个目录，re-fork 基座自带、无需搬运）**：`kv`、`oauth`、`workspace`、`worktree`、`persistent-pty`、`instructions`、`instance`、`modal`、`models-dev`、`vcs`、`shell`、`environment`、`formatter`、`codemode`、`wellknown`。

**session/ 文件级**：fork 独有 `schedule*`（6 个）、`kb-service`、`personal-memory`、`verifier*`、`work-preset`、`work-review`、`correction-*`、`doom-loop`、`dag`、`cache-diagnostics`、`v2-runtime`、`v2-snapshot` 等；上游新增 `inbox`、`model-request`、`model-transport`、`subagent-*`、`system-prompt`、`instructions*`、`transfer`、`move`、`title`、`stats`、`usage`、`affinity`、`shell`、`skill` 等。同名核心（`execution`/`runner`/`store`/`projector`/`compaction`/`revert`）双侧都大改。

### 3.4 fork 侧移植面（策略 A 的权威工作量口径）

双向差异（§3.1）混入了上游侧漂移，**不能**当作 re-fork 的移植清单。re-fork 的移植工作量 = fork 自己相对基线做了什么，即 `git diff --name-status 83e3651f6..HEAD -- <18 个现行包>`（`data/fork-delta.txt`，汇总在 `data/fork-delta-summary.txt`）：

```text
544 core    496 app    384 aigcfroge    75 ui     66 schema    57 tui
 41 session-ui   37 desktop   22 llm   20 server   16 sdk   ≤9 其余 7 包
```

合计 **1,783 个新增/修改文件**（口径：A+M，不含删除）。按已确认的桌面端闭包裁剪（剔除 `tui` 57 / `sdk` 16 / `effect-sqlite-node` 1 / `effect-drizzle-sqlite` 1 / `enterprise` 1）后为 **1,707 个**（`data/desktop-closure-porting.txt`）——这就是选项 A 实际要搬回的自研面。

## 4. 上游结构性变化清单（同步的真正难点）

| # | 变化 | 时间/提交 | 对本仓库的影响 |
| --- | --- | --- | --- |
| 1 | `protocol` 从 server 拆出 | 2026-06-25 `56a37c36`（#33708，**基线次日**） | fork 的 server 需要补上契约层；API 已完成 139 endpoint 的审计（`V2_HTTP_API_AUDIT.md`） |
| 2 | `client` 生成链 + `httpapi-codegen` | 随 #33708 之后成型 | fork 的 `sdk/js`（OpenAPI 生成）对应物变成 protocol→client 生成链；app/desktop 消费端要切换 |
| 3 | `llm` → `ai` 改名重写 | 2026-07-15 `bb15b164` | fork 保留并演进了 `llm` 包（30 次触达）；上游 `ai` 2,429 次触达。**决策项**：保 fork llm / 迁上游 ai / 双轨 |
| 4 | `packages/opencode` 移除，`cli` 唯一入口 | 2026-07-20 `44b6938b` | fork 的 `aigcfroge` 包（850 个独有文件）已与上游 `cli`（178 个独有文件）几乎不相交；入口包按"fork 自有资产"处理，不追上游形态 |
| 5 | `effect-sqlite-node` 删除，驱动内联进 core | 2026-08-05 `3839aafa`（#40766） | 上游改用 `core/src/database/sqlite.{bun,node,workerd}.ts` + `#sqlite` 条件导入；fork 仍是独立包，R2 采纳上游布局并让独立包退役 |
| 6 | TUI 重写（feature-plugins + stories） | 基线以来持续 | `uponly=331`；fork 侧 tui 几乎没动，**可批发接收** |
| 7 | `slack`/`docs` 包移除 | 2026-08-21 / 2026-07-25 | fork 早已删除，无影响 |
| 8 | 新能力包 20 个（§1.2） | 持续 | R0 裁剪时决定引入范围（默认仅保留 `protocol`/`client`/`httpapi-codegen`） |
| 9 | Effect `beta.83`→`rc.118`、bun `1.3.14`→`1.4.2` | 持续 | R0 基座直接落在新代际；适配成本摊进全部移植文件（§8） |

## 5. 同步策略选项对比

| 选项 | 做法 | 成本 | 风险 | 适用动机 |
| --- | --- | --- | --- | --- |
| **A. 全量 re-fork** | 从 v2 HEAD 重新 slim + 改名，再把 fork 全部特性移植回去 | 最高：移植桌面端闭包内 1,707 文件 + core/app 内数万行 fork 改动；已确认按双周窗口渐进执行，功能冻结仅限 cutover 前最后 1-2 个窗口 | 移植期质量回归面巨大 | 产品决定"以后严格跟死上游"、愿意付一次大迁徙 |
| B. 分层追赶 | 按包分歧度分阶段（§6）：低冲突包批发接收，双高热包结构化合并 | 分期可控；每阶段有独立验收门禁 | 中间态双轨维护；需要纪律（每阶段闭环再进下一个） | 想保持自研节奏的同时持续吸收上游 |
| **C. 精选回移** | 用嫁接点 `116ac93` 定位上游 bugfix/安全补丁，逐个 cherry-pick 过改名桥 | 最低 | 漂移继续扩大，3 个月后再同步成本更高 | 只想要个别修复，暂不追版本 |
| **D. git 嫁接合并（作为 B 的底座）** | `git replace --graft c51269f7e 116ac93` + 上游侧先过改名 codemod 再 `git merge` | 一次性铺设成本小 | 751 个分歧文件的冲突仍需人工，但 git 从此记住血缘，后续每次同步冲突面递减 | 任何长期同步都应该先做这一步 |

**已确认（2026-10-10）：选项 A（全量 re-fork）+ 范围限定为桌面端完整闭包**，执行节奏为常态化双周窗口。合成后的形态是**渐进式 re-fork**：在长期分支上以上游 v2 HEAD 为基座、按窗口逐包移植 fork 自研面（§3.4 裁剪后 1,707 文件），最后一个窗口做 cutover 切换 main。选项 D 的 git 血缘嫁接在 re-fork 下不再必需（新基座直接从上游树出发），但**改名桥必须保留**（§7）：每个窗口 `fetch upstream → 全树 codemod → 进基座` 是固定工序。技术债声明：A + 双周窗口的代价是切换前 `main`（旧血统、继续发版）与 `v2-sync`（新基座、在建）双轨并存，每个窗口还要把 main 的新增自研补进 v2-sync——因此 §8 把"窗口投入比例"与"cutover 前冻结 main 重构类改动"列为强制纪律，且全部规划性债务已登记 `docs/technical-debt.md` §15。

## 6. 执行路线图（策略 A · 双周窗口制）

> 窗口 = 双周一次的同步投入；估算共 **8-10 个窗口（约 4-5 个月日历时间）**。每个窗口有独立验收门禁；未完成的项登记 `packages/app/e2e/coverage-manifest.json` 后才可关窗。

### R0 — 新基座（第 1 窗口）

1. `git remote add upstream https://github.com/anomalyco/opencode.git && git fetch upstream v2`。
2. 建长期分支 `v2-sync`，起点 = `upstream/v2` HEAD。
3. 裁剪为**桌面端依赖闭包**（已验证，非手写清单；复算命令见附录 A-6）：
   - **保留 19 个上游基座包**：`schema`、`util`、`protocol`、`httpapi-codegen`、`client`、`http-recorder`、`ai`、`codemode`、`plugin`、`plugin-browser`、`theme`、`simulation`、`core`、`server`、`ui`、`session-ui`、`gui-extensions`、`app`、`desktop`。
   - **不引入**：`cli`、`tui`、`latex`、`merman`、`sdk`、`effect-drizzle-sqlite`（上游已无人依赖，适配器内联进 `core/src/database/drizzle/`）、`console`、`containers`、`function`、`identity`、`posts`、`stats`、`web`，及 `sdks/`、`services/`。
   - 闭包依据（硬依赖边）：`core→{ai,codemode,plugin-browser,http-recorder,util}`、`server→{simulation,util,…}`、`desktop→gui-extensions`、`app→util`、`plugin→theme`、`tui→{latex,merman}`（tui 不入闭包故 latex/merman 亦不入）。**`ai` 是 core 的硬依赖，必须随基座进入运行时**（修正早期草案"ai 仅作参考"的错误判断）。
   - fork 侧运行时证据：`packages/desktop/src/main/server.ts` 用 Electron `utilityProcess` fork `aigcfroge server` sidecar，主进程仅 import `@aigcfroge/ui` 与 `@aigcfroge/app` 类型——桌面端运行时不含 `cli`/`tui`。
4. 全树跑改名桥 codemod（§7），产出"上游树 + AigcForge 品牌"的空基座。
5. drift 报告与 fork-delta 清单（`data/fork-delta.txt`、`data/desktop-closure-porting.txt`）固化为每窗口例行产物。
- 验收：基座 `bun install && bun turbo typecheck` 通过（此时无 fork 资产；基座无可运行入口，运行验证从 R4 起）。
- 子决策（默认裁掉）：若 R0-R3 期间需要可运行冒烟，可临时保留 `cli`（连带 `tui`/`latex`/`merman`），cutover 前删除。

### R1 — schema 与基础设施包（第 2 窗口）

- `schema`：按 fork-delta（66 文件，product-mode 等契约）移植到上游 schema 新结构。
- `http-recorder`/`script`/`plugin`/`storybook`：上游原样 + fork 小 delta 回放；`sdk/js` 的 fork 定制映射到 `client` 生成链（fork 的 `sdk` 包本方案下退役，不移植其 16 个 delta 文件）。
- 依赖代际随基座直接落在 Effect `rc.118` + bun `1.4.2`（A 方案无需单独升级 spike，但后续所有 fork 移植代码必须按 rc API 适配）。
- 验收：`bun --cwd packages/schema test`、`bun turbo typecheck`。

### R2 — core 移植（第 3-5 窗口，最大项）

- 权威清单：`data/fork-delta.txt` 的 core 段（544 个 A/M 文件），逐文件移植到新基座；上游新子系统（§3.3 的 15 个目录）随基座自带，无需搬运。
- SQLite：采纳上游内联驱动（`core/src/database/sqlite.{bun,node,workerd}.ts` + `#sqlite`）与内联 Drizzle 适配器（`core/src/database/drizzle/`）；fork 的 `effect-sqlite-node` 与 `effect-drizzle-sqlite` 两包退役（上游二者均无人依赖）。
- DB migration：fork 基线后新增的 migration 追加到上游序列尾部，重排时间戳并做双侧对照评审（做错会破坏存量用户库）。
- 对账基准：AGENTS.md "V2 Session Core" 8 条语义不变量，不做机械文件级替换。
- 验收：`bun --cwd packages/core test` 全绿；MetaAgent/Product Mode/委派/kb/schedule 的既有测试逐项过。

### R3 — 表层移植（第 5-7 窗口）

- 回放顺序按 delta 从小到大：`ui` 75 → `session-ui` 41 → `desktop` 37（含 sidecar 装配，`src/main/server.ts` 的 `utilityProcess` fork 模型保留）；`app` 496（Product Mode UI 深植其中）最后做。**`tui` 不在桌面端闭包内，不移植**（57 个 delta 文件随范围裁定剔除）。
- 运行验证口径：aigcfroge sidecar 要到 R4 才落地，本阶段 `app` e2e 的服务端由 `@opencode/server` 直启（或按 R0 子决策临时保留 `cli` 充当宿主）。
- 验收：受影响包 test + storybook 起服务冒烟 + `app` e2e 关键路径。

### R4 — aigcfroge 入口包与 llm（第 7-8 窗口）

- `aigcfroge`（384 个 delta 文件）整体平移，适配新 core/server 的装配差异（服务 ID、Location、bus 事件、client 生成物），并恢复 desktop 的 `utilityProcess` sidecar 全链路。桌面端入口 `src/node.ts`（Config/Server/bootstrap/Database）已验证 **tui-free**（0 个 tui 引用），sidecar 链路不受 TUI 退役影响。
- **TUI 宿主剥离**（tui 退役的连带面）：`aigcfroge` 硬依赖 `@aigcfroge/tui`（`package.json` + 20 个源文件引用，集中在 `src/cli/`），需随移植一并剥离交互式 TUI 模式，保留 server/sidecar 与非交互命令入口。
- `llm`（22 个 delta 文件）按已确认决策保留：适配新 schema/core，维持 `AIGCFROGE_EXPERIMENTAL_NATIVE_LLM` 双路径。
- 子决策（R4 时定）：基座的上游 `ai`（core 硬依赖，默认 AI SDK 路径）与 fork `llm`（native 实验路径）的组合方式——llm 是否包装/复用 ai，还是保持平行双轨。
- 验收：`bun --cwd packages/aigcfroge test` + sidecar 直启冒烟（`node.ts` 入口起 server）+ desktop 实机起动冒烟。

### R5 — Cutover 与常态化（最后一个窗口）

- 门禁（全绿才切换）：全仓 `bun turbo typecheck`、逐包 `bun --cwd packages/<pkg> test`、`app` e2e 全量、**存量 DB 升级演练**（旧库文件跑新 migration 序列）。
- 随 cutover 一并退役（桌面端闭包外）：fork 的 `tui`、`sdk`、`enterprise`、`effect-sqlite-node`、`effect-drizzle-sqlite` 包；若 R0 临时保留了 `cli`（连带 `tui`/`latex`/`merman`）一并删除。开发工作流相应迁移：TUI 的 `bun run dev` 路径消失，冒烟改走 `dev:desktop` / `dev:web` + sidecar。
- `main` 切到 `v2-sync` 血统（PR merge），发布一个过渡版本号。
- 常态化：此后每双周窗口执行 `fetch upstream → codemod → merge v2-sync → 全量门禁`，fork 自研 PR 正常走 `main`；`main` 与 `v2-sync` 在 cutover 后合一，双轨维护结束。

## 7. 改名桥（codemod）规格

- 三段映射：`opencode→aigcfroge`、`OpenCode→AigcForge`、`OPENCODE_→AIGCFROGE_`（接收上游变更时正向应用）。
- 服务标签：基线时是 `@opencode/v2/X`，fork 现为 `@aigcfroge/X`；上游现在也丢掉了 `/v2` 段（`@opencode/X`），codemod 后正好收敛。
- 已知例外：`models-dev.snapshot.json` 内的 `OPENCODE_API_KEY` 等是上游 provider 生态的环境变量名，**保留不改**；`desktop/out/**`、`aigcfroge/dist/**` 是构建产物，不参与 codemod。
- 逆向桥（fork→上游拼写）仅在向社区回贡献 PR 时使用。

## 8. 风险登记

| 风险 | 等级 | 缓解 |
| --- | --- | --- |
| **双轨维护税**：切换前 `main`（旧血统、继续发版）与 `v2-sync`（新基座、在建）并存，`main` 每个新增自研都要补进 `v2-sync`，窗口越多税越重 | 高 | 窗口投入比例建议 ≥50%；cutover 前 1-2 个窗口冻结 `main` 的重构类改动（只允许修 bug）；整体时间盒 10 个窗口封顶 |
| **TUI 宿主剥离**：`aigcfroge` 硬依赖 `tui`（20 个引用点集中在 `src/cli/`），退役 tui 需同步剥离交互式 TUI 模式；开发者日常 `bun run dev`（TUI）路径消失 | 高 | sidecar 入口 `src/node.ts` 已验证 tui-free，桌面链路不受影响；R4 剥离后冒烟改走 `dev:desktop`/`dev:web` + sidecar 直启；若未来要终端界面另行立项 |
| DB migration 追加与重排出错会破坏存量用户库 | 高 | R2 先做双侧 migration 对照表评审；R5 的存量库升级演练是 cutover 硬门禁 |
| fork 的 Session V2 核心移植到新基座时语义漂移 | 高 | 以 AGENTS.md "V2 Session Core" 8 条不变量为验收基准，非文件级 diff |
| Effect beta→rc 的 API 适配面落在全部 ~1,707 个闭包内移植文件上 | 高 | R0 基座直接落 `rc.118`；每窗口跑全仓 typecheck，适配问题在移植当时解决而非集中补课 |
| 上游 ~42 commits/天（4,517/108 天），窗口间隔内基座持续前移 | 中 | 每窗口固定工序 `fetch → codemod → merge`；drift 报告（`scan-divergence.sh`）作为窗口例行产物 |
| 双 AI 抽象并存：基座上游 `ai`（core 硬依赖）与 fork `llm`（决策保留） | 中 | R4 定组合方式（包装复用 vs 平行双轨）；此前不臆断，两轨并存跑通为验收底线 |
| SDK 消费端从 `sdk/js` 切到 `client` 生成物波及 app/desktop | 中 | R1 接生成链，R3 表层移植时统一消费；过渡期两套 SDK 并行提供 |

## 9. 已确认决策（2026-10-10）与遗留子决策

**已确认（用户拍板）：**

| # | 问题 | 决策 |
| --- | --- | --- |
| 1 | 同步策略 | **A 全量 re-fork**（双周窗口渐进执行，见 §6 R0-R5） |
| 2 | LLM 层 | **保留 fork `llm`**，适配新基座；上游 `ai` 仅作参考不接运行时 |
| 3 | 节奏 | **常态化双周窗口**，估算 8-10 个窗口 |
| 4 | 品牌 | **维护改名桥**（§7），每次同步对上游内容跑 codemod |
| 5 | 范围（同日补充） | **只同步桌面端产品的完整依赖闭包**：19 个上游基座包 + fork 资产（§6 R0 已列闭包依据）；`tui`/`cli`/`sdk`/`enterprise`/SQLite 基础设施包不移植，cutover 时退役 |

> 决策 #2 的执行细则被决策 #5 修正了一处：上游 `ai` 是 core 的硬依赖（闭包验证发现），必须随基座进入运行时；"保留 llm"指 fork 的 native 实验层继续存在，与基座 `ai` 的组合方式在 R4 裁定（§8 风险表）。

**遗留子决策（不阻塞开工，R0/R4 时定）：**

- `cli` 是否在 R0-R3 期间临时保留充当可运行冒烟宿主（默认不保留；保留则 cutover 时删除）。
- `enterprise` 包：无代码引用、不在 AGENTS.md 17 包拓扑内，默认随 cutover 退役（1 个 delta 文件不移植）。
- `effect-sqlite-node` / `effect-drizzle-sqlite`：上游均已无人依赖（适配器/驱动内联进 core），默认 R2 退役。
- 上游 `ai` 与 fork `llm` 的组合方式（包装复用 vs 平行双轨），R4 裁定。
- `aigcfroge` 的 TUI 宿主剥离边界（保留哪些非交互命令），R4 移植时定。

---

## 附录 A：复现命令

```bash
# A-1 基线考证（本仓库内执行）
git ls-tree --name-only c51269f7e packages/                          # 初始树
git ls-tree 116ac93ddbc3bb7a900468fba6980f5dce850fc5 packages/ > /tmp/base-trees.txt   # 需先 fetch upstream
git ls-tree c51269f7e packages/ > /tmp/forkinit-trees.txt
diff /tmp/base-trees.txt /tmp/forkinit-trees.txt                     # 差异仅 console/stats/opencode

# A-2 上游增量与时间线
git -C /tmp/opencode-v2 rev-list --count 116ac93..HEAD              # 4517
git -C /tmp/opencode-v2 log --diff-filter=D --format='%ad %H %s' --date=short v2 -1 -- packages/llm        # 2026-07-15 rename→ai
git -C /tmp/opencode-v2 log --diff-filter=D --format='%ad %H %s' --date=short v2 -1 -- packages/opencode  # 2026-07-20 removed
git -C /tmp/opencode-v2 log --diff-filter=D --format='%ad %H %s' --date=short v2 -1 -- packages/effect-sqlite-node  # 2026-08-05

# A-3 差异扫描（生成 data/）
./scan-divergence.sh . /tmp/opencode-v2 /tmp/v2sync

# A-4 两侧演进热度（§3.2 表的来源）
git log --name-only --pretty=format: 116ac93..HEAD -- packages/ | grep -v '^$' | awk -F/ '{print $2}' | sort | uniq -c | sort -rn   # 上游侧（在上游克隆内）
git log --name-only --pretty=format: 83e3651f6..HEAD -- packages/ | grep -v '^$' | awk -F/ '{print $2}' | sort | uniq -c | sort -rn  # fork 侧（在本仓库内）

# A-5 fork 侧移植清单（§3.4 / data/fork-delta.txt 的来源）
git diff --name-status 83e3651f6..HEAD -- packages/aigcfroge packages/app packages/core packages/desktop packages/effect-drizzle-sqlite packages/effect-sqlite-node packages/enterprise packages/http-recorder packages/llm packages/plugin packages/schema packages/script packages/sdk packages/server packages/session-ui packages/storybook packages/tui packages/ui

# A-6 桌面端依赖闭包（§6 R0 保留名单的来源；在上游克隆内执行）
for p in <候选包集>; do grep -oE '"@opencode/[a-z-]+"' packages/$p/package.json | sort -u; done   # 逐包列边，手工并集得到闭包
grep -l "opencode/effect-drizzle-sqlite" packages/*/package.json                                 # 空 = 无人依赖（vestigial）
grep -c "tui" packages/aigcfroge/src/node.ts                                                      # 0 = sidecar 入口 tui-free（fork 侧）
```

## 附录 B：本目录文件索引

| 文件 | 内容 |
| --- | --- |
| `scan-divergence.sh` | 可复现差异扫描器（本文所有包级数字的来源） |
| `data/summary.txt` | 16 包差异汇总（§3.1 原文） |
| `data/changed-<pkg>.txt` | 各包"改名归一化后仍分歧"的共有文件清单（结构化合并工作清单） |
| `data/forkonly-core.txt` / `data/forkonly-aigcfroge.txt` | fork 独有文件（同步中必须保留的资产清单） |
| `data/uponly-core.txt` | 上游 core 新增文件（R2 移植时的上游侧对照清单） |
| `data/fork-delta.txt` | **策略 A 的权威移植清单**：fork 相对基线的全部 A/M 文件（`git diff --name-status 83e3651f6..HEAD`） |
| `data/fork-delta-summary.txt` | 上表的每包汇总（§3.4 数字的来源） |
| `data/desktop-closure-porting.txt` | **桌面端闭包裁剪后的移植面**（1,707 文件；范围决策 #5 的落地清单） |
