# Chat 模式代码族全量审计报告

> **日期**：2026-08-14
> **范围**：Chat 模式（资产工作室）全代码族 —— 前端组件/context、后端 propose 工具族、导入解析链、资产 HTTP 端点、写事务服务层、orchestrator 提示词与产品模式权限策略
> **基线提交**：`a587d75b5`（main，工作树 clean）
> **审计性质**：全量静态审计 + 实测探针验证，非 diff 差异审查
> **基线意图来源**：`docs/prd/chat-mode-creation-layer.md`（v4.6 Approved）、`docs/architecture/adr/ADR-13-chat-work-mode-boundary.md`（Accepted）
> **关联**：`docs/review/`（diff 级差异审查，与本报告互补）

---

## 1. 执行摘要

本次审计共确认 **33 条缺陷**（P1 × 11、P2 × 18、P3 × 4），收敛为 **7 个根因**。

**关键结论：全部缺陷均为行为缺陷，不是编译期或测试期问题。** 审计前跑通的基线门禁全绿：

| 门禁 | 结果 |
|---|---|
| `bun --cwd packages/core typecheck` | PASS |
| `bun --cwd packages/schema typecheck` | PASS |
| `bun --cwd packages/aigcfroge typecheck` | PASS |
| `bun --cwd packages/app typecheck` | PASS |
| `bun --cwd packages/app test:unit` | 846 pass / 0 fail |

这意味着现有门禁体系对本报告涉及的缺陷类型**结构性失明**。第 8、9 节分析了原因。

**三条最应优先处理的结论：**

1. **PRD 明文规定的写事务不变量在 workflow/plugin 两类资产上全部丢失**（P1-2）。PRD §20.5 批准的技术债只是"不建 typed Effect service 层"，不包括丢掉原子写、目标级锁、备份回滚、realpath containment 和 readback。5 类走 typed service 的资产完全合规，两类内联实现的资产一条不合规。

2. **Chat 模式的 "deny write" 硬边界在权限层未强制**（P1-1、P1-11）。为 chat 设计的 fail-closed `chat-orchestrator` 信封不是默认值；默认 agent `meta` 的权限基线是 `{action:"*", effect:"allow"}`，V1 侧还额外放行 `create_agent` 与 `configure_mcp`。ADR-13 §边界规则 1 名存实亡。

3. **能拦住这批缺陷的规则大部分已存在于协议与 skills 中，但路由系统没有把人指到它们那里**（第 9 节）。全仓路由体系（`protocols` Phase 1 表 + `ARCHITECTURE.md` §1 表）**没有任何一行指向 `docs/prd/`**，这是"PRD 写了、代码没做、复查全绿"这类缺陷的共同上游根因。

**主操作可用性受损的完整链条**（三条缺陷叠加的实际用户体验）：

```
中文资产名 40 字
  → 路径层 100 UTF-8 字节上限拒绝 (P1-5)
  → InvalidCandidateError.reason 实测为空字符串 (P1-4)
  → 前端 catch 只 console.error，无任何 UI 反馈 (P1-3)
  = 用户点 Apply 永远没有反应，且没有任何提示
```

---

## 2. 审计基线与方法

### 2.1 代码族清单

| 层 | 文件 | 规模 |
|---|---|---|
| 前端组件 | `packages/app/src/components/chat/*`（17 文件） | 2984 行 |
| 前端 context | `packages/app/src/context/{chat-feature,chat-workspace,mode}.tsx` | 297 行 |
| 前端接线 | `packages/app/src/pages/{mode-workspace,mode-workspace-slots}.tsx` chat 分支 | 局部 |
| 后端工具 | `packages/core/src/tool/propose-*.ts`（9 文件） | 1051 行 |
| 资产类型层 | `packages/core/src/asset-kind.ts`、`asset-migration.ts` | 303 行 |
| 写事务服务 | `packages/core/src/{prompt,skill,mcp,command,agent}-asset-service.ts` | ~2000 行 |
| 路径校验 | `packages/core/src/*-asset/path.ts`（7 文件，逐字节同构） | 651 行 |
| 导入解析 | `packages/core/src/import-parser.ts` + `packages/schema/src/import-parser.ts` | 245 行 |
| V1 工具桥接 | `packages/aigcfroge/src/tool/propose-*.ts`（7 文件） | 436 行 |
| HTTP 端点 | `httpapi/handlers/*-asset.ts` + `groups/*-asset.ts`（14 文件） | 1092 行 |
| 权限与提示词 | `product-mode-agent-policy.ts`、`agent/prompt/chat-orchestrator.ts`、`plugin/agent.ts`、`agent/agent.ts` | 局部 |

### 2.2 方法

采用 `audit-context-building` skill 的逐行/逐块分析纪律（First Principles + 5 Whys），并对每条候选缺陷执行下列验证之一：

- **实测探针**：写一次性测试脚本在真实模块上复现（探针脚本用后即删，工作树保持 clean）
- **跨文件追链**：Read 被调用方源码确认真实签名与行为，禁止猜 API
- **同构家族比对**：对同构文件做归一化 diff，把"某文件有校验、另一文件没有"作为候选缺陷

写不出具体触发路径的观察降级为"代码异味"，不计入 33 条。

### 2.3 覆盖度声明

**已逐行覆盖**：导入解析链、写事务服务层（参照实现 + 4 类比对）、7 个 path.ts、propose 工具族、7×2 HTTP 端点的写事务角度、权限策略与两个运行时的 agent 信封、资产工作台 UI、候选状态机、重复检测、捕获辅助、右栏 tab 同步。

**未覆盖**（如实声明，无审计结论）：`chat-import-dialog.tsx` 的结果预览渲染段（约 270-540 行）、`chat-session-list.tsx` 与 `secondary-sidebar.tsx` 的会话列表过滤分支、`asset-migration.ts` 的迁移幂等性、SDK 生成层。

**未做运行时端到端验证**：未启动 dev server 实际点击。P1-3、P1-5、P2-2 的用户体验描述由代码推导得出，逻辑链完整但未操作复现。

---

## 3. 缺陷总表

| 编号 | 严重度 | 一句话 | 位置 | 状态 |
|---|---|---|---|---|
| P1-1 | P1 | chat 默认 agent 为 fail-open 的 meta，deny-write 边界未强制 | `plugin/agent.ts:228` | 活 |
| P1-2 | P1 | workflow/plugin 写事务丢失 PRD §8.3 全部不变量 | `handlers/workflow-asset.ts:105` | 活 |
| P1-3 | P1 | apply 失败只 console.error，用户零反馈 | `chat-right-panel.tsx:177` | 活 |
| P1-4 | P1 | 所有校验错误信息实测为空字符串 | `prompt-asset/path.ts:18` | 活 |
| P1-5 | P1 | 中文资产名超 33 字被拒（PRD 承诺 80 code points） | `prompt-asset/path.ts:15` | 活 |
| P1-6 | P1 | 导入 few-shot 提示词模板被静默摧毁 | `import-parser.ts:47` | 活 |
| P1-7 | P1 | 100KB–200KB 输入 defect 逃逸成 HTTP 500 | `import-parser.ts:21` | 活 |
| P1-8 | P1 | 噪声正则二次方爆炸，同步阻塞 4.4 秒 | `import-parser.ts:56` | 活 |
| P1-9 | P1 | `yamlEscape` 6 份同源副本，控制字符缺陷 ×6 | `prompt-asset-service.ts:15` 等 6 处 | 活 |
| P1-10 | P1 | 符号链接防护正确实现存在但零调用者 | `fs-util.ts:257` | 活 |
| P1-11 | P1 | V1 meta agent 额外放行 `create_agent`/`configure_mcp` | `agent/agent.ts:227` | 活 |
| P2-1 | P2 | description 含控制字符 → 写盘后 readback 失败并回滚 | `prompt-asset-service.ts:15` | 活 |
| P2-2 | P2 | delete 空 catch 吞异常，且从不传 baseRevision | `mode-workspace-slots.tsx:482` | 活 |
| P2-3 | P2 | 伪造 `sessionID: "ses-home-delete"` | `mode-workspace-slots.tsx:462` | 活 |
| P2-4 | P2 | 无效资产（parse_error）在 UI 中无删除入口 | `asset-workbench.tsx:338` | 活 |
| P2-5 | P2 | system origin 保护后端不存在（PRD 称双重拒绝） | 7 handler + 5 service | 活 |
| P2-6 | P2 | 候选状态用模型可见文案子串匹配兜底 | `prompt-asset-candidate.ts:181` | 活（兜底路径） |
| P2-7 | P2 | 多块导入全部同名，同类型后者覆盖前者 | `import-parser.ts:121` | 活 |
| P2-8 | P2 | 名字截断切裂代理对 / 中文标题导入必失败 | `import-parser.ts:123` | 活 |
| P2-9 | P2 | shell 脚本导入必然失败（首行含 `/`） | `import-parser.ts:131` | 活 |
| P2-10 | P2 | plugin 类型永远识别不出（检测字段不存在） | `import-parser.ts:87` | 活 |
| P2-11 | P2 | 带属性/连字符的 fence 让解析整体降级 | `import-parser.ts:23` | 活 |
| P2-12 | P2 | 代码块内注释被静默剥离且无 warning | `import-parser.ts:48` | 活 |
| P2-13 | P2 | 一个文件读不出，整个文件夹内容全丢 | `chat-import-dialog.tsx:204` | 活 |
| P2-14 | P2 | SDK 未就绪时"解析"按钮静默变成另一个功能 | `chat-import-dialog.tsx:230` | 活 |
| P2-15 | P2 | 两个提示注入边界包装器防护等级不一致 | `chat-import-dialog.tsx:104` | 活 / 潜伏 |
| P2-16 | P2 | 捕获内容默认含思考过程，违反 PRD §8.2 | `capture-helpers.ts:25` | **潜伏** |
| P2-17 | P2 | 单 token 提示词（continue/继续）误判为重复 | `repeat-detection.ts:70` | 活 |
| P2-18 | P2 | CJK 单边导致相似度从 1.0 断崖到 0.0 | `repeat-detection.ts:33` | 活 |
| P3-1 | P3 | Windows 保留设备名未拒绝（CON.md/NUL.md） | `prompt-asset/path.ts:27` | 活 |
| P3-2 | P3 | propose_workflow YAML 上限 5MB 且单位标错 | `propose-workflow-asset.ts:114` | 活 |
| P3-3 | P3 | 假名/韩文走错分词分支，重复检测失效 | `repeat-detection.ts:11` | 活（冻结 locale） |
| P3-4 | P3 | 资产树递归搜索无深度/数量上限且串行请求 | `chat-right-panel.tsx:106` | 活 |

> **"潜伏"** = 代码已存在缺陷但当前无生产消费者，会在对应功能上线时激活。

---

## 4. P1 缺陷详情

### P1-1 chat 模式默认 agent 为 fail-open 信封，deny-write 硬边界未强制

**位置**：`packages/core/src/product-mode-agent-policy.ts:49-53`、`:81`；`packages/core/src/plugin/agent.ts:228-229`、`:470-483`

ADR-13 与 Chat PRD 的核心边界是"Chat 只创建资产、不执行任务"，代码为此构建了 `chat-orchestrator` 的 fail-closed 信封（`plugin/agent.ts:330-339`）：先 `{action:"*", resource:"*", effect:"deny"}` 全禁，再逐项放开 read/glob/grep/question/propose_*。

但 2026-08-11 决策把 chat 的**默认** agent 改成了 `meta`：`resolvePrimaryAgent` 对 chat 返回 `META`，`checkPrimaryAgent` 允许 meta。而 `meta` 的信封方向相反 —— `defaults` 首条即 `{action:"*", resource:"*", effect:"allow"}`，在此基础上仅 deny 三个 action：`bash`、`edit`、`write`，同时**显式 allow `task`**。

**三层后果：**

1. 凡是 assert 的 action 名不在这三个里的工具，chat 模式默认全部放行。实测确认 `webfetch`（`tool/webfetch.ts:136` assert 自身名字）与 `taskspawn`（`tool/taskspawn.ts:55`）均不在 deny 列表 —— 一个"只创建资产"的模式默认具备网络外发能力。
2. `task` 被显式放行，代码注释自认这是间接写通道："task 工具保持 allow，是间接写、属子代理权限域 — P1 边界"。chat 会话可委派子代理写任意文件，绕过 propose → 用户确认。
3. **结构性风险**：fail-open 意味着未来新增任何写能力工具，默认对 chat 放行，除非有人记得去 meta 的 deny 列表补一行。

**已排除的误判**：`apply_patch`（`tool/apply-patch.ts:104`）与 `write`（`tool/write.ts:78`）都复用 `action: "edit"`，被 deny 覆盖。这个设计是对的，不构成绕过。

**违反**：ADR-13 §边界规则 1；`CLAUDE.md:20`「以破坏架构为耻，以遵循规范为荣」

### P1-11 V1 运行时 meta agent 额外放行 `create_agent` 与 `configure_mcp`

**位置**：`packages/aigcfroge/src/agent/agent.ts:227-243`

```ts
meta: {
  permission: Permission.merge(
    buildDefaults,
    Permission.fromConfig({ task: "allow", create_agent: "allow", configure_mcp: "allow" }),
    user,
  ),
```

比 V2 侧更宽，三点：

- 基线是 **`buildDefaults`** —— Coding 模式 `build` agent 的权限基线。chat 默认 agent 直接继承编码 agent 的起点。
- **`create_agent: "allow"`** —— 创建 agent 定义即写 `.agent.md` 文件，等于直接落盘造资产，**完全绕过 propose → 用户确认**这条 PRD §8.2 规定的唯一供给路径。
- **`configure_mcp: "allow"`** —— 可注册外部 MCP 工具服务器，等于可以给自己增加新工具。

比 P1-1 更直接：不需要委派子代理，chat 默认 agent 自己就能写文件。

### P1-2 workflow/plugin 资产写事务丢失 PRD §8.3 全部不变量

**位置**：`packages/aigcfroge/src/server/routes/instance/httpapi/handlers/workflow-asset.ts:85-150`；`plugin-asset.ts:118/160`（两文件结构同构，归一化 diff 后仅字段名差异）

PRD §8.3 把五条不变量写成验收标准，§8.3.1 强调"路径双重 containment、目标级事务锁、原子写 + 回滚、registry reload + readback、错误脱敏**全部不变**"。PRD §20.5 批准的债只是"不建 typed Effect service 层"。

| 不变量 | 5 类 typed service | workflow / plugin |
|---|---|---|
| 临时文件 + 原子替换 | ✓ `prompt-asset-service.ts:261` → `FileMutation.writeAtomic` | ✗ 裸 `fs.writeFile` (`:105`) |
| 目标级锁 | ✓ `:232` `locks.withLock` + `Effect.uninterruptible` | ✗ 无 |
| 覆盖前备份 + 失败回滚 | ✓ `:272-299` | ✗ 无 |
| realpath 双重 containment | ✓ `location-mutation.ts:83/90/126` | ✗ 仅 `path.resolve` (`:85`) |
| readback 校验 revision | ✓ `:311` | ✗ 只查存在性 (`:113`) |
| CAS 强制 | ✓ `:241-250` | ✗ 可跳过（见下） |
| delete 同构事务 | ✓ `:323-433` 备份/回滚/确认消失 | ✗ 只有 `fs.rm` (`:147`) |

**三条可给出触发路径的：**

1. **符号链接可写出项目根**。参照实现经 `resolveSafeTarget` → `LocationMutation.resolve`，其 `:90` 对目标做 `fs.realPath`、`:126` 检查 `contains(locationRoot, canonical)`，符号链接逃逸返回 `location_escape`。内联实现无此层。触发：仓库含 `.aigcfroge/workflows/deploy.yaml → ~/.ssh/authorized_keys` 符号链接（如克隆了恶意仓库），apply 名为 `deploy` 的 workflow → `fs.writeFile` 跟随符号链接写到项目外。
2. **CAS 可被跳过导致静默覆盖**。`:92` 是 `if (fileExists && ctx.payload.baseRevision)`，而 `baseRevision` 是可选字段。前端 `asset-insert.ts:48` 传 `input.candidate.revision ?? undefined` —— propose 阶段拿不到 revision 时（`propose-workflow-asset.ts:84-87` 的 readFile 失败被两层 catch 吞成 undefined）配合 `overwrite: true` 即**无条件覆盖**。同场景下 prompt/skill/mcp/command/agent 会正确抛 StaleRevision。`:96` 的 `if (currentBytes)` 是第二个跳过点。
3. **reload 失败静默后返回陈旧数据当成功**。`:109` 是 `registry.reload().pipe(Effect.catch(() => Effect.void))`。reload 失败后 `:113` 的 `getByPath` 命中旧缓存条目，handler 把旧版本 Info 当 apply 成功返回。前端拿到的 revision 与磁盘不符，此后每次 apply 都 CAS 失败，直到刷新页面。

**违反**：PRD §8.3 全部五条 + §8.3.1；`CLAUDE.md:88` Catch Everything、`:90` Security First、`:99` Reusability、`:61` 极致减法；`effect/SKILL.md:25`、`enterprise-code-standard/SKILL.md:57`

### P1-10 符号链接防护的正确实现已存在，但零调用者

**位置**：`packages/core/src/fs-util.ts:257`

```ts
export function resolveSecurePath(worktree: string, target: string): string {
  const absolute = pathResolve(worktree, target)
  if (!contains(worktree, absolute)) throw new Error(`Path ${absolute} escapes the workspace boundary`)
  const real = realpathSync(absolute)
  if (!contains(worktree, real)) throw new Error(`Symlink at ${absolute} resolves outside the workspace boundary: ${real}`)
  return real
}
```

实现正确。文档注释写着「Use this in all file-access tools (Read, Write, Bash, glob, search) to prevent symlink-based path traversal attacks.」

**全仓 grep：除定义行外零命中，是死代码。** 同时 `ARCHITECTURE.md:273` 把 `symlink-aware path containment` 列在 "Phase 6 complete"。

现状是同一防护有两份实现（`LocationMutation.resolve` 在用、`FSUtil.resolveSecurePath` 零调用），workflow/plugin 两者都没用，而架构文档拿后者当已完成的证据。这是 P1-2 的根因补充 —— 不是"没想到要做"，是**做了三遍、用错了地方**。

### P1-3 apply 失败对用户完全静默

**位置**：`packages/app/src/components/chat/chat-right-panel.tsx:177-180`、`:200-203`

```ts
} catch (err) {
  console.error("Apply failed:", err)
  setApplying(false)
}
```

只打 console，无 toast、无内联错误、无状态变化。所有服务端拒绝（name_conflict / stale_revision / overwrite_required / readback_mismatch / invalid_candidate）都退化为静默 no-op。这是 Chat 模式的主操作。

**违反**：`CLAUDE.md:88`「禁止未处理 Promise 和静默失败」、`:98`「吞异常」；`DESIGN.md:76`「Empty/error states may explain what happened and what action is available.」；`quality-to-pr/SKILL.md:101`「swallowed failures」

### P1-4 所有校验错误信息实测为空字符串

**位置**：`packages/core/src/prompt-asset-service.ts:20-22`（`failureMessage`）；`packages/core/src/prompt-asset/path.ts:18-21`（`PathValidationError`）

`failureMessage` 用 `error.message` 取信息，但 `PathValidationError` 是该错误族中**唯一没有 `override get message()`** 的类（同文件其他 8 个错误类都写了），类体为 `{ reason, path }`。

**实测**：`failureMessage(PathValidationError)` 返回 `""`，真正的诊断信息在 `reason` 字段里没人读。

后果：`prompt-asset-service.ts:169` 产出 `"Invalid name or path: "`；`:173`/`:228`/`:335` 三处路径逃逸错误的 reason 是**完整空串**。5 个 typed service × propose/apply/delete 全部命中，7 个 path.ts 同构。typecheck 与 lint 都不报 —— 门禁与工具链双盲。

### P1-5 中文资产名超过 33 字被拒（PRD 承诺 80 code points）

**位置**：`packages/schema/src/asset.ts:8-11`（80 Unicode code points，写得对）vs `packages/core/src/prompt-asset/path.ts:15`（`SEGMENT_MAX_BYTES = 100`，UTF-8 字节）

**实测**：`"工" × 80` = 80 code points（过 schema）= 240 UTF-8 字节（被 `isValidSegment` 拒）。中文名有效上限 = min(80 cp, 100 B) = **33 字**。

PRD §8.1 `:139` 注释只写了 `1..80 Unicode code points`，未写字节口径。对照 `:141` 的 `relativePath` 注释明确写了 `1..240 UTF-8 bytes` 并与 `PATH_MAX_BYTES` 一致 —— 说明 `:139` 是本段唯一漏写字节约束的字段。

叠加 P1-4 + P1-3 = 第 1 节所述"点 Apply 永远没反应"。

### P1-9 `yamlEscape` 有 6 份完全相同的副本

**位置**：`prompt-asset-service.ts:15`、`command-asset-service.ts:14`、`skill-asset-service.ts:14`、`mcp-asset-service.ts:14`、`agent-asset-service.ts:14`、`asset-migration.ts:22`

**实测**：6 份函数体逐字节相同，都只转义 `\ " \r \n \t`。所以 P2-1 的控制字符缺陷是 **×6**，修一处等于没修 —— 5 类资产 + 迁移路径全都会在遇到 C0 控制字符时写盘后 readback 失败并回滚。

**违反**：`CLAUDE.md:99`「扩展现有模块，不新建平行实现」；`reuse-first-refactor/SKILL.md:57`「two owners perform the same domain operation」

### P1-6 导入 few-shot 提示词模板会被静默摧毁

**位置**：`packages/core/src/import-parser.ts:47`（`CONVERSATION_RE`）+ 执行顺序 `:166` → `:169`

> **前置纠正**：PRD §20.5 写着「Core import-parser Effect service — M7 阶段以 Agent 解析代替，Core parser 延后独立一期」，**该声明已过期**。`chat-import-dialog.tsx:237` 实际在调 `props.client.importParser.parse(...)`，端点已注册。所有 import-parser 缺陷都是活的用户可达路径。

`CONVERSATION_RE = /^(User|Assistant|Human|AI):\s.*$/gm` 在 `:166` 对**整个原始输入**执行，而代码块提取在 `:169` 之后 —— 噪声剥离伸进了 fenced code block 内部。

**实测输入**：

````
# Translation Few-Shot
```
You are a translator.
User: Hello
Assistant: 你好
User: Goodbye
Assistant: 再见
```
````

**实测输出**：`template = "You are a translator."` —— 四行示例全被删除，只留一句系统提示。用户仅得到含糊的 `stripped_conversation` 警告。

`User:` / `Assistant:` 轮次标记是提示词模板最主流写法，而"导入提示词模板"正是 Chat 模式第一个验证闭环（PRD §7.3 路径 C）。**本报告认为这是导入链最严重的缺陷。**

### P1-7 100KB–200KB 输入 defect 逃逸成 HTTP 500

**位置**：`packages/core/src/import-parser.ts:21`（`MAX_BYTES = 200 * 1024`）vs `packages/schema/src/import-parser.ts:15`（`Template` ≤ `100_000` UTF-8 字节）

两个尺寸上限互相矛盾。**实测**：

| 输入 | 结果 |
|---|---|
| 90KB | 正常返回 1 个候选 |
| 110KB / 150KB / 199KB | `Die(Error: Template must be at most 100,000 UTF-8 bytes)` |

`Interface.parse` 签名为 `Effect.Effect<SchemaImportParser.Result>` —— **错误通道是 `never`**，故 `:195` 的 `Candidate` 构造抛出后变成 defect 逃逸。而 `handlers/import-parser.ts:10-15` 无任何错误处理 → HTTP 500。

讽刺的是 `Result` schema 本有 `errors` 数组，`reason: "too_large"` 也已存在（`:153`），只是在 100KB–200KB 窗口里永远走不到。

### P1-8 噪声正则二次方爆炸，同步阻塞运行时

**位置**：`packages/core/src/import-parser.ts:55-57`（先 `.test()` 再 `.replace()`，同一输入扫两遍）

**实测阻塞时间**（`<thinking>` 未闭合标签）：

| 输入 | 耗时 |
|---|---|
| 5000 个（49KB） | 284 ms |
| 10000 个（98KB） | 1092 ms |
| 20000 个（200KB） | 4360 ms |

清晰的二次方增长。`parseInput` 是纯同步函数（`:208` 的 `Effect.sync`），故这 4.4 秒是**服务端事件循环硬阻塞**。98KB 那一档在 100KB 安全窗口内，不会被 P1-7 挡掉。对照 `<!--` 只需 1ms —— 问题特定于 `<thinking>`/`<thought>` 这类长字面量前缀。

---

## 5. P2 缺陷详情

### 5.1 写事务与错误处理

**P2-1 description 含 C0 控制字符 → 写盘后 readback 失败并回滚**
`prompt-asset-service.ts:15-18` 的 `yamlEscape` 只转义 `\ " \r \n \t`。`name` 受 `isValidSegment` 的控制字符检查保护，但 **`description` 无任何控制字符校验**（schema 只限 300 code points）。

实测用真实 `ConfigMarkdown.parseOption` 做端到端探针：`\x0b` / `\x07` / `\x1b` / `\x0c` 全部导致解析失败 → registry 标记 `parse_error` → `:305-307` readback 找不到 → 回滚 + `ReadbackMismatchError`。回滚本身正确，问题是错误完全无法诊断。最真实场景是 `\x1b`：粘贴带 ANSI 颜色的终端输出，模型写进 description，apply 必然失败。见 P1-9（此缺陷存在 6 份副本）。

**P2-2 delete 空 catch 吞异常，且从不传 baseRevision**
`mode-workspace-slots.tsx:482-484` 是空 catch：`catch { return }`。所有删除失败（404/409/400/网络错误）被丢弃，对话框正常关闭，`refetchAssets()` 不执行，用户看到资产还在列表里且零解释。

同时 `:461-464` 的 payload 只有 `sessionID` 和 `relativePath`，**未传 `baseRevision`** —— 而 `prompt-asset-service.ts:368` 注释明确写着 `baseRevision === null` 是**强删语义**。`row.revision` 明明在手里却不传。触发：用户打开工作台，另一会话的 agent 更新了该资产，用户点删除 → 新版本被无条件销毁，PRD §8.3.1 要求的 `concurrent_modification` 保护被前端自己放弃。

`asset-delete-dialog.tsx:14-17` 的 `handleDelete` 无 try/catch 也无 pending 态（可重复点击）；当前唯一调用方自己 catch 了，故未产生未处理 rejection。

**P2-3 伪造 sessionID**
`mode-workspace-slots.tsx:462` 硬编码 `sessionID: "ses-home-delete"`。PRD §8.3.1 规定 sessionID 用于审计与归属，伪造值使审计线索失效。同族于 ADR-13 `:36`「不塞入……自由文本 metadata 充当事实真源」。

### 5.2 UI 可达性与授权

**P2-4 无效资产在 UI 中无删除入口**
`asset-workbench.tsx:338` 的 `<Show when={!row.invalid && row.origin !== "system"}>` 同时包住 Insert 与 Delete。结果 `parse_error`/`bad_frontmatter` 的损坏资产挂着红点，**最需要清理的对象没有清理入口**。

PRD §9.4 `:279` 要求「registry 跳过的坏文件必须可见……不允许文件"凭空消失"」—— 文件行仍可见（`:306` 渲染错误态），但等价于"可见但不可处置"。PRD §20.4 `:633` 已勾选的「Delete UI 全部 7 类」对 invalid 行不成立。

**P2-5 system origin 保护后端不存在**
PRD §20.3 `:622` 称「system origin 资产前后端双重拒绝」。实测 7 个 handler + 5 个 service **无任何 origin 校验**；`origin` 是纯前端概念（`asset-workbench.tsx:22`/`:58`），后端 schema 无此字段（`plugin-asset.ts:56` 中唯一含 origin 的字面量是 `originPath`，为 bridged 插件来源路径，非授权字段）。

当前实际防线是 owner root containment 的副作用，不是显式拒绝。绕过 UI 直调 HTTP 可删 system 资产。

**P2-6 候选状态用模型可见文案子串匹配兜底**
`prompt-asset-candidate.ts:181-183`：

```ts
const exists = booleanField(result, "exists") ?? output.includes("exists")
const nameConflict = booleanField(result, "nameConflict") ?? output.includes("Name conflict")
```

V1 与 V2 文案本就不一致：V2 在 `core/tool/propose-prompt-asset.ts:69-74` 输出 `"Name conflicts with..."`，V1 在 `aigcfroge/tool/propose-prompt-asset.ts:46-56` 输出 `"Name conflict: ..."`。当前两套文案恰好都能被子串命中，属运气。

更糟：V1 的 valid 文案是 `` `Candidate "${params.name}" is valid.` `` —— **把资产名嵌进被匹配字符串**。名为 `file-exists-check` 的资产会让 `output.includes("exists")` 为真，被误判"已存在"，带着 `revision: null` 去 apply，服务端 `:242` 直接抛 StaleRevision。

该兜底仅在 `structured`/`metadata` 均缺失时触发（V1/V2 都会填），属防御性死代码 —— 但走到就是错的。与 `CLAUDE.md:138` 已登记的 doom_loop 文案匹配债同构：**协议记住了，实现没学到。**

### 5.3 导入解析链（全部实测复现）

**P2-7 多块导入全部同名，同类型后者覆盖前者**
`import-parser.ts:121` 的 `inferName` 第一分支从**整篇文档**匹配 `^#\s+(.+)$`，而 `:186` 传入的是 `cleaned`（整篇）；`index` 只在最后兜底分支使用。

实测一个 H1 下两个纯文本块：`[{kind:"prompt",name:"Shared Title"},{kind:"prompt",name:"Shared Title"}]`。同 kind + 同 name → 同一 relativePath → apply 第二个覆盖第一个。UI 无改名入口（名字由解析器决定）。

**P2-8 名字截断切裂代理对 / 中文标题导入必然失败**
`:123` 的 `.slice(0, 80)` 按 UTF-16 code unit 截断。实测两个后果：

- 第 80 位落在 emoji 中间 → 名字以**孤立高位代理**结尾（实测 `lastCharCode=0xd83d`）。`isValidSegment` 不拦孤立代理，`TextEncoder` 替换为 U+FFFD，文件名与 frontmatter 里的 name 变成乱码。
- 80 个中文字 = 240 UTF-8 字节 → 被路径层 100 字节上限拒绝（实测 `REJECTED`）。叠加 P1-4 + P1-3，中文标题导入点 Apply 永远无反应。

**P2-9 shell 脚本导入必然失败**
实测 ```` ```bash ```` + `#!/bin/bash`：kind 正确推断为 `command`，但 `:131` 取首行做名字 → `name = "#!/bin/bash"` → 含 `/` → `isValidSegment` 拒绝。配合空错误信息，用户看不到原因。

**P2-10 plugin 类型永远识别不出**
`:87` 要求同时出现 `name:` + `tools:` + `hooks:` 才判定 plugin。但 `schema/plugin-asset.ts:49-58` 的 `PluginAsset.Frontmatter` 字段是 `kind / name / description / version / category? / author? / source? / hooks?` —— **没有 `tools` 字段**。

实测合法 plugin frontmatter（`kind: plugin` + name + description + version + hooks）→ 推断结果 `prompt`。对照 workflow 分支 `:84` 用的是 `kind: workflow` 判别符（正确做法），plugin 分支只是漏了同样写法。

**P2-11 带属性或连字符的 fence 让解析整体降级**
`:23` 的 `(\w*)` 匹配不了 `-` 与空格分隔的属性。实测三种常见写法全部提取失败并落到"整篇当纯文本"兜底，结果**资产正文包含字面 fence 标记**：

| fence | 结果 |
|---|---|
| ```` ```yaml title="deploy" ```` | kind=prompt，template 含 `` ```yaml title="deploy" `` |
| ```` ```objective-c ```` | 同上 |
| ```` ```ts twoslash ```` | 同上 |

**P2-12 代码块内注释被静默剥离且无 warning**
`:48` 的 `COMMENT_RE` 同样在提取前执行，且 `:69` 处理后**不 push 任何 warning**（thinking/conversation 都会 push）。实测导入带 `/* Copyright 2026 ACME ... */` 许可头的 js → `template = "export const x = 1"`，许可头无声消失。

### 5.4 导入对话框

**P2-13 一个文件读不出，整个文件夹内容全丢**
`chat-import-dialog.tsx:204` 用 `Promise.all(files.map(readEntry))` —— 首个 reject 即整体失败；而 `:203-215` 只有 `try/finally`，**无 catch**。选一个含单个不可读文件的文件夹 → 全部 entries 丢失、`skippedFiles` 保持 0、UI 显示空结果、外加未处理 Promise rejection。

设计意图本支持部分跳过（`:211` 的 `skippedFiles: files.length - entries.length`），但 `Promise.all` 让它只对"`readEntry` 返回 undefined"生效，对抛异常永久失效。`:185-194` 单文件路径同病。

**P2-14 SDK 未就绪时"解析"按钮静默变成另一个功能**
`:230-233`：`if (!props.client) { handleImport(); return }`。用户点"解析"，实际执行 AI 辅助导入（塞 chat draft）。`props.client` 来自 `mode-workspace-slots.tsx:436` 的 `assets?.chatDirSdk()?.client` —— 可选链，SDK 未就绪即 undefined。这是竞态：早开对话框就换语义，无任何提示。

`:247` 的 `catch {}` 丢弃错误对象，统一显示 `chatImport.parseFailed`，故 P1-7 的 500 在用户眼里只是"解析失败"。

### 5.5 提示注入边界

**P2-15 两个信任边界包装器防护等级不一致**
`chat-import-dialog.tsx:104-107` 的 `wrapImportContent` 只转义**精确字面量** `</untrusted_import>`，且把可信指令放在不可信内容**之后**。`</untrusted_import >`（`>` 前带空格）不被正则匹配，但模型通常当作闭合标签。

`capture-helpers.ts:37` 的 `wrapCaptureContent` **什么都不转义** —— content 含 `</captured_content>` 即可提前关闭边界。

两个同性质边界防护水平不一致，是"同构家族分叉"根因的又一处表现。配合 P1-1/P1-11，成功注入后有路径摸到具备写能力的 agent。**定为 P2 而非 P1：这是纵深防御层的加固缺口，未构造出端到端可用利用链。**

**P2-16 捕获内容默认含思考过程，违反 PRD §8.2（潜伏）**
PRD §8.2 原文：「思考过程内容默认不写入资产正文；用户明确要求保留时在预览中显式标注。」

`capture-helpers.ts:25` 是 `if (p.type === "reasoning") return true` —— 无条件包含，无开关、无默认关闭、无标注。`:17` 的文档注释甚至把 "Includes reasoning parts" 写成预期行为。

**限定**：grep 确认 `capture-helpers.ts` 目前**无任何生产消费者**（仅自身测试引用），与 PRD §20.5「会话捕获延后独立一期」一致。P2-15 的 capture 部分与 P2-16 都是潜伏缺陷，将在捕获功能上线时激活。

### 5.6 重复检测（已接线于 `session.tsx:612`、`:1932`）

实测数据：

| 场景 | 相似度 | 判断 |
|---|---|---|
| `"continue"` vs `"continue"` | 1.000 | 3 条历史即触发重复提示（误判） |
| `"继续"` vs `"继续"` | 1.000 | 同上 |
| `"fix the login bug"` vs `"fix the login bug（紧急）"` | **0.000** | 加一个中文字符，相似度从 1 掉到 0 |
| 日文纯假名两句 | 0.000 | 整句变成单 token |
| 韩文两句 | 0.000 | 走词分支 |

**P2-17 单 token 提示词误判为重复**
`repeat-detection.ts:70-86` 无最短长度/token 数下限。用户连说三次 "continue"/"继续"/"ok"（正常聊天行为）后第四次即弹重复提示。阈值 0.7 与 `MIN_SIMILAR_COUNT = 3` 对单 token 输入无意义，因自相似恒为 1.0。

**P2-18 CJK 单边导致相似度断崖**
`:33` 的 `hasCJK` 一旦为真即整段切 bigram，为假则按空格切词。**两个分支的 token 空间不可能相交**，故只有一边含 CJK 时相似度恒为 0。对中英混用用户（zh 为主力 locale），混排提示词永远检测不到重复。

**已排除的误判**：我一度怀疑 `countSimilarPrompts` 会自比较导致计数虚高 —— 这是错的。`session.tsx:615` 用 `userPrompts.slice(0, -1)` 正确排除了当前条目。

---

## 6. P3 缺陷

**P3-1 Windows 保留设备名未拒绝**
实测 `isValidSegment("CON.md")`、`NUL.md`、`COM1.md`、`LPT1.md`、`PRN.md`、`AUX.md` 全部返回 true。仓库有 Windows CI，在 Windows 上写这些名字会命中设备而非文件。位置 `prompt-asset/path.ts:27-36`（7 文件同构）。

**P3-2 propose_workflow YAML 上限 5MB 且单位标错**
`propose-workflow-asset.ts:114-117` 用 `content.length`（UTF-16 code unit）与 `5_000_000` 比较，错误信息却写 "bytes"；中文内容实际可达 15MB。对比 prompt 的 Template 上限 100KB，差 50 倍。5MB 的 `yaml.load` 也是 YAML 炸弹入口（js-yaml 4 无 RCE，但锚点展开可打爆内存）。

**P3-3 假名/韩文走错分词分支**
`repeat-detection.ts:11` 的 `CJK_RE` 覆盖 U+4E00–9FFF / U+3400–4DBF / U+F900–FAFF，**不含平假名片假名（U+3040–30FF）与韩文（U+AC00–D7AF）**。日文纯假名句子整句变成一个 token，重复检测对日语失效。降为 P3 的理由：按语言策略决定，ja/ko 已冻结维护，只保 en/zh/zht。

**P3-4 资产树递归搜索无上限且串行请求**
`chat-right-panel.tsx:106-116` 的 `walk(".aigcfroge")` 无深度/数量/结果上限，且 `await walk(child.path)` 在 for 循环里**串行** —— 每个目录一次 HTTP 往返。目录深了即几百个串行请求。`:118-120` 的 `catch { setSearchAllowed([]) }` 还把失败显示成"无结果"。

**已核查确认无缺陷**：`chat-right-panel.tsx:57-69` 的 tab 同步。memo→effect 回写虽读写同一信号，但 `:67` 的 `current.active() === active` 守卫使其两轮内收敛；`:58` 与 `:64` 的双重 mode 门控在 render-all + `display:none` 布局下正确隔离非 chat 模式。git log 的 "isolate mode-panel tab synchronizers" 修得是对的。

---

## 7. 根因收敛

按 `CLAUDE.md` 收敛三步法（归类 → 找交集 → 一击必杀），33 条缺陷收敛为 7 个根因。收敛的标志是"修一个点，好一片面"。

### 根因 A：同构家族分叉

**共同前提**：同一领域操作存在多份平行实现，其中一份缺失另一份的保护。

| 缺陷 | 表现 |
|---|---|
| P1-2 | 5 类走 typed service、2 类走 handler 内联 |
| P1-9 | `yamlEscape` 6 份同源副本 |
| P1-10 | realpath containment 三份实现（一份在用、一份零调用、两类都不用） |
| P2-5 | 7 个 handler 无一实现 origin 校验 |
| P2-6 | V1/V2 propose 工具文案不一致 |
| P2-15 | 两个注入边界包装器防护等级不一致 |

**一击必杀**：workflow/plugin 接入既有 owner（`FileMutation.writeAtomic` + `KeyedMutex` + `resolveSafeTarget`），`yamlEscape` 6 合 1。

### 根因 B：错误在边界处消失

**共同前提**：错误信息没有一条端到端可达的通路 —— 产生端不写、传递端吞掉、消费端不显示。

| 缺陷 | 环节 |
|---|---|
| P1-4 | 产生端：`PathValidationError` 无 `message` |
| P1-2 | 传递端：`Effect.catch(() => Effect.void)` 吞 reload 失败 |
| P1-3 / P2-2 | 消费端：`console.error` / 空 catch |
| P1-7 | 通道声明：错误通道 `never` 却 throw，defect 逃逸 |
| P2-12 / P2-13 / P2-14 / P3-4 | 静默剥离 / 静默丢弃 / 静默换语义 / 失败显示为空结果 |

**一击必杀**：补 `message` + 前端三处 catch 改为显示错误 + reload 失败不再吞。

### 根因 C：长度与字符单位跨层不一致

**共同前提**：code points / UTF-8 bytes / UTF-16 length 三种单位在不同层混用。

P1-5（80 cp vs 100 B）、P1-7（200×1024 B vs 100_000 B）、P2-8（UTF-16 截断切代理对）、P3-2（`.length` 当 bytes 用）。

**一击必杀**：约束单一常量源 + 双向边界测试。

### 根因 D：权限模型两套并存

P1-1、P1-11。fail-closed 的 `chat-orchestrator` 与 fail-open 的 `meta` 同为 chat 模式合法主 agent，安全语义取决于走哪条路。

### 根因 E：用自然语言文案当协议

P2-6。与 `CLAUDE.md:138` 已登记的 doom_loop 文案匹配债同构。

### 根因 F：噪声剥离与结构提取顺序颠倒

P1-6、P2-12。共同前提：`stripNoise`（`:166`）在 `extractBlocks`（`:169`）之前跑，正则伸进代码块内部。**交换两步顺序，两条一起消失。**

### 根因 G：协议规则存在但路由不到

P1-2、P2-4、P2-5 三条"PRD 写了、代码没做、复查全绿"的共同上游。详见第 9 节。

---

## 8. 协议合规映射

明文覆盖率约 **6/10**：缺陷 P1-1、P1-2、P1-3、P2-1（部分）、P2-4、P2-6（部分）在协议中有明文条目被违反；4 类属协议自身盲区。

### 8.1 明文写了但被违反

| 门禁原文（逐字） | 出处 | 命中 |
|---|---|---|
| 「所有 Effect 边界必须兜底……禁止未处理 Promise 和静默失败」 | `CLAUDE.md:88` | P1-2、P1-3、P2-13 |
| 「新代码禁止……绕过 mapper/registry、假测试、吞异常」 | `CLAUDE.md:98` | P1-3、P2-2 |
| 「新增 helper、组件、route、schema、adapter 前先查 owner module。扩展现有模块，不新建平行实现」 | `CLAUDE.md:99` | P1-2、P1-9、P1-10 |
| 「路径/命令/URL 先校验再使用。防止路径穿越、命令注入、XSS」 | `CLAUDE.md:90` | P1-2 |
| 「修复优先级：复用 → 删除 → 归并 → 重构 → 新增。复用归一化是基础，新增即负债」 | `CLAUDE.md:61` | P1-2、P1-9 |
| 「确认条件分支两端都有实际执行路径」 | `CLAUDE.md:111` | P1-2（CAS false 分支）、P2-4 |
| 「以破坏架构为耻，以遵循规范为荣」 | `CLAUDE.md:20` | P1-1 |
| 「Keep HTTP handlers thin……Put business rules in services.」 | `effect/SKILL.md:25` | P1-2 |
| 「Optimize for repeated use, scanning, comparison, and fast recovery from errors.」 | `DESIGN.md:15` | P1-3、P2-4 |
| 「Empty/error states may explain what happened and what action is available.」 | `DESIGN.md:76` | P1-3、P1-4 |
| 「New shared components should include expected states: default, hover, focus, disabled, loading, empty, and error when applicable.」 | `DESIGN.md:61` | P1-3、P2-4 |
| 「Remove comments that contradict the current implementation.」 | `reuse-first-refactor/references/detection-rules.md:45` | P1-1（`policy.ts:6` vs `:43-48` 同文件自相矛盾） |
| 「Chat 创建，Work/Coding 执行：Chat 不承担通用任务执行」 | `ADR-13:25` | P1-1、P1-11 |
| 「Mode 专属领域数据由 owner module 管理，不塞入……自由文本 metadata 充当事实真源」 | `ADR-13:36` | P2-3 |
| doom_loop 文案匹配债条目 | `CLAUDE.md:138` | P2-6（同构反模式复发） |

### 8.2 协议自身盲区（需新增门禁）

| 缺陷 | 缺失的门禁 | 为什么现有条目接不住 |
|---|---|---|
| P1-4 | **错误可诊断性**：`TaggedErrorClass` 必须实现 `override get message()`，或读方不得假定 `.message` 非空 | `AGENTS.md:188` 只到类型层（「Errors: `Schema.TaggedErrorClass`」）；`path.ts:18-21` 类体为空，typecheck 与 lint 双盲 |
| P1-5 / P1-7 / P2-8 | **跨层字段约束一致性**：同一字段在 schema / 路径层 / UI 的单位与上限必须同口径 | 无任何条目提"约束一致性"。`CLAUDE.md:75` 的 Schema 行只规定 `Schema.Class`/`brand`/`TaggedErrorClass` 选型 |
| P2-1 | **序列化方向的注入防护**：写盘/写 frontmatter 前必须校验控制字符与转义完整性 | `CLAUDE.md:90` Security First 只枚举 路径/命令/URL/XSS，全是"读入"方向 |
| P2-2 | **乐观锁 token 端到端**：服务端支持 CAS 时客户端必须传 revision；服务端不得把"未传"降级为强执行 | 无条目。`CLAUDE.md:89` No Null Pointer 只要求判空，而"可选参数缺省即放弃保护"恰好通过了判空 |
| P2-5 | **授权必须服务端可判定**：前端派生概念（origin/角色/可见性）不得充当安全边界 | 无条目。`CLAUDE.md:90` 不覆盖授权面 |
| P2-6 | **禁止用面向模型/用户的自然语言文案做控制流判定** | 只在技术债表作为个案登记，未提升为门禁 |
| P1-1 / P1-11 | **默认值必须 fail-closed**：新增/切换默认 Agent 或默认权限信封时，默认值必须是收窄的一侧 | ADR 只声明产品边界，不声明强制机制 |
| P1-2 / P2-4 / P2-5 共同上游 | **PRD/ADR 不变量的逐条核对步骤** | `CLAUDE.md:105-113` 改完即审 7 步中，第 2 步只路由 3 个专题 skill、第 5 步只追调用链，**没有一步是"对照已批准 PRD/ADR 的不变量清单逐条打勾"** |

---

## 9. Skills 调研

`.aigcfroge/skills/` 下 7 个 skill 共 1019 行。**核心结论：规则够用，路由不通。**

### 9.1 七个 skill 概览

| skill | 行数 | 覆盖范围 | 本次命中缺陷数 |
|---|---|---|---|
| `protocols` | 186 | 元数据导航，三层拓扑 + 双向索引 + 4 层按需加载 | 间接（路由本身失效） |
| `enterprise-code-standard` | 82 | 生产代码实现基线，以 Coding mode `build` 为兼容源 | 4 |
| `reuse-first-refactor` | 107 | 重复/死代码/冗余/复杂度/注释 5 类发现 | 6 |
| `quality-to-pr` | 142 | 需求→实现→测试→差异审查→提交→PR 全流水线 | 8（最多） |
| `effect` | 38 | Effect v4 用法 + 测试模式（最短） | 1 |
| `database` | 245 | Drizzle/SQLite schema、迁移 | 0 |
| `frontend-theming` | 219 | v1/v2 token 双系统、Oklch 引擎 | 0 |

`database` 与 `frontend-theming` 零命中是合理的：PRD `:69` 明确「不新增数据库 migration」，资产真源为 registry + 文件系统；缺陷 P1-3/P2-4 是错误反馈与入口可达性，归 `DESIGN.md`，不涉及 token/配色。

### 9.2 命中缺陷最多的规则（逐字原文，已抽查核对）

| 规则原文 | 位置 | 命中 |
|---|---|---|
| 「Check logs and tests for secrets, full prompts, user file content, unstable sleeps, broad mocks, unchecked casts, and **swallowed failures**.」 | `quality-to-pr/SKILL.md:101` | 7 个 skill 中唯一直接点名"吞失败" |
| 「For security-sensitive changes, verify path/command/URL validation, **authorization**, XSS boundaries, secret redaction, interruption, and **fail-closed behavior**.」 | `quality-to-pr/SKILL.md:88` | 一句同时命中 P1-2 的 realpath 缺失、P2-5 的 authorization、P1-1 的 fail-closed |
| 「\| Docs/skills/protocols \| Link/reference checks, frontmatter validation, no broken paths, **no stale claims** \|」 | `quality-to-pr/references/delivery-gates.md:33` | 全部文档漂移（第 10 节） |
| 「an accepted ADR or package protocol is contradicted;」 | `quality-to-pr/references/delivery-gates.md:53` | P1-1（Stop Condition，应阻断交付） |
| 「\| HTTP \| **thin handlers, service-owned business rules**, declared `HttpApiBuilder` groups \|」 | `enterprise-code-standard/SKILL.md:57` | P1-2 |
| 「**Reuse before creation.** ……A new helper or abstraction requires evidence that an existing owner cannot serve the need.」 | `enterprise-code-standard/SKILL.md:28` | P1-2、P1-9、P1-10 |
| 「**Make boundaries explicit.** Validate untrusted input at boundaries, use typed errors, preserve interruption and defects……」 | `enterprise-code-standard/SKILL.md:32` | P1-2、P1-7、P2-5 |
| 「Detect duplicate implementation: two owners perform the same domain operation or normalize the same data.」 | `reuse-first-refactor/SKILL.md:57` | P1-2、P1-9 |
| 「Prefer extending the existing owner over creating a parallel module.」 | `reuse-first-refactor/SKILL.md:71` | 同上 |
| 「Do not simplify code that protects ordering, interruption, permissions, **transactionality**……or **security boundaries** without a focused regression test and owner review.」 | `reuse-first-refactor/references/detection-rules.md:38-39` | P1-2 |

### 9.3 skill 覆盖缺口

| 缺陷 | 缺口 | 说明 |
|---|---|---|
| **P1-4** | **完全缺口 0/7** | `enterprise-code-standard:32`「use typed errors」+ `effect:24`「use `Schema.TaggedErrorClass`」都只到"用对类型"，无一处要求错误可被人读懂。没有任何 skill 会让人检查 `TaggedErrorClass` 子类是否实现 `message` |
| **P1-5** | **完全缺口 0/7** | `database` 的字段规范只管列名；`enterprise-code-standard:53` 的 Schema 行只管选型。无任何 skill 提"同一字段在不同层的单位/上限必须同口径" |
| **P2-6** | **近似完全缺口** | 仅 `reuse-first-refactor:60`「manual parsing where a Schema/helper exists」半沾。没有 skill 说"面向模型/用户的自然语言输出不得参与判定" |
| **P2-2** | 半缺口 | `delivery-gates.md:27` 的 "stale" 只要求为 stale 场景**写测试**，不要求客户端**传递** revision |
| **P2-1** | 半缺口 | `quality-to-pr:88` 与 `enterprise-code-standard:32` 都只覆盖读入方向，写盘前的控制字符/转义完整性无规则 |
| **P2-5** | 半缺口 | 能从 authorization 推到，但没有一句写"前端派生字段不得充当授权依据" |
| **P1-1** | 半缺口 | `quality-to-pr:88` 的 fail-closed 是唯一命中点，但在 Phase 4 验证清单里且限定 "security-sensitive changes"；无 skill 在**默认值选择**阶段要求 fail-closed |

**`effect` skill 的具体盲区**（全文 38 行，Guidelines `:21-30`）：**零涉及** `Effect.catch(() => Effect.void)` / `orDie` / `ignore` / catch-all。唯一负面清单是 `:29` 关于 `any`/非空断言/unchecked cast，与吞错无关。而吞错是本次 4 处静默失败的直接载体。也无任何关于 tagged error 必须提供可读 `message` 的要求。

### 9.4 `protocols` 路由失效清单（根因 G）

`protocols` skill 的路由规则（`SKILL.md:11-28`）：正向（任务→文档）查 Phase 1 路由表；反向（文档→文档）查 Phase 2 矩阵；4 层按需加载 L0 `CLAUDE.md` → L1 `AGENTS.md` 章节 → L2 包级 AGENTS/skills → L3 specs/ADR；未命中回退 `ARCHITECTURE.md` §1（`:94`）。

**六个失效点**（前三项本报告已独立 grep 验证）：

| # | 失效点 | 证据 |
|---|---|---|
| 1 | **两个路由入口一致地漏掉 4 个流程 skill** | `CLAUDE.md:108`「匹配 Skills：涉及主题/配色走 `frontend-theming`；涉及 Effect 编码走 `effect`；涉及数据库走 `database`」—— 与同文件 `:130` 列出的 7 skill 自相矛盾 |
| 2 | **拓扑与校验脚本停留在 3 skill 时代** | `protocols/SKILL.md:56-57`「技能层 (3) / skills/effect · skills/database · skills/frontend-theming」；`scripts/check-refs.sh:30-32` 也只校验这 3 个 SKILL.md。**脚本全绿不能证明另外 4 个 skill 存在或引用有效** |
| 3 | **全仓路由无任何一行指向 `docs/prd/`** | `ARCHITECTURE.md:9-25` §1 Document Routing 表中 `docs/prd` 出现 **0** 次（表内有 `docs/plan/`、`docs/roadmap/`、`docs/research/`、`docs/architecture/adr/`）。`:94` 的回退目标本身也无 PRD 入口 |
| 4 | **Phase 1 表无"资产/Asset/PRD/契约"行** | 本次任务核心对象（`*-asset-service.ts`、`propose_*_asset`、`*-asset/path.ts`、`asset-workbench.tsx`）在整个 protocols skill 中零出现 |
| 5 | **L2 列永不出现 4 个流程 skill** | Phase 1 表 L2 列只出现 `skills/effect`、`skills/database`、`skills/frontend-theming`；`enterprise-code-standard`/`reuse-first-refactor`/`quality-to-pr` 只出现在 Success Criteria 勾选项（`:185-186`），不在任何路由行 |
| 6 | **`effect` skill 触发词过窄** | `effect/SKILL.md:3` 全文只有「Work with Effect v4 / effect-smol TypeScript code in this repo」，无 handler/HTTP/error/service 等词。"审 HTTP handler 事务实现"的任务难以自动命中它 —— 而它的 `:25` 是击中 P1-2 最精准的一条 |

**结论**：命中缺陷最多的 `quality-to-pr` 与 `enterprise-code-standard` 从未出现在任何路由行；同时已批准 PRD 在全仓路由体系中没有入口，`quality-to-pr:42` 的必读清单列了 "ADRs, specs" 却**唯独没列 PRD**（`end-to-end-pr.md:15` 同）。7 个 skill 中 "PRD" 一词只在 `enterprise-code-standard:21` 与 `reuse-first-refactor:22` 出现，且都在 "When NOT to Use" 段落。

这不是偶发遗漏，是**路由体系没跟上 skill 增量**。

---

## 10. 文档-代码事实偏差

### 10.1 `docs/prd/chat-mode-creation-layer.md`

| 行 | 文档原句 | 代码事实 |
|---|---|---|
| 219 | `### 8.3 写入事务（沿用 M1 不变量）` | 标题中"沿用"是整节假声明的载体：workflow/plugin 未沿用任何一条 |
| 222 | 「写入同目录临时文件，成功后原子替换；不暴露半写文件。」 | `workflow-asset.ts:105` / `plugin-asset.ts:118` 裸 `fs.writeFile` |
| 223 | 「覆盖前保存旧内容；reload 或回读失败时恢复旧内容；目标级锁覆盖 write/reload/readback/rollback 全过程。」 | 无备份变量、无 `KeyedMutex`；`:109` 把 reload 失败吞掉后继续走成功路径 |
| 224 | 「registry 必须再次解析最终文件；仅"文件存在"不算成功。」 | reload 被吞后 `:113` 读的是陈旧缓存，构成"解析成功"假象 |
| 234 | 「apply / delete 不信任前端状态或 tool result」 | `:92` 的 CAS 门由前端是否传参决定，即信任了前端的"不传" |
| 235 | 「路径双重 containment、目标级事务锁、原子写 + 回滚、registry reload + readback、错误脱敏**全部不变**」 | 对 workflow/plugin 五项全部不成立 |
| 236 | 「delete = 备份旧 bytes → 原子删除 → registry reload → readback 确认不存在；失败恢复旧文件」 | `:147-150` 只有 `fs.rm` + 被吞掉的 reload |
| 621 | 「路径安全解析（nameToRelativePath → NFKC + segment 校验）、baseRevision CAS（sha256 对比）」 | 三处失真：无 realpath；未说明 CAS 可跳过；只列"有什么"未列丢失项 |
| 622 | 「system origin 资产前后端双重拒绝」 | 后端不存在（见 P2-5） |
| 633 | `- [x] Delete UI 全部 7 类 + system origin 拒绝 + 二次确认` | 已勾选的验收项两个子句均不成立 |
| 139 | `name: Name,  // 1..80 Unicode code points` | 漏写字节口径，实际中文上限 33 字（见 P1-5） |
| 644 | 「Core import-parser Effect service — M7 阶段以 Agent 解析代替，Core parser 延后独立一期」 | 已实现并接线到 UI（`chat-import-dialog.tsx:237`） |
| §8.2 | 「思考过程内容默认不写入资产正文」 | `capture-helpers.ts:25` 无条件包含 reasoning（潜伏） |

**建议修正**：§8.3 在 `:219`/`:220` 加范围限定（"以下不变量适用于 5 类 typed service；workflow/plugin 内联实现的实际保证见 §20.5"）；`:235` 的"全部不变"去掉或加例外表；`:139` 改为双约束表述；`:622`/`:633` 修正或撤销勾选；`:644` 更新为已实现。

### 10.2 其他文档

| 位置 | 文档原句 | 代码事实 | 建议 |
|---|---|---|---|
| `product-mode-agent-policy.ts:6` | ` * - \`mode=chat\` requires \`chat-orchestrator\` as the primary agent.` | **失效**。`:49-53` 默认返回 `META`；`:79-88` 对 chat 接受两者。同文件 `:43-48` 已有 2026-08-11 决策注释与之直接矛盾 | 改 `:6` 一行；`:7`/`:8` 两条仍成立 |
| `ADR-13:25` | 「Chat 创建，Work/Coding 执行：Chat 不承担通用任务执行」 | 权限层未强制（P1-1、P1-11） | 新增 Amendment-2 记录 2026-08-11 元智能体调度决策 |
| `ADR-13:3` | 状态行 `Accepted（2026-07-15……）` | 未记录 2026-08-11「chat/work 默认 agent 改 meta」决策（只写在代码注释里） | 同上 |
| `ARCHITECTURE.md:273` | Phase 6 complete 含 `symlink-aware path containment` | `FSUtil.resolveSecurePath` 零调用者（P1-10） | 限定作用域或接上调用 |
| `ARCHITECTURE.md:271` | 「M1-M7 全部完成 — 7 类资产新建/导入/创建/apply/delete 全闭环」 | 未区分 5 类 typed service 与 2 类内联 handler 的保证差异 | 加限定语 |
| `ARCHITECTURE.md:261` | 「handlers consume services via `yield*` and **never call `Effect.provide(SomeLayer)` inside a handler or raw callback**」 | **全部 7 个资产 handler 都在 handler 内 provide**（`prompt-asset.ts:68/96/118/139`、`workflow-asset.ts:29/53/79/109` 等）。属 Location-scoped 服务的既有模式，**非本次引入** | 协议句需补 Location-scoped 例外，否则整个资产 HTTP 层名义违规、门禁失去判别力 |

---

## 11. 修复优先级建议

### 11.1 四项收敛式修复

按"修一个点、好一片面"排序。前三项是代码，第四项是流程 —— 只做前三项会让同类缺陷再次发生。

**① 交换 import-parser 两步顺序**（根因 F）
`import-parser.ts:166` 与 `:169` 对调：先 `extractBlocks`，再只对块外文本 `stripNoise`。一处改动消掉 P1-6（few-shot 模板被摧毁）与 P2-12（注释静默剥离），恢复"导入提示词模板"这条 PRD §7.3 首要闭环。

**② `yamlEscape` 6 合 1 并补全控制字符转义 + 打通错误通路**（根因 A + B）
- `yamlEscape` 归一到单一 owner，补 C0 控制字符转义 → 单点修复覆盖 5 类资产 + 迁移路径（P2-1 ×6）
- `PathValidationError` 补 `override get message()` → P1-4
- `chat-right-panel.tsx:177`/`:200` 与 `mode-workspace-slots.tsx:482` 三处 catch 改为显示错误 → P1-3、P2-2
- 效果：P1-3/P1-4/P1-5/P2-8/P2-9 从"点按钮没反应"变成可诊断提示

**③ workflow/plugin 的 apply/delete 改为调用既有 owner**（根因 A）
`FileMutation.writeAtomic` + `KeyedMutex` + `resolveSafeTarget` 都已存在，不需要新写事务层 —— PRD §20.5 批准的"不建 typed service"这条债也不需要还。顺带决定 `FSUtil.resolveSecurePath` 是接上还是删掉：**留着零调用者的安全函数比没有更糟，因为 `ARCHITECTURE.md:273` 拿它当已完成的证据。**

**④ 补路由**（根因 G）
- `CLAUDE.md:108`、`protocols` Phase 1 表 L2 列、`check-refs.sh` PATHS 三处补上 `enterprise-code-standard` / `reuse-first-refactor` / `quality-to-pr`
- `ARCHITECTURE.md` §1 表加一行 `docs/prd/`
- `quality-to-pr:42` 必读清单补 PRD，并加一步"对照已批准 PRD/ADR 的不变量清单逐条核对"
- `protocols` Phase 1 表加"资产/Asset"行
- `effect/SKILL.md` 补吞错反模式规则（`Effect.catch(() => Effect.void)` / `orDie` / `ignore`）与"tagged error 必须提供可读 message"；description 补 handler/HTTP/error/service 触发词

### 11.2 权限边界（需人决策，不建议我单方面改）

P1-1 与 P1-11 涉及 2026-08-11 已批准的架构决策。两条路径：

- **恢复 chat 默认 fail-closed**：`resolvePrimaryAgent` 对 chat 返回 `CHAT_ORCHESTRATOR`，meta 保留为可显式选择项
- **接受现状并入档**：给 ADR-13 加 Amendment-2 记录默认 agent 变更，并明确 ADR §边界规则 1 的强制机制已改变

无论选哪条，`product-mode-agent-policy.ts:6` 的失效注释都要修。

---

## 12. 已核查确认无问题

列出以避免重复审计。

**路径安全**
- 7 个 `*-asset/path.ts` 逐字节同构（归一化 diff 验证，仅扩展名与 kind 名不同）
- **NFKC 归一化在字符校验之前执行，顺序正确** —— 全宽斜杠 `／`、全宽句点 `．．` 都无法绕过
- `nameToRelativePath` 的路径穿越防护有效：`/ \ .. < > : " | ? *` + `\x00-\x1F\x7F` + 首尾空格 + 尾点全部拒绝

**写事务**
- 5 类 typed service 的写事务完整满足 PRD §8.3 五条：临时文件 + 原子替换 + 目标级锁 + `Effect.uninterruptible` + 备份回滚 + readback revision 校验 + registry 重新解析
- `LocationMutation.resolve` 用 `realPath` 做双重 containment，符号链接逃逸被 `location_escape` 正确拦截
- `FileMutation.writeAtomic` 有 `Effect.addFinalizer` 清理临时文件 + per-canonical-target 锁

**权限**
- `write` / `edit` / `apply_patch` 共用 `action: "edit"`，meta 的 deny 覆盖到 `apply_patch`（曾怀疑此处有洞，实测不成立）
- chat 模式的 agent 白名单是收窄的（只允许 meta 与 chat-orchestrator 两个），`resolvePrimaryAgent` 的显式 agent 也会过 `checkPrimaryAgent`

**前端**
- chat 组件 62 个静态 i18n key + 全部动态 key（7 kinds × `chat.feature.*`、`asset.origin.*`）在 en/zh/zht 三 locale 全部存在（脚本化验证）
- `sortRows` 比较器满足严格弱序；`sameCandidateInfo` 的 7 个 kind 分支无遗漏
- `chat-right-panel.tsx:57-69` 的 tab 同步两轮内收敛，mode 门控正确隔离
- `countSimilarPrompts` 的调用方 `session.tsx:615` 用 `slice(0, -1)` 正确排除当前条目

**序列化**
- 模板正文含 `---`、空模板、纯 `---` 都能正确 round-trip（实测），不是缺陷

---

## 13. 未覆盖范围

**未审计**（无结论，不代表无缺陷）：
- `chat-import-dialog.tsx` 结果预览渲染段（约 270-540 行）
- `chat-session-list.tsx` 与 `secondary-sidebar.tsx` 的会话列表过滤分支（`(session.mode ?? "coding") === "chat"` 模式在多处重复，未逐点核对是否有漏写 `?? "coding"`）
- `asset-migration.ts`（253 行）的迁移幂等性与中途失败的半迁移状态
- SDK 生成层（`packages/sdk/js`）
- `groups/*-asset.ts` 的 HttpApi payload schema 定义（只从 handler 侧看了消费）

**未做运行时验证**：未启动 dev server 实际点击。P1-3、P1-5、P2-2 的用户体验描述由代码推导，逻辑链完整但未操作复现。

**执行说明**：本次原计划以 8 个并行子代理覆盖 7 个代码簇，全部因 API token 配额 403 中断（环境问题，非代码问题），改为主循环逐行读取 + 实测探针。协议与 skills 映射由一个后续子代理完成通读，其引文经本报告抽查 6 处核对准确；第 8、9 节中标注"已独立验证"的条目为本报告直接 grep 确认。

---

## 附录 A：`CLAUDE.md` 技术债表建议新增行

**选取原则**：只登记**结构性负债**（需架构决策或跨层收敛才能根治）。P1-3、P2-1、P2-2、P2-4 等是可直接修复的 bug，登记为技术债等于 `CLAUDE.md:98` No Cheating 的逃逸，故不入表。

追加位置：`CLAUDE.md` 已知技术负债表末行之后。

```
| workflow/plugin 资产 apply/delete 在 HTTP handler 内联实现 | aigcfroge | 丢失 PRD §8.3 全部写事务不变量：裸 `fs.writeFile` 无原子替换、无目标级锁、无备份回滚、无 realpath containment、`registry.reload()` 失败被 `Effect.catch(() => Effect.void)` 吞后返回陈旧 Info；PRD §20.5 只登记了"typed service 延后"，未声明该代价。根治：复用 `FileMutation.writeAtomic` + `KeyedMutex` + `resolveSafeTarget` | TBD | 开第 8 类资产前 |
| 资产 name 约束跨层不一致 | schema / core | `packages/schema/src/asset.ts:10` 为 80 Unicode code points，`packages/core/src/prompt-asset/path.ts:15` `SEGMENT_MAX_BYTES` 为 100 UTF-8 bytes，中文名实际上限 33 字，与 PRD §8.1 承诺不符且无跨层一致性测试。根治：单一常量源 + 双向边界测试 | TBD | 下次 schema 变更时 |
| PathValidationError 未实现 message，路径校验错误信息为空串 | core | `packages/core/src/prompt-asset/path.ts:18-21` 类体为空，同族 7 个 path.ts 同构；消费方 `failureMessage` 读 `error.message` 得空串，UI 显示空错误。typecheck/lint 双盲。根治：TaggedErrorClass 强制 `override get message()` 约定 + 错误面契约测试 | TBD | 下次错误面改动时 |
| yamlEscape 存在 6 份同源副本且均不转义 C0 控制字符 | core | `prompt/command/skill/mcp/agent-asset-service.ts` + `asset-migration.ts` 各一份，函数体逐字节相同；description 含 `\x1b`/`\x0b` 等即导致写盘后 registry 解析失败、readback 失败、回滚，错误不可诊断。根治：归一到单一 owner 并补全转义 | TBD | 下次资产序列化改动时 |
| 资产 origin 是纯前端概念，system origin 保护无服务端边界 | app / aigcfroge | PRD §20.3/§20.4 声称"前后端双重拒绝"，实测 7 个 handler + 5 个 service 无任何 origin 校验，绕过 UI 直调 HTTP 可删 system 资产。根治：origin 下沉为服务端可判定字段，或删除 PRD 中的双重拒绝声明 | TBD | 资产权限面评审时 |
| 资产候选状态依赖模型可见文案子串匹配 | app | `prompt-asset-candidate.ts:181` `booleanField(result, "exists") ?? output.includes("exists")`；V1/V2 文案不一致且 V1 把资产名嵌入被匹配串，误判/漏判静默发生。与已登记的 doom_loop 文案匹配债同构。根治：propose 工具双运行时统一 structured output 契约，删除文本兜底 | TBD | V1/V2 工具输出统一时 |
| chat 默认主 agent 为 meta（fail-open 权限信封） | aigcfroge / core | V2 `plugin/agent.ts:228` defaults 首条为 `{action:"*",effect:"allow"}` 仅 deny bash/edit/write；V1 `agent/agent.ts:227` 额外放行 `create_agent`/`configure_mcp` 且基线为 buildDefaults。ADR-13 §边界规则 1「Chat 不承担通用任务执行」在权限层未强制。根治：ADR-13 补 Amendment 记录 2026-08-11 决策，或恢复 chat 默认 fail-closed | TBD | ADR-13 Amendment-2 |
| FSUtil.resolveSecurePath 为零调用者死代码 | core | `fs-util.ts:257` 实现正确（realpath + 双重 contains）且文档注释要求"用于所有文件访问工具"，但全仓无调用者；`ARCHITECTURE.md:273` 却把 symlink-aware path containment 列为 Phase 6 complete。根治：接入调用点或删除并修正架构文档 | TBD | 与 workflow/plugin 事务修复同批 |
| 协议路由体系未覆盖 4 个流程 skill 与 docs/prd | 根 / .aigcfroge/skills | `CLAUDE.md:108`、`protocols/SKILL.md:56-57` Phase 1 表、`check-refs.sh:30-32` 三处均只认 effect/database/frontend-theming；`ARCHITECTURE.md:9-25` §1 路由表无 `docs/prd/` 行。导致"PRD 写了、代码没做、复查全绿"类缺陷无门禁拦截。根治：补路由 + 在 quality-to-pr 增加 PRD 不变量逐条核对步骤 | TBD | 下次协议拓扑更新时 |
```
