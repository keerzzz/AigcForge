# S4c：Work Artifact loading 证据

- Slice：S4c
- 结论：使用已经存在的 `sync().status`，不再把 loading 渲染成 `work.artifact.empty`。

## RED

```text
bun --cwd packages/app test:unit:file src/pages/work-artifact-extract.test.ts
SyntaxError: Export named 'workArtifactView' not found
```

新增纯函数测试固定优先级：`loading > applied > candidate > empty`。

## GREEN

```text
bun --cwd packages/app test:unit:file src/pages/work-artifact-extract.test.ts src/pages/work-artifact-panel.test.ts
35 pass, 0 fail, 51 expect() calls

bun --cwd packages/app typecheck
rc=0

LINT_BASE_REF=origin/main bun run script/lint-changed.ts
Incremental lint passed
```

## 数据流复查

`useSync().status` → `workArtifactView({ status, hasCandidate, applied })` → `Switch` 渲染 `work-artifact-loading` / `applied` / `candidate` / `empty`。没有新增 resource、没有伪造异步窗口。

## 未做/偏离

loading 骨架使用局部 markup，不新增组件；完整视觉 e2e 因本机 Vite 冷启动超时未取得绿证，登记在 S3/S4c 证据。
