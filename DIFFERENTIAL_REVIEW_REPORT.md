# 差异审查报告：右侧面板增强 + 缓存诊断 + Task 重试

**审查日期**: 2026-07-04
**修复日期**: 2026-07-04
**审查范围**: 当前未暂存工作区变更（`git diff` + 未跟踪文件）
**审查依据**: `CLAUDE.md`、`AGENTS.md`、`.aigcfroge/command/commit.md`、`docs/plan/right-panel-enhancement.md`、`docs/plan/cache-miss-diagnostics-and-agent-upgrade.md`、`specs/v2/session.md`、`specs/v2/tools.md`

---

## 审批结论

**🟢 修复后批准提交（Approved with fixes applied）**

本次审查发现的 P0/P1 级别缺陷已全部修复并验证：
1. ✅ `Git.log` 解析逻辑已修复，改用 `git log -z` 并按 4 字段一组解析；
2. ✅ `SessionToolActivity` 分类标签已走 `language.t()` 国际化；
3. ✅ `TaskTool` 重试状态已改为每次 `execute` 调用独立的 `Ref`，并发安全。

剩余未修复项已降级为 P2/P3，可在后续迭代中处理。

---

## 变更概述

| 主题 | 涉及文件 |
|---|---|
| Git 工作流 API/UI | `packages/aigcfroge/src/git/index.ts`、`project/vcs.ts`、HTTP API groups/handlers、前端 `git-*` 组件、`pages/session.tsx` |
| 缓存诊断 | `packages/core/src/session/cache-diagnostics.ts`、HTTP session handler、前端 `session-cache-diagnostics.tsx` |
| 工具活动聚合 | `packages/app/src/components/session/session-tool-activity*.ts*` |
| Task 子工具重试 | `packages/aigcfroge/src/tool/task.ts` |
| SDK 同步 | `packages/sdk/js/src/v2/gen/{sdk.gen,types.gen}.ts` |
| 次级边栏交互 | `packages/app/src/components/secondary-sidebar.tsx` |

---

## 详细发现

### P0 缺陷（已修复）

#### 1. `Git.log` 解析错误，`GET /vcs/log` 实际不可用 ✅

**位置**: `packages/aigcfroge/src/git/index.ts:367-377`

**修复内容**: 添加 `-z` 选项并使用 4 字段分组解析：
```ts
const result = yield* run(
  ["log", "-z", `--max-count=${count}`, "--format=%H%x00%s%x00%an%x00%aI"],
  { cwd },
)
if (result.exitCode !== 0) return []
const fields = nuls(result.text())
const entries: CommitEntry[] = []
for (let i = 0; i + 3 < fields.length; i += 4) {
  entries.push({
    hash: fields[i],
    message: fields[i + 1],
    author: fields[i + 2],
    date: fields[i + 3],
  })
}
return entries
```

**验证**: `test/git/git.test.ts` 新增 3 个 live 测试，全部通过。

---

#### 2. `SessionToolActivity` 分类标签未国际化 ✅

**位置**: `packages/app/src/components/session/session-tool-activity.tsx:14`

**修复内容**: 在 `ToolActivitySection` 内调用 `language.t()`，并导出 `Dictionary` 类型以安全转换 key：
```tsx
import { useLanguage, type Dictionary } from "@/context/language"
// ...
{props.activity.total} {language.t(props.activity.label as keyof Dictionary)}
```

**验证**: `bun --cwd packages/app typecheck` 通过。

---

### P1 缺陷（已修复）

#### 3. `TaskTool` 重试状态为全局闭包，并发不安全 ✅

**位置**: `packages/aigcfroge/src/tool/task.ts:119-120`、`210-216`、`255-256`、`439-443`

**修复内容**: 使用 `Effect.Ref` 在每次 `execute` 调用内部维护重试状态，确保不同 execute 调用之间不共享：
```ts
execute: (params, ctx) =>
  Effect.gen(function* () {
    const previousSessionIDRef = yield* Ref.make(Option.none<SessionID>())
    return yield* run(params, ctx, previousSessionIDRef).pipe(
      Effect.retry(Schedule.recurs(1)),
    )
  }).pipe(Effect.catch((e) => Effect.die(e)))
```

**验证**: `test/tool/task.test.ts` 新增 "execute retry cancels only its own child session" 测试，21 个 task 测试全部通过。

---

### P1 缺陷（已修复）

#### 4. `cache-diagnostics.ts` 数据库查询使用 `orDie` ✅

**位置**: `packages/core/src/session/cache-diagnostics.ts:127`

**修复内容**: 移除 `.pipe(Effect.orDie)`，让数据库错误能被 handler 的 `Effect.mapError` 捕获并转为 `BadRequest`。

**验证**: `bun --cwd packages/core typecheck` 通过。

---

### P1 缺陷（已修复）

#### 5. `vcs.unstage` 失败仍返回 `"stage-failed"` ✅

**位置**: `packages/aigcfroge/src/project/vcs.ts:459` 及 `packages/aigcfroge/src/server/routes/instance/httpapi/groups/instance.ts:37`

**修复内容**: 在 `PatchApplyError` / `ApiVcsApplyError` 的 reason 枚举中新增 `"unstage-failed"`，并在 `Vcs.unstage` 失败时返回该 reason。

**验证**: `bun --cwd packages/aigcfroge typecheck` 通过，`test/project/vcs.test.ts` 12 个测试全部通过。

| # | 问题 | 位置 | 说明 |
|---|---|---|---|
| 6 | ahead/behind 硬编码为 0 ✅ | `packages/app/src/pages/session.tsx`、`git-status-bar.tsx` | 已将 `ahead`/`behind` 改为可选 props，调用处不再传入硬编码值 |
| 7 | 单文件 stage/unstage 未接入 | `packages/app/src/components/session/git-state.ts` | `stageFile`/`unstageFile` 已导出但无调用 |
| 8 | v1 缓存诊断可能重复计数 | `packages/core/src/session/cache-diagnostics.ts:60-65` | 需核对 v1 `tokens.input` 是否已包含 cache read |
| 9 | `secondary-sidebar.tsx` 行为变更 | `packages/app/src/components/secondary-sidebar.tsx:185-195` | 新建 workspace 后不再自动打开草稿 tab，需确认产品意图 |
| 10 | 新增功能缺少测试 ✅（部分） | `packages/aigcfroge/test/git/git.test.ts`、`test/tool/task.test.ts` | 已为 Git log/stage/commit/unstage 和 Task 重试并发安全补充测试 |

---

## 合规性检查

### 协议遵循（CLAUDE.md / AGENTS.md）

| 检查项 | 结果 | 说明 |
|---|---|---|
| 影响面控制 | ⚠️ | `secondary-sidebar.tsx` 顺手删除了打开草稿 tab 的逻辑，需确认 |
| 安全门禁 | ⚠️ | Git 路径使用 `--` 分隔符正确，但 `files` 未做去重/空字符串过滤；TaskTool 并发状态有安全隐患 |
| 工程门禁 | ⚠️ | 存在未使用的 i18n key；`session-tool-activity-model.ts` 的正则应改为 `startsWith` |
| 设计规范 | ✅ | 使用 v2 Token、i18n、AccordionV2 |
| 无障碍 | ⚠️ | `GitCommitBar` 快捷键提示写死 `Cmd+Enter`，Windows/Linux 不准确 |

### 已运行验证命令

```bash
bun --cwd packages/aigcfroge typecheck   # ✅ 通过
bun --cwd packages/app typecheck         # ✅ 通过
bun --cwd packages/core typecheck        # ✅ 通过
bun run lint                             # ⚠️ 失败（均为既有警告，本次新增代码无新增警告）
bun --cwd packages/aigcfroge test test/git/git.test.ts test/tool/task.test.ts test/project/vcs.test.ts --timeout 60000  # ✅ 45 pass
```

**lint 说明**: 失败全部由仓库既有未使用变量/导入/consistent-return 等警告引起，本次修改未引入新的 lint 警告。`session-tool-activity-model.ts` 的 `prefer-string-starts-ends-with` 警告已修复。

---

## 修复清单（提交前必须完成）

- [x] 修复 `Git.log` 字段解析（P0）
- [x] 修复 `SessionToolActivity` 标签国际化（P0）
- [x] 修复 `TaskTool` 重试状态并发问题（P1）
- [x] 修复 `cache-diagnostics.ts` 的 `orDie`（P1）
- [x] 修复 `vcs.unstage` 错误 reason（P1）
- [x] 将 `session-tool-activity-model.ts` 中的 `/^xxx/.test(tool)` 改为 `tool.startsWith(...)`
- [x] 为 Git stage/unstage/commit/log、Task 重试补充单元/集成测试
- [x] 重新运行 `bun run lint` 并确保无新增警告
- [x] 重新运行受影响包的 `bun test`

---

## 剩余风险

- 缓存诊断后端事件 `session.next.cache.diagnostic` 已注册但当前无发布点，相关 SDK 类型暂时为“死类型”。
- `settings-icon-visibility.md` 计划中的设置 UI 开关尚未暴露。
- ahead/behind 功能未完整实现，但 UI 已占位展示。

---

**审查人**: Kimi Code CLI（高级全栈开发顾问）
**建议**: 修复 P0/P1 问题后重新提交审查。
