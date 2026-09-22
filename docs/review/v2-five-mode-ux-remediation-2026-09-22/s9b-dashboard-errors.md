# S9b：Assistant mutation 错误可见化证据

- Slice：S9b
- 结论：reminder/memory/KB/delivery mutations 不再 `.catch(console.error)` 吞掉；统一进入 `role="alert"` 的错误横幅。

## RED

```text
bun --cwd packages/app test:unit:file src/pages/assistant-dashboard.test.ts
FAIL: dashboard still contains `.catch(console.error)` and lacks assistant-mutation-error
```

## GREEN

```text
bun --cwd packages/app test:unit:file src/pages/assistant-dashboard.test.ts src/pages/assistant-dashboard-model.test.ts src/i18n/parity.test.ts
5 pass, 0 fail, 2956 expect() calls

bun --cwd packages/app typecheck
rc=0

LINT_BASE_REF=origin/main bun run script/lint-changed.ts
Incremental lint passed
```

## 行为

- `runMutation(action, refetch)` 清空旧错、执行 mutation、refetch，失败时把 Error message 或 i18n fallback 写入 state。
- 页面顶部显示 `data-component="assistant-mutation-error"` + `role="alert"`，支持 dismiss。
- 覆盖 confirm/reject/remove memory、save/delete note、cancel reminder、mark delivery read。
- 新增 i18n `assistant.dashboard.actionError`，仅 en / zh / zht。

## 未做/偏离

没有重试按钮：失败后用户可直接再次触发原 action；本轮只要求可见、可理解反馈。
