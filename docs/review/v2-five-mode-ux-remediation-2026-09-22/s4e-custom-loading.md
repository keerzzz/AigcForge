# S4e：Custom loading skeleton 证据

- Slice：S4e
- 结论：Custom 侧栏 loading 不再落入各分类空态，改为复用 `SessionSkeleton`；partial/error 保留错误横幅，只有 ready 且为空才显示 empty。

## RED

新增 reuse 契约测试 `custom-sidebar.test.ts`，固定：
- `status() !== "loading"` 才渲染列表内容；
- loading 使用既有 `<SessionSkeleton count={6} />`。

## GREEN

```text
bun --cwd packages/app test:unit:file src/components/custom/custom-sidebar.test.ts
1 pass, 0 fail

bun --cwd packages/app test:unit:file src/components/asset-list-status.test.ts src/components/custom/custom-asset-catalog.test.ts
15 pass, 0 fail

bun --cwd packages/app typecheck
rc=0

LINT_BASE_REF=origin/main bun run script/lint-changed.ts
Incremental lint passed
```

## 数据流复查

`custom-sidebar.tsx` 已有的 `catalogStatus` → `status()` → loading 分支复用 `SessionSkeleton`；`partial/error` 仍由顶端 `AssetLoadError` 反馈。没有新增数据源或状态。

## 未做/偏离

Render 级 e2e 受本机 Vite 冷启动超时限制，当前以 source reuse contract + 状态 fold 单测验证；后续可在正常 CI runner 上补跑 Custom 场景。
