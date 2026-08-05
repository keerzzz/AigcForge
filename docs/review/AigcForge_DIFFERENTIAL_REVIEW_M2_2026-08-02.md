# AigcForge `todo-task-m2` M2 里程碑审批报告

- **审批日期**：2026-08-02（星期日）
- **基线**：`main` (`ef454564f`，含 M0/M1 已审批代码)
- **目标**：`todo-task-m2` (`056e00430`)，3 个代码提交 + 1 个 docs 提交，34 files，`+1346/-1115`
- **范围**：M2a（output_digest 持久化 + GET /session/{id}/task）、M2b（SessionTodoProgress 脉冲线 + dock 移除）、M2c（折叠浮层 + task.updated store + E2E）
- **结论**：❌ **REJECT / 暂不批准进入 M3**
- **总体风险**：HIGH（2 个 HIGH 均直击 M2 退出条件与审批红线；修复量小）

## 1. Executive Summary

| Severity | Count |
|---|---:|
| 🔴 CRITICAL | 0 |
| 🟠 HIGH | 2 |
| 🟡 MEDIUM | 3 |
| 🟢 LOW | 5 |

M2 的骨架质量很高：dock 移除彻底（全仓零残留、revert 的 rolled/lift 完好）、§5.5 边界兜底逐条落实且有测试、E2E 实跑通过（2 passed/18.3s）、全量命令绿（core 1406 / aigcfroge 46 / app 556 pass、lint 0 error、SDK 再生成幂等、migration --check 通过）、V1 读路径与 TUI 消费者零回归。

但两条 HIGH 使 M2 退出条件实际不成立：

1. **刷新后首次勾选会静默抹掉 outputDigest 与稳定 id**——重载恢复只拉三字段 `GET /todo`（无 id），M2a 交付的 `GET /session/{id}/task` 在 App 端**零调用**；浮层对无 id 条目发起 PATCH → `update()` 整行 delete+re-mint → digest 全丢、id 全重铸。M2 退出条件"outputDigest 刷新后跳转不丢"在这条最常见路径上不成立。
2. **`SessionTask.update` 的 resolved Info / `task.updated` payload 丢 outputDigest**（DB 保留）——第三轮 MEDIUM-1（parentID）的同款问题在 digest 字段上复发，违反红线 #6（事件 payload 与 DB 一致），两个审查域独立实证。

## 2. Blocking Findings

### 🟠 HIGH-1：刷新 → 展开浮层 → 勾选 = 全量 delete+re-mint，静默抹掉 outputDigest 与稳定 id

**Evidence**

- `packages/app/src/pages/session/timeline/session-todo-progress.tsx:38-42`：`session_task` 为空即回退三字段投影（条目无 `id`）；
- `:50-53`：重载恢复只调 `sync().session.todo(id)`（`GET /todo` 三字段）；**`GET /session/{id}/task` 在 App 端零调用**（全仓 grep 实证），尽管 SDK gen 注释写明其用途就是 "reload-recovery source for the TaskPanel"；
- `:66-67`：写回 body 带 `id: task.id`（fallback 时为 `undefined`）→ `packages/core/src/session/task.ts:172` 无 id 铸新 id + `:238-242` 旧行不在 retained 集合整行 DELETE（新行无 `output_digest`）；
- E2E test 2（`session-todo-progress.spec.ts:131-151`）只断言刷新后节点/统计恢复，不覆盖 reload→toggle→digest 存活；mock PATCH 仅 echo body，抓不到此问题。

**Failure Flow**

```text
委派回写 patch 落 output_digest（子会话跳转链接）
  → 用户刷新页面 → session_task 空 → UI 回退 GET /todo 三字段（无 id）
  → 用户勾选任意 checkbox → PATCH WriteInfo（id=undefined）
  → SessionTask.update：旧行（含 digest）DELETE，新行铸新 id 插入
  → outputDigest 全丢、task id 全重铸、createdAt 重置
```

**Required Fix**（兼施）

1. 重载恢复改拉 `GET /session/{id}/task` 填 `session_task` store（与挂载时拉取统一）；
2. 写回守卫：**条目无稳定 id 时 checkbox 只读/禁用**（单点同时化解 HIGH-1 与 MEDIUM-1 的 V1 写回分裂——V1 投影条目本就无 id，与旧 dock readOnly 行为对齐）；
3. 回归测试（红线 #10）：「reload → toggle → digest/id 存活」E2E 或组件级测试。

### 🟠 HIGH-2：`update` 的 resolved Info / `task.updated` payload 丢 outputDigest（红线 #6 同款复发）

**Evidence**

- `packages/core/src/session/task.ts:217-224`：update 写入列不含 `output_digest`（DB 保留）；`:252-264`：`resolved` Info 手工构造只回退 `parentID`（第三轮修的 `parentIdById`），**未回退 `outputDigest`**；
- 实证（临时复现，两个审查域独立跑出）：patch 落 `ses_child` → 同 id reconcile update → DB digest `"ses_child"` / 返回值 `undefined` / 事件 `undefined`；
- 连带：`specs/v2/schema-changelog.md:19` 声明 "DB, resolved Info, and `task.updated` payload stay in agreement" 不成立（红线 #8 漂移）。

**Failure Flow**

正常 id 携带的勾选 → PATCH 响应与 republish 的 `task.updated` 无 digest → App `session_task` store reconcile 后内存 digest 被抹 → 跳转链接消失，直到下次全量 GET。

**Required Fix**

`update` 事务内仿 `parentIdById` 捕获 `prior?.output_digest` 填进 `resolved`（或事务后整表重读，与 append/replaceLegacy 一致）；补「reconcile 后 digest 在返回值与事件中保留」回归测试；改正 changelog :19。

## 3. Medium Findings

### 🟡 MEDIUM-1：V1 runtime 写回分裂——PATCH 写 TaskTable，GET /todo 读 TodoTable

`handlers/session.ts:130-142`（PATCH 无 runtime 分支，恒写 TaskTable）vs `:118-128`（GET /todo V1 分支读 legacy TodoTable）。默认 V1 runtime 下勾选当次靠 `task.updated` 事件回填看似工作，**刷新后勾选状态丢失**。旧 dock 的 CheckboxV2 是 `readOnly`，故非既有行为回归，但红线 #1 要求共享路径双 runtime 保障。**Fix**：随 HIGH-1 的守卫一并解决（无稳定 id → 只读，V1 投影天然满足）；或 PATCH 加 V1 分支。补 V1 写回测试。

### 🟡 MEDIUM-2：写回失败仅 `console.error`，用户无感知

`session-todo-progress.tsx:73-76`：400/网络失败时 checkbox 无声回弹，违反 Catch Everything「禁止静默失败」。**Fix**：`.catch` 加 `showToast`（仿 `bootstrap.ts:351-354` 既有模式 + i18n key）。

### 🟡 MEDIUM-3：新增 CSS 使用 v1 token，未走 `--v2-*`

`index.css` 新增块引用 `--icon-interactive-base/--icon-interactive-hover/--background-stronger/--icon-disabled/--text-weak`（v1 token）；frontend-theming SKILL 强制"新 UI 必须用 v2 token"，v2 等价物存在（`--v2-icon-icon-base`、`--v2-text-text-muted`、`--v2-background-bg-accent` 等）。无硬编码 hex（红线 #9 硬性部分未违反），但 skill 强制条款被违反。**Fix**：6 处颜色 var 机械替换为 v2 等价 token。

## 4. Low Findings

| # | 问题 | 证据 | 处置 |
|---|---|---|---|
| LOW-1 | `schema-changelog.md:20` 写 SDK `Task.getTask`，实际生成的是 `Task.get`（`sdk.gen.ts:4727`） | changelog:20 | 随手改 |
| LOW-2 | `--v2-radius-md` 全仓无定义且无 fallback → panel 圆角静默失效 | index.css 新增 panel 规则 | 加 fallback 或换已定义 token |
| LOW-3 | i18n 死键 `session.todo.title/collapse/expand/progress`（4 键 × 18 语言文件，唯一消费者是被删的 dock）；新组件 aria-label 硬编码英文模板而未复用 `session.todo.progress` | session-todo-progress.tsx:86 | 删死键 + 复用键 |
| LOW-4 | E2E 注释声称 "digest link rides outputDigest" 但 UI 无跳转链接；hover 显示 content 未测 | spec.ts:95 | 注释改实或补链接 UI（若链接归 M4 则在 specs 注明分期） |
| LOW-5 | 本分支新增 2 条 lint warning（`session-todo-progress.tsx:52` no-floating-promises；`session-task-service.test.ts:192` no-misused-spread） | lint 输出 | M3 顺手清理 |

## 5. 无问题项（实证通过）

- **迁移纪律**：drizzle 管线、尾部注册、可空列存量 null、journal 幂等、`--check` 通过 ✓
- **GET /session/{id}/task 端点**：schema/error/handler/404/空数组测试 ✓；SDK diff 恰好对应、再生成零 diff ✓
- **dock 移除**：全仓零残留；rolled/lift 保留；Question/Permission/Revert/Followup dock 独立挂载不受影响 ✓
- **§5.5 边界**：undefined/空数组/全 completed/非法 status/多 in_progress/cancelled/除零/单节点/降采样/aria 逐条落实 + 测试覆盖 + 运行时复现 ✓
- **数据流 V1 兼容**：`todo.updated` case 逐字节未动；`task.updated` 为纯增量 case + 谓词收窄（无 as any）；双 store 并存由 cleanup 同步清理 ✓
- **E2E 纪律**：playwright 自动等待，无 waitForTimeout，无假测试；实跑 2 passed ✓
- **测试全量**：core 1406 / aigcfroge 46 / app 556 全 pass；lint 0 error；typecheck 四包全过 ✓
- **TUI 零改动**；mock-server 纯增量不影响既有 spec ✓

## 6. Required Actions Before Approval

### Blocking（不修不批）

- [ ] HIGH-1：重载恢复改拉 `GET /session/{id}/task` + 无稳定 id 条目 checkbox 只读守卫 + 「reload → toggle → digest/id 存活」回归测试
- [ ] HIGH-2：`update` resolved/事件回退 `output_digest`（仿 parentIdById）+ 回归测试 + changelog :19 改正
- [ ] MEDIUM-1：V1 runtime 写回语义（随 HIGH-1 守卫解决或 PATCH 加 V1 分支）+ 测试
- [ ] MEDIUM-2：写回失败 showToast
- [ ] MEDIUM-3：6 处 v1 token → `--v2-*`

### 随手清理（不阻塞）

- [ ] changelog :20 `Task.getTask` → `Task.get`
- [ ] `--v2-radius-md` fallback；i18n 死键清理 + aria-label 复用；E2E 注释改实 + hover 断言；2 条新 lint warning；`todo.md` M2a 行"重载恢复数据源"表述随 HIGH-1 修复后自然成立

## 7. Methodology

- 4 个并行审查代理分域：M2a（core/server/SDK）、M2b（App UI + dock 移除）、M2c（浮层 + E2E）、全量验证 + 文档 + 残留扫描；
- 审批依据：根 CLAUDE.md / AGENTS.md / DESIGN.md、`.aigcfroge/skills/{effect,database,frontend-theming}`、计划 §5.2/§5.3/§5.5/§8/§9、提示词 §6 十条红线、前三轮审批报告的 REJECT 先例；
- 34/34 变更文件覆盖；HIGH-1/HIGH-2 均经临时复现测试实证（用后删除，工作区零残留）；E2E 实际运行（2 passed/18.3s，chromium）。

**Confidence：HIGH**
