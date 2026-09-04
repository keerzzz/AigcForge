# S0 行为基线冻结

> 归属：[`docs/plan/five-mode-dogfood-remediation-2026-09-04.md`](../../plan/five-mode-dogfood-remediation-2026-09-04.md) §5 S0
> 性质：实测输出台账。只记录跑过的命令和它们的真实输出；未跑到的条目标 `PENDING`，不写推测。
> 本阶段**未改任何生产代码**，只新增/扩展测试断言。

---

## 0. 执行基线

| 项                 | 实测值                                                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| worktree / 分支    | `/media/win_data/aigcfroge/.worktrees/dogfood-remediation` · `dogfood-remediation`                                                                      |
| HEAD               | `917881a45e622a4434d7528c4915cc5f77ee3005` — `docs(plan): add five-mode dogfood remediation plan`（2026-09-04 21:22:06 +0800）                          |
| origin/main        | `917881a45e622a4434d7528c4915cc5f77ee3005`（`git fetch origin main --prune` 之后）                                                                      |
| merge-base         | 同上；`git rev-list --left-right --count origin/main...HEAD` = `0	0`                                                                                     |
| 与审查基线的代码差 | `git diff --name-only 09a615232 917881a45 -- 'packages/**'` → **0 个文件**（两次提交只动 `docs/` `scripts/` `*.md`）。计划 §2 的 `path:line` 全部仍有效 |
| 运行时 flags       | 环境内无任何 `AIGCFROGE_*` 变量 → `AIGCFROGE_V2_RUNTIME` 未设（默认 false）、`AIGCFROGE_CUSTOM_MODE` 未设（默认 false）                                 |
| bun                | 1.3.14                                                                                                                                                  |
| Playwright         | `@playwright/test` 解析到本 worktree；`~/.cache/ms-playwright` 已有 `chromium-1217`、`chromium_headless_shell-1217`、`ffmpeg-1011`                      |

### 0.1 依赖隔离（前置，否则 RED 不可信）

本 worktree 建立时没有 `node_modules`，跨包 import 会沿目录树解析到**父 worktree 的源码**，测得的行为不属于本分支。已在本 worktree 独立 `bun install`（1482 packages / 745.70s / exit 0，含 `fix-node-pty` 与 `husky` postinstall）。隔离后解析实测：

```text
[core]      @aigcfroge/schema/provider      -> <wt>/packages/schema/src/provider.ts
[core]      @aigcfroge/core/session/revert  -> <wt>/packages/core/src/session/revert.ts
[aigcfroge] @aigcfroge/core/tool/registry   -> <wt>/packages/core/src/tool/registry.ts
[app]       @aigcfroge/session-ui/message-part -> <wt>/packages/session-ui/src/components/message-part.tsx
[app]       vite                            -> <wt>/node_modules/vite/dist/node/index.js
```

`node_modules` 在 `.gitignore` 内，`git status` 仍只显示测试文件改动。

---

## 1. 方法学发现：`--only-failures` 把新增 RED 吞成绿

`packages/core` 的 `test` 脚本是 `bun test --timeout 30000 --only-failures`。同一文件两种跑法结果不同：

| 命令                                                                             | 结果              |
| -------------------------------------------------------------------------------- | ----------------- |
| `bun --cwd packages/core test test/session-revert-v2.test.ts`（走包脚本）        | `2 pass / 0 fail` |
| `bun test --timeout 30000 test/session-revert-v2.test.ts`（cwd=`packages/core`） | `2 pass / 2 fail` |

两条新增断言在包脚本下**根本没有执行**。同理 `test/tool-bash.test.ts` 的两条新断言也只在原始命令下现形。

**本批规则**：所有 RED 判定输出一律用去掉 `--only-failures` 的原始命令；包脚本形式只用于回归对照。带 `--only-failures` 的“全绿”不作为任何 DoD 证据。

---

## 2. 已知基线复现（计划 §8 preflight）

| 命令                                                  | 计划记载              | 本 worktree 实测                                                          | 结论       |
| ----------------------------------------------------- | --------------------- | ------------------------------------------------------------------------- | ---------- |
| `core test test/session-revert-v2.test.ts`            | 2 pass / 0 fail       | 包脚本 2 pass / 0 fail；原始命令 **2 pass / 2 fail**（新增断言，见 §3.1） | 一致       |
| `core test test/session-runner-tool-registry.test.ts` | 18 pass / 0 fail      | 18 pass / 0 fail                                                          | 一致       |
| `core test test/plugin/provider-dynamic.test.ts`      | 0 pass / 1 fail       | 0 pass / 1 fail / 1 error                                                 | 一致       |
| `core test test/config/provider.test.ts`              | 同一循环、另一抛点    | 0 pass / 1 fail / 1 error                                                 | 一致       |
| `session-ui typecheck`                                | `@shikijs/types` 冲突 | **0 error / exit 0**                                                      | **不一致** |
| `app typecheck`（`tsgo -b` + e2e tsconfig）           | 未记载                | 0 error / exit 0                                                          | 新增基线   |

plugin 模块循环的两个真实抛点：

```text
test/plugin/provider-dynamic.test.ts:
  ReferenceError: Cannot access 'locationLayer' before initialization.
    at packages/core/src/plugin/internal.ts:119:22   // Layer.provideMerge(PluginV2.locationLayer)

test/config/provider.test.ts:
  ReferenceError: Cannot access 'locationLayer' before initialization.
    at packages/core/src/plugin.ts:158:22            // Layer.provideMerge(SkillV2.locationLayer)
```

两者都发生在测试收集阶段，是 `plugin.ts` ↔ `plugin/internal.ts` 的 ESM 求值循环，与单文件内声明顺序无关——与计划 §5「S3b 点名前置」判定一致，且**不阻塞 S1/S2**。

### 对计划的更正 1：`session-ui typecheck` 基线红是依赖树产物，不是代码事实

隔离安装**之前**（借用父 worktree 的 `node_modules`）报的是另一组错误：`src/components/file-ssr.tsx(106,11)`/`(114,11)` 的 `@pierre/diffs` `WorkerPoolManager` 重复声明（`node_modules/.bun/@pierre+diffs@1.2.10+.../` 与 `node_modules/@pierre/diffs/` 两份声明的 private 字段冲突）。隔离安装**之后**为 0 error。计划记载的 `markdown-shiki.worker.ts` `@shikijs/types` 冲突在两种情形下都未复现。

**结论**：该项不是基线缺陷，§16 最终门禁的 `bun --cwd packages/session-ui typecheck` 无需豁免、也无需为它拆前置。

---

## 3. 六条核心基线

| #   | 断言                                                      | 层             | 状态           |
| --- | --------------------------------------------------------- | -------------- | -------------- |
| 1   | revert 到第 N 条用户消息 → `snap.restore` 收到第 N 轮快照 | core 单测      | **RED 已确认** |
| 2   | 真实 permission leaf 拒绝/纠正 → 可见 error 且反馈不丢    | core 单测      | **RED 已确认** |
| 3   | `MessageTimeline` busy 且无输出超阈值 → stalled 出口      | app unit + e2e | `PENDING`      |
| 4   | 冷加载 `/mode/work` 主区出现 loading                      | app e2e        | **RED 已确认** |
| 5   | 无项目点「新建会话」有反馈且不 POST session               | app e2e        | **RED 已确认** |
| 6   | `tab.close` 每上下文恰一个有效 owner                      | app 单测/e2e   | `PENDING`      |

### 3.1 基线 1 — P0-REVERT-TARGET（RED）

文件：`packages/core/test/session-revert-v2.test.ts`（扩展既有 `snapshotMock`，未新建 mock；新增三轮对话 fixture，每轮 assistant 带独立 `snapshot.start`）

```text
$ bun test --timeout 30000 test/session-revert-v2.test.ts     # cwd=packages/core

(fail) V2 SessionRevert > revert restores the snapshot of the turn that owns the target user message
  expect(received).toEqual(expected)
    [
    -   "snap_turn_3",
    +   "snap_turn_1",
    ]

(fail) V2 SessionRevert > revert returns a decodable session after writing the revert marker
  expect(Exit.isSuccess(exit)).toBe(true)
    Expected: true   Received: false

 2 pass / 2 fail / 4 expect() calls
```

红因核验（不是测试自身错）：

- `packages/core/src/session/revert.ts:32-35` 的谓词只判 `m.type === "assistant" && m.snapshot?.start != null`，`input.messageID` 从未进入判断；
- `packages/core/src/session/history.ts:49` 是 `orderBy(asc(SessionMessageTable.seq))`，所以 `Array.prototype.find` 命中**最早**一轮 → 实测 `snap_turn_1`，与计划 §2.1「回滚到会话最早快照」一致；
- fixture 只写 `session_message` 投影行 + 用 `SessionV2.Service.create` 建会话，未 mock 被测逻辑。

第二条失败是**计划未记载的新缺陷**，见 §4。

### 3.2 基线 2 — P1-PERMISSION-DENY 抵达形状（RED，V2 侧）

文件：`packages/core/test/tool-bash.test.ts`（扩展既有 `permission` 假层，加一个 `permissionFailure` 注入点，让同一 leaf 可以分别抛 `DeniedError` 与 `CorrectedError`；未新建 registry/runner 脚手架）

```text
$ bun test --timeout 30000 test/tool-bash.test.ts             # cwd=packages/core

(fail) BashTool > settles a permission denial differently from an execution failure
(fail) BashTool > keeps correction feedback in the settled tool result
  expect(received).toMatchObject(expected)
    {
      "type": "error",
    -   "value": StringContaining "use git status instead of pwd",
    +   "value": "Unable to execute command: pwd",
    }

 11 pass / 2 fail / 47 expect() calls
```

**抵达形状结论（决定 S2 的 GREEN owner，推翻旧假设）**：typed permission outcome 在**leaf** 就被擦掉，不是在 Registry。`CorrectedError.feedback` 与 `DeniedError` 都被 `bash` leaf 的兜底 `Effect.mapError` 压成同一句 `Unable to execute command: pwd`；两种语义（“你拒绝了”与“进程崩了”）落成**完全相同**的 durable outcome。

因此：

- `packages/core/src/tool/registry.ts:177` 的 `Effect.catchTag("LLM.ToolFailure", …)` 无法恢复原始 typed 语义——到它手里已经只有一个泛化 `ToolFailure`；
- `packages/core/src/tool/tool.ts` 的 `execute`/`settle` 错误通道类型本身就是 `ToolFailure`（唯一允许的 E）；
- 所以 GREEN 必须落在 leaf 共用边界（翻译/保留明确分类的 recoverable outcome），符合计划 §2.2 第一分支；**不得**在 Registry 用 `catchCause` 逆推。

`AskExpiredError` / `RejectedError` / `GrantEvent.CommitRejected` / `NotFoundError` 的抵达形状与操作语义仍需在 S2 单独取证，本基线未覆盖，不得默认按 `ToolFailure` 处理。

### 3.3 基线 4 — P1-MODE-MOUNT 的 pending 表示（RED）

文件：`packages/app/e2e/regression/mode-surface-wiring.spec.ts`（扩展既有 spec 与其 `openWorkspace` fixture，复用它已有的 `data-mode-sidebar` / `data-mode-main` 选择器，不新建 spec）

pending 窗口被做成确定性的：Work 主槽读 `workflowAsset.list()`（`mode-workspace-slots.tsx:668-676`，经 `whenActive` 门控）→ `GET /workflow-asset`；把该响应按住即长期停在 pending。**实测的 pending 期 DOM（3s→25s 稳定不变）**：

```text
mainCount=1  [data-mode-main="work"]=0  [data-mode-sidebar="work"]=0
roles=["button","region"]   body.innerText = "DEV M <session title> ● 127.0.0.1:4096 … FPS 60 …"
（放开响应后）mainCount=1  [data-mode-main="work"]=1  Work 预设内容出现
```

即 `<main>` 在，但**内容为空、无任何 `status`/`progressbar` 语义**，页面上只剩顶栏与 dev 调试条——与报告 BUG-MODE-REENTRY「URL 已是 `/mode/work`，主区只有顶栏」一致。RED 输出：

```text
$ bun --cwd packages/app test:e2e e2e/regression/mode-surface-wiring.spec.ts --workers=1 -g "pending representation"

1) cold /mode/work shows a loading indication in main before the surface is ready
   expect(locator).toBeVisible() failed
   Locator: locator('main').getByRole('status').or(locator('main').getByRole('progressbar')).first()
   Error: element(s) not found

整文件回归：6 passed / 1 failed（既有 6 条未受影响）
```

**对 S4 的约束（实测得出，计划未写）**：pending 期两个 work 槽**都不在 DOM 里**。所以「槽仍保留在 DOM 并显示局部 loading」不能只靠 slot 内 fallback 实现——fallback 必须落在槽之外（`layout.tsx` 或 `ModeWorkspace` 边界）或为每个槽各建边界。

两条写法上的坑（都已实测并写进注释，避免后人重踩）：

- 用 `**/workflow-asset**` glob 拦截会连 dev server 的模块请求一起吞掉，页面根本不启动——那是「为错误原因而白屏」。必须用精确 pathname 谓词 + API 端口。
- 按住响应后 `page.goto` 的默认 `waitUntil: "load"` 永不返回（实测撞 180s 超时）。pending 窗口本身就是被测对象，所以必须用 `waitUntil: "commit"`。

### 3.4 基线 5 — P2-HOME-EMPTY（RED）

文件：`packages/app/e2e/regression/home-empty-new-session.spec.ts`（新建；复用 `mockAigcfrogeServer` 与 `home-mode-ownership.spec.ts:70-80` 的 `aigcfroge.global.dat:server` 播种方式，把 `projects.local` 设为 `[]`——服务端仍有项目，空的是客户端「已打开项目」列表，正是新档案上可复现的路径）

```text
$ bun --cwd packages/app test:e2e e2e/regression/home-empty-new-session.spec.ts --workers=1

1) clicking new session with no opened project gives visible feedback
   expect(locator).toBeVisible() failed
   Locator: getByRole('dialog').or(getByRole('alert')).first()
   Error: element(s) not found

1 failed / 1 passed (3.0m)
```

- 按钮存在且唯一（`[data-component="home-overview"] [data-action="home-new-session"]` count=1），点击后**无 dialog、无 alert**；
- 第二条用例通过，记录未回归的一半：点击后 URL 仍是 `/`，且 `POST /session` 计数为 `0`。修好反馈后这条必须继续通过——不能靠「照样建会话」来掩盖缺目录。

### 3.5 基线 3 与 6（`PENDING`，S0 剩余）

| #   | 需要的前置                                                                                                                                                                                                                               |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3   | 需要给 `e2e/utils/mock-server.ts` 加一个 `sessionStatus` 配置（当前 `/session/status` 被硬编码成 `{}`，会话永远 idle，`rows.ts:197` 的 Thinking 分支进不去）；阈值推进用 Playwright `page.clock.fastForward`，因为生产端今天没有任何时钟 |
| 6   | `tab.close` 行为矩阵：两处注册已核实（`titlebar.tsx:412-420` 关**顶层 tab**，`use-session-commands.tsx:442-446` 关 `closableTab()` 即**会话内子 tab**，且仅在有子 tab 时才注册），`command.tsx:263-272` **保留第一条并 warn**            |

**基线 6 的预判已被代码推翻，必须在 S8a 更正**：计划 §5「推荐保留 Titlebar 全局 owner、删除 Session 重复注册」会把**唯一能关子 tab 的路径删掉**——两者语义不同（顶层 tab vs 会话内子 tab），不是重复实现。收敛手段应是让单一 owner 变成上下文感知（有聚焦子 tab 先关子 tab，否则关顶层 tab），或给两者不同 id/keybind；不能直接删一处。

---

## 4. 新缺陷：V2 `session.revert` 写完标记后必然 die（计划未记载）

基线 1 的第二条失败不是 fixture 问题，是一条完整的生产链：

| 环节                                        | 事实                                                                                                                                                                                   |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/session/revert.ts:49-57` | `revert()` 调 `store.setRevert({ revert: { messageID, snapshot: currentSnapshot } })`，**从不传 `diff`**                                                                               |
| `packages/core/src/session/store.ts:84-89`  | `setRevert` 落库时把缺失字段写成 `null`：`{ messageID, snapshot: … ?? null, diff: … ?? null } as any`；就地 oxlint-disable 注释自认「omits the null placeholders this write persists」 |
| `packages/core/src/session/revert.ts:59-60` | 紧接着 `store.get()` 回读                                                                                                                                                              |
| `packages/core/src/session/info.ts:58-64`   | `fromRow` 把 `row.revert.snapshot` / `row.revert.diff` 原样塞进 `SessionSchema.Info.make({...})`                                                                                       |
| `packages/schema/src/session.ts:18-22`      | `Revert.snapshot` / `Revert.diff` 是 `Schema.optional(Schema.String)`——**可缺省，不可为 null**                                                                                         |
| 结果                                        | `Info.make` 拒绝 `diff: null` → 抛出 → 在 `Effect.fn` 内成为 defect → `revert()` 的 Exit 是 failure                                                                                    |

后果：**只要 revert 真的找到了快照并写了盘，调用方就一定拿到失败**。磁盘已被改（还改错了时点）、marker 行已落库，然后回读崩掉——用户侧表现为「操作报错但工作区已变」。`unrevert` 走同一 `store.get`，所以计划 §2.5 所依赖的「dock 逐条 restore 可恢复」在 V2 路径上同样受这条 defect 影响。

**缺陷同型**：与 dogfood 报告 `BUG-CUSTOM-SNAPSHOT`（服务端写 `profilePath: null`，客户端声明 optional string，合法 200 被解码拒绝）是同一类——写侧用 `null` 占位、读侧声明 optional，收敛面属计划 §3 面 A（跨边界丢 typed 契约）。

**建议的最小修法（待裁决，不在本阶段执行）**：在写边界删掉 null 占位（`setRevert` 只写出现的字段），而不是把公共 schema 放宽成 `NullOr`——后者会改公共 HTTP 契约并触发 SDK 重生成。附带收益是那处 `as any` + oxlint-disable 一并消失（No Cheating）。

**需要用户裁决的范围问题**：计划 §6 的文件表里 S1 只列 `revert.ts`；本缺陷的 owner 在 `store.ts`（写）与 `info.ts`/`schema/session.ts`（读）。请二选一：

1. 并入 S1（一个提交同时修目标选择与 null 占位，回滚粒度较粗）；
2. 拆成 S1b 独立提交（推荐：两条缺陷的 RED、owner、回滚都独立）。

---

## 5. 本阶段门禁与停止点

```text
bun --cwd packages/core typecheck                                  → exit 0
bun --cwd packages/app typecheck                                   → 0 error（含 e2e/tsconfig.json）
bun --cwd packages/session-ui typecheck                            → 0 error
LINT_BASE_REF=origin/main bun run script/lint-changed.ts           → passed
bash .aigcfroge/skills/protocols/scripts/check-refs.sh             → All 32 paths OK
git diff --check                                                   → clean
bun --cwd packages/app test:e2e e2e/regression/mode-surface-wiring.spec.ts        → 6 passed / 1 failed（新增 RED）
bun --cwd packages/app test:e2e e2e/regression/home-empty-new-session.spec.ts     → 1 passed / 1 failed（新增 RED）
```

未跑：`packages/ui` / `packages/schema` / `packages/aigcfroge` 的 test（本阶段未触达这些包）；`packages/app test:unit`（本阶段只加 e2e spec，未加单测）。

**停止点**

- 基线 3、6 未取证前不进入 S1；
- §4 的范围问题（新缺陷归 S1 还是独立 S1b）需用户裁决后才动 `store.ts`；
- 基线 6 的 owner 选择必须先跑完行为矩阵，计划里的「删掉 Session 注册」已被 §3.5 的代码事实否掉，不得照旧执行。
