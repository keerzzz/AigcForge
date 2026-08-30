# Custom Mode M3 Phase C 执行提示词

> 对应总计划：[custom-mode-composition-platform-implementation.md](custom-mode-composition-platform-implementation.md)
> M3 计划：[custom-mode-m3-mcp-approval.md](custom-mode-m3-mcp-approval.md)
> 前置：M2 总复审 APPROVED（R5）+ R6 整改（`b9c6d1077`）；**M3 Phase A**（`7a2804624`）、**Phase B**（`99dce8906`）、**Phase D**（`38d82e2b3`）、**Phase F0**（`f66f93d8c`，合并为 `229e3eb7d`）均已交付、经独立复审整改并合入本地 main——ADR-19 Accepted v1.0（C1/C2 已闭合）、ADR-20 Accepted v1.2、ADR-21 Accepted v1.0（2026-08-24 人类裁定 §2.5）
> 分析基线：**本地 `main@229e3eb7d`**（2026-08-24）。**本地 main 领先 origin/main 38 个提交**：按用户安排 M3 全部 Phase 完成后统一开一个 PR，因此以**本地 main** 为基线，不要因落后 origin 而回退
> 生成日期：2026-08-22（2026-08-24 第六次校准：Phase F0 已合入；提示词**收窄为纯 Phase C**）
> 当前开工阶段：**Phase C** connection / credential / health，分支 `mcp-connection`
> 用途：复制 `PROMPT START` 与 `PROMPT END` 之间的正文到新的执行对话

<!-- PROMPT START -->

你是 AigcForge 仓库（`/media/win_data/aigcfroge`）的高级全栈工程师。你的目标是按仓库协议，以 TDD 小切片执行 **Custom Mode M3 Phase C：MCP connection、credential 与 health**。

M3 的根问题不是「让 Profile 能选 MCP」。它要让外部工具在一个明确的 Location/Session/Agent/revision scope 内进入**唯一** ToolRegistry，并且凭证、授权、健康、撤销与无人值守策略全部 fail closed：

```text
Location -> Profile/composition (MCP binding = ref + fingerprint, 永不含 secret)
-> Plan (requested/effective/denied + credential/health) -> server re-freeze -> Snapshot
-> scoped registration (owner Scope, 非进程全局) -> canonical ToolRegistry
-> 调用前三重校验: Snapshot allowlist + registration fingerprint + Permission/ScopedGrant
-> pending approval request -> once/Session/Location grant (typed scope + expiry + revocation)
-> 撤销/断线/schema drift 立即使新调用失败
```

**Phase C 在这条链里的位置**：它交付上面第 3 行的**连接实体本身**——今天这一行完全不存在（生产装配是 `McpV2.noopLayer`，零消费方）。Phase B 交付了注册契约但只有测试消费方；Phase C 是它的**首个生产消费者**。Phase E（Snapshot/Resolver）与 Phase F（审批中心 UI）都要等 Phase C 交付的连接实体，所以本 Phase 的形状会被后两个 Phase 直接继承——**这里定错，后面两个 Phase 一起返工**。

## 0. 最重要的一条：Slice 0 已履行，从 Slice 1 开工

**Phase A / B / D / F0 都已合入本地 `main`，G3-1 / G3-2 / G3-3 / G3-4 四个 Gate 全过。** 本次只交付一个任务：

```text
Phase C   connection / credential / health        分支 mcp-connection
├─ Slice 0  ADR-21 独立事实复核        ✅ 已完成并经人类裁定（2026-08-24，ADR-21 → v1.1）
├─ Slice 1  typed MCPConnection owner + stdio     ← 从这里开工
├─ Slice 2  credential binding + 跨 Location 拒绝
├─ Slice 3  remote / OAuth + health 状态机
└─ Slice 4  disconnect / reconnect / drift
```

### 0.0 Slice 0 的结论与四条新裁定（照做，不重新论证）

**八条事实 8/8 全部成立，无一被证伪；§2.2「必须新增 `mcp_credential_binding`」经逐候选否决后保留。** 复核另外抓出三处 ADR 自身缺陷 + 一处未定项，人类已于 2026-08-24 全部裁定，**已写进 ADR-21 v1.1，施工照 v1.1 不照初稿**：

1. **绑定表 `workspace_id` 改 `not null default ''`（空串哨兵），不用 `COALESCE` 表达式索引。** 初稿 `unique(directory, workspace_id, server_name)` 里 `workspace_id` 可空，而 SQLite 把 `NULL` 视为互异 → `(dir, NULL, server)` 可无限重复插入，唯一约束在「未绑定 workspace」这一最常见情形下完全失效。裁定理由见 ADR-21 §2.2 v1.1（仓库无表达式索引先例、迁移走生成器快照管线、哨兵把不变量前移到列上）。**代价**：`Location.Ref` 侧 `workspace_id` 可空，写入需 `?? ""` 归一——**该转换必须集中在绑定 store 的单一编解码处**，散落到调用方就会出现两套表示。**必写断言**：workspace 缺省下同一 `(directory, server_name)` 第二次插入**必须抛唯一约束错误**。
2. **「轮换对绑定完全透明」是过度声明，已收窄。** `Credential.update` 原地改值保 ID（`credential.ts:121-129`），OAuth 主动刷新走这条（`integration.ts:436`）——这半透明。但 `Credential.create` 是 **delete-then-insert 且换新 ID**（`credential.ts:93-119`），而 key 录入与重新 authorize 都走它，**于是重新授权同一 integration 会让所有指向旧 `cred_` 的 binding 集体悬空**。裁定契约：解析悬空 ref **一律 typed fail closed + 要求 rebinding**，不得解出 `undefined` 继续连接（`Credential.get` 返回 `Info | undefined`，`remove` 删 0 行也静默返回 `void`，两条路径都不自报错，判空是连接 owner 的责任）。**必写断言两条成对**：`update` 路径透明 + `create` 路径悬空 typed fail。**只测前者恰好绕开会出事的那条。**
3. **止血 1 扩展到 WAL/SHM 侧车 + Windows best-effort 声明。** WAL 是强制启用的（`database/database.ts:27`、`packages/effect-sqlite-node/src/index.ts:69`），**最新提交的凭据行先落在 `-wal` 里**，只 chmod 主库等于把最新的秘密留在没收紧的文件里。实现为 open 后对主库/`-wal`/`-shm` 三路径**幂等 chmod 并容忍 `ENOENT`**。Windows 上 `chmod` 只能切 read-only 位，退化为依赖目录 ACL（先例写法 `ripgrep/binary.ts:88` 的 `if (process.platform !== "win32")`）——**报告不得声称跨平台等效**。open 到 chmod 之间的时序小窗如实记录、不追求消除。
4. **OAuth `expires` 过期 = typed fail 进 `auth-required`，Phase C 不实现 refresh。** 取 V1 MCP 的被动判定形状（`mcp/v2-auth.ts:139-144`），不取 provider 侧的主动 refresh（`integration.ts:432-437`）。理由见 ADR-21 §4.1 第 6 条，核心是：自动 refresh 会让连接 owner 顺带变成凭据生命周期 owner，违反 §2.1。**该路径只允许 typed fail，不允许悄悄实现 refresh。**

**这四条都不是起草方发现的。** 起草方是复审方，Slice 0 是「起草方不自批」的补偿控制——它生效了。**同理适用于你**：下面每一条施工事实，怀疑就去验，不要因为它写在提示词里就当真。

### 0.1 为什么 Gate 全过了还有一道门

[ADR-21 MCP Credential Custody](../architecture/adr/ADR-21-mcp-credential-custody.md) 已 **Accepted v1.0**（2026-08-24 人类裁定 §2.5：静态加密排除在 M3 之外，只做两项止血）。**G3-3 已通过，Phase C 解锁。** 但它带一条不可分割的前置条件：

- **它由复审方起草。** 按仓库既有做法，起草方与批准方必须分离——Phase A 的 ADR-19/ADR-20 由执行方起草、复审方批准，正是这个分离抓出了「引用不实」（C2）与整个 §2.6 BLOCK（R6-1/R6-2/R6-3 三项）。ADR-21 反过来了，所以它**不能由起草方自己核自己**。
- **补偿控制 = Slice 0，已于 2026-08-24 履行完毕。** 复核结论与由此产生的四条新裁定见 **§0.0**，全部已写入 ADR-21 v1.1。**施工照 v1.1，不照初稿。**
- **§2.2 经复核后保留**（逐候选否决：`credential` 加列违反 §2.1、`scoped_grant` 授权语义≠配置绑定语义、`IntegrationConnection` 是 12 行类型转发垫片且不落库、`workspace` 语义不符）。§2.1 不新建第二个 secret owner、§2.3 撤销不中断在飞连接、§2.4 先扫描后裁剪、§2.5 加密排除、§2.6 不动 V1 `mcp-auth.json`、§3 L4 只做绑定、Schema 复用 `mcp-scope.ts` 均为定案，照做不改。
- **这道门留在提示词里的意义已经变了**：它不再是你要过的门，而是一份证据——**四条缺陷全部由复核发现，起草方自己一条都没看见**。所以下面 §4 的每一条事实，怀疑就去验，不要因为写在提示词里就当真。

### 0.2 Phase C 的三个陷阱

**陷阱 A —— 「参考死代码」会把两个 bug 一起搬进第一个真实实现。** `packages/aigcfroge/src/mcp/v2-bridge.ts` 全仓只有两处引用：它自己的 barrel 行（`:1`）和一句文档注释（`:155`）。它是**死代码**，不是「在服役的旧实现」。它的 `cfg: any` 曾掩盖两处真实的键名不匹配。**可以读它找形状，但每一个键名都必须回到 `McpScope.McpServerBinding`（`packages/schema/src/mcp-scope.ts:63`）核对。** 照抄 = 把两个 bug 搬进产品第一个能跑的 MCP 实现。

**陷阱 B —— 「只跑 core 不算跑门禁」，而 Phase C 恰好站在 Phase D 踩雷的同一块地上。** Phase D 的报告只贴了 core 的全绿数字，实际带着 **9 个实例 HTTP 回归**合过来（`session task` 读回 `[]`、`task is not owned by session` 的 500）。根因是 `ScopedGrantStore.locationLayer` 用 `Layer.provideMerge` 提供 Database，导出了**第二个内存 SQLite** 并遮蔽共享实例，写读分家；core 单测测不到，因为它们各自直接组合 Layer。**Phase C 要新增连接 owner 的 location 层、要动 Layer 拓扑、还是 `McpRegistration` 的首个生产消费者——`bun --cwd packages/aigcfroge test test/server/` 必须真的跑完并贴数字（约 10 分钟）。**

**陷阱 C —— secret 的「不泄漏」必须给出验证方式，不是给出结论。** 报告里写「已确认材料未进 log」等于没做。必须说清**怎么验的**：喂一个可识别的哨兵值进凭据，然后在 Snapshot bytes / event 行 / 日志输出三处分别断言它不出现。并且日志经 `CredentialScanner` 时**必须先扫描后裁剪**——先截断再扫描等于把秘密切成扫不出来的碎片放过去。注意 `CredentialScanner` 是正则文本扫描器（1 个生产 `.scan()` 调用点：`packages/core/src/workflow/workflow-runner.ts:436`），**它不是密钥保护层，不能当既有安全层倚靠**。

### 0.3 Slice 0 已履行的复核记录（追溯用，勿重做）

复核方逐条独立复跑了 ADR-21 §1.1 的 8 条事实，结论 **8/8 成立**；§1.2 三个结论均被事实支撑；§2.2 保留。**不要重做这项复核**，但下面两条留给你直接用：

- **可以当已验事实用的**：凭据明文入库无 scope 列（`credential/sql.ts:5-14`）、`Credential` 是进程级单例（`location-layer.ts:274` 在 `dependencies` 内，lookup 于 `:268` 以 `Layer.fresh` 收尾）、`auth.json`/`mcp-auth.json` 均 `0o600` 而库文件无 chmod、`CredentialRef` 契约已定义但零生产消费方（`mcp-scope.ts:51-56`、`:89`）、Snapshot 无 credential 字段、`credential.active` 零引用。
- **复核过程里两条对施工有直接价值的额外发现**：① `mcp-auth.json` 有 **V1 与 v2 两代并存文件**（`mcp/auth.ts:81`、`mcp/v2-auth.ts:81`），都是 `0o600`，**都不许动**（ADR-19 §2.1 并存裁定）；② `CredentialScanner` 的 `workflow-runner.ts:70` 那处 `input.scan(...)` 是 handoff 渲染入参，**不是** scanner 的第二个调用点——唯一生产调用点仍是 `:436`，且该处已有「先扫描后裁剪」的正确实现与注释（`:66-72`），**新日志面照抄那个形状即可，不需要修复动作**。

## 1. 开工门禁

先执行并记录：

```bash
pwd
git branch --show-current
git status --short --branch
git remote -v
git fetch --prune origin
git log -1 --format='%H %ad %s' --date=iso main
git log -1 --format='%H %ad %s' --date=iso origin/main
git rev-list --left-right --count main...origin/main
git log --oneline --decorate -20 main
```

规则：

1. **开工前提：Phase A / B / D / F0 都已合入本地 main。** 先 fetch 并审计最新 main，确认 `7a2804624`（Phase A）、`99dce8906`（Phase B）、`38d82e2b3`（Phase D）、`229e3eb7d`（Phase F0 合并提交）都在 main 上；`packages/core/src/grant/store.ts`、`packages/core/src/permission/approval-presence.ts`、`packages/core/src/tool/mcp-registration.ts` 必须存在，且 `grant/store.ts` 里必须能找到 `export const listFilter`（F0 交付物，见 §4.1）。**注意本地 main 领先 origin/main 38 个提交**（按用户安排，M3 全部完成后统一开一个 PR），所以以本地 main 为基线、不要因为落后 origin 而回退。若上述提交或文件缺失，说明你在另一个克隆里，停止并报告。
2. 不覆盖、回滚、清理或提交用户已有改动。若 main 有无关脏改动，先报告并隔离本任务文件；禁止 `git reset --hard`、`git checkout --`、盲目 `clean`。**已知无关在途文件：`docs/research/agent/Codex Harness 深度调研.md`（用户资料，保留原样，不要提交进本任务的 commit）。**
3. 分支策略（M3 计划 §7）：`mcp-scope-adr`（Phase A，已合入）→ `mcp-registration`（Phase B，已合入）→ `scoped-grants`（Phase D，已合入）→ `approval-preflight`（Phase F0，已合入）→ **`mcp-connection`（本次 = Phase C）** → `mcp-composition`（Phase E，待 Phase C 交付连接实体）、`approval-center`（Phase F 本体，需产品定界面）。从最新**本地** `main`（`229e3eb7d`）建分支。分支名不超过三个短词、无 slash。M3 各阶段在本地依次合入 main 成链，**不逐阶段推送、不逐阶段开 PR**。
4. 未经用户确认 remote、issue、最终 diff、commit/PR title，不 push、不创建 PR。禁止 `--no-verify`。
5. 测试永不从仓库根运行。用 `bun --cwd packages/<name> test --timeout 30000`。根目录只跑 typecheck/lint/protocol/diff 等非 test 门禁。
6. **创建 custom session 的新测试文件必须自己拿 kill switch**：在文件作用域调用 `withCustomModeEnabled()`（`packages/core/test/lib/product-mode.ts`），并用 `env -u AIGCFROGE_CUSTOM_MODE bun --cwd packages/core test <file>` 单跑验证。放进 `describe` 里只覆盖那一个 block，不够；靠别的测试文件泄漏的 env 通过 = 本地绿 CI 红（M2 实际踩过）。
7. **`bun --cwd <pkg> run <...>` 一律跑不通**：它会打印 `bun run` 的 usage、什么都不执行、**并且 exit 0**。所以迁移检查要写 `cd packages/core && bun run script/migration.ts --check`，包脚本要写 `bun --cwd packages/app test:unit`（不带 `run`）。这条不是迁移脚本特有的，见 [docs/testing.md](../testing.md) §0。报告里照实写你实际敲的那一行，不要抄提示词——**照抄这个形式会得到一个什么都没跑的绿色退出码**。

## 2. 必读协议与计划

开工前完整读取，不依赖本提示词转述：

```text
CLAUDE.md
AGENTS.md
ARCHITECTURE.md
DESIGN.md
docs/testing.md
.aigcfroge/skills/protocols/SKILL.md
.aigcfroge/skills/enterprise-code-standard/SKILL.md
.aigcfroge/skills/reuse-first-refactor/SKILL.md
.aigcfroge/skills/quality-to-pr/SKILL.md
docs/architecture/adr/ADR-17-custom-mode-composition-platform.md
docs/architecture/adr/ADR-18-custom-mode-workflow-execution.md
docs/architecture/adr/ADR-19-mcp-scoped-registration.md
docs/architecture/adr/ADR-20-scoped-grant-model.md
docs/architecture/adr/ADR-21-mcp-credential-custody.md
docs/prd/custom-mode-composition-platform.md
docs/roadmap/custom-mode-roadmap.md
docs/plan/custom-mode-composition-platform-implementation.md
docs/plan/custom-mode-m3-mcp-approval.md
docs/review/AigcForge_CUSTOM_M2_REVIEW.md
docs/technical-debt.md
specs/v2/session.md
specs/v2/tools.md
specs/v2/schema-changelog.md
packages/core/src/tool/AGENTS.md
```

**ADR-19 / ADR-20 / ADR-21 三份是本 Phase 的裁定真源，必须完整读**，不要只读本提示词 §4 的摘要。

随后只为当前 slice 加载专题协议：

- Effect/Core：`.aigcfroge/skills/effect/SKILL.md`、相关 package `AGENTS.md`。
- Database：`.aigcfroge/skills/database/SKILL.md`、migration/schema owner 与测试（credential binding 表强制）。
- HTTP：`packages/aigcfroge/src/server/routes/instance/httpapi/AGENTS.md`、`packages/aigcfroge/test/server/AGENTS.md`。
- App/UI：`packages/app/AGENTS.md`、`.aigcfroge/skills/frontend-theming/SKILL.md`。

**M2 复审报告必读 §2.5 与 §3。** 它记录了 11 项 P0/P1 的根因与修法，其中 3 条直接决定 M3 的设计边界（见 §4.6）。

## 3. 锁定 M3

只执行 Phase C（对应 M3 计划 §3）：

```text
Phase A  Registration/Grant ADR 与 Schema 契约       分支 mcp-scope-adr       ✅ 已合入 main（7a2804624）
Phase B  canonical scoped registration              分支 mcp-registration    ✅ 已合入 main（99dce8906）
Phase D  ScopedGrant 与 PermissionEffective          分支 scoped-grants       ✅ 已合入 main（38d82e2b3）
Phase F0 审批中心前置切片                            分支 approval-preflight  ✅ 已合入 main（f66f93d8c → 229e3eb7d）
Phase C  connection、credential 与 health            分支 mcp-connection      ← 本次任务
--- 以下不得开工 ---
Phase E  Resolver/Snapshot 与运行依赖                分支 mcp-composition    （依赖 Phase C 交付的连接实体，今天没有可解析的对象）
Phase F  HTTP/SDK/App 审批中心本体                   分支 approval-center    （需产品先定界面；V2 端点与事件已存在，缺的纯粹是客户端）
Phase G  故障注入与灰度                                                      （验的是 C/E/F 的边界，三者未齐无从注入）
```

执行顺序与计划 §3 的字母序不同（D 先于 C，F0 先于 F 本体），因为排程按 Gate 与依赖的实际状态，不按字母。

开始前输出：`M3 / 当前 Phase / Gate 状态 / 基线 / 分支 / 非目标`。

### M3 禁区（计划 §6，违反即停止）

- 不把 secret、executor、MCP client 存进 Snapshot／event／log；Snapshot 只存 opaque ref + fingerprint。
- **不把 `PermissionSaved.always` 改名冒充 once/Session/Location grant。** 它是既有 Project 语义，改名即静默迁义。
- 不新建第二个 Tool registry / executor / permission engine。ToolRegistry 仍是唯一执行入口，leaf Permission assert 仍是最终授权边界。
- **不重新引入进程级「最后注册者胜」。** registration scope 必须沿用 owner Scope 模型（`task-driver.ts` 的 `Context.Reference` 范式是标准答案）。
- 不让 cleanup 只依赖手工 Map 删除而无 owner Scope。**本 Phase 多出一类被清理对象：子进程。**
- `ask` 在 unattended/headless 状态不得无限等待，也不得默认 allow。
- 不开放 Plugin runtime（M4）、Code Presentation（M5）、external CLI、judge。
- 应用级审批入口只聚合 pending request，**不成为「应用级永久 allow」**。
- 运行状态只进 DB，不回写 Profile/资产文件，不在 Profile/Task/Session 三处复制再靠事件猜测同步。

## 4. 已确认的架构事实

以下事实经独立核查落到 `file:line`。**[M3 计划 §0](custom-mode-m3-mcp-approval.md) 是完整版，开工必读**；本节只列会直接约束你设计的部分。若最新 main 已改变，必须用代码/测试证据更新计划后再施工，不能静默偏离。

**注意**：本节是转述。Slice 0 复核 ADR-21 时**不得引用本节**，必须回到源文件自己验（§0.3 第 2 问就是为此设计的）。

### 4.0 先记住这六条反直觉事实（否则你会照着不存在的东西写代码）

1. **产品今天完全不连接任何 MCP server。** 生产装配是 `McpV2.noopLayer`（`packages/aigcfroge/src/effect/app-runtime.ts:195`），`McpV2.Service` 零生产消费方；`packages/aigcfroge/src/mcp/v2-bridge.ts` 是**死代码**（全仓仅两处引用：自己的 barrel 行 `:1` 与一句文档注释 `:155`）。Phase C 是写**第一个能跑的实现**，不是重构现有 bridge。要实现的接口很小：`McpV2.Interface`（`packages/core/src/mcp/mcp-v2.ts:13-21`）只有 4 个方法——`start` / `stop` / `tools` / `callTool`。**接口小不等于问题小**：难点全在生命周期、凭据与失败语义，不在方法数量。
2. **但 V1 MCP 在跑，而且已有 HTTP 面。** `packages/aigcfroge/src/mcp/index.ts`（979 行），经 `MCP.node` 挂载于 `packages/aigcfroge/src/server/routes/instance/httpapi/server.ts:314`，路由见 `groups/mcp.ts:33-37`（`/mcp`、`/mcp/:name/auth`、`/mcp/:name/auth/callback`、`/mcp/:name/auth/authenticate`、`/mcp/:name/connect`）。ADR-19 §2.1 已裁定 V1 与 canonical **并存不合并**，迁移归 M4。**不要默认它不存在，也不要动它的在役语义。**
3. **另有一整套 Location-scoped 的 MCP 资产子系统在服役**（`packages/core/src/mcp-asset.ts`、`mcp-asset-service.ts`），其 `configJson`（`packages/schema/src/mcp-asset.ts:59`、`:91`）是不解码的 opaque 串（≤100000 字节）。ADR-19 §2.9 裁定写入面必须经 `McpScope.McpServerBinding`（`packages/schema/src/mcp-scope.ts:63`）解码校验。**写入面加固从这里开始，别新造。**
4. **`ToolRegistry.register` 本来就是运行时动态 + Scope 清理 + 冲突 last-wins。** 缺的是 identity/placement 契约，而 Phase B 已经补上。但 **registration fingerprint 仍是新概念**——fingerprint 今天只出现在 resolver/schema，registry 内 0 命中。
5. **凭据是明文、全局、双 owner。** `CredentialTable`（`packages/core/src/credential/sql.ts:5-14`）以 `value: text({mode:"json"})` 逐字写入，无加密，且**没有任何 scope 列**。`Credential.defaultLayer` 位于 `packages/core/src/location-layer.ts:274`，在 `dependencies:` 数组**之内**（约 `:271-296`），**不在** LayerMap 的 lookup 内（lookup 以 `Layer.fresh` 收尾于 `:268`）——所以它是进程级单例，跨 Location 隔离今天**结构上不可能**。`auth.json`/`mcp-auth.json` 完全绕开 Credential service，且以 `0o600` 落盘（`packages/aigcfroge/src/mcp/auth.ts:81`；`writeJson(path, data, mode?)` 签名见 `packages/core/src/fs-util.ts:37`），而秘密最集中的 SQLite 库文件**没有任何 chmod**。**文件存储比数据库更严**，这个倒置就是 ADR-21 §2.5 的依据。另外：Snapshot v2 也还没有任何字段能装 opaque ref。
6. **unattended 已经 fail-closed；真正挂起的是「有人值守但没客户端」。** 相关但不属于 Phase C：V2 的 pending/reply 端点与 `permission.v2.*` 事件都已存在并已挂载，缺的纯粹是客户端（app/tui/session-ui/ui 对 `permission.v2` 零消费）。**那是 Phase F 的事，本 Phase 不碰。**

### 4.1 已交付接缝（首要复用候选，禁止重建）

- **`McpRegistration`（`packages/core/src/tool/mcp-registration.ts`）——本 Phase 的主接缝**：已有 `mcp_<server>_<tool>` 命名空间、全或无语义、typed `InvalidServerNameError`（`:14`）/ `McpNameCollisionError`（`:23`）/ `McpToolNameTooLongError`（`:41`）、`MAX_TOOL_NAME = 64`（`:57`）、按 placement 求值的冲突检查 `registry.registeredNames(input.sessionID)`（`:104`）。**它今天只有测试消费方，Phase C 的连接 owner 是它的首个生产消费者。** 禁止新增第二个 registry / executor；**它的 typed 错误语义不许为了「让连接跑通」而放宽**。
- **`packages/core/src/grant/`（Phase D 的 grant owner）**：`ScopedGrantStore` 是唯一 CAS 写入者，状态变更写在 `EventV2.publish(..., { commit })` 的 commit 回调里、与事件行同事务，`seq + 1 === grantRevision` 守卫，0 行更新抛 typed error。`findValid` 是**授权咨询路径**：SQL 侧过滤 `consumed_at IS NULL AND revoked_at IS NULL`，JS 侧做 `isExpired` 与通配 action/resource 匹配（通配无法下推 SQL）。`decodeRow` / `toInfoSafe` 是容错解码路径——**新增读路径必须走它**，不要再写 `rows[0]` 直解。**照抄的是既有 durable owner 模式，不要发明第二套一致性方案。**
- **`packages/core/src/permission/approval-presence.ts`**：应答方连接事实源，进程级单例（`LocationServiceMap` dependencies），两个 SSE 面各按连接 Scope `bindResponder()`。`PermissionV2` 以**硬依赖**取用（首版用 `Effect.serviceOption` 且无人提供，导致全模式 ask 静默硬拒出厂）。本 Phase 不需要动它，**但不要把它改回可选**。
- **`packages/core/src/permission/effective.ts`**：`DANGEROUS_ACTIONS` 与 `READONLY_CEILING_ACTIONS` 的**单一真源**，均为裁定项。复用，禁止另抄。
- **Phase F0 刚产生的三条范式，Phase C 直接沿用**：
  - **纯谓词导出**：`ScopedGrantStore.listFilter` / `retentionCutoff`（`packages/core/src/grant/store.ts:144`、`:159`）把查询谓词导出成纯构造函数，于是 `EXPLAIN QUERY PLAN` 断言跑在**生产同一个谓词**上。手抄一份到测试里，会在生产漂移后继续绿——F0 一审就是这么被打回的。
  - **owner-Scope 周期维护**：`cleanupLayer` 用 `Effect.forkScoped({ startImmediately: true })` + `Schedule.spaced` 挂在 owner Scope 上；在役先例三处：`tool-output-store.ts:200`、`integration.ts:399`、`models-dev.ts:239`。**health 轮询/重连调度照这个形状写。**
  - **不往共享契约塞可选字段**：apply 结果拿到了自己的响应契约（`AgentAsset.ApplyResult = { asset, warnings }`），而不是给共享的 `AgentAsset.Info` 加可选字段——否则同一字段在另一条端点上**结构性恒缺**，那是契约谎报。**connection / health 的返回形状同理：谁需要就给谁自己的契约。**
- **`packages/core/src/tool/task-driver.ts` 的 `Context.Reference` 范式**：scope 由 Context/owner Scope 决定，不由进程全局最后写入者决定。
- **测试装配**：实例 HttpApi 测试走 `HttpApiApp.routes` 真实装配；`packages/core/test/lib/product-mode.ts` 的 `withCustomModeEnabled()`；迁移测试范式见 `packages/core/test/database-migration.test.ts`（新建表看 `session_composition_snapshot` 与 `scoped_grant` 两例：clean / existing / rerun 三条腿）。

### 4.2 M0-M2 固定裁决（M3 不得推翻）

- Custom 一律 V2-native；服务端 re-freeze，Session+Snapshot 原子事务；exact retry 幂等，digest 不同即 conflict。
- Snapshot bytes/digest 写入后不可 update；运行中不采用最新资产，升级只能 fork/new Session。
- allowlist 不只写进 Prompt；task 与 child create 双层强制。
- 运行依赖检查经 `SessionComposition` 单点，不在 handler/App 复制。
- 旧客户端不得看到/解码 Custom 为 Coding；capability 矩阵在 M3 全部新端点上继续保持。
- 运行状态只进 DB，不回写 Profile/资产文件，不在 Profile/Task/Session 三处复制再靠事件猜测同步。
- UI 只投影服务端状态；不在客户端推演授权、frontier 或成功语义。**health 六态尤其适用这一条。**

### 4.3 Gate 现状：四项全过，G3-3 带 Slice 0 前置

- **G3-1 已通过**（ADR-19 Accepted v1.0，条件 C1/C2 已闭合）。
- **G3-2 已通过**（ADR-20 Accepted v1.2，§2.6 两半均已 Accepted，attended 裁定为 `ask`）。
- **G3-3 已通过**（ADR-21 Accepted v1.0，2026-08-24 人类裁定 §2.5）——**但带 Slice 0 前置**，理由见 §0.1：起草方是复审方，独立事实复核是「起草方不自批」的补偿控制。
- **G3-4 已通过**（三问由 ADR-20 §2.7 / §2.6 / §2.8 回答）。

**本 Phase 不重新讨论任何已定案项。** 与 Phase C 直接相关、照做不改：

- ADR-20 §2.2：deny 恒胜出；grant 只存 allow（Schema 钉死 `Literal("allow")`）；仅 `ask` 才查 grant。
- ADR-20 §2.4：`scoped_grant` 单一 CAS 写入者 + 同事务事件 + 0 行必抛。**新增 binding 表照这三条写。**
- ADR-20 §2.5：grant 与 Snapshot audit digest 永不互为真源。
- ADR-20 §2.8：**不存在应用级永久 allow**；浏览器侧既有 auto-accept 存储不是服务端 grant，禁止混入。
- ADR-21 §2.1 不新建第二个 secret owner、MCP 侧只持 opaque ref；§2.2 隔离的是「哪个 Location 被授权用哪条秘密」而非秘密本身（**唯一可被 Slice 0 推翻的一条**）；§2.3 撤销绑定不删 `Credential` 行、**不中断在飞连接**（诚实边界，不得虚称即时生效）；§2.4 先扫描后裁剪，scanner 不是密钥保护层；§2.5 静态加密排除在 M3 外，只做两项止血（DB 文件权限对齐 + 解码期拒绝秘密字面量）；§2.6 不为「统一凭据」去改 V1 `mcp-auth.json`。

定案结果同步 `specs/v2/schema-changelog.md`。**只允许追加/更新状态**；删除既有定案段落必须显式说明理由。Phase A/B/D/F0 四条条目已在其中，其中 **Phase D 那条被复审修正过三处不实陈述——不要改回去**。

### 4.4 M4/M5 硬缺口（M3 不得提前实现）

- Plugin Asset 不是 Installed Extension；缺 provenance/trust/pinned revision/staged rollback/quarantine（M4）。
- Code Presentation 必须使用成熟隔离引擎并证明 Native/Code 等价（M5）。

M3 硬性非目标：Plugin runtime（M4）、Code Presentation（M5）、external CLI、judge、Workflow 语义改造。

### 4.5 Phase C 必须结清的欠账与仍开放项

**必须在本 Phase 结清（technical-debt §3.2）**：

1. **canonical 工具名 64 字符共享预算无截断策略。** `mcp_`（4）+ server + `_`（1）+ tool 共享 `Tool.validateName` 的 64 上限；实测 server 23 字符 + tool 38 字符 = 66 即越界，报 typed `McpToolNameTooLongError`。**刻意不在 Phase B 定**：canonical 名进 Snapshot catalog 与工具指纹（ADR-17 §2.4 / ADR-19 §2.6），一旦定下就是**不可变命名契约**，必须拿真实 server 目录数据决定一次。
2. **ADR-19 §2.7 隔离矩阵 #1（跨 Location）与 #4（V1 单向隔离）的连接期集成断言。** Phase B 时无连接实体无法断言，Phase C 有了连接实体就要补。

**仍开放、本 Phase 不碰**：`MAX_STEPS` 等图不变量不在解码期强制；`timeoutSeconds` 省略即无超时；MCP 冲突域不是 Location-scoped——`ApplicationTools.layer` 在 LayerMap `dependencies` 里（进程全局），所以 Location A 注册的应用工具会占掉 Location B 的同名 MCP 工具名。方向是 fail-closed（不会遮蔽、不会跨 Location 泄漏工具），故非安全缺陷，但它让 §2.7「跨 Location 隔离」对冲突域不成立。**写 §2.7 #1 断言时要知道这个边界在哪，不要断言一个今天不成立的事然后去改产品让它成立。**

### 4.6 已确认并修复的 M2 P0（不要重做，但要记住教训）

M2 带着「多 Agent 委派在真实 Provider 上跑不起来」这个 P0，穿过 **R1–R5 五轮复审 + 全套门禁（typecheck / 单测 / lint / exerciser / e2e）全绿**合进了 main。原因只有一个——**没有任何测试驱动一个真实的 provider turn**。已于 2026-08-23 修复（合并提交 `b9c6d1077`，把每轮主 agent 门禁的豁免收窄到 `session.mode === "custom" && session.parentID !== undefined`），**不要重做**。

**这个教训在 Phase C 的三种等价形态**：

1. **只跑 core 不算跑门禁。** Phase D 交付时报告只贴了 core 的绿数字，实际带着 **9 个实例 HTTP 回归**合过来。根因是 `Layer.provideMerge` 导出第二个内存 SQLite 并遮蔽共享实例；core 单测测不到，因为它们各自直接组合 Layer。**Phase C 是 `McpRegistration` 的首个生产消费者、要新增 location 层、动同一批 Layer 拓扑——`bun --cwd packages/aigcfroge test test/server/` 必须真的跑完并贴数字。**
2. **测试名声称什么，断言就必须真的观察到什么。** Phase B 有一条名为「reveals the previously registered tool」的测试用了两个无法区分的处理器，关闭前后断言字面完全相同——它证明的是「还在」，不是「露出了前一个赢家」。**本 Phase 的高危同型：「子进程被杀掉」写成断言 Scope 关闭没报错；「材料没进日志」写成断言日志非空。**
3. **harness 提供的东西，生产装配未必有。** Phase D 首版的 presence 用 `Effect.serviceOption` 而无人提供，测试却因为每个 harness 自己补了那层而全绿。**本 Phase 的高危同型：测试里手搓 Layer 组合让连接 owner 拿到 `Tools.Service`，而生产装配的 Layer 顺序根本组不出来。**

## 5. 工作拆解

每个 slice 独立红绿，不要一把梭。每个 slice 开始前建立：

### 5.1 Reuse table

```text
candidate | definition | callers/tests | compatibility | decision | rejection reason
```

必须查询 owner、调用方、注册路径、近邻测试与相关 Git 历史。符号/调用链优先 codegraph MCP（`search`/`node`/`callers`/`callees`/`impact` 无预算限；`explore` 限 2 次）；字符串/flag/i18n/path 用 `rg`。

新增前遵循：**复用 -> 删除 -> 归并 -> 重构 -> 新增**。禁止复制 Session、ModeWorkspace、ToolRegistry、Permission、Agent registry、asset transaction、Workflow state 或 Plugin lifecycle owner。§4.1 的接缝是首要复用候选。

**本 Phase 的 reuse table 有一条特别值钱**：`McpV2.Interface` 只有 4 个方法，很容易让人以为「照 `v2-bridge.ts` 填四个函数就完了」。填表时必须逐个回答：这个能力今天有没有 owner？（连接生命周期→owner Scope；工具注册→`McpRegistration`；凭据解析→`Credential`；周期维护→`cleanupLayer` 范式）**四个方法的实现体里几乎每一块都该是委派，不是新写。**

### 5.2 验收映射

```text
acceptance | layer | red test | expected failure | green evidence | final gate
```

覆盖 success、invalid、boundary、authorization、concurrency、interruption、idempotency、migration、old-client、reload/recovery、UI error/empty/loading。

**安全测试必须成对覆盖「模型看到定义」和「settle 真执行」**——只测 permission assert 或只测 UI 隐藏均不合格（M3 计划 §4）。跨 Location 隔离测试必须真的建两个 Location 各持一套资源，断言解析被拒；**只断言「配置里写了隔离」不算**。

### 5.3 已交付阶段（仅供追溯，勿重做）

- **Phase A**（`7a2804624`）：调研报告、ADR-19、ADR-20、`packages/schema/src/mcp-scope.ts` + 17 例用例。
- **Phase B**（`99dce8906`）：ToolRegistry placement 维度（materialization 绑定 placement，ADR-19 条件 C1）、`registeredNames(sessionID?)` 按 placement 求值、`McpRegistration` 命名空间 + 全或无 + typed 冲突/超长错误、四个守卫测试文件。
- **Phase D**（`38d82e2b3`）：`ScopedGrantStore` durable owner + 迁移 `20260823072731_wakeful_lady_bullseye`、`PermissionV2` 仅 `ask` 时咨询 grant、ask TTL + 无应答方即时拒绝、`ApprovalPresence` 连接事实服务、attended 天花板改判为 `ask`、provenance 校验。
- **Phase F0**（`f66f93d8c`，合并为 `229e3eb7d`）：grant 保留期与 `issue()` 解耦 + 30 天有界窗口 + `list`/`prune` 读写路径 + 两个索引；资产导入通配 allow 披露（不阻断，只揭示）。产出 §4.1 那三条范式。

### 5.4 Phase C 详细范围

**先认清起点**（详见 §4.0）：产品今天完全不连接任何 MCP server，`v2-bridge.ts` 是死代码而非在役实现，V1 MCP 与 canonical 已裁定并存，Location-scoped MCP 资产子系统在服役且 `configJson` 是 opaque 串，`McpRegistration` 只有测试消费方。**所以 Phase C 是写第一个能跑的实现。**

#### Slice 0：ADR-21 独立事实复核

复核清单见 **§0.3**，不在此重复。三条纪律：

- **不采信转述**，包括本提示词 §4 的每一条。§4 给了 file:line 是为了让你**去验它**，不是让你引用它。
- **§2.2「必须新增 `mcp_credential_binding`」值得花最多时间**——它是唯一可被推翻的一条，而「新增一张表」是本 Phase 最大的一笔新增负债。复核路径建议：把 `packages/core/src/database/schema.gen.ts` 里的表名**全部列出来**，再看 `packages/core/src/integration/connection.ts` 究竟持有什么、是否落库。**结论无论是「必须新增」还是「可以复用」，都要给出可复跑的命令与输出。**
- **产出是复核报告 + 人类裁定，不是代码。** 任一条事实被证伪 → 停机报告，不要在错误前提上施工（Phase A 复核抓出 C2 就是这么抓的）。若复核推翻了 §2.2，**先改 ADR 再施工**，不许一边写代码一边说「ADR 待更新」。

#### Slice 1：typed MCPConnection owner + stdio

**红**：invalid command / invalid config 被 typed 拒绝；进程启动失败（可执行文件不存在、非零退出）typed fail；stdio 握手超时 typed fail；process interruption；**owner Scope 关闭必须杀掉子进程且不留孤儿**。

孤儿断言怎么写才算数：拿到子进程 PID，关闭 owner Scope，然后**断言该 PID 已不存在**。断言「Scope 关闭没抛错」不算——那是 §4.6 第 2 条点名的假断言形态。

**绿**：第一个能跑的 typed connection owner；发现的工具经 `McpRegistration` 注册（**首个生产消费者**），不新增第二个 registry / executor。

**重构**：expected failure 全部走 `Schema.TaggedErrorClass`；外部 SDK 的 callback 一律经 Effect 边界 Catch Everything；不留宽 `any`、不留 raw `console`。**`v2-bridge.ts` 的 `cfg: any` 是反面教材——它掩盖了两处真实键名不匹配，每个键名都要回 `McpScope.McpServerBinding` 核对。**

**装配（本 slice 必须解决，不许拖）**：connection owner layer 必须排在 `Tools.Service`（`packages/core/src/tool/tools.ts:19`；ToolRegistry Service 见 `packages/core/src/tool/registry.ts:97`）可用**之后**，且不得形成 `PluginBoot -> Tools -> PluginBoot` 环。**环无法避免就是停机项，不许靠延迟初始化绕过。** 新增的 location 层一律 `Layer.provide`，**不是** `provideMerge`（§4.6 第 1 条的根因）。

#### Slice 2：credential binding + 跨 Location 拒绝

依 ADR-21 §2.2 / §2.3。**若 Slice 0 推翻了「必须新增 `mcp_credential_binding`」，先按复核结论改 ADR 再施工。**

**红**：跨 Location 的 credential ref 解析必须 typed **fail closed**；撤销绑定后下次解析失败；`Credential.remove` 之后的悬空 ref 有确定行为（**typed 失败，不是解出 `undefined` 继续连**）；绑定表 0 行更新必抛；CAS `expectedRevision` 不匹配必抛。

**绿**：只存 ref、不存材料；**连接建立那一刻**才换取材料，用完即弃，不驻留在服务对象、缓存或闭包里。

**红线（验证方式见 §0.2 陷阱 C）**：材料不得进 Snapshot / event / log / 绑定表。日志经 `CredentialScanner`，且**先扫描后裁剪**——先截断再扫描等于把秘密切成扫不出来的碎片放过去。这条要给**顺序证据**：喂一个长度会跨过截断点的秘密，断言它仍被扫出。

若新增表：迁移走 generator/index 管线，clean / existing / rerun 三条腿；索引必须配 SQL 侧谓词并用 §4.1 的纯谓词范式做 `EXPLAIN QUERY PLAN` 断言（**F0 一审因为「建了一个服务不了任何查询的索引」被打回**）。

#### Slice 3：remote / OAuth + health 状态机

**红**：invalid URL；credential missing / expired / revoked 三种各自 typed；auth-required 流（缺凭据时进 `auth-required` 而非静默 `offline`）；六态转换 `connecting | ready | degraded | offline | auth-required | revoked`；secret redaction。

**绿**：health 投影**只读服务端状态**，App 不自行推演六态（§4.2 固定裁决）。轮询/重连调度用 §4.1 的 owner-Scope 范式，不用裸 `setInterval`、不用 `Effect.fork`。

**未定项——不要硬编**：OAuth `expires` 过期时「该失败还是该 refresh、由谁负责」是 §0.3 第 5 问要回答的问题之一。**裁定前该路径只允许 typed fail，不允许悄悄实现一套 refresh。** 报告里必须写清裁定来源（谁裁的、裁的是失败还是 refresh）。

#### Slice 4：disconnect / reconnect / drift

**红**：断线重连后 server 的 `listTools` 发生变化 ⇒ 下一个 provider turn 报 `tool_fingerprint_mismatch` / `catalog_digest_mismatch` 并 fail closed（**复用既有重验路径，不新增第三套漂移检测**）；kill switch 关闭时新连接**在 admission 处即拒**（不是连上再断）；pending request 由 owner finalizer 释放，不留悬挂 Deferred。

**本 slice 必须补上的两笔欠账（§4.5）**：

1. **ADR-19 §2.7 隔离矩阵 #1（跨 Location）与 #4（V1 单向隔离）的连接期集成断言**。写 #1 时注意 §4.5 提到的边界：冲突域今天不是 Location-scoped，**别断言一个今天不成立的事，再去改产品让它成立**。
2. **工具名 64 字符截断策略**：拿真实 server 目录定，写进 changelog 并给依据。**必须解释为什么这个方案在「不可变命名契约」前提下站得住**（canonical 名进 Snapshot catalog 与工具指纹，定了就改不动）。

#### Phase C 明确不做

- 不动 V1 `mcp/index.ts` 与 `mcp-auth.json` 的在役语义（ADR-19 §2.1 并存裁定，迁移归 M4）。
- 不做静态加密（ADR-21 §2.5 已排除），只做两项止血：DB 文件权限对齐 + 解码期拒绝秘密字面量。
- **不扩 Snapshot version**（Phase E）。注意为什么这件事不能顺手做：composition union 今天只有 V1|V2，**没有 v1→v2 升级**，未知版本硬失败，消费方各自 `switch version`——新增 v3 意味着**每个这类站点都要加第三分支**。这是一次独立评估，不是一个字段。
- 不做审批中心 UI（Phase F 本体）。
- 不动 `ApprovalPresence`、不动 `PermissionSaved`、不动 `permission/effective.ts` 的两个清单。

## 6. 每个 slice 强制 TDD 循环

```text
1. 精读当前 slice 的计划、owner、调用方、近邻测试、协议和 Git 历史
2. 写 reuse table 与验收映射
3. 红：先写最小测试，实际运行并确认因目标行为缺失而失败
4. 绿：写最小生产实现使红测试通过，不扩张当前 slice
5. 重构：去重、收敛错误/Layer/状态/分支，保持 focused tests 绿
6. 检查 focused diff 与五层数据流
7. 执行 CLAUDE.md「改完即审」七项并输出复查结论
8. 重读 CLAUDE.md、相关 AGENTS/skill 和当前计划小节
9. 运行 focused test + 受影响包 test/typecheck + incremental lint + diff check
10. 全绿后才进入下一 slice；失败则根因收敛并停止范围扩张
```

红测试必须真实失败，不能只写完不跑。**不得用源码字符串断言替代行为测试**（仅明确的 owner/source-contract 测试除外，且测试名不得声称它渲染或执行了什么——M2 有一个名为「renders the complete runtime state surface」却从未 import 组件的用例，已被复审判为假测试）。不对无关文件做机械格式化；diff 中每个 hunk 必须能映射到本 slice 的语义变更。

**本 Phase 额外一条**：Phase C 大量涉及子进程、网络与外部 SDK。**红测试不许用 `Effect.sleep(N)` 等真实进程/连接就绪**，用 Deferred/Latch/就绪信号或 `TestClock`。等 200ms 看子进程起没起，是 CI 上的定时炸弹。

### 6.1 Effect/Schema/DB 红线

- `Effect.gen(function* () {})`；公开效果用 `Effect.fn("Domain.method")`。
- expected failure 用 `Schema.TaggedErrorClass` + `yield* new Error(...)`；不以 `Effect.die` 表达业务拒绝（`Effect.die` 只用于编程错误，如 owner Scope 缺失）。
- 不 `catchCause` 吞 interruption/defect；外部文件/网络/子进程/SDK/JSON callback 边界必须 Catch Everything。
- 不用 `Effect.fork`/`forkDaemon`；用 owner Scope / `Effect.forkIn(scope)` / `Effect.forkScoped`。**子进程与连接必须由 owner Scope 负责终止**（见 §5.4 Slice 1 的孤儿断言）。
- 不用 `Effect.sleep(N)`/`setTimeout` 做并发同步；用 Deferred/Latch/readiness signals。
- 多字段 contract 用 `Schema.Class` + `new X(...)`；single ID/digest/revision 用 brand。
- DB 列 snake_case；迁移走 generator/index 管线，测试 clean + existing + rerun。**迁移里不要建随后就会被删掉的索引，也不要在回填时把「当前值」写进历史行**——M2 两者都踩过（前者会让 `DatabaseMigration.apply` 在真实数据上失败进而 `orDie` 让应用起不来）。F0 刚踩过第三种：**建一个服务不了任何查询的索引**——索引必须配 SQL 侧谓词，且用 §4.1 的纯谓词范式让 `EXPLAIN QUERY PLAN` 断言跑在生产同一个谓词上。
- 状态转换全部带 `expectedRevision` CAS；0 行结果必须抛，不得静默返回。

### 6.2 Tool/Permission/MCP 红线

- Tool definition filtering 不是授权；leaf Permission assert 仍是最终边界。
- definitions 与 captured settle 必须来自同一 effective registrations。
- **每条注册/连接路径必须有 owner Scope 负责清理**，不留孤儿 server/registration/pending request/子进程。这是 ADR-18 §2.2「每个已派发单元必须显式 settle」的同构要求；M2 的教训是清扫语句漏掉中间态（`dispatching`/`cancelling`）就会留下永久孤儿。
- 事件 payload、DB row、返回 Info 必须一致；日志只记稳定分类/digest，**不记完整 prompt/output/secret/path/Authorization**。
- 外部输入（MCP tool 名、schema、server 响应）进入 Record 查找前必须 `Object.hasOwn` 或经 Schema 解码——不要让 `constructor`/`__proto__` 经原型链解析出一个「有效」值（M2 的 `branchTarget` 踩过）。**MCP server 的响应是本 Phase 最大的一片外部输入面，全部经 Schema 解码，不留宽 `any`。**
- 取消/撤销后已在飞的调用按 ADR 明确策略结束；不得默默继续。ADR-21 §2.3 已裁定撤销绑定**不中断在飞连接**——这是诚实边界，**文案与文档不得虚称即时生效**。

### 6.3 UI 红线

- 复用 ModeRoute/ModeWorkspace/typed slots/side panel/Location owner；新 UI 用 shared v2 components/tokens、现有 icon library、i18n、a11y。
- 不硬编码颜色/间距/圆角（用 `--v2-*` token）；**所有用户可见文案走 i18n 并保证 en/zh/zht 三语 parity**，图标按钮必须有存在的 `aria-label` key（M2 有 3 个按钮引用了三语都不存在的 key，`aria-label` 直接不渲染）。
- 动作可用性必须与服务端守卫一致：不要渲染一个服务端一律 409/403 的按钮。
- health 投影**只读服务端状态**，App 不自行推演六态（M0-M2 固定裁决：UI 只投影，不在客户端推演授权或成功语义）。
- 覆盖 desktop/narrow、light/dark、keyboard/focus、empty/loading/error、三语 overflow。

### 6.4 报告真实性红线（违反即交付拒绝）

- 完成/复查报告中每个测试数字必须可复制粘贴自真实命令输出；顾问会独立复跑，**虚报（含把红报绿）一律 REJECT**。
- **「已确认 X」不是证据，「怎么验的 X」才是。** 尤其 secret 不泄漏（§0.2 陷阱 C）、子进程无孤儿、索引真被用到三处。
- 负载敏感失败必须如实标注并给出空载单跑证据，不得写成「已全绿」。已知负载敏感文件见 technical-debt §3.1。
- 不得在生产模块引入全局可变测试 seam。
- 文档改写只允许追加或状态更新；删除既有定案段落必须显式说明理由。

## 7. 每个 slice 的复查结论

```text
复查结论:
- M / Phase / slice / 基线 / 分支:
- 影响文件:
- 五层数据流:
- reuse table 摘要:
- 保留的 owner 与不变量:
- Gate 状态(G3-1 至 G3-4，含 G3-3 的 Slice 0 前置状态):
- Catch Everything / No Null Pointer / Security First:
- No Cheating / Reusability / Clean Logs:
- 红测试失败证据:
- 绿测试与重构证据:
- 已运行命令:
- 剩余风险:
- 下一 slice / 是否触发停止条件:
```

「声明风险」不能代替修复或 Gate。发现多个同类失败时按 CLAUDE.md 根因收敛，不逐文件打补丁。

## 8. 常用验证命令

只选当前 slice 受影响的命令；最终门禁按 M3 计划 §5 全量执行：

```bash
# Schema
bun --cwd packages/schema test --timeout 30000
bun --cwd packages/schema typecheck

# Core（含 migration clean/existing/rerun 证据）
bun --cwd packages/core test path/to/focused.test.ts --timeout 30000
env -u AIGCFROGE_CUSTOM_MODE bun --cwd packages/core test path/to/focused.test.ts --timeout 30000
bun --cwd packages/core test --timeout 30000
bun --cwd packages/core typecheck
cd packages/core && bun run script/migration.ts --check   # 注意：不是 bun --cwd ... run script/...

# HTTP/server（陷阱 B：必须真跑完并贴数字，约 10 分钟）
bun --cwd packages/aigcfroge test test/server/ --timeout 30000
bun --cwd packages/aigcfroge test path/to/focused.test.ts --timeout 30000
cd packages/aigcfroge && bun run script/httpapi-exercise.ts --mode coverage --fail-on-missing --fail-on-skip
cd packages/aigcfroge && bun run script/httpapi-exercise.ts --mode auth --fail-on-missing --fail-on-skip
bun --cwd packages/aigcfroge typecheck

# SDK（重新生成并审查真实 diff）
bun ./packages/sdk/js/script/build.ts
bun --cwd packages/sdk/js typecheck

# App/UI
bun --cwd packages/app test --timeout 30000
bun --cwd packages/app typecheck
bun --cwd packages/app test:e2e e2e/regression/<spec>.spec.ts

# Protocol/delivery
bash .aigcfroge/skills/protocols/scripts/check-refs.sh
bun run script/lint-changed.ts
git diff --check
```

跨包 Phase 完成或合并前再运行 `bun turbo typecheck` 与 `bun run lint`。不要运行根 `bun test`。SDK/migration/schema/generated output 必须通过仓库脚本生成并审查真实 diff，不手改生成结果隐藏漂移。

已知：`packages/storybook` 构建当前 OOM（分支既有，technical-debt §3.1），视觉截图门禁取不到——如实标注，不要伪造。

## 9. 停止与交付

**Slice 0 完成后 —— 第一个停机点（只交报告，不交代码）：**

输出 ADR-21 复核报告，逐条回答 §0.3 的 5 个问题，每条给**你自己复跑的** file:line 与命令输出。明确标注：哪几条成立、哪几条被证伪、§2.2 是否应被推翻、有哪些 ADR-21 漏掉的绿地。**停机等待人类裁定；裁定前不写 connection / credential 生产代码。**

**Slice 1-4 全部完成后 —— 第二个停机点：**

1. 运行 §8 里受影响门禁 + protocol refs + incremental lint + diff check；**新增表/索引必须给 clean / existing / rerun 三份证据**；跨包改动再跑 `bun turbo typecheck` 与 `bun run lint`。基线（低于即回归）：
   - **core 2109 pass / 2 skip / 0 fail**
   - **aigcfroge server 套件 379 pass / 2 skip / 0 fail**（`bun --cwd packages/aigcfroge test test/server/`，约 10 分钟、64 文件；**必须真的跑**——Phase D 就是因为只跑 core，漏掉了 9 个实例 HTTP 回归，见 §0.2 陷阱 B）
2. 以下守卫必须全程绿，**变红都不是「测试要改」**：
   - `packages/core/test/tool-registry-stale.test.ts`
   - `packages/core/test/tool-registry-placement.test.ts`
   - `packages/core/test/tool-mcp-registration.test.ts`（Phase C 是它的首个生产消费者，它的 typed 错误语义不许为了让连接跑通而放宽）
   - `packages/aigcfroge/test/session/v1-canonical-registry-boundary.test.ts`（V1/canonical 并存边界）
   - `packages/core/test/scoped-grant-store.test.ts`、`permission-grants.test.ts`、`permission-ask-bounds.test.ts`、`permission-effective.test.ts`、`database-migration.test.ts`
3. 输出 Phase C 报告，必须包含：
   - **真实 stdio 子进程被 owner Scope 杀掉、无孤儿的实跑证据**（怎么验的：进程 PID 在 Scope 关闭后不存在，不是「已确认」）；
   - **跨 Location credential ref 被拒绝的实跑输出**（typed 错误名 + 断言）；
   - **材料未进入 Snapshot / event / log 的验证方式**（§0.2 陷阱 C 的哨兵值三处断言，写清怎么验的）；
   - **先扫描后裁剪的顺序证据**（喂一个会被截断点切断的长秘密，断言它仍被扫出）；
   - **ADR-19 §2.7 隔离矩阵 #1（跨 Location）与 #4（V1 单向隔离）的连接期断言**；
   - **工具名 64 字符截断策略的决定与依据**（拿真实 server 目录定，写进 changelog；说明为什么这个方案在「不可变命名契约」下站得住）；
   - **OAuth `expires` 处置的裁定来源**（谁裁的、裁的是失败还是 refresh；未裁定就只能 typed fail）；
   - Layer ordering 的解决方式（owner 在 `Tools.Service` 之后可用、无 `PluginBoot -> Tools -> PluginBoot` 环的证据）；
   - 新增 location 层用的是 `Layer.provide` **不是** `provideMerge` 的逐个确认；
   - 若动了 HTTP/SDK：SDK 重新生成后的**真实 diff 审查**（不手改生成结果）+ App 三语 key 存在性与 desktop/narrow/dark 覆盖说明；
   - `PermissionSaved`（`saved.ts` / `permission/sql.ts`）**diff = 0 行**的证明。
4. **停机等待复审。不进 Phase E（Resolver/Snapshot 扩 version）、不进 Phase F 本体（审批中心 UI）。**
5. 未经交付批准，不 commit/push/PR。**本地 main 领先 origin/main 38 个提交**：按用户安排 M3 全部 Phase 完成后统一开一个 PR，所以本 Phase 只在本地成链，不单独开 PR。

**M3 全部 Phase 完成后**按 M3 计划 §5 跑完整测试矩阵，输出 M 完成报告，统一开一个 PR，不进入 M4。

```text
M completion:
- M / baseline / branch / commits:
- Gate evidence(G3-0 至 G3-4):
- Scope and non-goals:
- Reused owners(含 M0-M2 接缝):
- Five-layer changes:
- TDD slices and red/green evidence:
- Tests/typechecks/HTTP/SDK/migration/E2E/资源指标:
- Security and protocol review:
- Rollout/rollback:
- M2 遗留项闭环证据:
- Remaining risks or blocked checks:
- Proposed next M (not started):
```

## 10. 必须立即停止的情况

- **Slice 0 未完成，或其结论未获人类裁定**，却要写 credential / connection / transport 生产代码。
- **Slice 0 推翻了 ADR-21 的某条款，却不先改 ADR 就继续施工**（不许一边写代码一边说「ADR 待更新」）。
- **Layer ordering 无解**：connection owner 排不到 `Tools.Service` 之后，或 `PluginBoot -> Tools -> PluginBoot` 环无法避免。**不许靠延迟初始化绕过。**
- 任何新增 location 层用了 `Layer.provideMerge` 提供 Database/EventV2（Phase D 已因此导出第二个内存 SQLite，产生 9 个实例 HTTP 回归）。
- 需要自己再抄一份危险动作清单或只读白名单（真源在 `packages/core/src/permission/effective.ts`）。
- 需要新增第二个 registry / executor，或第二个 Session / Tool / Permission / ModeWorkspace / Agent / Workflow / Plugin owner。
- 方案要求把 executor / client / secret 存入 Snapshot / event / log / 绑定表。
- 材料无法做到「连接建立那一刻换取、用完即弃」，只能驻留在服务对象、缓存或闭包里。
- Location/Session/子进程 cleanup 只能依赖手工 Map 删除而无 owner Scope。
- 需要重新引入进程级「最后注册者胜」。
- `PermissionSaved.always` 被直接改名成 Session/Location grant。
- `ApprovalPresence` 要改回可选依赖（`Effect.serviceOption`）。
- `ask` 在 unattended/headless 状态可能无限等待或默认 allow。
- 撤销语义要写成「即时中断在飞连接」——ADR-21 §2.3 已裁定不中断，**改语义要走 ADR，不是改文案**。
- 需要扩 Snapshot version、需要审批中心 UI、或需要 Plugin runtime / Code Presentation / external CLI 才能闭合基本 MCP 环。
- 需要放宽 `McpRegistration` 的 typed 错误语义（冲突/超长/非法 server 名）才能让连接跑通。
- 任一 applicable test / typecheck / migration / HttpApi / SDK / lint / E2E / security check 失败。
- 只能靠 `as any`、`@ts-ignore`、任意 sleep、broad mock、吞异常、跳 hook、假测试、全局可变测试 seam 继续。
- 最新 main 与计划的关键 owner/不变量冲突（此时**先修计划**，不要静默偏离）。

停止报告必须包含：已读文件、代码证据、失败命令与关键输出、已尝试方案、未改/已改文件、需要哪个 owner 作何决策。**不要猜接口，不要自行跨 Gate，不要编造答案。**

<!-- PROMPT END -->

## 使用说明

| 项           | 值                                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------ |
| 复制范围     | `<!-- PROMPT START -->` 到 `<!-- PROMPT END -->`                                                                   |
| 当前安全起点 | **Phase C（connection / credential / health），分支 `mcp-connection`**；从最新**本地** `main`（`229e3eb7d`）建分支 |
| 第一个停机点 | **Slice 0 复核报告**——只交报告不交代码，等人类裁定 ADR-21                                                          |
| 自动继续范围 | 裁定通过后 Slice 1→4 各自全绿即自动继续；**不进 Phase E、不进 Phase F 本体**                                       |
| 强制停止点   | Slice 0 未裁定、四个 slice 全部完成（等复审）、范围滑进 Phase E/F、测试失败、owner/协议冲突、§10 任一条            |
| 测试基线     | core **2109 pass / 2 skip / 0 fail**；aigcfroge server **379 pass / 2 skip / 0 fail**（低于即回归）                |
| 分支原则     | M3 各阶段在本地依次合入 main 成链，全部完成后统一开一个 PR；不逐阶段推送                                           |
| 卡住时       | 输出停止报告，不绕过 Gate 或测试                                                                                   |
