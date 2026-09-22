# S3：Work Workflow Tab 证据

- Slice：S3 `WorkflowRuntimePanel` 挂进 Work
- 结论：实现完成；e2e 用例已落盘，但本机冷启动 Vite 超时导致本轮 e2e 未取得绿证。

## RED

```text
bun --cwd packages/app test:unit:file src/pages/session/workflow-runtime-panel.test.tsx
FAIL: is mounted by the custom and work session panels
原因：work-artifact-panel.tsx 中没有 <WorkflowRuntimePanel>
```

## GREEN

```text
bun --cwd packages/app test:unit:file src/pages/session/workflow-runtime-panel.test.tsx
2 pass, 0 fail

bun --cwd packages/app test:unit:file src/pages/session/workflow-runtime-model.test.ts src/pages/work-artifact-panel.test.ts
16 pass, 0 fail, 76 expect() calls

bun --cwd packages/app typecheck
rc=0

LINT_BASE_REF=origin/main bun run script/lint-changed.ts
Incremental lint passed
```

## 行为契约

- `WorkSessionPanel` Tab 白名单变为 `context | artifact | workflow`，双处校验收敛为一个 `isWorkTab`。
- workflow Tab 只在选中时挂载 `<WorkflowRuntimePanel sessionID={params.id} />`，不引入 wrapper 组件，不改变 panel 接口。
- 新 e2e 用例 `e2e/regression/workflow-runtime.spec.ts`：
  - 复用 custom runtime 测试的 mock 与断言；
  - 把 session mode 切到 `work`；
  - 点击 workflow Tab，断言 7 条 step 与 running badge。

## e2e 未验证项

```text
bun --cwd packages/app test:e2e e2e/regression/workflow-runtime.spec.ts --project=chromium
结果：Vite 冷启动 69s 后端口 ready，但 global setup 的 page.goto 在 180s 内 modules=0，
随后连续路由同样超时；已中止，未产生本用例的通过结论。

这是当前 NTFS 工作树的开发服务器启动/编译性能问题，不是 S3 的行为结论。
```

## 数据流复查

`useSessionLayout().params.id` → `WorkSessionPanel` → `WorkflowRuntimePanel(sessionID)` → `createWorkflowRuntimeAdapter(sdk().client)` → `GET /session/:id/workflow`。Work 和 Custom 复用同一个 adapter/组件，没有新增请求路径。
