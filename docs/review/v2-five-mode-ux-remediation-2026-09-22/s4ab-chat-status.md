# S4a/S4b：Chat 资产三态证据

- Slice：S4a 共享状态 fold + S4b Chat 资产列表
- 结论：Chat 首次/未 settle 读取显示骨架，不再显示 `promptAsset.panel.noAssets`；partial/error 由既有横幅表达，不伪造空态。

## RED

```text
bun --cwd packages/app test:unit:file src/components/asset-list-status.test.ts
Cannot find module './asset-list-status'
```

共享 fold 的测试先覆盖：

- `failed === undefined` → loading
- refetch 时已有数据 → ready，避免闪骨架
- 部分失败 → partial；全部失败 → error
- 只有 ready 且 rows=0 才能显示空态

## GREEN

```text
bun --cwd packages/app test:unit:file src/components/asset-list-status.test.ts src/components/chat/asset-workbench.test.ts src/components/custom/custom-asset-catalog.test.ts
45 pass, 0 fail, 76 expect() calls

bun --cwd packages/app typecheck
rc=0

LINT_BASE_REF=origin/main bun run script/lint-changed.ts
Incremental lint passed
```

## 数据流复查

`ChatAssetsProvider.list` + `PROJECT_ASSET_LIST_COUNT` → `assetListStatus` → `ModeWorkspaceAssetContext.chatAssetStatus` → `ChatAssetWorkbenchMain` → `AssetWorkbenchTable.state` → loading 骨架 / rows / empty。Custom 的 `catalogStatus` 与 `showsEmptyState` 现在委托同一 fold，不新增平行真源。

## 未做/偏离

- 没有新增请求状态；loading 直接读取现有 `createResource`。
- 完整 e2e 因本机 Vite 冷启动超时未取得绿证；行为由纯 fold 单测覆盖，组件挂载链由 typecheck 覆盖。
