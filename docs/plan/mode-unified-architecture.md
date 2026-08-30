# Mode Framework — Unified Architecture (Phase 1)

> 状态：SUPERSEDED
> 取代方案：[`mode-module-switching-completion.md`](mode-module-switching-completion.md)
> 说明：本文保留历史实施记录；其中 `activeSessionId` 自动恢复和无 placement 自动新建 Draft 的语义不再有效。当前实现见 [`mode-module-switching-completion.md`](mode-module-switching-completion.md)：模式切换导航到 `/mode/:mode`，Mode Route 校验参数并同步 `currentMode`；首页即模式工作区，会话列表按 Mode 发起服务端过滤查询。

> Historical status: READY
> Branch: brand-migration-v001
> Scope: 3 changes, 3 files

---

## 0. Current State

```
mode 状态流:

  ModeSwitcher 点击 → setCurrentMode(m)           ← 旧实现：仅本地状态，无模块入口 URL
  HomeModeCards 点击 → enterMode(m)               ← 有分支：
    ├── 有 placement     → sessionHref 恢复        ← 所有 mode 统一 ✅
    ├── m === "coding"   → newDraft               ← 只有 Coding ✅
    └── 其他 mode        → navigate("/")           ← 回到首页，死循环 ❌

  Draft 提交后:
    session = created                              ← submit.ts:386
    tabs.promoteDraft(...)                         ← submit.ts:391
    ❌ setActiveSessionId 从未被调用                ← Bug: 切换 mode 后回不来

  URL 打开已有 session:
    tabs.addSessionTab(...)                        ← app.tsx:119
    ❌ setActiveSessionId 从未被调用                ← Bug: 同上
```

## 1. Three Changes

### 1.1 home.tsx — Unify enterMode

**Before** (line 394-410):

```ts
function enterMode(m: Mode) {
  mode.setCurrentMode(m)
  const placement = mode.activeSessionId(m)()
  if (placement) {
    navigate(sessionHref(placement.server, placement.sessionId))
    return
  }
  if (m === "coding") {
    // ← 删掉这个分支
    const conn = focusedServer()
    const project = newSessionProject()
    if (conn && project) {
      openProjectNewSession(conn, project.worktree)
    }
    return
  }
  navigate("/") // ← 删掉这个兜底
}
```

**After**:

```ts
function enterMode(m: Mode) {
  mode.setCurrentMode(m)
  const placement = mode.activeSessionId(m)()
  if (placement) {
    navigate(sessionHref(placement.server, placement.sessionId))
    return
  }
  const conn = focusedServer()
  const project = newSessionProject()
  if (conn && project) {
    openProjectNewSession(conn, project.worktree)
  }
}
```

四个 mode 统一：有 placement 恢复，没有就新建 draft。

### 1.2 submit.ts — Record activeSessionId on draft submit

**Location**: `createPromptSubmit` in [submit.ts:384-392](../../packages/app/src/components/prompt-input/submit.ts#L384-L392)

After session creation (`session = created`), add:

```ts
mode.setActiveSessionId(mode.currentMode, {
  server: server.key,
  sessionId: created.id,
})
```

Need to add `import { useMode } from "@/context/mode"` and `const mode = useMode()`.

### 1.3 app.tsx — Record activeSessionId on session navigation

**Location**: `ResolvedTargetSessionRoute` in [app.tsx:116-123](../../packages/app/src/app.tsx#L116-L123)

After `tabs.addSessionTab(...)`, add:

```ts
mode.setActiveSessionId(mode.currentMode, {
  server: serverKey(),
  sessionId: params.id,
})
```

Need to add `import { useMode } from "@/context/mode"` and `const mode = useMode()`.

## 2. Data Flow After Fix

```
用户在 Coding mode → 新建 session → 发送消息:
  submit.ts → session = created
  → mode.setActiveSessionId("coding", { server, sessionId })

用户点首页 Chat 卡片:
  enterMode("chat")
  → setCurrentMode("chat")
  → mode.activeSessionId("chat")() → undefined（首次）
  → newDraft → 新建 Chat session → 发送消息
  → mode.setActiveSessionId("chat", { server, sessionId })

用户再点首页 Coding 卡片:
  enterMode("coding")
  → setCurrentMode("coding")
  → mode.activeSessionId("coding")() → { server, sessionId } ← 找回来了
  → navigate(sessionHref(server, sessionId)) ← 恢复 session

用户在 Coding session 中 → 点 ModeSwitcher 的 Chat 图标:
  → mode.setCurrentMode("chat") ← 只改状态，不动当前 session
  → 下次点 Coding 图标: setCurrentMode("coding") ← 还是同一个 session
```

## 3. Verification

```bash
bun --cwd packages/app typecheck
bun --cwd packages/app test --timeout 30000
bun run lint
```

## 4. File Manifest

| File                                                                  | Action                                                  | Lines |
| --------------------------------------------------------------------- | ------------------------------------------------------- | ----- |
| [home.tsx](../../packages/app/src/pages/home.tsx)                     | Delete `if (m === "coding")` branch + `navigate("/")`   | -7    |
| [submit.ts](../../packages/app/src/components/prompt-input/submit.ts) | Add `mode.setActiveSessionId(...)` after session create | +4    |
| [app.tsx](../../packages/app/src/app.tsx)                             | Add `mode.setActiveSessionId(...)` after tab add        | +4    |

## 5. What This Does NOT Do

- 不新增 ModeConfig / 配置表 / 模式注册机制
- 不改次级侧边栏的按钮文案或行为
- 不改 ModeSwitcher 或 Layout 结构
- 不创建默认目录

这些是后续特定 mode 的 agent 就绪后才需要的事。

## 6. Mode-Based Filtering

本节原待办已被 [`mode-module-switching-completion.md`](mode-module-switching-completion.md) 接管。新方案明确 Product Mode 是独立 Session 分类，不能从 Agent/Message 的 execution mode 继承；项目跨 Mode 共享，Session 列表、搜索、加载和未读状态按 Mode 过滤。
