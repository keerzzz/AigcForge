# S8a：AssetLoadError alert 证据

- Slice：S8a
- 结论：资产加载失败横幅使用 `role="alert"`。

## RED

```text
bun --cwd packages/app test:unit:file src/components/asset-load-error.test.tsx
Expected role=alert, received null
```

真实 DOM 测试使用 `PlatformProvider` + `LanguageProvider` 挂载组件。

## GREEN

```text
bun --cwd packages/app test:unit:file src/components/asset-load-error.test.tsx
1 pass, 0 fail

bun --cwd packages/app typecheck
rc=0

LINT_BASE_REF=origin/main bun run script/lint-changed.ts
Incremental lint passed
```

## 未做/偏离

未添加其他 ARIA；现有按钮与文案节点保持原样。
