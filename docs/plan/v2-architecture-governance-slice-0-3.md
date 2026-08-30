# V2 架构治理实施计划：Slice 0–3

> **来源路线图**：[docs/roadmap/v2-architecture-roadmap.md](../roadmap/v2-architecture-roadmap.md)（2026-08-29，**有条件批准架构方向**）
>
> **范围**：Slice 0 红线止血 · Slice 1 Session lifecycle owner · Slice 2 Recovery 边界 · Slice 3 Composition identity。关闭路线图的 F1（已证实 P1）、F2（已证实 P1，只做最小诚实恢复）、F4（较高概率 P2，只做 probe 不做大重构）、F7 的代码侧半边。
>
> **明确不在本计划内**：Slice 4 端点退休矩阵、Slice 5 runner 提纯、Slice 6 Secret Vault；**不翻** `AIGCFROGE_V2_RUNTIME` 默认值；**不写任何 UI**（UI 归 [v2-ux-trust-foundation.md](v2-ux-trust-foundation.md)）。
>
> **分支**：`v2-lifecycle-owner`　**工作区**：`.worktrees/v2-arch`　**并行伙伴**：`v2-ux-foundation`
>
> **状态**：草案，待人类批准开工。ADR-22/23/24 未起草前不得进入批次 A1/A2/A3 的绿灯步骤。

---

## 0. 开工 Gate 与实测基线

### 0.1 基线事实（本计划撰写时实测，非引用）

| 项             | 实测结果                                                                                  | 命令                                                                  |
| -------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 分支基线       | `main@eeaec64f2`，与 `origin/main` **零差异**（`rev-list --count origin/main..main` = 0） | `git rev-list --count origin/main..main`                              |
| typecheck      | core / schema / app / ui / session-ui / aigcfroge / desktop **7 包全 PASS**               | `bun --cwd packages/<p> typecheck`                                    |
| 增量 lint      | `Incremental lint passed: no changed JavaScript or TypeScript files`                      | `LINT_BASE_REF=origin/main bun run script/lint-changed.ts`            |
| 生成 SDK       | 生成器可离线复跑，exit 0，`git diff -- packages/sdk` **为空**，无临时残留                 | `bun ./packages/sdk/js/script/build.ts`                               |
| 协议引用       | **32/32 OK**                                                                              | `bash .aigcfroge/skills/protocols/scripts/check-refs.sh`              |
| 工作区数       | 17 个 workspace 包（16 × `packages/*` + `packages/sdk/js`）                               | `ls -d packages/*/package.json packages/sdk/js/package.json \| wc -l` |
| ADR 下一可用号 | **ADR-22 / 23 / 24**（现存至 ADR-21）                                                     | `ls docs/architecture/adr/`                                           |

> **基线陷阱提醒**：`script/lint-changed.ts` 默认以**本地** `main` 为 diff 基线（`script/lint-changed.ts:94`）。本分支每次自查都必须显式写 `LINT_BASE_REF=origin/main`，否则在本地累积提交时会扫到 0 个文件并空绿通过。

### 0.2 开工前置（缺一不得进入绿灯步骤）

1. **人类批准本计划**，并确认 Slice 1 的 `purge vs tombstone` 产品裁决（见 §4.1，这是 ADR-22 无法由执行方自行决定的部分）。
2. **ADR-22（Session lifecycle semantics）** 起草并 Accepted —— 批次 A1 的准入材料。
3. **ADR-23（Execution crash recovery）** 起草并 Accepted —— 批次 A2 的准入材料。
4. **ADR-24（Composition scopes）** 起草并 Accepted —— 批次 A3 的准入材料。
5. 已读：[CLAUDE.md](../../CLAUDE.md)、[AGENTS.md](../../AGENTS.md) §Effect Coding / §Schema / §Testing / §V2 Session Core（8 条不变量）、[CONTEXT.md](../../CONTEXT.md)、[ARCHITECTURE.md](../../ARCHITECTURE.md) §4.1/§4.3/§6、[docs/testing.md](../testing.md)、`.aigcfroge/skills/effect/SKILL.md`、`.aigcfroge/skills/database/SKILL.md`。

### 0.3 发布裁决边界（路线图 §1.2，本计划不得越界）

- 本计划**不解除**任何阻断。它只把「V2 破坏性端点」与「生产级桌面 V2」两项从*不可解释*变为*可解释且已止血*。
- `AIGCFROGE_V2_RUNTIME=true` 默认开启仍然**阻断**（需 F1–F4 全关 + Slice 4 逐端点矩阵）。
- 交付物中**禁止**出现 crash-safe、自动恢复、encrypted-at-rest 三类表述。

---

## 1. 目标与非目标

### 1.1 目标（按路线图根因 R1/R2/R3/R5 收敛）

| 编号 | 目标                                   | 对应路线图问题   | 退出条件                                                                                                                                                                          |
| ---- | -------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1   | V2 破坏性路径不再制造不可重放状态      | F1 最小修复      | delete / deleteMessage / rename 三条 V2 路径 fail-closed 或已事件化                                                                                                               |
| G2   | Session 生命周期只有一个 command owner | F1 健壮演进 · R1 | 调用面无法直写 `SessionTable` / `SessionMessageTable` / `EventTable`；`create → rename → message delete → session delete → ID reuse → replay` 全程等价；孤儿 `parent_id` 计数为 0 |
| G3   | sidecar 死亡与不确定副作用**可解释**   | F2 最小修复 · R2 | 强杀 sidecar 后没有静默挂起；durable inbox 可安全续跑；未知副作用进入显式 `recovery_required` 而非盲重试                                                                          |
| G4   | process owner 身份**有证据**           | F4 最小验证 · R3 | Database / EventV2 / SessionExecution / TaskDriver / ApprovalPresence 在 instance/server/global 三面 + 两个 listener 上的实例身份被测试钉住                                       |
| G5   | 生产模块不携带测试后门                 | F4 · R5          | `SessionExecution` 的 busy 测试 seam 从生产模块移除，改由测试装配注入                                                                                                             |
| G6   | 文档不再把提案写成已完成               | F7 代码侧        | `CredentialValue` 回到 schema/core owner；`ARCHITECTURE.md` §7 与 `specs/v2/todo.md` 与代码一致                                                                                   |

### 1.2 非目标（写清楚，防止范围蔓延）

- **不建** `TurnMiddleware` / pipeline / phase algebra（路线图 §9 已否决）。
- **不换** SQLite，不做 1/4/16 Session 性能基准（路线图列为「非阻断，先测」，另立专项）。
- **不做** Secret Vault、OS keychain、静态加密（Slice 6，需产品+Security 联合裁决）。
- **不做** durable provider-turn attempt / lease / fencing / CAS settlement（Slice 2 的「健壮演进」半边，需 ADR-23 之后另立专项）。
- **不动** V1 路径的语义（`packages/aigcfroge/src/session/session.ts`），除非是 G2 要求的「禁止直写」收敛。
- **不改任何 `packages/app` / `packages/ui` / `packages/session-ui` 文件**（见 §2 所有权矩阵）。
- **不新增用户可见文案**（i18n 归并行计划）。服务端错误只写结构化 `kind`，不写待翻译字符串。

---

## 2. 并行执行契约（与 `v2-ux-foundation` 共享，两份计划逐字一致）

> 本节是「两个工作区同时进行、分别开 PR、合并无冲突」的机械保证。**任何一方越界即视为破坏契约，PR 打回。**

### 2.1 工作区创建（`.worktrees` 已在 `.gitignore:3`，不会污染工作树）

```bash
# 前置：批次 0 的文档基线已提交（见 §11.1），否则两个工作区看不到路线图与本计划
git -C /media/win_data/aigcfroge worktree add .worktrees/v2-arch -b v2-lifecycle-owner main
git -C /media/win_data/aigcfroge worktree add .worktrees/v2-ux   -b v2-ux-foundation  main

# 每个工作区必须各自装依赖：node_modules 不随 worktree 共享（.gitignore:2）
cd /media/win_data/aigcfroge/.worktrees/v2-arch && bun install
cd /media/win_data/aigcfroge/.worktrees/v2-ux   && bun install
```

> **软链隐患**：仓库另有位于 `/media/keer/办公/aigcfroge/.worktrees/` 的历史 worktree，而 `/media/keer/办公` 是指向 `/media/win_data` 的软链。新建工作区请一律用 `/media/win_data/aigcfroge/...` 绝对路径，避免软链被删后 worktree 指针失联。

### 2.2 包级所有权矩阵（唯一写权限）

| 包 / 路径                                                      | 架构计划（`v2-lifecycle-owner`）                       | UX 计划（`v2-ux-foundation`）               |
| -------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------- |
| `packages/core/**`                                             | ✅ 独占                                                | ⛔                                          |
| `packages/schema/**`                                           | ✅ 独占（recovery / lifecycle schema）                 | ⛔（只读 import，如 `schema/product-mode`） |
| `packages/aigcfroge/**`                                        | ✅ 独占（handler / server / app-runtime / auth / mcp） | ⛔                                          |
| `packages/desktop/**`                                          | ✅ 独占（main 进程 sidecar 监督 + IPC）                | ⛔                                          |
| `packages/sdk/js/**`（生成物）                                 | ✅ 独占，**只有本计划可跑生成器**                      | ⛔ 永不跑 `packages/sdk/js/script/build.ts` |
| `packages/app/**`                                              | ⛔                                                     | ✅ 独占                                     |
| `packages/ui/**`                                               | ⛔                                                     | ✅ 独占（含 i18n 字典、v2 token、v2 组件）  |
| `packages/session-ui/**`                                       | ⛔                                                     | ✅ 独占                                     |
| `packages/storybook/**`                                        | ⛔                                                     | ✅ 独占                                     |
| `packages/llm`、`packages/tui`、`packages/plugin`、vendor 两包 | ⛔ 双方均不动                                          | ⛔                                          |

### 2.3 文档所有权矩阵

| 文档                                              | 架构计划                      | UX 计划                         | 说明                                                                           |
| ------------------------------------------------- | ----------------------------- | ------------------------------- | ------------------------------------------------------------------------------ |
| `ARCHITECTURE.md`                                 | ✅ 独占（§4.1/§4.3/§7）       | ⛔                              | §4.10 的 Custom 状态已在批次 0 修正，双方都不用再动                            |
| `DESIGN.md`                                       | ⛔                            | ✅ 独占                         | §Scope 已在批次 0 修正                                                         |
| `specs/v2/todo.md`                                | ✅ 独占                       | ⛔                              |                                                                                |
| `docs/architecture/adr/ADR-22/23/24-*.md`         | ✅ 新建文件，天然无冲突       | ⛔                              |                                                                                |
| `docs/architecture/system-blueprint.md`           | ✅ 独占                       | ⛔                              |                                                                                |
| `docs/technical-debt.md` §4 表                    | ✅ **只在表体第一行之前插入** | ✅ **只在表体最后一行之后追加** | §4 表体现有 **21 行**，首尾相距远超 git 三方合并所需的 3 行上下文 ⇒ 机械可合并 |
| `docs/technical-debt.md` 其他节（§0/§1/§2/§3/§5） | ⛔                            | ⛔                              | 批次 0 已校准；本轮任何一方都不改                                              |
| 本计划与并行计划两份 `docs/plan/*.md`             | 各自独占自己那份              | 同                              |                                                                                |

### 2.4 两条接缝（Seam）：为什么可以先后任意顺序合并

两份计划有两个真实的语义依赖。契约把它们收敛成**带兜底的类型化端口**，使双方都能独立通过 typecheck、独立跑绿、独立合并。

**接缝 S1 · 服务端能力读路径（capability read path）**

- **已存在、可复用、双方都不必新建**：能力协商机制端到端已通：常量 owner 在 `packages/schema/src/product-mode.ts`（`CAPABILITY_CUSTOM_V1` / `CAPABILITIES_HEADER = "x-aigcfroge-capabilities"`，注释明确写了它放在 schema 而非 core 是因为浏览器 app 也要发这个头，而 `core/product-mode-policy` 会传递依赖 `core/flag/flag` 并在模块求值期读 `process.env`）；`core/product-mode-policy.ts:7-8` 再导出；App 在 `packages/app/src/utils/server.ts:37` 为**每个** SDK client 注入该头；服务端在 `custom-composition.ts` / `session.ts` / `global.ts` / `event.ts` / `experimental.ts` 多处读取。
- **缺口（实测）**：`isCustomModeEnabled()` 在 `packages/aigcfroge/src/` 只被三个**动作** handler 消费（`custom-composition.ts:26/39/88`）。**不存在任何读端点**能让客户端在动作之前问「这台服务端启用了哪些 Product Mode」。
- **本计划负责**（批次 A0-3）：新增能力读路径 + 在 custom 停用分支写入结构化 `InvalidRequestError.kind = "custom_mode_disabled"`（该可选字段**已在别处启用**：`handlers/session.ts:502/512`、`middleware/workspace-routing.ts:199`、`middleware/schema-error.ts:31`，属复用而非新增机制），并重跑 SDK 生成器。
- **UX 计划负责**：定义 UI 侧 `CapabilityPort` 端口与 `enabled | disabled | unknown` 三态渲染，默认适配器返回 `unknown`（退化为当前行为），测试注入假端口。
- **合并后集成门**（在 `main` 上跑，不在任一分支）：把 UX 侧默认适配器切到生成 SDK 的真实方法 + 改判 `kind`，字符串匹配降级为兼容旧服务端的兜底。这是一次**十行量级**的收尾提交，责任人由两个 PR 的作者共同承担。

**接缝 S2 · 恢复状态（recovery state）**

- **本计划负责**：`server-dead` 与 `recovery_required` 的**产生**——schema 取值、持久化、事件/SSE 投递、desktop 主进程可观测性。
- **UX 计划负责**：状态词汇表里的 `recovery` 语义位与渲染骨架；在后端尚未投递真实状态前**不伪造按钮**（这条是 UX 路线图 Phase 2 的明文停止条件）。
- **禁止**：任一方为了自测方便在对方包里塞 mock 数据源。UX 侧一律用注入的假端口，架构侧一律用 `test/server` 装配。

### 2.5 冲突自检（每次 push 前，两个工作区都要跑）

```bash
# 1. 本分支是否碰了不属于自己的包
git diff --name-only origin/main...HEAD | grep -E '^packages/' | cut -d/ -f2 | sort -u

# 2. 与并行分支的真实重叠文件（应当为空；docs/technical-debt.md 若同时出现，核对 §2.3 的插入位置规则）
comm -12 \
  <(git diff --name-only origin/main...v2-lifecycle-owner | sort) \
  <(git diff --name-only origin/main...v2-ux-foundation  | sort)

# 3. 干跑合并（不落地，只看会不会冲突）
git merge-tree $(git merge-base v2-lifecycle-owner v2-ux-foundation) v2-lifecycle-owner v2-ux-foundation | grep -c '^<<<<<<<' || echo "0 conflicts"
```

第 2 步输出非空且不在 §2.3 允许清单内 ⇒ **停止 push**，先按所有权矩阵把越界改动搬回正确分支。

---

## 3. 五层代码追踪（执行前必读，行号为本计划撰写时实测）

### 3.1 F1 的机制根因：事件表与 session 表之间没有任何物理约束

```
调用面                     命令层                        事件层                       投影层                    表
────────────────────────────────────────────────────────────────────────────────────────────────────────────
handlers/session.ts        SessionV2.remove              （不经过）                   （不触发）                 DELETE session
  :466-471  remove      →    session.ts:773-779      ──╳──                        ──╳──                  ↑ 唯一动作
  :535-539  setTitle    →    session.ts:784-791      ──╳──                        ──╳──                  UPDATE session.title
  :957-965  removeMsg   →    session.ts:780-783      ──╳──                        ──╳──                  DELETE session_message

对照 V1（语义正确的那条）
  aigcfroge/session.ts:660-681
    :661 读 info → :670 取消 background job → :671-674 递归删 child（children :650-658）
    → :676 publish SessionV1.Event.Deleted → 投影 projector.ts:263-265 删 session 行
    → :677 events.remove(sessionID) 清整条事件流 + sequence（event.ts:519-528）
```

**三条 V2 函数的实测形态**（`packages/core/src/session.ts`，接口声明 `:232`/`:233`/`:234`）：

| 函数            | 实现行                             | 写的表                   | 事务 | publish | `Effect.uninterruptible` |
| --------------- | ---------------------------------- | ------------------------ | ---- | ------- | ------------------------ |
| `remove`        | `:773-779`（DELETE 在 `:778`）     | 仅 `SessionTable`        | 无   | 无      | 无                       |
| `removeMessage` | `:780-783`（DELETE 在 `:782`）     | 仅 `SessionMessageTable` | 无   | 无      | 无                       |
| `setTitle`      | `:784-791`（UPDATE 在 `:786-790`） | 仅 `SessionTable.title`  | 无   | 无      | 无                       |

对比：`prompt` / `shell` / `skill` 都包了 `Effect.uninterruptible`（`session.ts:657`/`:687`/`:719`）。

**决定性证据 —— 注释与函数体自相矛盾**（`session.ts:775-778`）：注释写着「Event table is separate, so delete events explicitly」，函数体里**没有任何** `EventTable` / `EventSequenceTable` 写入，也没有调用 `events.remove`。

**为什么 DB 层兜不住**：`session/sql.ts:34` 是 `parent_id: text().$type<SessionSchema.ID>()`，**没有 `.references()`** —— 无自引用 FK、无 `ON DELETE`、无 NOT NULL，删父行不会动子行；`event` / `event_sequence` 对 session **没有任何 FK**（`event/sql.ts:4-25` 只按 `aggregate_id: text()` 字符串关联），所以即使 `PRAGMA foreign_keys = ON`（`database/database.ts:105`）也绝无可能由级联带走事件流。session 行的入站 FK 有 13 张表会级联清理（`sql.ts:80-83`/`:111-114`/`:131-134`/`:161-164`/`:182-185`/`:210-213`/`:220-223` 等），唯独事件流不在其中。

### 3.2 触发面**已经打开**（这条决定 Slice 0 的紧迫性）

`ProductModePolicy.shouldUseV2Runtime`（`packages/core/src/product-mode-policy.ts:106-109`）对 `mode === "custom"` **无条件返回 `true`**，与 `AIGCFROGE_V2_RUNTIME`（默认 false，`packages/aigcfroge/src/effect/app-runtime.ts:92`）无关。也就是说：**今天任何一个 custom 会话执行删除/改名/删消息，都会走上述三条直写路径。** 三个 HTTP 入口分别是 `handlers/session.ts:466-471`、`:535-539`、`:957-965`。

### 3.3 投影层现状：缺口不是「少一个分支」，而是「表错位 + 事件不存在」

唯一投影注册点是 `SessionProjector.layer`（`packages/core/src/session/projector.ts:215-463`，全仓 `src/` 无第二处 `events.project(`）。

| 事件                 | 投影行     | 动作                                                                                                           |
| -------------------- | ---------- | -------------------------------------------------------------------------------------------------------------- |
| `session.created`    | `:219-238` | insert + `onConflictDoNothing().returning()`，无行返回则 `Effect.die(new SessionAlreadyProjected())`（`:228`） |
| `session.updated`    | `:239-246` | `set(sessionRow(info))` 全字段覆盖（含 title）                                                                 |
| `session.next.moved` | `:247-262` | 改 directory/path/workspace + `SessionContextEpoch.reset`（`:260`）                                            |
| `session.deleted`    | `:263-265` | `delete(SessionTable)` 一行，仅此                                                                              |
| `message.removed`    | `:280-298` | 删 **`MessageTable`**（`:292-296`）+ `applyUsage(..., -1)`（`:288-291`）                                       |

三个**结构性**缺口：

1. **V2 命名空间没有生命周期事件**。全仓只有 V1 的 `session.created` / `session.updated` / `session.deleted` / `message.removed`（`packages/core/src/v1/session.ts:583`/`:591`/`:599`/`:615`），`packages/core/src/session/event.ts` 全是 `session.next.*` 且**没有** `session.next.deleted`、没有任何 rename/title 事件。
2. **`message.removed` 与 V2 表错位**：投影删 `MessageTable`（V1 表），而 V2 `removeMessage` 删 `SessionMessageTable`。**没有任何 projector 会删 `SessionMessageTable` 行。**
3. **定义了却无人发无人投**：`SessionEvent.Forked`（定义 `session/event.ts:159-167`，已列入 `DurableDefinitions` `:563`，全仓零引用；V2 Session 也没有 `fork` 方法）；`Verify.Started/Passed/Failed`（`:506-533`，在 DurableDefinitions `:577-579` 但无投影）；`Compaction.Started`（`:446` 无投影）；`Retried` 的投影被注释掉（`projector.ts:460`）。另一处不对称：`SyntheticAdmitted` 有投影（`:407`）但**未**列入 `DurableDefinitions`，因此会被 `Session.events()` 的 `isDurableSessionEvent` 过滤掉（`session.ts:307`、`:655`）。

### 3.4 下游联动断裂（超出重放范畴，但同样由「不发事件」导致）

- App 全局同步 reducer 有 `session.deleted`（`packages/app/src/context/global-sync/event-reducer.ts:237-249`）与 `message.removed`（`:344-352`）分支 —— V2 直写后前端**永远收不到删除**。
- 分享清理监听 `Session.Event.Deleted`（`packages/aigcfroge/src/share/share-next.ts:200`）—— V2 直写后**不会触发**。

### 3.5 正路径：统一 owner 要复用的就是这条链（`packages/core/src/event.ts`）

```
publish(:425-444)  补 Location(:427-432) + 生成 ID(:435)
  → publishEvent(:374-402)  查 registry(:376)；非 durable 带 commit 即 die(:377-383)
    → commitDurableEvent(:213-372)   取 aggregateID(:227)、取 projectors(:244)、整段 uninterruptible(:245)
      → db.transaction(behavior:"immediate")(:247-357)   ← 一个事务内，严格顺序
           读 seq+owner(:251-257, latest = row?.seq ?? -1)
           encode(:258) → strictOwner 围栏(:259-266)
           幂等/分歧判定(:267-295, 不一致 die "Replay diverged")
           seq = input?.seq ?? latest+1(:299) → replay 连续性校验(:300-307)
           事件 ID 全局去重(:308-320)
           ★ 跑 projectors(:325-327)
           ★ 跑 PublishOptions.commit(seq, tx)(:328)   ← 与事件同事务写本地投影的唯一合法通道
           upsert EventSequenceTable(:329-340) → insert EventTable(:341-353)
      → 事务外唤醒该 aggregate 的 durable 订阅者(:359-365) → notify(:412-423)
```

关键性质：**projector 与 `commit` 钩子都在同一事务内、且在 seq/event 行落库之前执行，任一失败整笔回滚**（已由 `packages/core/test/event.test.ts:196` "rolls back the durable event and projector when the local commit fails" 覆盖）。`PublishOptions.commit` 类型见 `event.ts:146`，`Transaction` 见 `event.ts:139`。

**现成范式（三份同构实现，本计划复用而不新造）**：`GrantEvent.publish`（`packages/core/src/grant/event.ts:29-50`，签名 `(events, update, commit)`，含 `CommitRejected` `:19-26` 与 `seq + 1 !== revision` 围栏 `:37-39`）、`mcp/binding/event.ts:32-36`、`workflow/event.ts:38-42`、`workflow/workflow-run.ts:339-343`。

### 3.6 `EventV2.remove` 的真实语义（Slice 1 会用到）

接口 `event.ts:169`，实现 `:519-528`，装配 `:649`。它是 **aggregate 级整流清除**：同时删 `EventSequenceTable` 行（`:523`）与该 aggregate 全部 `EventTable` 行（`:524`）。删掉 sequence 行即把序号计数器复位 —— `latestSequence` 无行时返回 `-1`（`event.ts:51-62`），所以 remove 后同 aggregate 从 seq 0 重新开始。两个实现细节要注意：`db.transaction(() => ...)`（`:521`）的回调**不接收也不使用 `tx`**，两条 DELETE 打在闭包外的 `db` 上（对比 `commitDurableEvent` 全程用 `tx`）；第二条 DELETE 逻辑上冗余（`event/sql.ts:13-16` 已有 `onDelete: "cascade"`）。生产代码**唯一**调用点是 V1 的 `packages/aigcfroge/src/session/session.ts:677`，`packages/core/src` 内**零调用**。

### 3.7 测试现状：破坏性路径零覆盖，但重放探针模板已存在

- **V2 的 `remove` / `removeMessage` / `setTitle` 在 `packages/core/test/` 命中为 0**（精确 grep `setTitle|removeMessage|session\.remove|sessions\.remove` 返回空）。全仓测试目录**没有任何地方设置 `AIGCFROGE_V2_RUNTIME`**，所以这三条 V2 分支在测试中从未被执行过。
- **重放等价性测试已存在，可直接当模板**：`packages/core/test/session-create.test.ts:253` `it.effect("replays one prompt lifecycle into a fresh target database")` —— 把源库 `EventTable` 全量序列化，在**独立的临时 target sqlite**（`:283-286` 新建 Database/Events/Projector/Store layer）上分两段 `replayAll`（`:299`、`:309`），逐段断言 `SessionInput.find` 的 `admittedSeq/promotedSeq`、`store.context`，以及目标库事件序列 `[[0, session.created.1], [1, prompt.admitted.1], [2, prompted.1]]`（`:321-333`）。它只覆盖 create + prompt。
- 其他可复用装配：`session-prompt.test.ts:382`（`events.remove` + 手工清表 + `replayAll` 的同库重投影）、`session-runner.test.ts:457-475` 的 `replaySessionProjection` 辅助（被 13+ 用例复用）、`event.test.ts:1046` "remove clears durable event sequence"。
- `session-projector.test.ts` **无任何删除/改名投影用例**；`session-children.test.ts:44-` **无「删父后 child 变孤儿」用例**。

### 3.8 F7 代码侧：`CredentialValue` 是一条既反向又未声明的边

`packages/core/src/plugin/provider/aigcfroge.ts:5` `import type { CredentialValue } from "@aigcfroge/sdk/v2/types"`（使用点 `:193`）。真实来源是 **generated SDK**（`packages/sdk/js/package.json:19` → `./src/v2/gen/types.gen.ts`，类型本体 `types.gen.ts:3912`）。而 `packages/core/package.json` **未声明** `@aigcfroge/sdk` 依赖（workspace 依赖只有 http-recorder / effect-drizzle-sqlite / effect-sqlite-node / llm / plugin / schema），仅靠 bun workspace 解析生效。**owner 早已存在**：`packages/schema/src/credential.ts:31-34` `export const Value = Schema.Union([OAuth, Key])`，core 已再导出为 `Credential.Value`（`packages/core/src/credential.ts:19-20`）。同类反向依赖还有 `packages/plugin/src/v2/effect/integration.ts:4` 与 `packages/plugin/src/v2/promise/integration.ts:2`（本计划只修 core 那条，plugin 两条登记为债）。

---

## 4. 设计决策与方案对冲

### 4.1 D1（**唯一需要人类裁决的决策**）：delete 是 purge 还是可审计 tombstone

全仓 `src/` 内 `tombstone|Tombstone` **零命中**，所以这不是「对齐既有概念」，而是新立语义。两个自洽方案：

|            | **方案 P · purge（与 V1 一致）**                                                           | **方案 T · 事件流即墓碑（推荐）**                                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 删除动作   | publish `session.next.deleted` → 投影删行 → **再调 `events.remove(aggregateID)`** 清整条流 | publish `session.next.deleted` → 投影删行；**事件流保留**                                                                                  |
| 重放等价性 | 平凡成立（无流可重放）                                                                     | **结构性成立**：重放 `created → … → deleted` 后行必然不存在                                                                                |
| 同 ID 复用 | 允许，新流从 seq 0 起                                                                      | **必须拒绝**（typed error）：aggregate 已有终态 `deleted`，再来一个 `created` 会让重放撞上 `SessionAlreadyProjected`（`projector.ts:228`） |
| 审计       | **丢失**——无任何记录证明该 session 曾存在                                                  | 保留，导出/审计/恢复可用                                                                                                                   |
| 新增 DB 列 | 无                                                                                         | **无**（墓碑由事件流终态表达，不是 DB 标志位 —— 极致减法）                                                                                 |
| 代价       | 审计缺口；与「导出/重放/恢复依赖 EventV2」的前提冲突                                       | `event` 表不再被 session 删除回收，需要独立的保留/清理策略（先例：grant 的 `prune`）                                                       |

**推荐方案 T**，理由：等价性从「靠测试守」变成「靠结构成立」；不新增列；`ID 复用被拒绝` 是比「允许复用」更强、更好测的不变量。**代价必须显式承认**：事件表增长与保留策略成为一条新的、已登记的技术债（§10-1）。

> **执行门**：本决策写入 **ADR-22** 并由人类签署后，批次 A1 才可进入绿灯。方案未定前，A1 只能做红先行测试（测试可以先写成 T 的形状，并在 ADR 落定后调整）。

### 4.2 D2：统一 owner 放在哪里 —— 复用既有先例，不新造层

`packages/core/src/control-plane/move-session.ts` 是全仓**唯一**「V2 session 状态变更走独立 command owner + durable 事件」的先例（`Input :21`、四个 TaggedError `:28-52`、`Service :70`、`moveSession :81`、`events.publish(SessionEvent.Moved, ...) :111-116`）。本计划照它的形状新建 `packages/core/src/session/lifecycle.ts`，而**不**引入任何新的抽象层、不建 command bus、不做 CQRS 框架。

### 4.3 D3：「禁止直写」用结构强制，不靠人工纪律

三步，缺一则约束会在下一个 PR 里失效：

1. 把 `remove` / `removeMessage` / `setTitle` 从 `SessionV2.Interface`（`session.ts:232-234`）**移除**，只由 `SessionLifecycle.Service` 暴露；HTTP 三个入口（`handlers/session.ts:466`/`:535`/`:957`）改调 owner。
2. 新增**结构门禁测试**：断言 `packages/core/src` 内除 `session/projector.ts` 与 `session/lifecycle.ts` 外，不存在对 `SessionTable` / `SessionMessageTable` / `EventTable` 的 `delete(` / `update(` 调用。用 `Bun.Glob` + 源码扫描实现（这是唯一允许的源码级断言：它断的是**架构约束**而非行为，`docs/testing.md` §10 红线 3 禁止的是用源码字符串**代替行为断言**）。
3. `EventV2.remove` 的生产调用面收敛：方案 T 下 `packages/core/src` 仍应保持零调用；方案 P 下**只允许** `session/lifecycle.ts` 调用。同一门禁测试覆盖。

### 4.4 D4：Slice 0 的止血用 fail-closed flag，而不是删端点

删端点会改 wire shape、连带打断 SDK 与 App（越界到并行计划的包）。改用**复用**现有两套机制：

- 门控：`Flag` 新增 `get AIGCFROGE_V2_DESTRUCTIVE()`（**getter 形式**，与 `AIGCFROGE_CUSTOM_MODE`（`flag/flag.ts:74-75`）一致；不要用文件顶部 `const`，那会在模块求值期读 `process.env`，测试无法驱动）。默认 **false**。
- 拒绝信号：抛 `InvalidRequestError` 并写 **结构化 `kind: "v2_destructive_disabled"`**。`kind` 字段**已在别处启用**（`handlers/session.ts:502`/`:512`、`middleware/workspace-routing.ts:199`、`middleware/schema-error.ts:31`），属复用；**不得**只传 `message` —— 那正是 `docs/technical-debt.md:130` 记录的「客户端只能靠英文子串匹配」这条债的成因。
- 门控点放在 **core 的 lifecycle 入口**（不是 HTTP handler），这样 CLI / TUI / 未来任何调用面都被同一处拦住。

### 4.5 D5：Slice 2 只做「诚实恢复」，不做 durable attempt

按路线图 §6.1 的分级表实现：durable `session_input` 已提交未 drain ⇒ 启动 sweep 后按 prompt ID 去重续跑；provider 请求可能已发出但未 settlement ⇒ 标 `recovery_required` 并展示不确定性；文件/shell/MCP/Plugin 外部副作用 ⇒ 记录未知副作用 + 人工确认。**lease / owner epoch / fencing / CAS settlement 明确不做**（ADR-23 之后另立专项）。

### 4.6 D6：Slice 3 只做 identity probe，不动 Layer 拓扑

路线图把 F4 判为「较高概率，未证实」。本计划**先证明再动**：只加 probe + 移除生产测试 seam；**不**做「唯一 composition root」重构（那要等 probe 结论 + ADR-24 + V1 退役）。已有教训佐证这条谨慎：按 env 分叉 Layer 拓扑会让 `Layer.empty` 的 `never` 在联合类型里消失、造成类型谎报。

### 4.7 方案对冲总表

|          | 简单实现（本计划采用）                                | 健壮架构（不在本计划）                                            |
| -------- | ----------------------------------------------------- | ----------------------------------------------------------------- |
| 生命周期 | 单 command owner + 同事务事件/投影                    | 同左 + 保留策略/归档/导出契约                                     |
| 恢复     | `server-dead` + 启动 sweep + 人工 `recovery_required` | durable attempt + lease + fencing + CAS settlement + 副作用幂等键 |
| 装配     | identity probe + 移除测试 seam                        | 唯一 composition root + process/location/session scope 严格分离   |
| 声明     | **不得**宣称 crash-safe / 自动恢复                    | 需产品 SLA 与故障注入矩阵后才可宣称                               |

---

## 5. 分阶段实施（每批次严格 红 → 绿 → 重构；批次之间可独立提交）

> 通用规则：每个「红」步骤必须先跑一次并**看到失败**，把失败输出贴进 PR 描述；`docs/testing.md` §10 七条红线逐条适用。**禁止** `Effect.sleep(N)` 等待并发 fiber，用 `pollWithTimeout` / `Deferred` / `awaitWithTimeout`。

### 批次 A0 · 红线止血（Slice 0，估算 0.5–1 天）

| 步   | 类型 | 动作                                                                                                                                                                                                                                                                                                                                                                               |
| ---- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A0-1 | 红   | 在 `packages/core/test/session-lifecycle-gate.test.ts` 新建：断言 flag 关闭时 `SessionLifecycle` 的 delete/rename/deleteMessage 返回 `kind: "v2_destructive_disabled"` 的 typed 失败。此刻 owner 还不存在 ⇒ 编译期即红                                                                                                                                                             |
| A0-2 | 绿   | `packages/core/src/flag/flag.ts` 加 `get AIGCFROGE_V2_DESTRUCTIVE() { return truthy("AIGCFROGE_V2_DESTRUCTIVE") }`（**getter**，对照反例：`AIGCFROGE_V2_RUNTIME` 是 `app-runtime.ts:92` 的模块级 const，测试无法驱动）                                                                                                                                                             |
| A0-3 | 绿   | 新建 `packages/core/src/session/lifecycle.ts` 骨架：`Service` + 三个方法，方法体先只做 flag 门禁 + 委派到现有 `SessionV2` 实现（**此批不改语义**，只是把入口收敛到一个 owner 并加门）                                                                                                                                                                                              |
| A0-4 | 绿   | `handlers/session.ts` 三个 V2 分支（`:466-471` / `:535-539` / `:957-965`）改调 `SessionLifecycle`；`InvalidRequestError` 带 `kind`（复用既有可选字段，见 §4.4）                                                                                                                                                                                                                    |
| A0-5 | 绿   | **能力端点诚实化**：`handlers/experimental.ts:45` 的 `customMode: false` 是硬编码字面量，不读 kill switch；改为 `ProductModePolicy.isCustomModeEnabled()`；`productModes`（`:46`）改由 `ProductMode.ID` 的 literals 派生而非手写数组。同步改 `packages/aigcfroge/test/server/product-mode-compatibility.test.ts:28-38`（它把 `customMode === false` 钉死了），改成按 flag 双向断言 |
| A0-6 | 绿   | 文档诚实化：`specs/v2/todo.md` Phase 5（`:184-190`）补 flip 的前置验收清单；修正 `docs/plan/meta-agent-v2-production-closure.md:3,18,55` 里「`AIGCFROGE_V2_RUNTIME` 默认 true（`fef78b8`）」的错误声明（**实测默认 false**）；`ARCHITECTURE.md` §7 加入两份 V2 路线图                                                                                                              |
| A0-7 | 重构 | `CredentialValue` 改 import 方向：`packages/core/src/plugin/provider/aigcfroge.ts:5` 从 `@aigcfroge/sdk/v2/types` 改为 core 自己的 `Credential.Value`（`packages/core/src/credential.ts:19-20`，真源 `packages/schema/src/credential.ts:31-34`）。**不动** plugin 包那两条同类边（`plugin/src/v2/{effect,promise}/integration.ts`），登记为债                                      |
| A0-8 | 门禁 | `bun --cwd packages/core test session-lifecycle-gate.test.ts` · `bun --cwd packages/aigcfroge test server/product-mode-compatibility.test.ts` · core+aigcfroge typecheck · `LINT_BASE_REF=origin/main bun run script/lint-changed.ts`                                                                                                                                              |

> **A0 的价值判据**：批次结束时，`shouldUseV2Runtime` 对 custom 无条件为 true（`product-mode-policy.ts:106-109`）这条**已经打开**的触发面被一道 fail-closed 门挡住，且客户端能靠 `kind` 而非英文子串识别原因。

### 批次 A1 · Lifecycle 一击必杀（Slice 1，估算 3–5 天，**前置 ADR-22**）

| 步    | 类型 | 动作                                                                                                                                                                                                                                                                                                                                                                            |
| ----- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1-1  | 红   | `packages/core/test/session-lifecycle-replay.test.ts`：照 `session-create.test.ts:253-336` 的**跨库 target sqlite + `replayAll`** 模板，写 `create → setTitle → removeMessage → remove → 同 ID 重建 → replay` 全链等价断言。预期红：当前 `remove` 不发事件，target 库重放后 session 行仍在                                                                                      |
| A1-2  | 红   | 同文件补孤儿断言：建父子两 session，删父，断言 `store.children(parentID)` 为空且无 `parent_id` 指向已删 ID。预期红（`sql.ts:34` 无 FK）                                                                                                                                                                                                                                         |
| A1-3  | 红   | 补「同 ID 复用被拒绝」（方案 T）或「同 ID 复用得到干净流」（方案 P）断言，按 ADR-22 落定的方案二选一                                                                                                                                                                                                                                                                            |
| A1-4  | 绿   | `packages/core/src/session/event.ts` 新增三个 durable 定义：`session.next.deleted`、`session.next.renamed`、`session.next.message-removed`（`EventV2.define`，`durable: { version: 1, aggregate: "sessionID" }`），并**同步加入 `DurableDefinitions`**（`session/event.ts:553-585`）—— 漏加会被 `isDurableSessionEvent` 过滤掉，`SyntheticAdmitted` 就是现成的反面教材          |
| A1-5  | 绿   | `session/projector.ts` 注册三个投影：deleted → `delete(SessionTable)`（复用 `:263-265` 形状）；renamed → 只改 `title` + `time_updated`（**不要**复用 `session.updated` 的全量 `sessionRow` 覆盖）；message-removed → 删 **`SessionMessageTable`**（当前**没有任何** projector 会删这张表）并复用 `applyUsage(db, sessionID, value, -1)`（`projector.ts:94-114`）回冲 token/cost |
| A1-6  | 绿   | `session/lifecycle.ts` 三个方法改为**只经 `events.publish`**：照 `GrantEvent.publish`（`grant/event.ts:29-50`）的 `(events, update, commit)` 范式，把父子递归清理与 `SessionContextEpoch.reset` 放进 `PublishOptions.commit(seq, tx)`（`event.ts:146`）—— 那是与 durable 事件同事务写本地投影的**唯一合法通道**（`event.ts:328`，且在 seq/event 行落库之前，失败整笔回滚）      |
| A1-7  | 绿   | 递归 child：复用 `SessionStore.children`（`session/store.ts:74-82`，现成读侧，V2 当前零调用）；删除前忙检查复用 `SessionExecution.isActive`（用法见 `session.ts:548`）与 `SessionBusyError`（`session.ts:150-152`）                                                                                                                                                             |
| A1-8  | 绿   | 方案 P 才需要：在 lifecycle 内调 `events.remove(aggregateID)`（`event.ts:519-528`，注意它会把 sequence 复位到 -1）。方案 T 则**不调**，改为在 `create` 路径拒绝已有终态 `deleted` 的 aggregate                                                                                                                                                                                  |
| A1-9  | 重构 | 从 `SessionV2.Interface`（`session.ts:232-234`）移除三个方法；加 §4.3 的结构门禁测试（扫 `packages/core/src` 禁止直写三张表）                                                                                                                                                                                                                                                   |
| A1-10 | 门禁 | core 全量 `bun --cwd packages/core test --timeout 30000`；aigcfroge `test/server` 子集；两包 typecheck；增量 lint                                                                                                                                                                                                                                                               |

### 批次 A2 · Recovery 边界（Slice 2，估算 4–7 天，**前置 ADR-23**）

复用清单先行 —— 本批次**不发明**恢复机制，仓库里已有两套可抄：

- **状态与 CAS 模板**：`WorkflowRun.recoverRunning`（`packages/core/src/workflow/workflow-run.ts:1167-1295`）。单事务内二分：**无 running step ⇒ 安全续接**（`dispatching → ready`，清 `time_started/completed`，`:1198-1219` 返回 `safe_dispatch`）；**有 running step ⇒ 冻结**（CAS `.where(and(eq(id), eq(status, current.status), eq(revision, claimedRevision)))` `:1231-1236`，写 `recovery_required` + `revision + 1`，`running → execution_unknown`）。状态枚举在 `packages/schema/src/workflow-asset.ts:31-40` / `:43-54` / `:67-79`，`recovery_required` 已在 `terminalRunStatuses`（`workflow-run.ts:328-334`）中属**不可变终态**。
- **启动 sweep 模板**：`packages/core/src/session/scheduled-job.ts` 的 `recoverStaleClaims()`（`:203-215`，扫 `TaskTable` 里 `in_progress` 且无调度字段的行 → 走事件 + revision 的 `patch`）+ `arm(now, { recover })`（`:56-61`）+ `daemonLayer` 把 `startupSweep` 交给 `SchedulerCore.daemon`（`:225-235`），且 `daemonNode`（`:236`）**已接入** httpapi app 图（`httpapi/server.ts:338`）。**注意 WorkflowRun 的 `recoverRunning` 是懒触发（drain 循环内 `workflow-runner.ts:527-537`），不是启动 sweep；启动 sweep 只有 ScheduledJob 这一处先例。**

| 步   | 类型 | 动作                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A2-1 | 红   | `packages/core/test/session-recovery.test.ts`：durable `session_input` 已 admit 未 drain ⇒ 启动 sweep 后按 prompt ID 去重续跑。预期红：当前**不存在**任何按 session 扫 pending inbox 的启动 sweep（`SessionInputTable` 定义在 `session/sql.ts:178-206`，消费在 `session/input.ts`）                                                                                                                                                                                                                                                                                                                                                                                                           |
| A2-2 | 红   | 同文件：provider 请求可能已发出但未 settlement ⇒ 状态落 `recovery_required` 且**不自动重试**。预期红                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| A2-3 | 绿   | `packages/schema` 加 Session 侧恢复状态取值（照 `workflow-asset.ts` 的 `Schema.Literals` 形状），含 `recovery_required` / `unknown_side_effect`；`server-dead` 属**进程级**事实，不入 session 行                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| A2-4 | 绿   | Session 侧 sweep：照 `scheduled-job.ts:203-215` 写 `recoverStaleSessions()`，经 `SchedulerCore.daemon` 的 `startupSweep` 接入（复用已在 app 图里的 `daemonNode`，**不新建 daemon**）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| A2-5 | 绿   | 副作用分级按路线图 §6.1 表落地：只读工具/边界可证 ⇒ 续跑；文件写入/shell/MCP/Plugin ⇒ 记录未知副作用 + 需人工确认。**不做** lease/fencing/CAS settlement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| A2-6 | 绿   | Desktop sidecar 监督（`packages/desktop/src/main/server.ts` + `index.ts`）：当前 `child.once("exit")`（`server.ts:98-103`）只做三件事（置 `exited`、resolve deferred、调 `options.onExit`），而 `index.ts:345` 的 `onExit` **只 `writeLog`**；`health.wait`（`server.ts:163-182`）只在启动期 race 一次、`healthy = true` 即结束，**无持续监控**；`forwardInitializationFailure`（`initialization.ts:3-6`）是**一次性 Deferred**，fail 后不可重置。本步只加「**可观测 + 安全重启**」：`server-dead` 终态 + 复用 `relaunch`（`index.ts:163-168`）。**不做自动 restart 循环**（sidecar 子进程 `start`/`stop` 两条命令都以 `process.exit()` 收尾，`main/sidecar.ts:41-81`，同进程无法二次 start） |
| A2-7 | 绿   | 主进程 → renderer 的状态推送：**复用**既有两个订阅式先例的形状 —— WSL 的 `wsl-servers-subscribe` / `-get-state` / `-event`（`main/wsl/ipc.ts:26-42,91-95` + `preload/index.ts:17-39`）与 updater 的 `updater-subscribe` / `updater-state`（`main/ipc.ts:60-71`）。当前 renderer **只有** 一次性的 `awaitInitialization()`（`preload/types.ts:18-22`，`renderer/index.tsx:302` 用 `createResource` 消费一次），没有任何 health/status channel。本步只暴露状态，**不画 UI**（UI 归并行计划，见 §2.4 接缝 S2）                                                                                                                                                                                   |
| A2-8 | 门禁 | core 相关子集 + `bun --cwd packages/desktop typecheck`；**故障注入**：按路线图 §10.1 至少覆盖场景 1/3/4/6（provider 前、settlement 前、`Tool.Called` 后、sidecar 退出而窗口仍在）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

### 批次 A3 · Composition identity（Slice 3，估算 3–5 天，**前置 ADR-24**，可与 A2 并行）

先固化机制事实（effect `4.0.0-beta.83` 实测）：MemoMap 按 **Layer 对象引用**去重（`node_modules/effect/dist/Layer.js:123`、`:163`），`Layer.provide` 向下传同一张 memoMap（`:861`），`Layer.fresh` 分配**私有** memoMap（`:1416`）。所以「同一个模块级 Layer 对象 + 同一张 memoMap」⇒ 同实例。仓内已有成文教训：`packages/core/src/database/database.ts:113-124` 记录了 inline 出第二个 `Layer.effect` 导致第二个内存库 + 62 个 HttpApi 失败。

**当前有三张 memoMap**（这是 F4 真正的风险点，不是「装配语言多」）：① 共享模块级（`packages/core/src/effect/memo-map.ts:3`，被 root 1 `app-runtime.ts:253` 与 root 2 `httpapi/server.ts:386` 与 `testEffectShared` 共用）；② **每个 `Server.listen()` 新建一张**（`server/server.ts:148`，注释 `:121-138` 自陈动因是 TaskDriver 的 `Context.Reference` 要求「每个 listener 自成 composition root」）；③ 每个 Location 一张（`location-layer.ts:280` 的 `Layer.fresh`）。同进程既跑 `AppRuntime.runPromise` 又跑 `Server.listen()` 的入口（CLI `serve`/`web`/`acp`、TUI worker）横跨 ①②。

| 步   | 类型 | 动作                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A3-1 | 红   | `packages/core/test/composition-identity.test.ts`：照**唯一**现存 identity 探针 `permission-ask-bounds.test.ts:228-260`（手建 `Layer.makeMemoMapUnsafe()` + 两次 `Layer.buildWithMemoMap` + 跨句柄可见性断言）的写法，为 Database / EventV2 / SessionExecution / TaskDriver / ApprovalPresence 五个 owner 各写一条。**先按「必须共享」写死，让不共享的那些转红**                                                                                                                                                                                                         |
| A3-2 | 红   | `packages/aigcfroge/test/server/composition-identity.test.ts`：覆盖 instance/server/global 三面 + 两个 listener。复用 `test/server/httpapi-layer.ts` 的 `httpApiLayer` / `requestInDirectory`，以及 exerciser 的 `runtime()` 单例（`test/server/httpapi-exercise/runtime.ts:20-52` 同时持 `HttpApiApp` + `AppLayer` + 自有 memoMap，`runner.ts:70,116` 的 `buildWithMemoMap` 用法可直接抄）                                                                                                                                                                              |
| A3-3 | 绿   | 按 A3-1/A3-2 的红证据**逐个判定**：必须共享的（Database、EventV2、ApprovalPresence —— 后者已在 `httpapi/server.ts:163/:172/:245` 显式 provide 三次，注释 `:168-171` 明说必须是同一个 Layer 对象）修装配；必须按 Location 分离的（ToolRegistry、McpConnection 等）写成断言钉死。**不做**「唯一 composition root」重构                                                                                                                                                                                                                                                     |
| A3-4 | 绿   | 移除生产测试 seam：`SessionExecution.setBusySeamForTesting`（`session/execution.ts:23`，setter `:25-27`，读点 `:43` 与 `execution/local.ts:35-36`）。**根因**是 `test/server/httpapi-layer.ts` 用 `HttpApiApp.routes` 而**不 provide `AppLayer`**，而 root 2 里 SessionExecution 被 `Layer.provide` 藏在 `v2RuntimeLayer` 内部（`session/v2-runtime.ts:16-19`）、不出现在 route 的输出 context，于是 per-test Layer override 触不到它。修法：给测试装配开一个正规注入点，然后删 seam + 改唯一写点（`test/server/httpapi-custom-composition-upgrade.test.ts:162`/`:165`） |
| A3-5 | 门禁 | core + aigcfroge 全量 test；三包 typecheck；`bun --cwd packages/aigcfroge test:httpapi`（coverage + auth 两条硬门禁）                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

---

## 6. 测试策略与矩阵

### 6.1 层级归属

| 要验证的东西                           | 层级                                 | 位置                                             | 说明                                                                                                                                                                                             |
| -------------------------------------- | ------------------------------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| lifecycle 事务语义、投影结果、重放等价 | 单测（`it.effect`）                  | `packages/core/test/session-lifecycle-*.test.ts` | 用 `testEffect()`，禁手写 runtime                                                                                                                                                                |
| 跨库重放等价                           | 单测                                 | 同上                                             | 复用 `session-create.test.ts:253-336` 的独立 target sqlite 模板                                                                                                                                  |
| 父子孤儿                               | 单测                                 | 同上                                             | 复用 `SessionStore.children`                                                                                                                                                                     |
| flag 门禁 / `kind` 信号                | 单测 + HTTP                          | core + `packages/aigcfroge/test/server/`         | HTTP 层用 `httpapi-layer.ts` 的 `requestInDirectory`（真起服务）                                                                                                                                 |
| 恢复 sweep、副作用分级                 | 单测（`it.live` 需真实 FS 时）       | `packages/core/test/session-recovery.test.ts`    | 禁 `Effect.sleep`，用 `pollWithTimeout`                                                                                                                                                          |
| sidecar 死亡可观测                     | typecheck + 手工场景                 | `packages/desktop`                               | desktop 无单测（`docs/testing.md` §2），靠 typecheck + 故障注入手工记录                                                                                                                          |
| composition identity                   | 单测                                 | core + aigcfroge                                 | 见 §5 A3-1/A3-2                                                                                                                                                                                  |
| 端点行为负例                           | **必须写进 `test/server/*.test.ts`** | `packages/aigcfroge/test/server/`                | **不能只放 exerciser**：`--mode coverage` 从不发请求（`routing.ts:36` 无条件返回 pass），把期望状态改成 `.json(599)` 依然 PASS；`--mode effect` 有 `continue-on-error: true`（`test.yml:83-88`） |

### 6.2 命令（每条都要在 PR 里写真实结果，不许写「应该通过」）

```bash
# 单文件红先行
bun --cwd packages/core test test/session-lifecycle-replay.test.ts --timeout 30000
# 包级
bun --cwd packages/core      test --timeout 30000
bun --cwd packages/aigcfroge test --timeout 30000
bun --cwd packages/aigcfroge test:httpapi
# 类型
bun --cwd packages/core typecheck && bun --cwd packages/schema typecheck
bun --cwd packages/aigcfroge typecheck && bun --cwd packages/desktop typecheck
# lint（必须带基线）
LINT_BASE_REF=origin/main bun run script/lint-changed.ts
# 生成物（只有本计划可跑）
bun ./packages/sdk/js/script/build.ts && git diff --stat -- packages/sdk
```

### 6.3 已知会干扰判读的既有噪声（不要误判成本分支回归）

- `packages/aigcfroge/test/server/httpapi-reference.test.ts` **真的会克隆 github.com/Effect-TS/effect**，网络不通时整个 `test/server/` 门禁以超时形式变红（实测无代理 384 pass / 2 fail 耗时 884s，开代理 386 pass / 2 skip 耗时 620s）。
- spawn 子进程 / 实例引导测试对机器负载敏感（`test/project/instance-bootstrap.test.ts`、`test/cli/acp/*.test.ts`、`test/cli/run/run-process.test.ts`）：并行跑 lint/typecheck/子代理时会集体 `TimeoutError`，空载单跑全绿。**结论：跑门禁时不要同时跑其他重负载任务。**
- exerciser `--mode effect` 在 `main` 上已有 3 条既有失败：`agent-asset.apply`、`session.workflow.run`（期望 202 实得 500）、`session.task.get`。
- 全仓 Prettier 基线漂移（`packages/core/src` 112/498 文件未过 prettier，`origin/main` 上即如此）。**不要**在本分支做批量格式化。

---

## 7. 文件清单

### 7.1 新增

| 文件                                                          | 用途                                                                               |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `docs/architecture/adr/ADR-22-session-lifecycle-semantics.md` | purge vs tombstone、父子递归、ID 复用、事件/投影等价                               |
| `docs/architecture/adr/ADR-23-execution-crash-recovery.md`    | recovery_required、外部副作用分级、at-least-once 边界                              |
| `docs/architecture/adr/ADR-24-composition-scopes.md`          | process/location/session scope、memoMap 数量、唯一 root 的**目标**（本计划不实施） |
| `packages/core/src/session/lifecycle.ts`                      | 唯一 Session lifecycle command owner                                               |
| `packages/core/test/session-lifecycle-gate.test.ts`           | A0 flag 门禁 + `kind` 信号                                                         |
| `packages/core/test/session-lifecycle-replay.test.ts`         | 重放等价 + 孤儿 + ID 复用                                                          |
| `packages/core/test/session-lifecycle-boundary.test.ts`       | §4.3 结构门禁（禁止直写三张表）                                                    |
| `packages/core/test/session-recovery.test.ts`                 | sweep + 副作用分级                                                                 |
| `packages/core/test/composition-identity.test.ts`             | 五个 owner 的 identity probe                                                       |
| `packages/aigcfroge/test/server/composition-identity.test.ts` | 三面 + 两 listener                                                                 |

### 7.2 修改（**全部落在本计划的所有权范围内**）

`packages/core/src/`：`session.ts`（移除三方法）· `session/event.ts`（+3 durable 定义，同步 `DurableDefinitions`）· `session/projector.ts`（+3 投影）· `session/sql.ts`（`parent_id` 约束，按 ADR-22）· `flag/flag.ts`（+1 getter）· `session/execution.ts`（删 seam）· `session/execution/local.ts`（删 seam 读点）· `session/scheduled-job.ts` 邻域（Session sweep）· `plugin/provider/aigcfroge.ts`（import 方向）
`packages/schema/src/`：Session 恢复状态取值
`packages/aigcfroge/src/`：`server/routes/instance/httpapi/handlers/session.ts`（三处改调 owner）· `handlers/experimental.ts`（能力端点诚实化）· `effect/app-runtime.ts`（如需）
`packages/desktop/src/main/`：`server.ts` · `index.ts` · `ipc.ts` · `../preload/{index.ts,types.ts}`
`packages/sdk/js/src/v2/gen/**`：**生成物，只能由生成器产出**
文档：`ARCHITECTURE.md` §4.1/§7 · `specs/v2/todo.md` · `docs/architecture/system-blueprint.md` · `docs/plan/meta-agent-v2-production-closure.md` · `docs/technical-debt.md` §4 表**首**插入

---

## 8. 风险与缓解

| 风险                                  | 表现                     | 缓解                                                                                                              |
| ------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| ADR-22 迟迟不决                       | A1 卡住，A0 的门一直开着 | A0 与 A1 拆成两个 PR，A0 先合；门关上后即使 A1 延后也不再产生坏数据                                               |
| 方案 T 导致事件表无界增长             | 长期磁盘占用             | §10-1 显式登记债；参考 grant 的 `prune` 形状另立保留策略专项                                                      |
| 移除 `SessionV2` 三方法破坏未知调用面 | 编译错误在别的包         | 先用 codegraph `impact` 量影响面，再动；`shouldUseV2Runtime` 的 14 个调用点全在 `handlers/session.ts`，面是收敛的 |
| 恢复语义被误宣传                      | 文案出现「自动恢复」     | §0.3 措辞禁令 + PR 模板自检项                                                                                     |
| identity probe 结论推翻装配假设       | A3-3 范围膨胀            | A3 只允许「修必须共享的」+「钉死必须分离的」；重构留给 ADR-24 之后的专项                                          |
| 与并行 UX 分支冲突                    | 合并冲突                 | §2.5 三条自检；越界即打回                                                                                         |
| 桌面改动无单测兜底                    | 回归无拦截               | 故障注入场景手工记录 + `desktop typecheck`；并行计划的 e2e 覆盖 UI 侧                                             |

---

## 9. 验收标准与发布门禁映射

| 门禁（路线图 §10） | 本计划的验收证据                                                                             | 是否本计划关闭                                            |
| ------------------ | -------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 数据一致性         | `create → rename → message delete → session delete → ID reuse → replay` 单测全绿；孤儿计数 0 | ✅ 关闭                                                   |
| 崩溃恢复           | 场景 1/3/4/6 有记录；未知副作用不自动重放；出现可解释 `recovery_required`                    | ⚠️ 只关闭「最小诚实恢复」，durable attempt/fencing 仍开放 |
| Composition        | 五个 owner 的 identity probe 全绿；Location 服务不跨域泄漏                                   | ✅ 关闭「有证据」，不关闭「唯一 root」                    |
| API 迁移           | 不在本计划（Slice 4）                                                                        | ❌                                                        |
| 安全               | 不在本计划（Slice 6）                                                                        | ❌                                                        |
| 性能               | 不在本计划                                                                                   | ❌                                                        |
| 工程               | 受影响包 typecheck/test/lint 全绿；无无关 diff                                               | ✅                                                        |

**本计划完成后仍然阻断的事项**：`AIGCFROGE_V2_RUNTIME` 默认翻转（缺 Slice 4 逐端点矩阵）、企业/合规发行（缺 Slice 6）、"crash-safe / 自动恢复 / encrypted-at-rest" 任何表述。

---

## 10. 技术债声明（按 CLAUDE.md 方案对冲要求显式申报）

1. **事件保留策略缺失**（方案 T 引入）：session 删除后事件流不再被回收，`event` / `event_sequence` 单调增长。触发条件：磁盘或重放耗时成为问题时。
2. **`plugin` 包的两条反向 SDK 依赖未修**（`plugin/src/v2/{effect,promise}/integration.ts` 仍从 `@aigcfroge/sdk/v2/types` 取 `CredentialValue`）。本计划只修 core 那条，避免把 plugin 的公开类型契约拖进本批 diff。
3. **恢复只到「人工确认」**：无 durable provider-turn attempt、无 lease/owner epoch/fencing、无 settlement CAS。未知副作用一律不自动重试。
4. **desktop 无自动 restart**：sidecar 死后提供 `server-dead` + 安全重启入口，不做自动重建（子进程 `start`/`stop` 都以 `process.exit()` 收尾，同进程不可二次 start）。
5. **`isV2Mode` 死代码未删**（`product-mode-policy.ts:102-104`，生产零调用，仅测试引用）。留待 Slice 4 判定。
6. **`Forked` / `Verify.*` / `Compaction.Started` 仍是「已定义无人发无人投」**；`SyntheticAdmitted` 仍是「有投影但不在 `DurableDefinitions`」。本计划不顺手修，登记待 Slice 4/5。
7. **`packages/app/e2e` 不在 typecheck 项目内且带 29 个存量类型错误** —— 与本计划无关但会影响并行分支的门禁判读，已在 `docs/technical-debt.md` §3.1 登记。

---

## 11. 分支、PR 与合并流程

### 11.1 批次 0（**预分支，必须先落地**）

两个工作区都需要看到「两份路线图 + 两份计划 + 已校准的协议文档」，而 worktree 不携带未跟踪文件。所以先在 `main` 上做一次**文档-only** 提交：

```bash
git add docs/roadmap/v2-architecture-roadmap.md docs/roadmap/v2-ux-ui-roadmap.md \
        docs/plan/v2-architecture-governance-slice-0-3.md docs/plan/v2-ux-trust-foundation.md \
        ARCHITECTURE.md DESIGN.md docs/architecture/system-blueprint.md docs/technical-debt.md
git checkout -b docs-v2-baseline
git commit -m "docs: land V2 roadmaps, two implementation plans, and calibrate stale protocol facts"
```

该提交包含的**事实校准**（均已实测，非引用）：

| 文件                                           | 原状                                                                                                           | 校准为                                                                                                                                                   |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/technical-debt.md` §0/§3                 | M3「合入本地 `main`（未推送），待开 PR」                                                                       | 已合入 `origin/main`（PR #52/#54/#56/#58/#60；`4278b45f7` 已是 `main` 祖先）                                                                             |
| `docs/technical-debt.md` §5 两行               | `workflow-surface`「未提交」、`scoped-grants`「待复审合入」                                                    | 均已合入（后者以 `permission-ask-bounds.test.ts` 存在于 `main` 核实）                                                                                    |
| `DESIGN.md:4`                                  | scope 含 `packages/enterprise/` 与「`packages/web/` 是 Astro 站点」                                            | `packages/web/` **不存在**；`packages/enterprise/` **不是** workspace 包（无 `package.json`，仅 1 个被跟踪的遗留文件，不在任何 `tsconfig`/`turbo` 图内） |
| `ARCHITECTURE.md` §4.10                        | 「四值集合仍是当前实现契约」「M0 Phase B 落地前不得视 `custom` 为运行时值」                                    | `ProductMode.ID` 已是**五值**联合；ADR-17 M0–M3 已合入；运行时由 `AIGCFROGE_CUSTOM_MODE` **opt-in 默认关**门控                                           |
| `docs/architecture/system-blueprint.md` §9/§10 | Custom 列为「未实现规划」；§10 声称 **21 包**并列出 `cli`/`function`/`slack`/`web`/`enterprise` 五个不存在的包 | Custom 移出规划；§10 **删除重复拓扑副本**，改为指向 workspace manifest 与 `ARCHITECTURE.md` §3 单一真源（极致减法：删除而非维护第二份）                  |

> **顺带纠正路线图自身的一处误判**：架构路线图 F7 把包数漂移归给 `ARCHITECTURE.md:68-113`，但实测 `ARCHITECTURE.md` 的「17 包」是**正确**的；真正漂移的是 `system-blueprint.md:139-141` 的「21 包」。已按根因修在后者。

**回退路径**：若不愿在 `main` 上先落文档，则批次 0 的内容归入本计划的 PR，此时**并行 UX 分支必须在本 PR 合并后 rebase**（因为它要读 `handlers/experimental.ts` 诚实化后的能力值）。这会牺牲「任意顺序合并」，请择一。

### 11.2 分支与提交

- 分支名：`v2-lifecycle-owner`（≤3 词、连字符、无 `feat/` 前缀 —— `AGENTS.md` §Branch And Commit）
- 提交信息：`type(scope): summary`，type ∈ `feat|fix|docs|chore|refactor|test`，scope 用 `core`/`aigcfroge`/`desktop`/`schema`/`sdk`
- 建议一批次一提交（A0/A1/A2/A3 各一），便于 review 与回退
- `.husky/pre-push` 会跑 `bun typecheck`（全仓）；快速迭代可 `AIGCFROGE_SKIP_TYPECHECK=1`，但**最后一次 push 前必须让它真跑一次**

### 11.3 PR

- 用 `.github/pull_request_template.md`。注意模板明写「**若粘贴大段明显 AI 生成的描述，PR 可能被忽略或关闭**」⇒ 「How did you verify」一节必须是**真实命令 + 真实数字**，不是叙述。
- `pr-standards.yml` 校验标题/分支规范；`test.yml` 跑 unit × 2 OS + e2e × 2 OS + exerciser（coverage/auth 硬门禁，effect advisory）；`ci.yml` 跑 Lint → Typecheck → `bun turbo test`。
- 标题建议：`refactor(core): unify session lifecycle behind one command owner`（≤70 字符）
- PR 描述必含：§4.1 采纳的方案（P 还是 T）与 ADR-22 链接、§10 全部技术债、§6.3 噪声说明（避免 reviewer 误判）、`git diff --stat`。

### 11.4 合并顺序

批次 0 落地后，本分支与 `v2-ux-foundation` **可任意顺序合并**。两者都合并后，由两个 PR 的作者共同完成 §2.4 的两条接缝收尾（十行量级，单独一个小 PR）。

---

## 12. 执行提示词（交给实施 agent 时整份粘贴）

```text
你在 /media/win_data/aigcfroge/.worktrees/v2-arch（分支 v2-lifecycle-owner）执行
docs/plan/v2-architecture-governance-slice-0-3.md。

硬约束：
1. 只允许改 packages/{core,schema,aigcfroge,desktop,sdk} 与该计划 §7 列出的文档。
   碰 packages/{app,ui,session-ui,storybook} 任一文件即违约，立即停下。
2. 严格按 §5 的批次顺序；每个「红」步骤必须先跑到失败并把输出记下来，再写实现。
3. 不新建抽象层：lifecycle owner 照 packages/core/src/control-plane/move-session.ts 的形状；
   事件发布照 packages/core/src/grant/event.ts:29-50 的 (events, update, commit) 范式；
   恢复照 packages/core/src/workflow/workflow-run.ts:1167-1295 与
   packages/core/src/session/scheduled-job.ts:203-235；
   identity probe 照 packages/core/test/permission-ask-bounds.test.ts:228-260。
4. 禁止 Effect.sleep(N) 等待并发 fiber；禁止 as any / @ts-ignore；
   新 flag 必须是 Flag 上的 getter 而不是模块级 const。
5. 每次 push 前跑：LINT_BASE_REF=origin/main bun run script/lint-changed.ts
   + 受影响包 typecheck + 受影响包 test；跑门禁时不要并行跑其他重任务（见 §6.3）。
6. ADR-22 未由人类签署前，不得进入 A1 的绿灯步骤——只能写红先行测试。
7. 输出 CLAUDE.md §改完即审 的「复查结论」七项。
```

---

## 13. 关联文档

- 路线图：[v2-architecture-roadmap.md](../roadmap/v2-architecture-roadmap.md) · 并行 UX 路线图 [v2-ux-ui-roadmap.md](../roadmap/v2-ux-ui-roadmap.md)
- 并行计划：[v2-ux-trust-foundation.md](v2-ux-trust-foundation.md)
- 协议：[CLAUDE.md](../../CLAUDE.md) · [AGENTS.md](../../AGENTS.md) · [ARCHITECTURE.md](../../ARCHITECTURE.md) · [CONTEXT.md](../../CONTEXT.md) · [docs/testing.md](../testing.md)
- 既有 ADR：[ADR-17](../architecture/adr/ADR-17-custom-mode-composition-platform.md) · [ADR-18](../architecture/adr/ADR-18-custom-mode-workflow-execution.md)（`recovery_required` 与终态不可变的来源）· [ADR-20](../architecture/adr/ADR-20-scoped-grant-model.md) · [ADR-21](../architecture/adr/ADR-21-mcp-credential-custody.md)
- 债与状态：[docs/technical-debt.md](../technical-debt.md) · [specs/v2/todo.md](../../specs/v2/todo.md)
- 技能：`.aigcfroge/skills/effect/SKILL.md` · `.aigcfroge/skills/database/SKILL.md` · `.aigcfroge/skills/quality-to-pr/references/delivery-gates.md`
