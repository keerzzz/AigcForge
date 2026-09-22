# S4d：Assistant citation loading/error 证据

- Slice：S4d
- 结论：`kb.get` 从 `.then/.catch(empty)` 改为 `createResource`；loading、error、retry 都有用户可见状态。

## RED

```text
bun --cwd packages/app test:unit:file src/pages/session/assistant-citation.test.ts
FAIL: surfaces citation loading, error, and retry instead of swallowing failures
```

## GREEN

```text
bun --cwd packages/app test:unit:file src/i18n/parity.test.ts src/pages/session/assistant-citation.test.ts
17 pass, 0 fail, 2986 expect() calls

bun --cwd packages/app typecheck
rc=0

LINT_BASE_REF=origin/main bun run script/lint-changed.ts
Incremental lint passed
```

## 行为

- 点击 citation 仍立即 `openEntityPanel` 到 KB Tab。
- 右侧 citation overlay 先显示 `assistant.citation.loading`。
- `kb.get` 失败显示 `role="alert"` + `assistant.citation.error` + retry；retry 调用同一 resource 的 `refetch`。
- 成功仍展示既有标题与 220 字摘要。

## i18n

新增 `assistant.citation.{loading,error,retry}`，仅 en / zh / zht；parity 测试已通过。

## 未做/偏离

未新增“打开原文 URL”字段；KB note 没有外部 URL 契约，现有 KB Tab 指向完整 note.content。显式打开按钮仍归 S9a/导航专项裁决。
