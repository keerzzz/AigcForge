# 全局资产展示实施计划

> 状态：Approved（2026-07-26，五层代码追溯后修正 6 项，详见 §8 审批记录）
> 依据：[Chat PRD v4.5 §9.4](../prd/chat-mode-creation-layer.md)（Approved 2026-07-18）、[M3 实施计划](chat-m3-asset-kind-generalization.md)
> 前置：M2（chat-asset-studio-m2.md）+ M3（AssetKind 框架泛化）均已合并到 main
> 分支：`chat-m4-global-asset-display`（从 main 切出）
> 范围：`packages/app` 纯 UI 改动

---

## 0. 问题

AssetWorkbenchTable 当前只显示 `.aigcfroge/<kind>/` 下的**项目级资产**。系统级运行时数据（server-sync 里的 skill、MCP 配置、命令、agent）在 ChatFeaturePanel 删除后不再可见。用户看到的是「空白技能表格」，但实际上系统有丰富的 skill。

## 1. 目标

在 AssetWorkbenchTable 增加「来源」维度，合并显示**系统级** + **项目级**两类资产，用徽标区分来源，系统资产只读。

## 2. 非目标

- 不做文件夹级资产（三级来源，后续再补）
- 不改写后端/API（纯前端 UI 改动）
- 不改 asset registry / server-sync 写入路径
- 不做跨 kind 合并搜索

## 3. 数据流

```
home.tsx:
  ┌─ SDK list API（chatAssetList）──→ projectAssets (prompt/skill/mcp/command/agent)
  └─ server-sync child store ──────→ systemAssets (skill/mcp/command/agent)
                                      ↓
              systemAssets() 提取 → mergeAssets() 去重合并 → AssetWorkbenchTable
                                            ↑
                                     kindFilter = chatFeature()
```

### 3.1 系统级数据来源（已按代码事实修正）

server-sync child store 形状见 `packages/app/src/context/global-sync/child-store.ts:191-241`、数据加载见 `bootstrap.ts:188-330`。

| kind | server-sync 来源 | 说明 |
|------|-----------------|------|
| **skill** | `data.command.filter(c => c.source === "skill")` | 运行时 skill（`command/index.ts:142-153` 注入 `source: "skill"`） |
| **mcp** | `Object.keys(data.mcp)` | 已配置 MCP 服务器（record keyed by name，非数组；description 留空） |
| **command** | `data.command.filter(c => c.source !== "skill")` | 普通命令 + MCP prompt（`source` 为 optional，含 `undefined`/`"command"`/`"mcp"`，归入 command 属预期） |
| **agent** | `data.agent.filter(a => !a.hidden)` | 已配置 agent（`normalizeAgentList` 不过滤 hidden，需在此过滤） |

**数据门控（关键）**：child store 的 `command` 与 `mcp` 仅在 child 以 `{ mcp: true }` 触碰后才加载（`bootstrap.ts:276,330`、`child-store.ts:302-307` 的 `enableMcp`）；`agent` 随普通 bootstrap 加载。因此 home.tsx 与 mode-surfaces.tsx 必须调 `sync.child(dir, { mcp: true })`，否则 command/mcp 恒为空。

### 3.2 去重规则（审批新增，原计划缺失）

按 `kind + name` 去重，**project 优先**（系统行被同名项目行遮蔽）。

依据：
- M3 legacy migration（`asset-migration.ts`）只做复制不删原文件，`.claude/skills/**/SKILL.md`、`.agents/skills/**/SKILL.md`、`.aigcfroge/command/` 等仍被 runtime 扫描进 `command.list()`，同时迁移副本已进入 `.aigcfroge/<kind>/` 被 SDK list 返回——不去重会双行显示。
- 服务端已有同名遮蔽先例：`command/index.ts:143` `if (commands[item.name]) continue`。
- 跨 kind 同名不冲突（M3 风险 5 结论）：去重键必须含 kind，prompt `fmt` 不遮蔽 skill `fmt`。

## 4. 改动文件

| 文件 | 改动 | 量级 |
|------|------|------|
| `asset-workbench.tsx` | `AssetRow` 加 `origin: "system" \| "project"`；输入项加可选 `origin`（默认 `"project"`） | ~10 行 |
| `asset-workbench.tsx` | 纯逻辑区新增 `systemAssets()` 提取 + `mergeAssets()` 去重合并 + `systemCountFor()` 计数 | ~45 行 |
| `asset-workbench.tsx` | 行渲染 Name 列前加来源**文本 chip**（复用 kind badge 样式，i18n `asset.origin.*`）；[Insert] 仅 `!row.invalid && row.origin !== "system"` 时渲染 | ~12 行 |
| `home.tsx` | `chatCtx().sync.child(dir, { mcp: true })` 取系统数据，`createMemo` 合并后传入表格 | ~15 行 |
| `mode-surfaces.tsx` | `useChatFeatureData` 改 `{ mcp: true }`；`kindCounts` 带 project name 集合；`countFor` = 项目数 + `systemCountFor` | ~25 行 |
| `i18n/en.ts + zh.ts` | `asset.origin.system`, `asset.origin.project` | 4 行 |
| `asset-workbench.test.ts` | Step 1-3 红测试（co-located，对齐现有 strategy A 纯函数测试） | ~70 行 |

**不改**：core、aigcfroge、schema、sdk — 纯 UI 改动。

**设计裁定（DESIGN.md Icon System）**：来源徽标不用 emoji（📦/📁），用与 kind badge 同款文本 chip（`rounded-[3px] bg-v2-background-bg-layer-04` + i18n 文案）。i18n 只加 en/zh 与 `promptAsset.*` 现行债务一致（`parity.test.ts` 仅守护 unseen session keys，不阻断）。

## 5. 实施步骤（TDD）

每步严格 红 → 绿 → 验证（`bun --cwd packages/app test --timeout 30000` + `bun --cwd packages/app typecheck`），验证通过才进入下一步。测试 co-located 于 `asset-workbench.test.ts`，对齐现有 `bun:test` + 纯函数风格。

### Step 1：AssetRow 加 origin 字段 + 行渲染来源徽标

**红**（`asset-workbench.test.ts` 新增）：

```ts
describe("buildRows origin", () => {
  test("defaults origin to project when input omits it", () => {
    const rows = buildRows([asset()], [])
    expect(rows[0].origin).toBe("project")
  })

  test("carries system origin from input", () => {
    const rows = buildRows([systemAsset()], [])
    expect(rows[0]).toMatchObject({ name: "fmt", origin: "system", invalid: false })
  })

  test("invalid rows are always project origin", () => {
    const rows = buildRows([], [invalid()])
    expect(rows[0].origin).toBe("project")
  })
})
```

**绿**：
- `AssetOrigin = "system" | "project"`；`AssetRow.origin: AssetOrigin`
- `buildRows` 的 `assets` 输入项类型加 `origin?: AssetOrigin`（缺省 `"project"`）；invalid 行恒 `"project"`
- 行渲染 Name 列名前加来源文本 chip（i18n `asset.origin.system` / `asset.origin.project`）
- [Insert] 渲染条件改为 `!row.invalid && row.origin !== "system"`
- **禁止**给系统行打 `data-invalid`（invalid 语义 = 解析失败，会影响 sortRows 排序与红色错误徽标）

**重构**：无接口破坏（`origin` 可选，现有调用方零改动）。

### Step 2：系统数据提取 + 去重合并 + home.tsx 接入

**红**：

```ts
describe("systemAssets", () => {
  test("splits command list into skill and command kinds", () => {
    const items = systemAssets({ commands: [cmd({ name: "fmt", source: "skill" }), cmd({ name: "run" })], agents: [], mcp: {} })
    expect(items).toEqual([
      { kind: "skill", name: "fmt", description: "" },
      { kind: "command", name: "run", description: "" },
    ])
  })

  test("maps mcp record keys to mcp assets and skips hidden agents", () => {
    const items = systemAssets({ commands: [], agents: [agent({ name: "build" }), agent({ name: "internal", hidden: true })], mcp: { github: {} } })
    expect(items).toEqual([
      { kind: "mcp", name: "github", description: "" },
      { kind: "agent", name: "build", description: "" },
    ])
  })
})

describe("mergeAssets", () => {
  test("appends system rows with system origin", () => {
    const merged = mergeAssets([asset()], [{ kind: "skill", name: "fmt" }])
    expect(merged).toHaveLength(2)
    expect(merged[1]).toMatchObject({ kind: "skill", name: "fmt", origin: "system" })
  })

  test("dedups by kind+name, project wins", () => {
    const merged = mergeAssets([asset({ kind: "skill", name: "fmt" })], [{ kind: "skill", name: "fmt" }])
    expect(merged).toHaveLength(1)
    expect(merged[0].origin).toBe("project")
  })

  test("same name in different kinds is not a duplicate", () => {
    const merged = mergeAssets([asset({ kind: "prompt", name: "fmt" })], [{ kind: "skill", name: "fmt" }])
    expect(merged).toHaveLength(2)
  })
})
```

**绿**：
- `asset-workbench.tsx` 纯逻辑区新增：
  - `SystemAsset = { kind: AssetKindId; name: string; description?: string }`
  - `systemAssets({ commands, agents, mcp })`：按 §3.1 提取（command 二分、mcp 取 key、agent 滤 hidden）
  - `mergeAssets(project, system)`：project 项标 `origin: "project"`（保留原值），system 项补 `origin: "system"` 并合成 `relativePath = name`、`revision = ""`；按 `kind\0name` 去重，project 优先
- `home.tsx`：
  - `createMemo` 取 `chatCtx()?.sync.child(dir, { mcp: true })[0]`（与 `chatDirSdk` 同 ctx，保证同 server）
  - 合并 memo：`mergeAssets(chatAssetList()?.assets ?? [], systemAssets({ commands: data?.command ?? [], agents: data?.agent ?? [], mcp: data?.mcp ?? {} }))`
  - `AssetWorkbenchTable` 的 `assets` 改传合并结果；`invalid` 不变（系统数据无 invalid 概念）

**重构**：无。

### Step 3：功能树计数合并两种来源

**红**：

```ts
describe("systemCountFor", () => {
  const system = [
    { kind: "skill", name: "fmt" },
    { kind: "skill", name: "lint" },
    { kind: "command", name: "run" },
  ] as const

  test("counts system items of the given kind", () => {
    expect(systemCountFor(system, "skill", new Set())).toBe(2)
  })

  test("excludes names shadowed by project assets", () => {
    expect(systemCountFor(system, "skill", new Set(["fmt"]))).toBe(1)
  })

  test("returns 0 for kinds without system items", () => {
    expect(systemCountFor(system, "workflow", new Set())).toBe(0)
  })
})
```

**绿**：
- `asset-workbench.tsx` 新增 `systemCountFor(system, kind, projectNames)`
- `mode-surfaces.tsx`：
  - `useChatFeatureData` 的 `child(current)` 改 `child(current, { mcp: true })`
  - `kindCounts` resource 返回值加 `names: Record<kind, Set<string>>`（project name 集合，供去重）
  - `countFor(feature)` = 项目数 + `systemCountFor(systemAssets(...), feature, names[feature])`，> 0 才显示

**重构**：`systemAssets` 在表格合并与侧栏计数间复用，单一提取逻辑不复制。

### Step 4：验证

```bash
bun --cwd packages/app typecheck
bun --cwd packages/app test --timeout 30000
bun run lint
```

## 6. 验收标准

- [x] AssetWorkbenchTable 每行显示来源 chip（系统 / 项目，i18n 文案）
- [x] 系统行无 [Insert] 按钮，且不携带 `data-invalid` / 红色错误徽标（当前表格无 [Edit]/[Delete]，不涉及）
- [x] 功能树计数 = 项目级 + 系统级（按 kind+name 去重后）
- [x] 表格行与功能树计数一致（同一 `systemAssets` + 去重规则）
- [x] M3 legacy 迁移源（`.claude/skills` 等）不产生重复行
- [x] kind filter 切换后两种来源均按 kind 过滤
- [x] `bun --cwd packages/app typecheck` 通过（2026-07-26 验证）
- [x] `bun --cwd packages/app test --timeout 30000` 通过（465 + 3 virtualizer，2026-07-26 验证）
- [x] `bun run lint` 通过（0 errors，2026-07-26 验证）

## 7. 已排除（后续考虑）

- 系统行的搜索高亮
- 点击系统行展开详情（当前系统行不可交互）
- 三级来源：「文件夹级」（`.aigcfroge/<kind>/subdir/`）
- 按来源独立筛选 Tab
- MCP prompt（`source: "mcp"`）从 command 拆出独立归类（当前归入 command）

## 8. 审批记录

### 2026-07-26：五层代码追溯，6 项修正后 Approved

**追溯路径**：
- L5 `asset-workbench.tsx` → `buildRows(assets, invalid)` 双参签名，`AssetRow` 无 `origin`；测试 co-located（strategy A 纯函数 + `bun:test`）
- L5 `home.tsx:344-372` → `chatAssetList` 并发取 5 kind SDK list，合并 `assets`/`invalid` 传入表格
- L5 `mode-surfaces.tsx:173-194` → `kindCounts` 取 5 kind SDK list 计数；`useChatFeatureData` 用 `child(current)` 未开 mcp
- L4 SDK `types.gen.ts` → `Command.source?: "command" | "mcp" | "skill"`（optional）；`Agent.hidden?`；`mcp.status()` 为 record
- L3 `command/index.ts:142-153` → skill 以 `source: "skill"` 注入命令表，`if (commands[item.name]) continue` 同名遮蔽先例
- L3 `skill/index.ts:24` + `config/paths.ts:23-41` → runtime 扫描 `{skill,skills}/**/SKILL.md`（含项目 `.aigcfroge` 上扫）；M3 资产为 `<name>.md` 不匹配该 pattern，但 legacy 源仍双轨
- L5 `child-store.ts:191-241` + `bootstrap.ts:188-330` → `command`/`mcp` 数据由 `{ mcp: true }` 门控加载，`agent` 随 bootstrap

**发现的问题及修正**：

| # | 问题 | 严重程度 | 修正 |
|---|------|---------|------|
| 1 | 原计划无去重规则：M3 migration 不删 legacy 原文件，runtime 仍扫描 → 同 asset 双行 | 🔴 阻断 | §3.2 新增 kind+name 去重，project 优先（对齐服务端遮蔽先例） |
| 2 | `command`/`mcp` 数据需 `{ mcp: true }` 门控加载，原计划直接读会恒空 | 🔴 阻断 | §3.1 门控说明；home/mode-surfaces 改 `child(dir, { mcp: true })` |
| 3 | 红测试引用不存在的 `buildWithOrigin`；`mergeAssets` 签名两处不一致 | 🟡 TDD | §5 全部改为真实接口（`buildRows` 扩展 + `systemAssets`/`mergeAssets`/`systemCountFor`） |
| 4 | 「系统行 `data-invalid`」语义错误：会触发错误排序与红色错误徽标 | 🟡 正确性 | 系统行用 `origin` 判定，不碰 `invalid`；验收标准同步修正 |
| 5 | 📦/📁 emoji 徽标违反 DESIGN.md Icon System（v2 内联 SVG 字典，无 emoji） | 🟡 设计 | 改为 kind badge 同款文本 chip + i18n `asset.origin.*`（en/zh，沿用 promptAsset.* 债务约定） |
| 6 | 类型细节缺失：`Command.source` optional 含 `"mcp"`；`data.mcp` 是 record 非数组；agent 需滤 `hidden` | 🟡 类型 | §3.1 表格逐条注明 |
