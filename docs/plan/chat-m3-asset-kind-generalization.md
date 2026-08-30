# AssetKind 框架泛化 + 全量开闸实施计划

> 状态：Approved（2026-07-25，五层代码追溯 + 6 风险修正后）
> 依据：[Chat PRD v4.5 §8.1](../prd/chat-mode-creation-layer.md)（Approved 2026-07-18）、[CLAUDE.md](../../CLAUDE.md)、[AGENTS.md](../../AGENTS.md)、[ARCHITECTURE.md](../../ARCHITECTURE.md)
> 审查轨迹：schema → core → aigcfroge → sdk → app 五层追溯，修正 6 项风险（详见 §12）
> 前置：[M2 实施计划](chat-asset-studio-m2.md)（Step 0-6 已全部闭环，chat-m1-closure 分支）
> 范围：`packages/schema` + `packages/core` + `packages/aigcfroge` + `packages/sdk/js` + `packages/app`
> 分支：`chat-m3-asset-kind`（从 chat-m1-closure 切出，commit `a1d05bda1`）
> **本文件为自包含实施手册，可供其他 agent 独立执行。**

---

## 0. 背景与目标

M2 只完成了 `prompt`（提示词）单一资产类型的闭环（schema/registry/CRUD/Insert/UI）。其他类型（skill/mcp/command/agent）在 UI 上通过 ChatFeaturePanel 展示了运行时列表（server-sync 数据），但**不具备资产的创建/管理能力**。

M3 目标：

1. **框架泛化**：定义 `AssetKindDef`, `AssetKindRegistry`, `AssetError` 等通用层，使新类型开闸只需注册定义
2. **全量开闸**：skill / mcp / command / agent 四种类型全部变成真资产（有文件、有注册表、可创建/遍历/插入）
3. **UI 简化**：ChatFeaturePanel 在 Phase 6（全部 kind 开闸后）自然消亡，所有类型走 AssetWorkbenchTable filter
4. **数据迁移**：每个 kind 的 migration 前置到其 UI 切换之前（Phase 2B/3B/4B/5B）

---

## 1. 架构全景

```
┌─ schema 层（公共契约）─────────────────────────────────────────┐
│  asset.ts                                                    │
│  AssetKindId (Literal: prompt|skill|mcp|command|agent|...)   │
│  AssetSummary (kind, name, description, relativePath, revision)│
│  AssetError (统一错误面: unknown_kind 等，不强迁现有错误)       │
├───────────────────────────────────────────────────────────────┤
│  per-kind: prompt-asset.ts, skill-asset.ts, mcp-asset.ts...  │
│  Summary, Info, Frontmatter, InvalidEntry                    │
└───────────────────────┬───────────────────────────────────────┘
                        ↓
┌─ core 层（业务逻辑）───────────────────────────────────────────┐
│  asset-kind.ts                                               │
│  AssetKindDef<K, SummarySchema, InfoSchema>                  │
│  AssetKindRegistry.Service (register/resolve/list)           │
│  AssetSerializer<K> 抽象                                      │
├───────────────────────────────────────────────────────────────┤
│  per-kind: prompt-asset.ts, skill-asset.ts, mcp-asset.ts...  │
│  loadDir + Service + layer（每类独立，照 prompt 模板复制）      │
│  XxxAssetService: propose/apply/delete（事务层，per-kind）     │
└───────────────────────┬───────────────────────────────────────┘
                        ↓
┌─ aigcfroge 层（HTTP API + 工具）───────────────────────────────┐
│  per-kind HttpApiGroup: /prompt-asset, /skill-asset, etc.    │
│  每组 4 个端点: list, content, apply, delete                   │
│  注册到 InstanceHttpApi                                       │
│  handlers: prompt-asset.ts, skill-asset.ts, mcp-asset.ts...  │
│  per-kind toApplyError/toDeleteError（保留分散错误类）          │
└───────────────────────┬───────────────────────────────────────┘
                        ↓
┌─ sdk/js 层（生成代码）─────────────────────────────────────────┐
│  每类生成独立 client 类: PromptAsset, SkillAsset, MCPAsset... │
│  方法: list(), content({path}), apply(), delete()             │
└───────────────────────┬───────────────────────────────────────┘
                        ↓
┌─ app 层（前端）────────────────────────────────────────────────┐
│  asset-workbench.tsx                                          │
│  AssetKind = AssetKindId（泛化: all|prompt→all|prompt|...）   │
│  AssetRow.kind = AssetKind（不再是 hardcoded "prompt"）       │
│  buildRows 接收泛型 Summary[] 而非 PromptAssetSummary[]        │
│  filterByKind 用泛型 AssetKind                                │
│                                                               │
│  home.tsx                                                     │
│  fetchAllKinds() = 逐个 kind 调 SDK.list + 合并 results        │
│                                                               │
│  mode-surfaces.tsx                                            │
│  功能树点击 ↦ setChatFeature(kind) ↦ setKindFilter(kind)      │
│  ChatFeaturePanel: Phase 2-5 期间仅未开闸 kind 保留           │
│  ChatFeaturePanel: Phase 6 完全删除                            │
└────────────────────────────────────────────────────────────────┘
```

**关键设计决策**（与 PRD §8.1.1 一致）：

1. 各类型保留现有分散错误类（PromptAsset 的 NotFoundError/NameConflictError 等，Effect tagged-union 惯用法）
2. `AssetError` 仅作框架层 catch-all（`unknown_kind` 等），不强迁现有实现
3. `AssetKindDef.S/I` 用 `Schema.Schema.Any` 上界（避免 `any` 逃逸）
4. prompt 类型现有实现**不迁移**——框架新增并排共存，prompt 作为首个 kind 注册到 `AssetKindRegistry`
5. `template` 仅存在于 `Info` 层（非 `Summary`/`Frontmatter`）

---

## 2. Phase 划分（TDD 每步，已按审查修正）

| Phase  | 内容                                                                                                                       | 测试所在包              | 包                        | 依赖 |
| ------ | -------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ------------------------- | ---- |
| **1A** | 框架契约：AssetKindId + AssetSummary + AssetError                                                                          | `packages/schema/test/` | schema                    | —    |
| **1B** | AssetKindRegistry + AssetSerializer 接口                                                                                   | `packages/core/test/`   | core                      | 1A   |
| **1C** | PromptAsset 接入框架 + AssetRow 类型泛化                                                                                   | `packages/core/test/`   | core + app                | 1B   |
| **2A** | SkillAsset schema + core registry + HTTP handler + API group                                                               | `packages/core/test/`   | schema + core + aigcfroge | 1C   |
| **2B** | **SkillAsset 数据迁移**（server-sync skill → .aigcfroge/skills/ 文件落地）                                                 | `packages/core/test/`   | core                      | 2A   |
| **2C** | SkillAsset SDK 重新生成 + UI 切换（功能树 skill → AssetWorkbench filter，保留 skill 的 ChatFeaturePanel 降级为未开闸占位） | —                       | sdk/js + app              | 2B   |
| **3A** | MCPAsset schema + core + HTTP                                                                                              | —                       | schema + core + aigcfroge | 2C   |
| **3B** | **MCPAsset 数据迁移**                                                                                                      | —                       | core                      | 3A   |
| **3C** | MCPAsset SDK + UI 切换                                                                                                     | —                       | sdk/js + app              | 3B   |
| **4A** | CommandAsset schema + core + HTTP                                                                                          | —                       | 同上                      | 3C   |
| **4B** | **CommandAsset 数据迁移**                                                                                                  | —                       | core                      | 4A   |
| **4C** | CommandAsset SDK + UI 切换                                                                                                 | —                       | sdk/js + app              | 4B   |
| **5A** | AgentAsset schema + core + HTTP                                                                                            | —                       | 同上                      | 4C   |
| **5B** | **AgentAsset 数据迁移**                                                                                                    | —                       | core                      | 5A   |
| **5C** | AgentAsset SDK + UI 切换                                                                                                   | —                       | sdk/js + app              | 5B   |
| **6**  | UI 收尾：删 ChatFeaturePanel（全部 4 kind 已开闸），Insert 通用化                                                          | `packages/app/test/`    | app                       | 5C   |

**每 Phase 验证关**：

- `bun --cwd packages/<name> typecheck` + `bun --cwd packages/<name> test --timeout 30000` + `bun run lint`
- 跨 kind 同名不冲突测试（Phase 2A-5A 每个都加）
- 回归测试：现有 PromptAsset API 零回归

---

## 3. Phase 1A：框架契约定义（packages/schema）

### 3.1 新增文件

| 文件                                 | 操作     | 说明                                  |
| ------------------------------------ | -------- | ------------------------------------- |
| `packages/schema/src/asset.ts`       | **新增** | AssetKindId, AssetSummary, AssetError |
| `packages/schema/test/asset.test.ts` | **新增** | Schema 校验测试                       |

### 3.2 AssetKindId + AssetSummary + AssetError

参照 PRD §8.1.1 的签名级草案。关键约束：

- `AssetSummary` 不含 `template`（template 是 per-kind Info 层字段）
- `AssetError.reason` 枚举含 `unknown_kind`，用于框架层 catch-all
- 不替换现有 `PromptAsset.Summary` 等（并排共存）

```ts
// packages/schema/src/asset.ts

import { Schema } from "effect"

export const AssetKindId = Schema.Literal("prompt", "skill", "mcp", "command", "agent", "workflow")
export type AssetKindId = typeof AssetKindId.Type

export class AssetSummary extends Schema.Class<AssetSummary>("Asset.Summary")({
  kind: AssetKindId,
  name: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(80)),
  description: Schema.String.pipe(Schema.maxLength(300)),
  relativePath: Schema.String,
  revision: Schema.String,
}) {}

export class AssetError extends Schema.TaggedErrorClass<AssetError>()("AssetError", {
  kind: Schema.String,
  reason: Schema.Literal(
    "unknown_kind",
    "invalid_candidate",
    "path_escape",
    "owner_root_escape",
    "name_conflict",
    "path_conflict",
    "stale_revision",
    "overwrite_confirmation_required",
    "delete_confirmation_required",
    "permission_denied",
    "write_failed",
    "reload_failed",
    "readback_mismatch",
    "rollback_failed",
    "concurrent_modification",
  ),
  message: Schema.String,
}) {}
```

### 3.3 测试（packages/schema/test/asset.test.ts）

```ts
import { Schema } from "effect"
import { describe, expect, test } from "bun:test"
import { Asset } from "@aigcfroge/schema/asset"

describe("AssetSummary", () => {
  test("validates minimal summary", () => {
    const s = Schema.decodeUnknownSync(Asset.Summary)({
      kind: "prompt",
      name: "test",
      description: "",
      relativePath: "test.md",
      revision: "a".repeat(64),
    })
    expect(s.kind).toBe("prompt")
  })

  test("rejects unknown kind", () => {
    expect(() =>
      Schema.decodeUnknownSync(Asset.Summary)({
        kind: "bogus",
        name: "x",
        description: "",
        relativePath: "x.md",
        revision: "a".repeat(64),
      }),
    ).toThrow()
  })
})

describe("AssetError", () => {
  test("creates error with tagged reason", () => {
    const err = new Asset.Error({ kind: "mcp", reason: "unknown_kind", message: "Not registered" })
    expect(err.reason).toBe("unknown_kind")
  })
})
```

### 3.4 更新 schema export

```ts
// packages/schema/src/index.ts 加：
export { Asset } from "./asset"
```

### 3.5 验证

```bash
bun --cwd packages/schema test
bun --cwd packages/schema typecheck
```

---

## 4. Phase 1B：AssetKindRegistry（packages/core）

### 4.1 新增文件

| 文件                                    | 操作     |
| --------------------------------------- | -------- |
| `packages/core/src/asset-kind.ts`       | **新增** |
| `packages/core/test/asset-kind.test.ts` | **新增** |

### 4.2 AssetKindDef 接口

与 PRD §8.1.1 对齐。注：S/I 上界用 `Schema.Schema.Any`。

```ts
// packages/core/src/asset-kind.ts

import { Context, Effect, Layer, Schema } from "effect"
import { AssetError, AssetKindId } from "@aigcfroge/schema/asset"

// --- AssetKindDef ---

export interface AssetKindDef<K extends AssetKindId = AssetKindId> {
  readonly id: K
  readonly schema: {
    readonly Summary: Schema.Schema.Any
    readonly Info: Schema.Schema.Any
  }
  readonly ownerDir: string
}

// --- AssetKindRegistry ---

export interface AssetKindRegistryInterface {
  readonly register: (def: AssetKindDef) => Effect.Effect<void, AssetError>
  readonly resolve: (kind: string) => Effect.Effect<AssetKindDef, AssetError>
  readonly list: () => ReadonlyArray<AssetKindId>
}

export class AssetKindRegistryService extends Context.Service<AssetKindRegistryService, AssetKindRegistryInterface>()(
  "@aigcfroge/v2/AssetKindRegistry",
) {}

// --- Layer ---

export const layer = Layer.effect(
  AssetKindRegistryService,
  Effect.gen(function* () {
    const kinds = new Map<string, AssetKindDef>()

    const register = Effect.fn("AssetKindRegistry.register")(function* (def: AssetKindDef) {
      kinds.set(def.id, def)
    })

    const resolve = Effect.fn("AssetKindRegistry.resolve")(function* (kind: string) {
      const def = kinds.get(kind)
      if (!def) return yield* new AssetError({ kind, reason: "unknown_kind", message: `Unknown asset kind: ${kind}` })
      return def
    })

    const list = () => Array.from(kinds.keys()) as AssetKindId[]

    return AssetKindRegistryService.of({ register, resolve, list } satisfies AssetKindRegistryInterface)
  }),
)
```

### 4.3 测试

```ts
import { Effect } from "effect"
import { describe, it } from "bun:test"
import { testEffect } from "@aigcfroge/test/lib/effect"
import { AssetKindRegistryService } from "@aigcfroge/core/asset-kind"

describe("AssetKindRegistry", () => {
  it.effect("registers and resolves a kind", () =>
    Effect.gen(function* () {
      const reg = yield* AssetKindRegistryService
      yield* reg.register({
        id: "skill",
        schema: { Summary: null as any, Info: null as any },
        ownerDir: ".aigcfroge/skills",
      })
      const d = yield* reg.resolve("skill")
      expect(d.id).toBe("skill")
    }),
  )

  it.effect("fails with unknown_kind for unregistered", () =>
    Effect.gen(function* () {
      const reg = yield* AssetKindRegistryService
      const result = yield* reg.resolve("bogus").pipe(Effect.flip)
      expect(result).toBeInstanceOf(Error)
    }),
  )

  it.effect("lists registered kinds", () =>
    Effect.gen(function* () {
      const reg = yield* AssetKindRegistryService
      yield* reg.register({
        id: "skill",
        schema: { Summary: null as any, Info: null as any },
        ownerDir: ".aigcfroge/skills",
      })
      expect(reg.list()).toContain("skill")
    }),
  )
})
```

### 4.4 验证

```bash
bun --cwd packages/core test --timeout 30000
bun --cwd packages/core typecheck
```

---

## 5. Phase 1C：PromptAsset 接入框架 + AssetRow 类型泛化

### 5.1 Core 层

| 文件                                  | 操作                                                                  |
| ------------------------------------- | --------------------------------------------------------------------- |
| `packages/core/src/asset-kind.ts`     | 不改（1B 已完成）                                                     |
| `packages/core/src/prompt-asset.ts`   | 不改（PromptAsset 不迁移）                                            |
| `packages/core/src/constants.ts`      | **修改**：加 `SKILLS_DIR`, `MCPS_DIR`, `COMMANDS_DIR`, `AGENTS_DIR`   |
| `packages/core` (new migration layer) | **新增**：PromptAssetProvider 中注册 prompt kind 到 AssetKindRegistry |

### 5.2 注册 PromptAsset

```ts
// 在 server 层的 prompt asset provider 中：
const promptDef: AssetKindDef = {
  id: "prompt",
  schema: { Summary: SchemaPromptAsset.Summary, Info: SchemaPromptAsset.Info },
  ownerDir: PROMPTS_DIR,
}
yield * assetKindRegistry.register(promptDef)
```

### 5.3 AssetRow 类型泛化（app 层）

```ts
// packages/app/src/components/chat/asset-workbench.tsx

// 旧（硬编码）:
export type AssetKind = "all" | "prompt"
export type AssetRow = {
  kind: "prompt"   // ❌ 硬编码
  ...
}

// 新（泛化）:
export type AssetKind = "all" | AssetKindId
export type AssetRow = {
  kind: AssetKindId  // ✅ 泛化
  relativePath: string
  name: string
  description: string
  revision: string
  invalid: boolean
  errorTag?: "parse_error" | "bad_frontmatter" | "name_conflict"
}
```

`filterByKind` 适配新 `AssetKind` 类型，无需改逻辑。

### 5.4 验证

- PromptAsset API 零回归：`bun --cwd packages/aigcfroge test`
- `bun --cwd packages/app typecheck` 通过

---

## 6. Phase 2A-2C-3A-3C-4A-4C-5A-5C：Per-Kind 开闸

**每个 kind 按以下 3 个子 phase 执行，迁移前置到 UI 之前**（风险 1 修正）：

### Phase XA：Schema + Core + HTTP + SDK（新增）

### Phase XB：数据迁移（server-sync → 文件落地）

### Phase XC：UI 切换（功能树 filter 生效）

**⚠️ 关键约束**：

- XB 的迁移是 XC UI 切换的**前提**——先有文件，再切 UI，否则用户看到空表
- ChatFeaturePanel **只在 Phase 6 删除**（风险 4 修正）。Phase 2-5 期间，已开闸 kind 走 AssetWorkbench filter，未开闸 kind 保留 ChatFeaturePanel 占位
- 每个 kind 增加**跨 kind 同名不冲突**测试（风险 5 修正）：skill 的 `my-tool.md` 和 prompt 的 `my-tool.md` 不冲突（不同 ownerDir）

### 6.1 Per-Kind Schema 定义

```ts
// ── SkillAsset（Phase 2A）──
// packages/schema/src/skill-asset.ts

export class SkillFrontmatter extends Schema.Class<SkillFrontmatter>("Skill.Frontmatter")({
  kind: Schema.Literal("skill"),
  name: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(80)),
  description: Schema.String.pipe(Schema.maxLength(300)),
  trigger: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200)),
  source: Schema.String.pipe(Schema.maxLength(5000)),
}) {}

export class SkillInfo extends Schema.Class<SkillInfo>("Skill.Info")({
  kind: Schema.Literal("skill"),
  name: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(80)),
  description: Schema.String.pipe(Schema.maxLength(300)),
  relativePath: Schema.String,
  revision: Schema.String,
  trigger: Schema.String,
  source: Schema.String,
}) {}

// ── MCPAsset（Phase 3A）──
// packages/schema/src/mcp-asset.ts

export class McpFrontmatter extends Schema.Class<McpFrontmatter>("MCP.Frontmatter")({
  kind: Schema.Literal("mcp"),
  name: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(80)),
  description: Schema.String.pipe(Schema.maxLength(300)),
  command: Schema.optional(Schema.String),
  args: Schema.optional(Schema.Array(Schema.String)),
  env: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
}) {}

// ── CommandAsset（Phase 4A）──
// packages/schema/src/command-asset.ts

export class CommandFrontmatter extends Schema.Class<CommandFrontmatter>("Command.Frontmatter")({
  kind: Schema.Literal("command"),
  name: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(80)),
  description: Schema.String.pipe(Schema.maxLength(300)),
  invocation: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200)),
  args: Schema.optional(Schema.String),
  source: Schema.optional(Schema.String.pipe(Schema.maxLength(5000))),
}) {}

// ── AgentAsset（Phase 5A）──
// packages/schema/src/agent-asset.ts

export class AgentFrontmatter extends Schema.Class<AgentFrontmatter>("Agent.Frontmatter")({
  kind: Schema.Literal("agent"),
  name: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(80)),
  description: Schema.String.pipe(Schema.maxLength(300)),
  config: Schema.String.pipe(Schema.maxLength(5000)),
  source: Schema.optional(Schema.String.pipe(Schema.maxLength(5000))),
}) {}
```

### 6.2 Per-Kind Core Registry

**模板**（Phase 2A，后续 Phase 3A-5A 复制并改 kind/ownerDir/schema）：

```ts
// packages/core/src/skill-asset.ts
// 参照 packages/core/src/prompt-asset.ts 的 loadDir + Service + layer 完整复制
// 关键差异:
//   - ownerRoot = path.resolve(location.directory, SKILLS_DIR)  // ".aigcfroge/skills"
//   - frontmatter 用 SchemaSkill.SkillFrontmatter 校验
//   - Info kind = "skill"
//   - 注册到 AssetKindRegistry
```

### 6.3 Per-Kind HTTP Handler + API Group

**模板**（Phase 2A）：

```ts
// packages/aigcfroge/src/server/routes/instance/httpapi/groups/skill-asset.ts
// 参照 groups/prompt-asset.ts 复制
// 关键差异:
//   const root = "/skill-asset"
//   const sessionRoot = "/session/:sessionID/skill-asset"
//   ListQuery/Success/Error 使用 SkillAsset 的 schema

// packages/aigcfroge/src/server/routes/instance/httpapi/handlers/skill-asset.ts
// 参照 handlers/prompt-asset.ts 复制
// 关键差异:
//   - toApplyError/toDeleteError 使用 SkillAssetService 的错误类
//   - HttpApiBuilder.group 引用 HttpApi, "skill-asset"
```

**API group 注册**（修改 `api.ts`）：

```ts
// packages/aigcfroge/src/server/routes/instance/httpapi/api.ts
// 加: import { SkillAssetApiGroup } from "./groups/skill-asset"
// 在 HttpApi.make 的 add 链中加: .add(SkillAssetApi)
```

### 6.4 SDK 重新生成（每 phase XC 之前）

```bash
cd packages/sdk/js && ./script/build.ts
```

### 6.5 Per-Kind 数据迁移（Phase XB，⭐ 前置到 UI 之前）

```ts
// 一次性的迁移逻辑。每个 kind 独立脚本。
// 示例：skill 迁移
async function migrateSkills(directory: string) {
  const skills = await sync.child(directory)[0].command.filter((c) => c.source === "skill")
  for (const skill of skills) {
    const frontmatter = `---\nkind: skill\nname: ${yamlEscape(skill.name)}\ndescription: ""\ntrigger: ${yamlEscape(skill.name)}\nsource: ""\n---\n`
    await fs.writeFile(path.join(directory, ".aigcfroge", "skills", `${skill.name}.md`), frontmatter)
  }
}
```

### 6.6 UI 切换（Phase XC）

每个 kind 开闸后，功能树点击该 kind 时：

- 若 kind 已开闸（AssetKindRegistry.resolve 成功）→ AssetWorkbenchTable filter
- 若 kind 未开闸 → 保留 ChatFeaturePanel（Phase 6 统一删除）

`home.tsx` 的资产 fetch 改为多源调用：

```ts
const [chatAssetList] = createResource(chatDirSdk, async (sdk) => {
  const results = await Promise.all([
    sdk.client.promptAsset.list(),
    // 后续 phase 逐个加:
    // sdk.client.skillAsset.list(),
    // sdk.client.mcpAsset.list(),
    // ...
  ])
  return {
    assets: results.flatMap((r) => r.data?.assets ?? []),
    invalid: results.flatMap((r) => r.data?.invalid ?? []),
  }
})
```

### 6.7 Per-Kind 跨 kind 同名不冲突测试

```ts
// 每个 kind 测试中包含（风险 5 修正）：
it.live("skill and prompt can have same name in different ownerDir", () =>
  Effect.gen(function* () {
    // 创建 .aigcfroge/skills/my-tool.md 和 .aigcfroge/prompts/my-tool.md
    // 验证 skill.list() 不报 name_conflict
    // 验证 prompt.list() 不报 name_conflict
  }),
)
```

---

## 7. Phase 6：UI 收尾

**前置条件**：Phase 2-5 全部完成（4 种 kind 均已开闸 + 迁移 + UI 切换）。

### 7.1 删除 ChatFeaturePanel

| 文件                | 操作                                                                                                     |
| ------------------- | -------------------------------------------------------------------------------------------------------- |
| `mode-surfaces.tsx` | **删** `ChatFeaturePanel` 组件 + `export`                                                                |
| `mode-surfaces.tsx` | 清理 `useDialog` import（仅 ChatFeaturePanel 使用）                                                      |
| `home.tsx`          | 删 `<Show when={chatFeature()==="prompt"} fallback={<ChatFeaturePanel/>}>`，主区始终 AssetWorkbenchTable |
| `home.tsx`          | 清理 `ChatFeaturePanel` import                                                                           |

### 7.2 Insert 流程通用化

`AssetSessionSelector` 选中会话插入时，参数格式调整为 `?insert=<relativePath>`（path 已包含子目录，区分 kind 通过 path 前缀推断），会话页根据 path 调用对应的 `content()` API。

### 7.3 功能树直连 AssetWorkbench filter

点击 CHAT_FEATURES 任意分类 → `setChatFeature(kind)` → `setKindFilter(kind)`，AssetWorkbenchTable 展示对应 kind 的资产行。

### 7.4 验证

- `bun --cwd packages/app typecheck` + `bun --cwd packages/app test`
- 功能树切换所有 6 个分类（含 workflow，暂无资产 → 空态），均不渲染 ChatFeaturePanel
- Insert 流程每种 kind 独立验证

---

## 8. 改动文件清单

| 文件                                                          | Phase | 操作                                                    |
| ------------------------------------------------------------- | ----- | ------------------------------------------------------- |
| `packages/schema/src/asset.ts`                                | 1A    | **新增**                                                |
| `packages/schema/test/asset.test.ts`                          | 1A    | **新增**                                                |
| `packages/schema/src/index.ts`                                | 1A    | **修改** 加 Asset export                                |
| `packages/core/src/asset-kind.ts`                             | 1B    | **新增**                                                |
| `packages/core/test/asset-kind.test.ts`                       | 1B    | **新增**                                                |
| `packages/core/src/constants.ts`                              | 1C    | **修改** 加 SKILLS_DIR/MCPS_DIR/COMMANDS_DIR/AGENTS_DIR |
| `packages/app/src/components/chat/asset-workbench.tsx`        | 1C    | **修改** AssetKind/AssetRow 类型泛化                    |
| `packages/schema/src/skill-asset.ts`                          | 2A    | **新增**                                                |
| `packages/core/src/skill-asset.ts`                            | 2A    | **新增**                                                |
| `packages/core/src/skill-asset-service.ts`                    | 2A    | **新增**                                                |
| `packages/core/test/skill-asset.test.ts`                      | 2A    | **新增**                                                |
| `packages/aigcfroge/src/.../groups/skill-asset.ts`            | 2A    | **新增**                                                |
| `packages/aigcfroge/src/.../handlers/skill-asset.ts`          | 2A    | **新增**                                                |
| `packages/aigcfroge/src/.../api.ts`                           | 2A    | **修改** 注册 SkillAsset group                          |
| `packages/schema/src/mcp-asset.ts`                            | 3A    | **新增**                                                |
| `packages/core/src/mcp-asset.ts`                              | 3A    | **新增**                                                |
| `packages/core/src/mcp-asset-service.ts`                      | 3A    | **新增**                                                |
| `packages/aigcfroge/src/.../groups/mcp-asset.ts`              | 3A    | **新增**                                                |
| `packages/aigcfroge/src/.../handlers/mcp-asset.ts`            | 3A    | **新增**                                                |
| `packages/schema/src/command-asset.ts`                        | 4A    | **新增**                                                |
| `packages/core/src/command-asset.ts`                          | 4A    | **新增**                                                |
| `packages/core/src/command-asset-service.ts`                  | 4A    | **新增**                                                |
| `packages/aigcfroge/src/.../groups/command-asset.ts`          | 4A    | **新增**                                                |
| `packages/aigcfroge/src/.../handlers/command-asset.ts`        | 4A    | **新增**                                                |
| `packages/schema/src/agent-asset.ts`                          | 5A    | **新增**                                                |
| `packages/core/src/agent-asset.ts`                            | 5A    | **新增**                                                |
| `packages/core/src/agent-asset-service.ts`                    | 5A    | **新增**                                                |
| `packages/aigcfroge/src/.../groups/agent-asset.ts`            | 5A    | **新增**                                                |
| `packages/aigcfroge/src/.../handlers/agent-asset.ts`          | 5A    | **新增**                                                |
| `packages/app/src/components/mode-surfaces.tsx`               | 6     | **修改** 删 ChatFeaturePanel                            |
| `packages/app/src/pages/home.tsx`                             | 6     | **修改** 删 ChatFeaturePanel fallback + fetchAllKinds   |
| `packages/app/src/components/chat/asset-session-selector.tsx` | 6     | **修改** Insert 通用化                                  |

---

## 9. TDD 工作流（每 Phase 必须严格执行）

```
1. 红：写测试（schema 校验、registry 注册/解析、API 返回正确、跨 kind 同名不冲突）
2. 绿：最小实现（schema 定义、registry layer、HTTP handler、数据迁移脚本）
3. 重构：DRY、统一错误处理、提取共享模式
4. 验证：
   bun --cwd packages/<name> typecheck
   bun --cwd packages/<name> test --timeout 30000
   bun run lint
5. commit: type(scope): summary  Co-Authored-By: Claude Sonnet 4.6 (1M context) <noreply@anthropic.com>
```

### 测试规范

| 层        | 测试工具                                | 位置                       | 模式                            |
| --------- | --------------------------------------- | -------------------------- | ------------------------------- |
| schema    | `bun:test` + `Schema.decodeUnknownSync` | `packages/schema/test/`    | 纯类型校验                      |
| core      | `testEffect(...)` + `it.live(...)`      | `packages/core/test/`      | Effect service + 文件系统       |
| aigcfroge | `testEffect(...)` + `Layer.mock`        | `packages/aigcfroge/test/` | HTTP handler                    |
| app       | `bun:test` + `createRoot`               | `packages/app/test/`       | test strategy A（纯函数+store） |

### Effect 编码规范（遵循 AGENTS.md + effect skill）

- 用 `Effect.gen(function* () {})` 组合，`Effect.fn("Domain.method")` 命名
- 错误用 `Schema.TaggedErrorClass`
- `Schema.Class` 定义多字段记录
- `Schema.brand` 定义单值类型
- 自导出模式 `export * as Foo from "./foo"` 全部新文件
- 不引入 `any`/`as any`/`@ts-ignore`

### 前端编码规范

- 新组件用 v2 token（`--v2-*`），禁硬编码 hex/rgba
- 纯函数 + store 测试（test strategy A），渲染靠 dev server
- 复用 v2 组件（ButtonV2, Icon, Dialog, Popover）

---

## 10. 回滚机制

任一 Phase 验证失败，先修根因。若某 Phase 的实现导致 regression（PromptAsset API 不可用），回退该 Phase 的 commit 并保留测试文件（红态）。

---

## 11. 验收标准

- [ ] `AssetKindRegistry` 可成功注册/解析 5 种 kind（prompt/skill/mcp/command/agent）+ workflow 占位
- [ ] 每个 kind 的 `list/content/apply/delete` API 均可用
- [ ] 每个 kind 的 SDK client 类已生成并可用
- [ ] AssetWorkbenchTable KindDropdown 可在 5 种 kind 间切换 filter
- [ ] 功能树点任意分类 → AssetWorkbenchTable 展示对应 kind 资产（含空态）
- [ ] ChatFeaturePanel 已从代码中删除（编译通过）
- [ ] Insert 流程对所有 kind 正常运行
- [ ] 跨 kind 同名不冲突（skill `my-tool.md` 和 prompt `my-tool.md` 不相生冲突）
- [ ] 数据迁移后在 `.aigcfroge/<kind>/` 下可见对应文件
- [ ] `bun --cwd packages/core test` 通过
- [ ] `bun --cwd packages/aigcfroge test` 通过
- [ ] `bun --cwd packages/app typecheck + test` 通过
- [ ] `bun run lint` 通过

---

## 12. 审查记录

### 2026-07-25：五层代码追溯 + 6 风险修正

**追溯路径**：

- L1 `packages/schema/src/prompt-asset.ts` → Name/Description/Revision/Template branded strings, Summary/Info/Frontmatter/InvalidEntry Schema.Class
- L2 `packages/core/src/prompt-asset.ts` → loadDir (ConfigMarkdown.parseOption → Schema.decodeUnknownSync Frontmatter → Hash.sha256 → assets/invalid map), Service + layer (Location.Service, FSUtil.Service, Watcher)
- L2 `packages/core/src/prompt-asset-service.ts` → per-kind errors (7 个 TaggedErrorClass), ProposeResult/ApplyInput/DeleteInput, propose/apply/delete transaction, yamlEscape
- L3 `packages/aigcfroge/src/server/routes/instance/httpapi/groups/prompt-asset.ts` → HttpApiGroup "prompt-asset", routes /prompt-asset + /content + /session/:sessionID/prompt-asset/apply/delete, ListResponse {assets, invalid}
- L3 `packages/aigcfroge/src/server/routes/instance/httpapi/handlers/prompt-asset.ts` → toApplyError/toDeleteError (per-kind error → ConflictError/InvalidRequestError), HttpApiBuilder.group(InstanceHttpApi, "prompt-asset")
- L4 `packages/sdk/js/src/v2/gen/sdk.gen.ts` → PromptAsset extends HeyApiClient, list/content/apply/delete methods, URL paths, Query/Payload types
- L4 `packages/sdk/js/src/v2/gen/types.gen.ts` → PromptAssetSummary/PromptAssetInvalidEntry/PromptAssetInfo
- L5 `packages/app/src/components/chat/asset-workbench.tsx` → AssetKind = "all" | "prompt" (hardcoded), AssetRow.kind = "prompt" (hardcoded), buildRows/filterByKind typed to PromptAssetSummary
- L5 `packages/app/src/pages/home.tsx` → sdk.client.promptAsset.list() → chatAssetList → AssetWorkbenchTable props
- L5 `packages/app/src/components/mode-surfaces.tsx` → CHAT_FEATURES (6 分类) → ChatFeatureID → mode-surfaces

**发现的风险及修正**：

| #   | 风险                                                               | 严重程度  | 修正内容                                                                                    |
| --- | ------------------------------------------------------------------ | --------- | ------------------------------------------------------------------------------------------- |
| 1   | 数据迁移顺序错误（Phase 7 在 UI 之后）                             | 🔴 阻断   | 每个 kind 的 migration 前置到 Phase XB，UI 切换后移到 XC                                    |
| 2   | AssetWorkbenchTable 类型耦合（AssetRow.kind 硬编码 "prompt"）      | 🟡 架构   | Phase 1C 增加 AssetKind/AssetRow 类型泛化定义                                               |
| 3   | Home 资产 fetch 单源（仅 promptAsset.list）                        | 🟡 架构   | Phase XC 实现 fetchAllKinds 多源调用 + 合并                                                 |
| 4   | ChatFeaturePanel 删除时机过早（Phase 2D 就删，未开闸 kind 无显示） | 🔴 阻断   | Phase 6（全部 kind 开闸后）才删除；已开闸的走 AssetWorkbench，未开闸的保留 ChatFeaturePanel |
| 5   | 缺少跨 kind 同名不冲突测试                                         | 🟡 TDD    | Phase 2A-5A 每个 kind 加跨 kind 同名不冲突测试                                              |
| 6   | PRD §8.1.1 一致性：AssetSummary 不含 template                      | ✅ 已对齐 | 确认 template 仅在 Info 中，Summary/Frontmatter 不含                                        |
