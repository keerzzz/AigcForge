# 全局资产展示实施计划

> 状态：Draft（待审批）
> 依据：[Chat PRD v4.5 §9.4](../prd/chat-mode-creation-layer.md)（Approved 2026-07-18）、[M3 实施计划](chat-m3-asset-kind-generalization.md)
> 前置：M2（chat-asset-studio-m2.md）+ M3（AssetKind 框架泛化）均已合并到 main
> 分支：`chat-m4-global-asset-display`（从 main 切出）
> 范围：`packages/app` 纯 UI 改动

---

## 0. 问题

AssetWorkbenchTable 当前只显示 `.aigcfroge/<kind>/` 下的**项目级资产**。系统级运行时数据（server-sync 里的 96 个 skill、MCP 配置、命令、agent）在 ChatFeaturePanel 删除后不再可见。用户看到的是「空白技能表格」，但实际上系统有丰富的 skill。

## 1. 目标

在 AssetWorkbenchTable 增加「来源」维度，合并显示**系统级** + **项目级**两类资产，用徽标区分来源，系统资产只读。

## 2. 非目标

- 不做文件夹级资产（三级来源，后续再补）
- 不改写后端/API（纯前端 UI 改动）
- 不改 asset registry / server-sync 写入路径
- 不做跨 kind 合并搜索

## 3. 数据流

```
home.tsx fetchAllKinds:
  ┌─ SDK list API ──→ projectAssets (prompt/skill/mcp/command/agent)
  └─ server-sync  ──→ systemAssets (skill/mcp/command/agent)
                       ↓
              mergeAssets(kindFilter) → AssetWorkbenchTable
                                            ↑
                                       kindFilter = chatFeature()
```

### 3.1 系统级数据来源

| kind | server-sync 来源 | 说明 |
|------|-----------------|------|
| **skill** | `data.command.filter(c => c.source === "skill")` | 系统 skill（96 个） |
| **mcp** | `data.mcp` | 已配置的 MCP 服务器 |
| **command** | `data.command.filter(c => c.source !== "skill")` | 普通命令 |
| **agent** | `data.agent` | 已配置的 agent |

## 4. 改动文件

| 文件 | 改动 | 量级 |
|------|------|------|
| `asset-workbench.tsx` | `AssetRow` 加 `origin: "system" \| "project"` | ~5 行 |
| `asset-workbench.tsx` | 行渲染加来源徽标（系统→📦，项目→📁）+ hide [Insert] for system | ~15 行 |
| `asset-workbench.tsx` | `buildRows` 改接收合并后的 `(AssetRow[])` 而非双源分离 | ~3 行 |
| `home.tsx` | `fetchAllKinds` 加 server-sync 数据合并 + `mergeAssets` | ~50 行 |
| `mode-surfaces.tsx` | ChatFeatureSidebar `countFor` 加系统级计数合并 | ~15 行 |
| `i18n/en.ts + zh.ts` | `asset.origin.system`, `asset.origin.project` | 4 行 |

**不改**：core、aigcfroge、schema、sdk — 纯 UI 改动。

## 5. 实施步骤（TDD）

### Step 1：AssetRow 加 origin 字段 + 行渲染来源徽标

**红**：
```ts
// asset-workbench.test.ts
test("buildRows with system flag sets origin correctly", () => {
  const rows = buildWithOrigin([], [{ kind: "skill", name: "fmt", source: "skill", ... }], "system")
  expect(rows[0].origin).toBe("system")
})
test("buildRows with project flag sets origin correctly", () => {
  const rows = buildWithOrigin([asset()], [], "project")
  expect(rows[0].origin).toBe("project")
})
```

**绿**：
- `AssetRow.origin: "system" | "project"`
- `buildRows` 接受可选的 `origin` 参数
- 行渲染在 Name 列前加来源徽标（`📦` / `📁`）
- 系统行 `data-invalid` + 不渲染 [Insert] 按钮

**重构**：`buildRows` 统一调用方接口。

### Step 2：Home fetchAllKinds 合并系统级数据

**红**：
```ts
// 验证 server-sync 数据成功合并到 assetRows
test("mergeAssets filters by kind", () => {
  const merged = mergeAssets({ kind: "skill", project: [], system: [{ name: "fmt", ... }] })
  expect(merged).toHaveLength(1)
})
```

**绿**：
- `fetchAllKinds` 读取 `useChatDirectory` 的 `directory` → `useServerSync().child(directory)`
- 从 `data.command` 提取 skill 和 command
- 从 `data.mcp` 提取 MCP
- 从 `data.agent` 提取 agent
- 合并到 assetRow 数组，标注 `origin`
- AssetWorkbenchTable 改为接收统一数组

### Step 3：功能树计数合并两种来源

**绿**：
- ChatFeatureSidebar `countFor` 加 server-sync 数据长度
- 系统级 + 项目级 = 总计数

### Step 4：验证

```bash
bun --cwd packages/app typecheck
bun --cwd packages/app test
bun run lint
```

## 6. 验收标准

- [ ] AssetWorkbenchTable 每行显示来源徽标（📦 系统 / 📁 项目）
- [ ] 系统行无 [Insert]/[Edit]/[Delete] 按钮
- [ ] 功能树计数 = 项目级 + 系统级
- [ ] kind filter 切换后两种来源均按 kind 过滤
- [ ] `bun --cwd packages/app typecheck` 通过
- [ ] `bun --cwd packages/app test` 通过
- [ ] `bun run lint` 通过

## 7. 已排除（后续考虑）

- 系统行的搜索高亮
- 点击系统行展开详情（当前系统行不可交互）
- 三级来源：「文件夹级」（`.aigcfroge/<kind>/subdir/`）
- 按来源独立筛选 Tab
