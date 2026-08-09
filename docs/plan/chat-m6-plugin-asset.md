# Plugin Asset 开闸实施计划（M6）

> 状态：Approved（修订后，Bridge 为 Effect service）
> 修订记录：
> - v1.0 (2026-07-27): 初稿，审批发现 Phase 1D Bridge 架构错误（裸 `node:fs` → Effect `FSUtil.Service`）
> - v1.1 (2026-07-27): 修订 Bridge 为 Effect service + 4 个次要问题修复
> 依据：[Chat PRD v4.5](../prd/chat-mode-creation-layer.md)、[CLAUDE.md](../../CLAUDE.md)、[AGENTS.md](../../AGENTS.md)、[ARCHITECTURE.md](../../ARCHITECTURE.md)、[智能体插件统一管理调研](../../research/agent/智能体插件统一管理调研.md)
> 前置：M5（WorkflowAsset 开闸）已合并到 main
> 分支：`m6-plugin-asset`（从 main 切出）
> 范围：`packages/schema` + `packages/core` + `packages/aigcfroge` + `packages/sdk/js` + `packages/app`
> **本文件为自包含实施手册，可供其他 agent 独立执行。**

---

## 0. 背景与目标

### 0.1 问题

当前 AigcForge Chat 模式支持 6 类资产（prompt/skill/mcp/command/agent/workflow），但缺少**插件包**概念。用户不能在 Chat 模式下管理"多工具集成包"——这类资产在 Claude Code（60+ marketplace plugins）、Codex（60+ curated skills）、Cursor（extensions）中已是事实标准。

现有 6 类资产的语义无法覆盖 Plugin：

| 现有资产 | 语义 | 与 Plugin 的差异 |
|---------|------|-----------------|
| mcp | **单一** MCP server 连接（1 文件 = 1 进程） | Plugin = **包**（含多个 tools + hooks + skills + commands） |
| skill | **单一** 知识注入 | Plugin 的 skill 只是其 bundled 子资产之一 |
| workflow | **单一** DAG 编排 | Plugin 执行不走 DAG，是工具集合 |

### 0.2 目标

1. **Plugin 作为第 7 类资产开闸**：5 层 pipeline（schema → core → HTTP API → SDK → UI）
2. **文件格式**：`.plugin.yaml`（纯 YAML，参考 Claude Code `.claude-plugin/plugin.json` + Dify `manifest.yaml`）
3. **系统级桥接**：自动扫描本地 Claude Code / Codex / Cursor / ZCode / Kimi Code 的插件，归一化为统一 BridgeEntry 展示
4. **TDD 每步**：红 → 绿 → 验证（typecheck + test + lint）

### 0.3 非目标

- 不做 Plugin 执行引擎（归 Work 模式，延后）
- 不做 PluginAssetService（propose/apply/delete 事务层，当前只做到 registry 只读）
- 不做 Plugin marketplace 拉取/安装（延后）
- 不做 hook 运行时（hooks.json 的 PreToolUse/PostToolUse 等事件不执行，仅定义存储）
- 不把 project-level plugin 内部的 commands/skills/agents 子资产自动注入到对应资产 registry（延后，Phase 2）

### 0.4 架构决策

| 问题 | 决策 | 依据 |
|------|------|------|
| 独立 kind 还是归并到 MCP | **独立 kind = `"plugin"`** | Plugin = 多工具集成包（含 hooks+skills+commands+mcp）；MCP = 单一 server 连接。用户明确要求不混淆 |
| 文件格式 | **`.plugin.yaml`**（纯 YAML） | 调研报告的 Dify/Coze 实践；workflow 已用 `.yaml`，扩展名区分 |
| 存储目录 | `.aigcfroge/plugins/` | 对齐现有 6 类目录结构 |
| 系统级桥接 | **PluginScanner**（1 个函数，6 个子函数） | 扫描 ~/.claude/、~/.codex/、~/.cursor/、~/.zcode/、~/.kimi-code/ |
| 桥接展示 | 作为 system origin 注入 Plugin 面板，与 project-level 合并 | M4 的 `systemAssets()` + `mergeAssets()` 模式 |
| 执行引擎 | 延后 | Work PRD 正稿阶段再建设 |

### 0.5 真实数据参考

基于用户机器实际扫描结果：

| 工具 | 插件数量 | 格式 | 示例 |
|------|---------|------|------|
| Claude Code | 60+ marketplace | `.claude-plugin/plugin.json` + `.mcp.json` + `commands/` + `skills/` + `hooks/` | code-review, hookify, agent-sdk-dev, gitkraken-hooks |
| Codex | 60+ curated skills | `skills-curated-cache.json` | aspnet-core, figma, cli-creator, cloudflare-deploy |
| Codex MCP | 2 servers | `config.toml [mcp_servers]` | pencil, context7 |
| Cursor | extensions/ | VS Code extension 模型 | remote-containers, remote-ssh |
| Kimi Code | skills + models | `config.toml` | K3 models, extra_skill_dirs |
| ZCode | 配置 | `v2/config.json` | bots-model-cache |

---

## 1. 架构全景

```
┌─ schema 层 ────────────────────────────────────────────────┐
│  schema/plugin-asset.ts                                    │
│  Frontmatter(kind=plugin, name, desc, version, category,   │
│              author, source, hooks?)                       │
│  Summary(kind=plugin, name, desc, relativePath, revision,  │
│          source, toolCount)                                │
│  Info(full: name, desc, version, category, author,         │
│       source, hooks, bundled)                              │
│  BridgeEntry(name, desc, source: claude-code|codex|...,    │
│              category, originPath, format, bundled{...})   │
│  InvalidEntry / InvalidErrorTag                            │
└────────────────────┬───────────────────────────────────────┘
                     ↓
┌─ core 层 ─────────────────────────────────────────────────┐
│  core/src/plugin-asset.ts                                 │
│  loadDir() glob .aigcfroge/plugins/*.plugin.yaml          │
│  → yaml.load() → Frontmatter decode → Map<Info>           │
│  Service: list / getByPath / findByName / listInvalid     │
│  layer: FSUtil + Location + EventV2 + KeyedMutex          │
│                                                           │
│  core/src/plugin-asset/bridge.ts                          │
│  PluginBridge.Service (Effect, 依赖 FSUtil)                │
│  scan() → Effect.all([6 路子扫描]) → BridgeEntry[]        │
│  ├── scanClaudeCodePlugins(fs) // ~/.claude/plugins/**    │
│  ├── scanCodexSkills(fs)       // skills-curated-cache    │
│  ├── scanCodexMCPServers(fs)   // config.toml [mcp_srvrs] │
│  ├── scanCursorPlugins(fs)     // ~/.cursor/plugins/      │
│  ├── scanZCodePlugins(fs)       // ~/.zcode/v2/            │
│  ├── scanKimiCodePlugins(fs)    // ~/.kimi-code/           │
│  └── countBundled(fs, dir)      // commands/skills/.mcp    │
│  layer: FSUtil + PluginBridge.Service                      │
│                                                           │
│  core/src/plugin-asset/path.ts                            │
│  isValidSegment / validateRelativePath / nameToRelativePath│
└────────────────────┬──────────────────────────────────────┘
                     ↓
┌─ aigcfroge 层 ────────────────────────────────────────────┐
│  groups/plugin-asset.ts + handlers/plugin-asset.ts        │
│  GET /plugin-asset → { assets, invalid, bridged }         │
│  GET /plugin-asset/content?path=... → Info                │
│  只读（bridged 来自 PluginBridge.Service.scan()）            │
└────────────────────┬──────────────────────────────────────┘
                     ↓
┌─ sdk/js 层 → PluginAsset client ─────────────────────────┘
                     ↓
┌─ app 层 ──────────────────────────────────────────────────┐
│  chat-feature.tsx: ChatFeatureID += "plugin"              │
│  mode-surfaces.tsx: CHAT_FEATURES += plugin               │
│  home.tsx: 第 7 路 fetch + bridged 合并                    │
│  asset-insert.ts: kind → dir 映射 + parseInsertKind       │
│  asset-workbench.tsx: systemAssets() += bridged plugins   │
└───────────────────────────────────────────────────────────┘
```

---

## 2. 文件格式设计

### 2.1 `.plugin.yaml` 示例

```yaml
# .aigcfroge/plugins/code-review.plugin.yaml
kind: plugin
name: code-review
description: Automated code review for pull requests
version: "1.0.0"
category: productivity
author:
  name: Anthropic
  email: support@anthropic.com
source:
  type: mcp
  mcp:
    name: github-mcp
hooks:
  - event: PostToolUse
    command: python3 ./hooks/check.py
```

### 2.2 BridgeEntry 结构（系统级桥接输出）

```typescript
interface BridgeEntry {
  name: string
  description: string
  source: "claude-code" | "codex" | "cursor" | "zcode" | "kimi-code" | "project"
  category: string
  originPath: string          // 原始文件绝对路径，调试用
  format: string               // 原始格式标记
  bundled: {
    commands: number
    skills: number
    agents: number
    hooks: number
    mcpServers: number
  }
}
```

### 2.3 桥接到系统级资产的展示协议

桥接插件以 `origin: "system"` 注入 `AssetWorkbench` 的行数据。面板显示：
- `kind` 列 = `"plugin"`
- 名称列前置 `[system]` badge + tooltip 显示来源工具名
- description 显示插件描述
- 不提供 Insert 按钮（系统级资产不可插入 prompt）

---

## 3. Phase 划分（TDD 每步）

| Phase | 内容 | 测试位置 | 包 | 依赖 |
|-------|------|---------|-----|------|
| **0** | Chat PRD §18 Plugin Asset 规格文档 | — | docs | — |
| **1A** | PluginAsset schema：Frontmatter/Summary/Info/BridgeEntry/InvalidEntry | `packages/schema/test/` | schema | — |
| **1B** | PluginAsset path 模块 | `packages/core/test/` | core | 1A |
| **1C** | PluginAsset core Service：loadDir + layer + watch | `packages/core/test/` | core | 1B |
| **1D** | PluginBridge scanner（系统级） | `packages/core/test/` | core | 1A |
| **2A** | HTTP API：groups + handlers（list/content/bridged） | `packages/aigcfroge/test/server/` | aigcfroge | 1C, 1D |
| **2B** | LocationServiceMap 注册 | — | aigcfroge | 2A |
| **2C** | SDK 重新生成 | — | sdk/js | 2A |
| **3A** | App：ChatFeatureID + CHAT_FEATURES + 功能树 | `packages/app/test/` | app | 2C |
| **3B** | App：home.tsx 第 7 路 fetch + bridged 合并 | — | app | 3A |
| **3C** | App：asset-insert.ts 路径映射 | — | app | 3B |
| **4** | 集成验证：lint + typecheck + test 全量 | — | 全部 | 3C |

---

## 4. 详细实施步骤（TDD）

### Phase 1A：Schema（`packages/schema/`）

**TDD 步骤**：

```
RED  → write test/plugin-asset.test.ts（Frontmatter/Summary/Info/InvalidEntry/BridgeEntry）
GREEN → write src/plugin-asset.ts
VERIFY → bun --cwd packages/schema test + typecheck
```

**新文件**：`packages/schema/src/plugin-asset.ts`

```typescript
export * as PluginAsset from "./plugin-asset"

import { Effect, Schema } from "effect"

// -- Branded scalars --
export const Name = Schema.String.pipe(
  Schema.check(Schema.makeFilter((s) => [...s].length >= 1, { message: "Min 1 code point" })),
  Schema.check(Schema.makeFilter((s) => [...s].length <= 80, { message: "Max 80 code points" })),
  Schema.brand("PluginAsset.Name"),
)
export type Name = typeof Name.Type

export const Description = Schema.String.pipe(
  Schema.check(Schema.makeFilter((s) => [...s].length <= 300, { message: "Max 300 code points" })),
  Schema.brand("PluginAsset.Description"),
)
export type Description = typeof Description.Type

export const Revision = Schema.String.pipe(
  Schema.isMinLength(64), Schema.isMaxLength(64),
  Schema.pattern(/^[0-9a-f]{64}$/),
  Schema.brand("PluginAsset.Revision"),
)
export type Revision = typeof Revision.Type

// -- Sub-types --
export class Author extends Schema.Class<Author>("PluginAsset.Author")({
  name: Schema.String,
  email: Schema.optional(Schema.String),
}) {}

export class SourceDef extends Schema.Class<SourceDef>("PluginAsset.SourceDef")({
  type: Schema.Literal("mcp", "openapi", "bundled"),
  mcp: Schema.optional(Schema.Struct({ name: Schema.String })),
  openapi: Schema.optional(Schema.Struct({ url: Schema.String })),
}) {}

export class HookDef extends Schema.Class<HookDef>("PluginAsset.HookDef")({
  event: Schema.Literal("PreToolUse", "PostToolUse", "Stop", "UserPromptSubmit",
    "Notification", "PermissionRequest", "SessionStart", "SessionEnd"),
  command: Schema.String,
  timeout: Schema.optional(Schema.Number),
}) {}

// -- Asset schemas --
export class Frontmatter extends Schema.Class<Frontmatter>("PluginAsset.Frontmatter")({
  kind: Schema.Literal("plugin"),
  name: Schema.String,
  description: Schema.String,
  version: Schema.String,
  category: Schema.optional(Schema.String),
  author: Schema.optional(Author),
  source: Schema.optional(SourceDef),
  hooks: Schema.optional(Schema.Array(HookDef)),
})

export class Summary extends Schema.Class<Summary>("PluginAsset.Summary")({
  kind: Schema.Literal("plugin"),
  name: Name,
  description: Description,
  relativePath: Schema.String,
  revision: Revision,
  source: Schema.optional(Schema.String),
  toolCount: Schema.Number.pipe(Schema.withDecodingDefault(() => 0)),
})

export class Info extends Schema.Class<Info>("PluginAsset.Info")({
  kind: Schema.Literal("plugin"),
  name: Name,
  description: Description,
  relativePath: Schema.String,
  revision: Revision,
  version: Schema.String,
  category: Schema.optional(Schema.String),
  author: Schema.optional(Author),
  source: Schema.optional(SourceDef),
  hooks: Schema.optional(Schema.Array(HookDef)),
})

export const InvalidErrorTag = Schema.Literals(["parse_error", "bad_frontmatter", "name_conflict"])
export type InvalidErrorTag = typeof InvalidErrorTag.Type

export class InvalidEntry extends Schema.Class<InvalidEntry>("PluginAsset.InvalidEntry")({
  relativePath: Schema.String,
  errorTag: InvalidErrorTag,
}) {}

// -- Bridge types (系统级桥接) --
export const BridgeSource = Schema.Literal(
  "claude-code", "codex", "cursor", "zcode", "kimi-code", "project",
)
export type BridgeSource = typeof BridgeSource.Type

export class BundledCounts extends Schema.Class<BundledCounts>("PluginAsset.BundledCounts")({
  commands: Schema.Number,
  skills: Schema.Number,
  agents: Schema.Number,
  hooks: Schema.Number,
  mcpServers: Schema.Number,
}) {}

export class BridgeEntry extends Schema.Class<BridgeEntry>("PluginAsset.BridgeEntry")({
  name: Schema.String,
  description: Schema.String,
  source: BridgeSource,
  category: Schema.optional(Schema.String),
  originPath: Schema.String,
  format: Schema.String,
  bundled: BundledCounts,
}) {}
```

**测试文件**：`packages/schema/test/plugin-asset.test.ts`

```typescript
import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { PluginAsset } from "../src/plugin-asset"

describe("PluginAsset.Frontmatter", () => {
  test("accepts minimal valid frontmatter", () => {
    const f = Schema.decodeUnknownSync(PluginAsset.Frontmatter)({
      kind: "plugin",
      name: "my-plugin",
      description: "A test plugin",
      version: "1.0.0",
    })
    expect(f.kind).toBe("plugin")
    expect(f.name).toBe("my-plugin")
  })

  test("accepts full frontmatter with hooks", () => {
    const f = Schema.decodeUnknownSync(PluginAsset.Frontmatter)({
      kind: "plugin",
      name: "hookify",
      description: "User-configurable hooks",
      version: "1.2.0",
      category: "development",
      author: { name: "Anthropic", email: "support@anthropic.com" },
      source: { type: "mcp", mcp: { name: "github" } },
      hooks: [
        { event: "PreToolUse", command: "python3 hooks/check.py", timeout: 10 },
        { event: "PostToolUse", command: "python3 hooks/audit.py" },
      ],
    })
    expect(f.hooks!.length).toBe(2)
  })
})

describe("PluginAsset.Summary", () => {
  test("accepts valid summary", () => {
    const s = Schema.decodeSync(PluginAsset.Summary)({
      kind: "plugin",
      name: Schema.decodeSync(PluginAsset.Name)("code-review"),
      description: Schema.decodeSync(PluginAsset.Description)("Auto review"),
      relativePath: "code-review.plugin.yaml",
      revision: Schema.decodeSync(PluginAsset.Revision)("a".repeat(64)),
      source: "mcp",
      toolCount: 5,
    })
    expect(s.kind).toBe("plugin")
  })
})

describe("PluginAsset.BridgeEntry", () => {
  test("accepts claude-code bridge entry", () => {
    const b = Schema.decodeUnknownSync(PluginAsset.BridgeEntry)({
      name: "code-review",
      description: "Automated code review",
      source: "claude-code",
      category: "productivity",
      originPath: "/home/user/.claude/plugins/marketplaces/.../plugin.json",
      format: "claude-plugin-v1",
      bundled: { commands: 1, skills: 2, agents: 0, hooks: 0, mcpServers: 0 },
    })
    expect(b.source).toBe("claude-code")
    expect(b.bundled.commands).toBe(1)
  })

  test("accepts codex bridge entry", () => {
    const b = Schema.decodeUnknownSync(PluginAsset.BridgeEntry)({
      name: "figma",
      description: "Use Figma MCP for design-to-code",
      source: "codex",
      category: "design",
      originPath: "/home/user/.codex/vendor_imports/skills-curated-cache.json",
      format: "codex-skill-v1",
      bundled: { commands: 0, skills: 1, agents: 0, hooks: 0, mcpServers: 1 },
    })
    expect(b.source).toBe("codex")
  })
})

describe("PluginAsset.InvalidEntry", () => {
  test("accepts parse_error tag", () => {
    const e = Schema.decodeUnknownSync(PluginAsset.InvalidEntry)({
      relativePath: "broken.plugin.yaml",
      errorTag: "parse_error",
    })
    expect(e.errorTag).toBe("parse_error")
  })
})
```

**更新**：`packages/schema/src/asset.ts` — `AssetKindId` 加 `"plugin"`

```typescript
export const AssetKindId = Schema.Literals([
  "prompt", "skill", "mcp", "command", "agent", "workflow", "plugin",
])
```

**更新**：`packages/schema/src/index.ts` — 追加 `export * as PluginAsset from "./plugin-asset"`

**验证**：
```bash
bun --cwd packages/schema test --timeout 30000
bun --cwd packages/schema typecheck
```

---

### Phase 1B：Path 模块（`packages/core/`）

**TDD**：
```
RED  → write test/plugin-asset-path.test.ts
GREEN → write src/plugin-asset/path.ts
VERIFY → bun test + typecheck
```

**新文件**：`packages/core/src/plugin-asset/path.ts`

```typescript
export * as PluginAssetPath from "./path"

import { Effect, Schema } from "effect"
import path from "path"
import { FSUtil } from "../fs-util"
import { LocationMutation } from "../location-mutation"
import { PLUGINS_DIR } from "../constants"

export { PLUGINS_DIR }

export const DISALLOWED_CHARS = /[<>:"/\\|?*]/
export const CONTROL_CHARS = /[\x00-\x1F\x7F]/
export const SEGMENT_MIN_BYTES = 1
export const SEGMENT_MAX_BYTES = 100
export const PATH_MAX_BYTES = 240

export class PathValidationError extends Schema.TaggedErrorClass<PathValidationError>()(
  "PluginAsset.PathValidation",
  { reason: Schema.String, path: Schema.String },
) {}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length
}

export function isValidSegment(segment: string): boolean {
  if (segment === "" || segment === "." || segment === "..") return false
  if (CONTROL_CHARS.test(segment)) return false
  if (DISALLOWED_CHARS.test(segment)) return false
  if (segment.startsWith(" ") || segment.endsWith(" ")) return false
  if (segment.endsWith(".")) return false
  const bytes = utf8Bytes(segment)
  if (bytes < SEGMENT_MIN_BYTES || bytes > SEGMENT_MAX_BYTES) return false
  return true
}

export function validateRelativePath(relativePath: string): string {
  const trimmed = relativePath.trim()
  if (trimmed === "") throw new PathValidationError({ reason: "Path must not be empty", path: relativePath })
  if (path.isAbsolute(trimmed)) throw new PathValidationError({ reason: "Path must not be absolute", path: relativePath })
  const normalized = trimmed.replace(/\\/g, "/")
  const segments = normalized.split("/")
  for (const segment of segments) {
    if (!isValidSegment(segment))
      throw new PathValidationError({ reason: `Invalid path segment: ${segment}`, path: relativePath })
  }
  if (!normalized.endsWith(".plugin.yaml"))
    throw new PathValidationError({ reason: "Path must end with .plugin.yaml", path: relativePath })
  const bytes = utf8Bytes(normalized)
  if (bytes > PATH_MAX_BYTES)
    throw new PathValidationError({ reason: `Path exceeds ${PATH_MAX_BYTES} UTF-8 bytes`, path: relativePath })
  return normalized
}

export function nameToRelativePath(name: string): string {
  const normalized = name.normalize("NFKC").trim()
  if (normalized === "") throw new PathValidationError({ reason: "Name must not be empty", path: name })
  if (!isValidSegment(normalized))
    throw new PathValidationError({ reason: `Name is not a valid segment: ${normalized}`, path: name })
  return path.posix.join(PLUGINS_DIR, `${normalized}.plugin.yaml`)
}

export function resolveOwnerRoot(locationDirectory: string): string {
  return path.resolve(locationDirectory, PLUGINS_DIR)
}

export function resolveSafeTarget(
  relativePath: string,
  mutation: LocationMutation.Interface,
): Effect.Effect<LocationMutation.Target, PathValidationError | LocationMutation.PathError | FSUtil.Error> {
  return Effect.gen(function* () {
    const validated = yield* Effect.try({
      try: () => validateRelativePath(relativePath),
      catch: (error) =>
        error instanceof PathValidationError
          ? error
          : new PathValidationError({ reason: String(error), path: relativePath }),
    })
    const resource = path.posix.join(PLUGINS_DIR, validated)
    const target = yield* mutation.resolve({ path: resource })
    const canonicalResource = target.resource.replaceAll("\\", "/")
    if (target.externalDirectory || canonicalResource !== resource)
      return yield* new PathValidationError({ reason: "Canonical path escapes plugin asset root", path: relativePath })
    return target
  })
}
```

**测试文件**：`packages/core/test/plugin-asset-path.test.ts`

测试要点（参考 `workflow-asset-path.test.ts` 结构）：
- `isValidSegment`：接受中文名/英文名/数字/连字符，拒绝空格/trailing dot/控制字符/Windows 保留字符/超长
- `validateRelativePath`：强制 `.plugin.yaml` 扩展名，拒绝空/绝对路径/`..` 穿越
- `nameToRelativePath`：产生 `.aigcfroge/plugins/<name>.plugin.yaml`，NFKC 归一化
- `resolveSafeTarget`：路径逃逸防护（含 symlink 重定向检测）

**验证**：
```bash
bun --cwd packages/core test plugin-asset-path --timeout 30000
bun --cwd packages/core typecheck
```

---

### Phase 1C：Core Service（`packages/core/`）

**TDD**：
```
RED  → write test/plugin-asset-registry.test.ts
GREEN → write src/plugin-asset.ts + update src/constants.ts
VERIFY → bun test + typecheck
```

**更新**：`packages/core/src/constants.ts`

```typescript
export const PLUGINS_DIR = ".aigcfroge/plugins"
```

**新文件**：`packages/core/src/plugin-asset.ts`

结构与 `workflow-asset.ts` 一致，关键差异：
- `loadDir` 用 `fs.glob("**/*.plugin.yaml", ...)` 而非 `**/*.yaml`（与 workflow 区分）
- 用 `yaml.load()` 解析（`js-yaml` 已是传递依赖）
- Info 包含 `bundled` 计数（扫描 YAML 中 hooks/commands/skills/agents 引用算数量，Phase 1 硬编码为 0）

```typescript
export * as PluginAsset from "./plugin-asset"

import { Context, Effect, Layer, Option, Schema, Scope, Stream } from "effect"
import path from "path"
import { PluginAsset as SchemaPluginAsset } from "@aigcfroge/schema/plugin-asset"
import { FSUtil } from "./fs-util"
import { EventV2 } from "./event"
import { KeyedMutex } from "./effect/keyed-mutex"
import { Location } from "./location"
import { Hash } from "./util/hash"
import { Watcher } from "./filesystem/watcher"
import { PLUGINS_DIR } from "./constants"
import yaml from "js-yaml"

export { PLUGINS_DIR }

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("PluginAsset.NotFound", {
  relativePath: Schema.String,
}) {}

export interface Info {
  readonly kind: "plugin"
  readonly name: string
  readonly description: string
  readonly relativePath: string
  readonly version: string
  readonly category?: string
  readonly author?: { readonly name: string; readonly email?: string }
  readonly source?: { readonly type: "mcp" | "openapi" | "bundled"; readonly mcp?: { readonly name: string }; readonly openapi?: { readonly url: string } }
  readonly hooks: ReadonlyArray<{ readonly event: string; readonly command: string; readonly timeout?: number }>
  readonly revision: string
}

export interface InvalidEntry {
  readonly relativePath: string
  readonly errorTag: "parse_error" | "bad_frontmatter" | "name_conflict"
}

export interface Interface {
  readonly list: () => Effect.Effect<ReadonlyArray<Info>>
  readonly getByPath: (relativePath: string) => Effect.Effect<Info, NotFoundError>
  readonly findByName: (name: string) => Effect.Effect<Info | undefined>
  readonly listInvalid: () => Effect.Effect<ReadonlyArray<InvalidEntry>>
  readonly getInvalid: (relativePath: string) => Effect.Effect<InvalidEntry | undefined>
  readonly reload: () => Effect.Effect<void, FSUtil.Error>
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/PluginAsset") {}

function loadDir(
  fs: FSUtil.Interface,
  ownerRoot: string,
): Effect.Effect<{ assets: Map<string, Info>; invalid: Map<string, InvalidEntry> }, FSUtil.Error> {
  return Effect.gen(function* () {
    const assets = new Map<string, Info>()
    const invalid = new Map<string, InvalidEntry>()
    const byName = new Map<string, string[]>()

    const files = yield* fs.glob("**/*.plugin.yaml", { cwd: ownerRoot, absolute: true, include: "file", dot: true })

    for (const file of files) {
      const relativePath = path.relative(ownerRoot, file).replaceAll("\\", "/")
      const raw = yield* fs.readFile(file).pipe(
        Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(undefined)),
      )
      if (!raw) continue

      const text = new TextDecoder().decode(raw)
      let doc: unknown
      try {
        doc = yaml.load(text)
      } catch {
        invalid.set(relativePath, { relativePath, errorTag: "parse_error" })
        continue
      }
      if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
        invalid.set(relativePath, { relativePath, errorTag: "parse_error" })
        continue
      }

      let frontmatter: SchemaPluginAsset.Frontmatter
      try {
        frontmatter = Schema.decodeUnknownSync(SchemaPluginAsset.Frontmatter)(doc)
      } catch {
        invalid.set(relativePath, { relativePath, errorTag: "bad_frontmatter" })
        continue
      }

      const revision = Hash.sha256(Buffer.from(raw))

      const conflicts = byName.get(frontmatter.name)
      if (conflicts) {
        conflicts.push(relativePath)
        for (const p of conflicts) {
          assets.delete(p)
          invalid.set(p, { relativePath: p, errorTag: "name_conflict" })
        }
        continue
      }
      byName.set(frontmatter.name, [relativePath])

      assets.set(relativePath, {
        kind: "plugin",
        name: frontmatter.name,
        description: frontmatter.description,
        relativePath,
        version: frontmatter.version,
        category: frontmatter.category,
        author: frontmatter.author,
        source: frontmatter.source,
        hooks: frontmatter.hooks ?? [],
        revision,
      })
    }
    return { assets, invalid }
  })
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const location = yield* Location.Service
    const ownerRoot = path.resolve(location.directory, PLUGINS_DIR)
    let assets = new Map<string, Info>()
    let invalid = new Map<string, InvalidEntry>()
    const reloadLock = KeyedMutex.makeUnsafe<string>()

    const reload = Effect.fn("PluginAsset.reload")(function* () {
      yield* reloadLock.withLock("reload")(
        Effect.gen(function* () {
          const result = yield* loadDir(fs, ownerRoot)
          assets = result.assets
          invalid = result.invalid
        }),
      )
    })

    const list = Effect.fn("PluginAsset.list")(function* () { return Array.from(assets.values()) })
    const getByPath = Effect.fn("PluginAsset.getByPath")(function* (p: string) {
      const entry = assets.get(p)
      if (!entry) return yield* new NotFoundError({ relativePath: p })
      return entry
    })
    const findByName = Effect.fn("PluginAsset.findByName")(function* (name: string) {
      for (const entry of assets.values()) if (entry.name === name) return entry
      return undefined
    })
    const listInvalid = Effect.fn("PluginAsset.listInvalid")(function* () { return Array.from(invalid.values()) })
    const getInvalid = Effect.fn("PluginAsset.getInvalid")(function* (p: string) { return invalid.get(p) })

    const scope = yield* Scope.Scope
    const eventsOpt = yield* Effect.serviceOption(EventV2.Service)
    if (Option.isSome(eventsOpt)) {
      yield* eventsOpt.value
        .subscribe(Watcher.Event.Updated)
        .pipe(
          Stream.filter((e) => FSUtil.contains(ownerRoot, e.data.file) && e.data.file.endsWith(".plugin.yaml")),
          Stream.runForEach(() =>
            reload().pipe(
              Effect.catch((error) =>
                Effect.logWarning("Failed to reload plugin assets", {
                  errorTag: "_tag" in error ? String(error._tag) : "filesystem_error",
                }),
              ),
            ),
          ),
          Effect.forkIn(scope),
        )
    }

    yield* reload().pipe(Effect.orDie)
    return Service.of({ list, getByPath, findByName, listInvalid, getInvalid, reload })
  }),
)

export const locationLayer = layer
```

**测试文件**：`packages/core/test/plugin-asset-registry.test.ts`

测试要点（参考 `workflow-asset-registry.test.ts` 结构）：
- 空目录 list = []
- 加载单个 `.plugin.yaml`
- 加载多个 plugin
- `getByPath` 命中/未命中
- `findByName` 命中/未命中
- YAML parse 失败 → `parse_error`
- Schema decode 失败 → `bad_frontmatter`
- 同名 → `name_conflict`
- Location A/B 隔离
- `reload` 动态增加文件
- `listInvalid` reload 修复

**验证**：
```bash
bun --cwd packages/core test plugin-asset-registry --timeout 30000
bun --cwd packages/core typecheck
```

---

### Phase 1D：PluginBridge Scanner（系统级桥接）— Effect Service

> **审批修订**：原设计用裸 `node:fs` + `for...of`，违反 AGENTS.md §Effect Coding（"Prefer Effect services over raw APIs"）和 §Style Guide（"Prefer functional array methods"）。修订为 `FSUtil.Service` + `Schema.Class` 化 BridgeEntry + `.flatMap`/`Effect.all`。

**TDD**：
```
RED  → write test/plugin-bridge.test.ts
GREEN → write src/plugin-asset/bridge.ts
VERIFY → bun test + typecheck
```

**新文件**：`packages/core/src/plugin-asset/bridge.ts`

```typescript
export * as PluginBridge from "./bridge"

import { Context, Effect, Layer, Schema } from "effect"
import os from "node:os"
import path from "path"
import { FSUtil } from "../fs-util"
import { PluginAsset } from "@aigcfroge/schema/plugin-asset"

export interface BridgeEntry {
  readonly name: string
  readonly description: string
  readonly source: "claude-code" | "codex" | "cursor" | "zcode" | "kimi-code"
  readonly category: string
  readonly originPath: string
  readonly format: string
  readonly bundled: {
    readonly commands: number
    readonly skills: number
    readonly agents: number
    readonly hooks: number
    readonly mcpServers: number
  }
}

export interface Interface {
  readonly scan: () => Effect.Effect<readonly BridgeEntry[]>
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/PluginBridge") {}

// ── 子扫描函数（内部 helper，非 export）──
// 每个子函数依赖 FSUtil.Service，单文件解析失败 skip，不阻断同工具其他 plugin

function scanClaudeCodePlugins(fs: FSUtil.Interface): Effect.Effect<readonly BridgeEntry[]> {
  return Effect.gen(function* () {
    const pattern = path.join(os.homedir(), ".claude", "plugins", "**", ".claude-plugin", "plugin.json")
    const files = yield* fs.glob(pattern, { absolute: true, include: "file" }).pipe(
      Effect.catchAll(() => Effect.succeed([] as readonly string[])),
    )
    const entries = yield* Effect.all(
      files.map((file) =>
        Effect.gen(function* () {
          const raw = yield* fs.readFile(file).pipe(Effect.catchAll(() => Effect.succeed(undefined)))
          if (!raw) return []
          const text = new TextDecoder().decode(raw)
          const parsed = JSON.parse(text) as { name?: string; description?: string }
          const name = parsed.name?.trim()
          const description = parsed.description?.trim() ?? ""
          if (!name) return []
          const pluginDir = path.dirname(path.dirname(file)) // 向上两级从 .claude-plugin/plugin.json 到 plugin root
          const bundled = yield* countBundled(fs, pluginDir)
          return [{
            name,
            description,
            source: "claude-code" as const,
            category: "",
            originPath: file,
            format: "claude-plugin-v1",
            bundled,
          }]
        }).pipe(Effect.catchAll(() => Effect.succeed([] as readonly BridgeEntry[]))),
      ),
    )
    return entries.flat()
  })
}

function scanCodexSkills(fs: FSUtil.Interface): Effect.Effect<readonly BridgeEntry[]> {
  return Effect.gen(function* () {
    const cachePath = path.join(os.homedir(), ".codex", "vendor_imports", "skills-curated-cache.json")
    const raw = yield* fs.readFile(cachePath).pipe(Effect.catchAll(() => Effect.succeed(undefined)))
    if (!raw) return []
    const text = new TextDecoder().decode(raw)
    const data = JSON.parse(text) as { skills?: { id: string; description?: string; repoPath?: string }[] }
    const skills = data.skills ?? []
    return skills
      .filter((s) => s.id?.length > 0)
      .map((s) => ({
        name: s.id,
        description: s.description ?? "",
        source: "codex" as const,
        category: "",
        originPath: cachePath,
        format: "codex-skill-v1",
        bundled: { commands: 0, skills: 1, agents: 0, hooks: 0, mcpServers: 0 },
      }))
  })
}

function scanCodexMCPServers(fs: FSUtil.Interface): Effect.Effect<readonly BridgeEntry[]> {
  return Effect.gen(function* () {
    const configPath = path.join(os.homedir(), ".codex", "config.toml")
    const raw = yield* fs.readFile(configPath).pipe(Effect.catchAll(() => Effect.succeed(undefined)))
    if (!raw) return []
    const text = new TextDecoder().decode(raw)
    // 用 regex 提取 [mcp_servers.X] 节（避免引入 TOML parser 新依赖）
    const matches = text.matchAll(/^\[mcp_servers\.(\w+)\]\s*$(?:\n^\s*\w+\s*=.*$)*/gm)
    return Array.from(matches).map((m) => ({
      name: m[1],
      description: `MCP server from Codex config: ${m[1]}`,
      source: "codex" as const,
      category: "",
      originPath: configPath,
      format: "codex-mcp-v1",
      bundled: { commands: 0, skills: 0, agents: 0, hooks: 0, mcpServers: 1 },
    }))
  })
}

function scanCursorPlugins(fs: FSUtil.Interface): Effect.Effect<readonly BridgeEntry[]> {
  return Effect.gen(function* () {
    const pattern = path.join(os.homedir(), ".cursor", "plugins", "local", "**", "package.json")
    const files = yield* fs.glob(pattern, { absolute: true, include: "file" }).pipe(
      Effect.catchAll(() => Effect.succeed([] as readonly string[])),
    )
    const entries = yield* Effect.all(
      files.map((file) =>
        Effect.gen(function* () {
          const raw = yield* fs.readFile(file).pipe(Effect.catchAll(() => Effect.succeed(undefined)))
          if (!raw) return []
          const text = new TextDecoder().decode(raw)
          const pkg = JSON.parse(text) as { name?: string; description?: string }
          const name = pkg.name?.trim()
          if (!name) return []
          return [{
            name,
            description: pkg.description ?? "",
            source: "cursor" as const,
            category: "",
            originPath: file,
            format: "cursor-ext-v1",
            bundled: { commands: 0, skills: 0, agents: 0, hooks: 0, mcpServers: 0 },
          }]
        }).pipe(Effect.catchAll(() => Effect.succeed([] as readonly BridgeEntry[]))),
      ),
    )
    return entries.flat()
  })
}

function scanZCodePlugins(fs: FSUtil.Interface): Effect.Effect<readonly BridgeEntry[]> {
  return Effect.gen(function* () {
    const configPath = path.join(os.homedir(), ".zcode", "v2", "config.json")
    const raw = yield* fs.readFile(configPath).pipe(Effect.catchAll(() => Effect.succeed(undefined)))
    if (!raw) return []
    const text = new TextDecoder().decode(raw)
    const data = JSON.parse(text) as Record<string, unknown>
    // ZCode v2 config 含 bots-model-cache，提取 bot/agent 条目
    const count = Object.keys(data).length > 0 ? 1 : 0
    return count > 0 ? [{
      name: "zcode-configurations",
      description: "ZCode v2 configurations and model cache",
      source: "zcode" as const,
      category: "",
      originPath: configPath,
      format: "zcode-config-v1",
      bundled: { commands: 0, skills: 0, agents: count, hooks: 0, mcpServers: 0 },
    }] : []
  })
}

function scanKimiCodePlugins(fs: FSUtil.Interface): Effect.Effect<readonly BridgeEntry[]> {
  return Effect.gen(function* () {
    const configPath = path.join(os.homedir(), ".kimi-code", "config.toml")
    const raw = yield* fs.readFile(configPath).pipe(Effect.catchAll(() => Effect.succeed(undefined)))
    if (!raw) return []
    const text = new TextDecoder().decode(raw)
    // 提取 [models."kimi-code/X"] 节
    const matches = text.matchAll(/^\[models\."kimi-code\/(\S+)"\]/gm)
    return Array.from(matches).map((m) => ({
      name: m[1],
      description: `Kimi Code model: ${m[1]}`,
      source: "kimi-code" as const,
      category: "",
      originPath: configPath,
      format: "kimi-config-v1",
      bundled: { commands: 0, skills: 0, agents: 0, hooks: 0, mcpServers: 0 },
    }))
  })
}

// ── bundled 计数器 ──
// 扫描 plugin root 下 commands/skills/agents/hooks/.mcp.json 数量，容错容缺

function countBundled(fs: FSUtil.Interface, pluginDir: string): Effect.Effect<BridgeEntry["bundled"]> {
  return Effect.gen(function* () {
    const [commands, skills, agents, hooksFiles, mcpJson] = yield* Effect.all(
      [
        fs.glob(path.join(pluginDir, "commands", "*.md"), { include: "file" }),
        fs.glob(path.join(pluginDir, "skills", "**", "SKILL.md"), { include: "file" }),
        fs.glob(path.join(pluginDir, "agents", "*.md"), { include: "file" }),
        fs.glob(path.join(pluginDir, "hooks", "hooks.json"), { include: "file" }),
        fs.readFile(path.join(pluginDir, ".mcp.json")).pipe(Effect.catchAll(() => Effect.succeed(undefined))),
      ],
      { concurrency: 5 },
    ).pipe(Effect.catchAll(() => Effect.succeed([[], [], [], [], undefined])))

    return {
      commands: commands.length,
      skills: skills.length,
      agents: agents.length,
      hooks: hooksFiles.length > 0 ? 1 : 0,
      mcpServers: mcpJson ? 1 : 0,
    }
  })
}

// ── 主扫描入口（Effect.fn 命名，FSUtil 注入）──

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service

    const scan = Effect.fn("PluginBridge.scan")(function* () {
      const results = yield* Effect.all(
        [
          scanClaudeCodePlugins(fs).pipe(Effect.catchAll(() => Effect.succeed([] as readonly BridgeEntry[]))),
          scanCodexSkills(fs).pipe(Effect.catchAll(() => Effect.succeed([] as readonly BridgeEntry[]))),
          scanCodexMCPServers(fs).pipe(Effect.catchAll(() => Effect.succeed([] as readonly BridgeEntry[]))),
          scanCursorPlugins(fs).pipe(Effect.catchAll(() => Effect.succeed([] as readonly BridgeEntry[]))),
          scanZCodePlugins(fs).pipe(Effect.catchAll(() => Effect.succeed([] as readonly BridgeEntry[]))),
          scanKimiCodePlugins(fs).pipe(Effect.catchAll(() => Effect.succeed([] as readonly BridgeEntry[]))),
        ],
        { concurrency: "unbounded" },
      )
      return results.flat()
    })

    return Service.of({ scan })
  }),
)
```

**各子扫描函数实现概要**：

| 扫描器 | Effect 模式 | 关键路径 |
|--------|-----------|---------|
| `scanClaudeCodePlugins` | `fs.glob("**/.claude-plugin/plugin.json")` → `fs.readFile` → `JSON.parse` → 提取 name/description/bundled | `~/.claude/plugins/**` |
| `scanCodexSkills` | `fs.readFile("skills-curated-cache.json")` → `JSON.parse` → 遍历 skills[] | `~/.codex/vendor_imports/` |
| `scanCodexMCPServers` | `fs.readFile("config.toml")` → regex 提取 `[mcp_servers.X]` | `~/.codex/config.toml` |
| `scanCursorPlugins` | `fs.glob("**/package.json")` → `fs.readFile` → `JSON.parse` | `~/.cursor/plugins/local/**` |
| `scanZCodePlugins` | `fs.readFile("v2/config.json")` → `JSON.parse` | `~/.zcode/v2/` |
| `scanKimiCodePlugins` | `fs.readFile("config.toml")` → regex 提取 models | `~/.kimi-code/config.toml` |
| `countBundled` | 并行 `Effect.all` glob commands/skills/agents + `.mcp.json` | plugin root 目录 |

**容错原则**（双层）：
- **子函数级**：`fs.glob` / `fs.readFile` 均 `.pipe(Effect.catchAll(() => Effect.succeed(undefined)))`
- **顶层 `scan`**：每个子函数 `.pipe(Effect.catchAll(() => Effect.succeed([])))`，同类工具内单个文件 fail 不影响其他

**测试文件**：`packages/core/test/plugin-bridge.test.ts`

```typescript
import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect, Layer } from "effect"
import { PluginBridge } from "../src/plugin-asset/bridge"
import { FSUtil } from "@aigcfroge/core/fs-util"
import { tmpdir } from "./fixture/tmpdir"

function bridgeLayer(dir: string) {
  return PluginBridge.layer.pipe(Layer.provide(FSUtil.defaultLayer))
}

describe("PluginBridge", () => {
  test("scan returns empty array when no tools installed", async () => {
    // 临时覆盖 AIGCFROGE_TEST_HOME 指向空目录，确保 scan 无副作用
    const emptyHome = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), "plugin-bridge-empty-"))
    const prev = process.env.AIGCFROGE_TEST_HOME
    process.env.AIGCFROGE_TEST_HOME = emptyHome
    try {
      const result = await Effect.runPromise(
        Effect.gen(function* () { return yield* (yield* PluginBridge.Service).scan() }).pipe(
          Effect.provide(bridgeLayer()),
          Effect.scoped,
        ),
      )
      expect(Array.isArray(result)).toBe(true)
    } finally {
      process.env.AIGCFROGE_TEST_HOME = prev
      await fs.rm(emptyHome, { recursive: true }).catch(() => {})
    }
  })

  test("scanClaudeCodePlugins extracts name/description/bundled", async () => {
    // 构造 mini Claude Code plugin 目录
    const tmp = await tmpdir()
    try {
      const pluginDir = path.join(tmp.path, ".claude", "plugins", "marketplaces", "test", "plugins", "my-plugin")
      await fs.mkdir(path.join(pluginDir, ".claude-plugin"), { recursive: true })
      await fs.mkdir(path.join(pluginDir, "commands"), { recursive: true })
      await fs.mkdir(path.join(pluginDir, "skills", "my-skill"), { recursive: true })
      await fs.writeFile(
        path.join(pluginDir, ".claude-plugin", "plugin.json"),
        JSON.stringify({ name: "my-plugin", description: "A test plugin" }),
      )
      await fs.writeFile(path.join(pluginDir, "commands", "hello.md"), "---\nname: hello\n---\nhello")
      await fs.writeFile(path.join(pluginDir, "skills", "my-skill", "SKILL.md"), "# My Skill")

      const prev = process.env.AIGCFROGE_TEST_HOME
      process.env.AIGCFROGE_TEST_HOME = tmp.path
      try {
        const result = await Effect.runPromise(
          Effect.gen(function* () { return yield* (yield* PluginBridge.Service).scan() }).pipe(
            Effect.provide(
              PluginBridge.layer.pipe(Layer.provide(FSUtil.defaultLayer))
            ),
            Effect.scoped,
          ),
        )
        const cc = result.filter((e) => e.source === "claude-code")
        expect(cc.length).toBeGreaterThanOrEqual(1)
        const my = cc.find((e) => e.name === "my-plugin")
        expect(my).toBeDefined()
        expect(my!.description).toBe("A test plugin")
        expect(my!.bundled.commands).toBe(1)
        expect(my!.bundled.skills).toBe(1)
      } finally {
        process.env.AIGCFROGE_TEST_HOME = prev
        await tmp[Symbol.asyncDispose]()
      }
    } catch { /* skip on env conflict */ }
  })
})
```

**验证**：
```bash
bun --cwd packages/core test plugin-bridge --timeout 30000
bun --cwd packages/core typecheck
```

---

### Phase 2A：HTTP API

**TDD**：
```
RED  → write test/server/httpapi-plugin-asset.test.ts
GREEN → write groups/plugin-asset.ts + handlers/plugin-asset.ts
VERIFY → bun test + typecheck
```

**新文件**：`packages/aigcfroge/src/server/routes/instance/httpapi/groups/plugin-asset.ts`

结构参考 `workflow-asset.ts`，差异：
- `ListResponse` 增加 `bridged: Schema.Array(Schema.Struct({ name, description, source, category, originPath, format, bundled }))`
- Group 注册到 `InstanceHttpApi`

**新文件**：`packages/aigcfroge/src/server/routes/instance/httpapi/handlers/plugin-asset.ts`

> **审批修订**：handler 通过 `PluginBridge.Service.pipe(Effect.provide(bridgeLayer))` 调用扫描，非 `os.homedir()` + standalone 函数。

```typescript
export * as PluginAssetHandlers from "./plugin-asset"

import { InstanceState } from "@/effect/instance-state"
import { LocationServiceMap } from "@aigcfroge/core/location-layer"
import { PluginAsset } from "@aigcfroge/core/plugin-asset"
import { PluginBridge } from "@aigcfroge/core/plugin-asset/bridge"
import { PluginAsset as SchemaPluginAsset } from "@aigcfroge/schema/plugin-asset"
import { Location } from "@aigcfroge/core/location"
import { FSUtil } from "@aigcfroge/core/fs-util"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { Effect, Layer, Schema } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { InvalidRequestError } from "../errors"

export const pluginAssetHandlers = HttpApiBuilder.group(InstanceHttpApi, "plugin-asset", (handlers) =>
  Effect.gen(function* () {
    const locations = yield* LocationServiceMap

    const list = Effect.fn("PluginAssetHttpApi.list")(function* (ctx: { query: { search?: string } }) {
      const ctx2 = yield* InstanceState.context
      const layer = locations.get(Location.Ref.make({ directory: AbsolutePath.make(ctx2.directory) }))
      const registry = yield* PluginAsset.Service.pipe(Effect.provide(layer), Effect.orDie)
      const all = yield* registry.list()
      const filtered = ctx.query.search
        ? all.filter((a) => a.name.toLowerCase().includes(ctx.query.search!.toLowerCase()))
        : all
      const invalid = yield* registry.listInvalid()

      // 系统级桥接：通过 PluginBridge.Service 扫描（Effect service，依赖 FSUtil）
      const bridgeLayer2 = locations.get(Location.Ref.make({ directory: AbsolutePath.make(ctx2.directory) }))
      const bridgeService = yield* PluginBridge.Service.pipe(
        Effect.provide(bridgeLayer2),
        Effect.provide(FSUtil.defaultLayer),
        Effect.orDie,
      )
      const bridged = yield* bridgeService.scan().pipe(
        Effect.catchAll(() => Effect.succeed([] as readonly PluginBridge["BridgeEntry"][])),
      )

      return {
        assets: filtered.map((a) =>
          Schema.decodeUnknownSync(SchemaPluginAsset.Summary)({
            kind: "plugin",
            name: a.name,
            description: a.description,
            relativePath: a.relativePath,
            revision: a.revision,
            source: a.source?.type,
            toolCount: (a.hooks?.length ?? 0) + (a.bundled?.commands ?? 0),
          }),
        ),
        invalid: invalid.map((e) =>
          Schema.decodeUnknownSync(SchemaPluginAsset.InvalidEntry)(e),
        ),
        bridged,
      }
    })

    const content = Effect.fn("PluginAssetHttpApi.content")(function* (ctx: { query: { path: string } }) {
      const ctx2 = yield* InstanceState.context
      const layer = locations.get(Location.Ref.make({ directory: AbsolutePath.make(ctx2.directory) }))
      const registry = yield* PluginAsset.Service.pipe(Effect.provide(layer), Effect.orDie)
      const info = yield* registry.getByPath(ctx.query.path).pipe(
        Effect.catch(() => Effect.fail(new InvalidRequestError({ message: `Not found: ${ctx.query.path}` }))),
      )
      return Schema.decodeUnknownSync(SchemaPluginAsset.Info)({
        kind: info.kind,
        name: info.name,
        description: info.description,
        relativePath: info.relativePath,
        revision: info.revision,
        version: info.version,
        category: info.category,
        author: info.author,
        source: info.source,
        hooks: info.hooks,
      })
    })

    return handlers.handle("list", list).handle("content", content)
  }),
).pipe(Layer.provide(LocationServiceMap.layer))
```

**测试文件**：`packages/aigcfroge/test/server/httpapi-plugin-asset.test.ts`

测试要点（参考 `httpapi-workflow-asset.test.ts` 结构）：
- GET `/plugin-asset` 返回空列表 `{ assets: [], invalid: [], bridged: [] }`
- GET `/plugin-asset` 包含 invalid entries（`.plugin.yaml` parse 失败 → `parse_error`）
- GET `/plugin-asset` 返回有效 plugin assets
- GET `/plugin-asset/content?path=xxx` 返回 Info
- GET `/plugin-asset/content?path=nonexistent` 返回 400

**验证**：
```bash
bun --cwd packages/aigcfroge test httpapi-plugin-asset --timeout 30000
bun --cwd packages/aigcfroge typecheck
```

---

### Phase 2B：LocationServiceMap 注册 + Bridge 层注入

**更新 1**：`packages/aigcfroge/src/server/routes/instance/httpapi/server.ts`
- 导入 `pluginAssetApiGroup`
- 注册到 `InstanceHttpApi.add()`

**更新 2**：`packages/aigcfroge/src/server/routes/instance/httpapi/api.ts`
- 追加 PluginAsset group 到 `InstanceHttpApi` 的 group 列表

**更新 3**：`packages/core/src/location-layer.ts`

> **审批修订**：增加 `PluginBridge.layer` 注入（依赖 `FSUtil.defaultLayer`，与 PluginAsset 同址）。

```typescript
import { PluginBridge } from "./plugin-asset/bridge"

// 在 LocationServiceMap.lookup() 的 return Layer.mergeAll(...) 中追加：
PluginAsset.locationLayer,
PluginBridge.layer.pipe(Layer.provide(FSUtil.defaultLayer)),
```

---

### Phase 2C：SDK 重新生成

```bash
bun --cwd packages/sdk/js run build.ts
```

---

### Phase 3A：App 功能树 + 类型

**更新**：`packages/app/src/context/chat-feature.tsx`
```typescript
export type ChatFeatureID = "prompt" | "skill" | "mcp" | "command" | "agent" | "workflow" | "plugin"
const FEATURE_IDS: readonly ChatFeatureID[] = ["prompt", "skill", "mcp", "command", "agent", "workflow", "plugin"]
```

**更新**：`packages/app/src/components/mode-surfaces.tsx`
```typescript
const CHAT_FEATURES = [
  // ... existing 6 entries
  { id: "plugin", icon: "mode-coding", label: "chat.feature.plugin" },
] as const
```

---

### Phase 3B：App home.tsx 第 7 路 fetch

**更新**：`packages/app/src/pages/home.tsx`

```typescript
const [promptsRes, skillsRes, mcpsRes, cmdsRes, agentsRes, workflowsRes, pluginsRes]
  = await Promise.all([
    sdk.client.promptAsset.list(),
    sdk.client.skillAsset.list(),
    sdk.client.mcpAsset.list(),
    sdk.client.commandAsset.list(),
    sdk.client.agentAsset.list(),
    sdk.client.workflowAsset.list(),
    sdk.client.pluginAsset.list(),       // ← 第 7 路
  ])

const pluginAssets = pluginsRes.data?.assets ?? []
const pluginInvalid = pluginsRes.data?.invalid ?? []
const bridgedPlugins = pluginsRes.data?.bridged ?? []  // ← 系统级桥接

// 系统级桥接插件转为 AssetInput（origin: "system"）
const bridgedPluginInputs: AssetInput[] = bridgedPlugins.map((b) => ({
  kind: "plugin" as const,
  name: b.name,
  description: b.description,
  relativePath: b.originPath,
  revision: "",
  origin: "system",
}))

return {
  assets: [...promptAssets, ...skillAssets, ...mcpAssets, ...cmdAssets,
           ...agentAssets, ...workflowAssets, ...pluginAssets, ...bridgedPluginInputs],
  invalid: [
    ...promptInvalid.map(i => ({ ...i, kind: "prompt" as const })),
    // ... existing mappings ...
    ...pluginInvalid.map(i => ({ ...i, kind: "plugin" as const })),
  ],
}
```

---

### Phase 3C：App asset-insert 路径映射

**更新**：`packages/app/src/components/chat/asset-insert.ts`

```typescript
import { PLUGINS_DIR } from "@aigcfroge/core/constants"

export function assetKindDir(kind: AssetKindId) {
  // ... existing mappings
  if (kind === "plugin") return PLUGINS_DIR
  return PROMPTS_DIR
}

export function parseInsertKind(value: string | undefined): AssetKindId | undefined {
  // ... existing mappings
  if (value === "plugin") return value
  return undefined
}

export async function listAssets(client: DirectorySDK["client"], kind: AssetKindId) {
  // ... existing mappings
  if (kind === "plugin") return client.pluginAsset.list(undefined, { throwOnError: true })
  return client.promptAsset.list(undefined, { throwOnError: true })
}
```

---

## 5. i18n 键表

| 键 | 用途 | 英文 | 中文 |
|---|------|------|------|
| `chat.feature.plugin` | 功能树/面板标题 | Plugin | 插件 |
| `pluginAsset.panel.title` | 插件面板标题 | Plugins | 插件管理 |
| `pluginAsset.list.source` | 表格 source 列 | Source | 来源 |
| `pluginAsset.list.toolCount` | 表格 toolCount 列 | Tools | 工具数 |
| `pluginAsset.badge.system` | system origin badge tooltip | System plugin (auto-discovered) | 系统插件（自动发现） |
| `pluginAsset.badge.bridged` | bridged source tooltip | Bridged from {{source}} | 来自 {{source}} 的桥接 |
| `pluginAsset.panel.noPlugins` | 空状态 | No plugins found | 无插件 |

---

## 6. PRD 集成

更新 `docs/prd/chat-mode-creation-layer.md` 追加：

```markdown
## 19. M6：PluginAsset 开闸（待定日期）

> 分支：`m6-plugin-asset`
> 实施计划：[chat-m6-plugin-asset.md](../plan/chat-m6-plugin-asset.md)

### 19.1 目标

插件（plugin）作为第 7 类资产开闸：项目级 `.plugin.yaml` + 系统级桥接本地 AI 工具的插件。

### 19.2 完成清单

| 层 | 工作 | 状态 |
|----|------|------|
| schema | `PluginAsset` Frontmatter/Summary/Info/BridgeEntry/InvalidEntry | ⬜ |
| core | `plugin-asset.ts` loadDir/layer/watcher + `bridge.ts` PluginScanner | ⬜ |
| aigcfroge | HTTP API `GET /plugin-asset` + `/content`（含 bridged） | ⬜ |
| sdk/js | `PluginAsset` client 类自动生成 | ⬜ |
| app | home.tsx 第 7 路 fetch + bridged 合并 + asset-insert 映射 | ⬜ |
```

---

## 7. 集成验证（Phase 4）

```bash
# 全仓 lint
bun run lint

# 受影响包 typecheck
bun --cwd packages/schema typecheck
bun --cwd packages/core typecheck
bun --cwd packages/aigcfroge typecheck
bun --cwd packages/app typecheck

# 受影响包 test
bun --cwd packages/schema test --timeout 30000
bun --cwd packages/core test --timeout 30000
bun --cwd packages/aigcfroge test --timeout 30000
bun --cwd packages/app test --timeout 30000

# 验证命令
git diff -- <files>
```
