# AigcForge 安全依赖治理 — 完整执行手册

> **审计基线**: 2026-07-28 `bun audit`（142 漏洞：3 critical / 40 high / 77 moderate / 22 low）
> **关联协议**: [CLAUDE.md](../../CLAUDE.md) · [ARCHITECTURE.md](../../ARCHITECTURE.md) · [DESIGN.md](../../DESIGN.md) · [AGENTS.md](../../AGENTS.md)
> **架构**: 22 workspace 包 + 4 部署单元，Effect Layer 组合，Drizzle + SQLite
> **上游**: anomalyo/opencode (dev 分支, fork 基线 v1.17.9, 362 提交差距, 无 git 血缘)

## 上游对照审计结论 (2026-07-28)

| 依赖 | 我们 | 上游 | 判定 |
|---|---|---|---|
| js-yaml | ^3.14.0 | **不存在** | 🔴 100% fork 引入 (M7) |
| dompurify | 3.3.1 | 3.3.1 | 🟡 上游继承, session-ui 为 fork 扩展 |
| minimatch | 10.0.3 | 10.0.3 | 🟢 完全相同 |
| nitro | 3.0.1-alpha.1 | 3.0.1-alpha.1 | 🟢 完全相同 |
| astro | 5.7.13 | 5.7.13 | 🟢 完全相同 |
| AI SDK 系列 | 3.0.49-82 | 3.0.84-102 | 🔴 **我们落后, 路线图已补** |

无 git 血缘意味着无法 cherry-pick 或 merge 上游提交。所有修复必须在本地实施，但安全升级后应持续监控上游是否也做了同类修复——若是，后续 port 时优先用上游方案替换我们的临时修复。

---

## 0. 总图：攻击面 × 架构边界 × 修复批次

### 0.1 七攻击面与 Layer 边界

```
                              公网 / 用户 / LLM 输出
                                     │
   ┌──────────────┬──────────────────┼──────────────────┬──────────────┐
   │              │                  │                  │              │
   ▼              ▼                  ▼                  ▼              ▼
┌────────┐  ┌──────────┐  ┌──────────────┐  ┌──────────────┐  ┌───────────┐
│enterprise│ │  web      │  │ session-ui    │  │    core       │  │ function  │
│SolidStart│ │ Astro+CF  │  │ SolidJS       │  │  领域层        │  │ CF Worker │
│          │ │           │  │               │  │               │  │           │
│Hono CORS │ │ SSR       │  │ DOMPurify     │  │ js-yaml.load()│  │ Hono 无   │
│无来源限制│ │ 0.0.0.0  │  │ sanitize()    │  │ (4处)         │  │ CORS中间件│
│公网API   │ │ Cloudflare│  │ LLM HTML→DOM  │  │ Arborist→tar  │  │ GitHub JWT│
└────┬─────┘ └────┬─────┘ └──────┬───────┘ └──────┬───────┘ └─────┬─────┘
     │            │              │                 │               │
     │   攻击面1  │    攻击面2   │     攻击面3     │ 攻击面4/5/6   │
     │   Hono    │    Astro     │    DOMPurify    │ js-yaml/tar   │
     │           │              │                 │ xml/minimatch │
     └───────────┴──────────────┴─────────────────┴───────────────┘
                                    │
                          Effect Layer 组合边界
                                    │
                    Layer.mergeAll(AppLayer)
                    Layer.provide(BootstrapLayer)
                    LayerNode.buildLayer(app)
```

### 0.2 攻击面→数据流→Layer→修复对照表

| # | 攻击面 | 数据来源 | 数据流路径 | Layer 边界 | 关键文件 | 漏洞类型 | 批次 |
|---|---|---|---|---|---|---|---|
| 1 | 公网 API | HTTP → cors() → Hono | enterprise→Hono→SolidStart | `enterprise/vite.config.ts` Nitro preset | `enterprise/.../[...path].ts:15` | CORS/SSRF | A |
| 2 | SSR 渲染 | HTTP → Astro SSR → Cloudflare | web→Astro→@astrojs/cloudflare | `web/astro.config.mjs` adapter | `web/astro.config.mjs:16` | Host Header SSRF | B |
| 3 | XSS 注入 | LLM→marked.parse→DOMPurify→DOM | session-ui→app | `Layer.provide(ui)` 在 app 侧 | `markdown-cache.tsx:37` | XSS/配置污染 | A |
| 4 | YAML DoS | LLM提议+文件→yaml.load | core→aigcfroge→server | `ProposePluginAsset.layer` | `propose-plugin-asset.ts:116` | 代码执行 | C |
| 5 | Tarball DoS | npm注册表→Arborist→tar | core→aigcfroge | `Npm.defaultLayer` | `npm.ts:82-100` | DoS | A |
| 6 | XML DoS | AWS响应→fast-xml-parser | core→aigcfroge | `Provider.defaultLayer` | `@aws-sdk/credential-providers` | DoS | C |
| 7 | Glob ReDoS | 用户输入→minimatch | core→aigcfroge→tui | `FSUtil.glob` | `glob.ts:32` | ReDoS | A |

### 0.3 上下游 5 层递进示例（DOMPurify）

```
L5 消费者  app(SolidJS) → dom渲染sanitized HTML
    │                    → Layer.provide(ui/SessionUI)
    │
L4 组合层  session-ui/markdown.tsx:352
    │      → sanitizeMarkdown(await marked.parse(block.src))
    │
L3 净化层  session-ui/markdown-cache.tsx:37
    │      → DOMPurify.sanitize(html, config)
    │      → addHook("afterSanitizeAttributes") 添加noopener
    │
L2 转换层  marked.parse(block.src) → LLM输出的markdown→HTML
    │
L1 来源层  LLM模型输出 (EventStream) → 不受信markdown文本
```

### 0.4 上下游 5 层递进（js-yaml — 最危险）

```
L5 消费者  Chat UI → 用户审批Plugin/Workflow资产
    │
L4 Handler  server/routes/instance/httpapi/handlers/
    │       → ProposePluginAsset handler → 接收LLM提议
    │       → Layer.provide(PluginAsset.defaultLayer)
    │
L3 解析层  core/tool/propose-plugin-asset.ts:116
    │      → yaml.load(content)  ← LLM生成的不受信YAML
    │      core/tool/propose-workflow-asset.ts:116
    │      → yaml.load(content)
    │
L2 资产层  core/plugin-asset.ts:72
    │      → yaml.load(text)  ← 文件系统.plugin.yaml
    │      core/workflow-asset.ts:70
    │      → yaml.load(text)  ← 文件系统.workflow.yaml
    │
L1 来源层  LLM输出(propose_*_asset工具参数content字段)
           + 用户文件系统(.claude/plugins/, .claude/workflows/)
```

---

## 批次 A: `security-deps` — 7月28-30日

> 目标: 直接运行时依赖 0 critical，公开请求入口 0 high
> 修复项: A1 js-yaml → A2 tar → A3 DOMPurify → A4 Hono/Nitro → A5 minimatch → A6 AI SDK 同步

### A1. js-yaml 3.14.2 → 4.2.0 ⚠️ 最高优先级 — Fork 引入

> 🔴 **100% 自有代码, 无上游补丁可移植。** 上游 opencode 不使用 js-yaml。Chat M7 (plugin-asset / workflow-asset / propose-*-asset) 新增了此依赖和 4 处 `yaml.load()` 调用点。必须本地修复，不可等待上游。

**严重性**: 4处 `yaml.load()` (非 safeLoad) 直接处理 LLM 输出+用户文件，可被利用实现代码执行。

**调用点审计**:

| 文件 | 行号 | 输入来源 | 数据信任级别 |
|---|---|---|---|
| `core/src/tool/propose-plugin-asset.ts` | 116 | `Input.content` — LLM 生成 | **零信任** |
| `core/src/tool/propose-workflow-asset.ts` | 116 | `Input.content` — LLM 生成 | **零信任** |
| `core/src/plugin-asset.ts` | 72 | 文件系统 `.plugin.yaml` | 用户控制 |
| `core/src/workflow-asset.ts` | 70 | 文件系统 `.workflow.yaml` | 用户控制 |

**Layer 影响追踪**:
```
ProposePluginAsset.layer → PluginAsset.defaultLayer → FSUtil.defaultLayer
                                                         → Schema.decodeUnknownSync(Frontmatter)
```
yaml.load() 发生在 Schema 验证**之前** — 恶意payload在验证前已经执行。

**TDD 工作流**:

```
Phase 1: 建立安全回归基线
  □ 创建 core/test/yaml-security.test.ts
  □ 6 个测试探针（在当前 3.14.2 下运行，部分应 FAIL）:

     TEST-1: 正常 plugin YAML 解析
      输入: "name: test\ndescription: A test plugin\nversion: 1.0.0"
      断言: 解析成功，各字段类型正确

     TEST-2: 锚点 + alias
      输入: "defaults: &def\n  version: 1.0.0\nplugin:\n  <<: *def\n  name: test"
      断言: alias 正确展开

     TEST-3: 深层嵌套 (1000层)
      输入: "a:\n" + "  b:\n".repeat(1000) + "    value: leaf"
      断言: 在 5s 超时内完成或被 Effect.timeout 捕获

     TEST-4: merge key (<<)
      输入: 包含 "<<" 合并键的YAML
      断言: 在 js-yaml@4 中应被拒绝或安全处理

     TEST-5: 自定义 tag (!custom)
      输入: "value: !custom x"
      断言: 应抛出或被拒绝

     TEST-6: 超大文件炸弹 (10MB)
      输入: 生成 10MB merge-key 嵌套YAML
      断言: 应有字节数限制或超时

Phase 2: 升级 + API 迁移验证 (v3→v4 破坏性大版本)
  □ bun update js-yaml@^4.2.0
  □ v3→v4 API 迁移对照:
    v3: yaml.load(str) = unsafe → v4: yaml.load(str) = safe ✓
    v3: yaml.safeLoad(str)       → v4: yaml.load(str)
    v3: yaml.unsafeLoad          → v4: 不存在
  □ grep 确认仅 4 处 yaml.load() 调用，无其他 v3-only API
  □ 回退保险: 若升级失败 → overrides "js-yaml": "3.14.2" + 替换全部 load→safeLoad

Phase 3: 加固
  □ 在每个 yaml.load() 调用前增加:
    - 最大字节数限制: 1MB (plugin/propose), 5MB (workflow/propose)
    - Effect.timeout(5_000) 包裹解析
    - 捕获 YAMLException 转 typed error (YamlParseError extends Schema.TaggedErrorClass)
  □ 示例加固代码:
    ```ts
    const MAX_YAML_BYTES = 1_000_000
    const doc = yield* Effect.try({
      try: () => {
        if (text.length > MAX_YAML_BYTES) return yield* new YamlSizeError({ size: text.length })
        return load(text)
      },
      catch: (e) => new YamlParseError({ cause: Schema.Defect(e) })
    }).pipe(Effect.timeout("5 seconds"))
    ```

Phase 4: 验证
  □ 重跑 6 个安全探针 → 全部 PASS
  □ core test: plugin/workflow/propose 相关测试套件
  □ aigcfroge test: plugin/workflow 相关测试套件

Phase 5: 回退
  □ 若 v4 升级导致现有 YAML 解析失败: overrides js-yaml@3.14.2 + 全局替换 load→safeLoad
  □ v4 迁移可推迟，v3 safeLoad 足以阻断代码执行向量
```

```bash
# 验证命令
bun --cwd packages/core test --timeout 30000 --test-name-pattern="yaml|plugin.*asset|workflow.*asset|propose"
bun --cwd packages/core test --timeout 30000
bun --cwd packages/aigcfroge test --timeout 30000 --test-name-pattern="plugin|workflow"
```

---

### A2. tar 7.5.16 → 7.5.18

**Layer 追踪**:
```
aigcfroge → Npm.defaultLayer → npm.ts → dynamic import("@npmcli/arborist")
                                            → new Arborist({ ignoreScripts: true })
                                            → arborist.reify() → tar 解压
```

**关键代码** (`core/src/npm.ts:82-100`):
```ts
const { Arborist } = yield* Effect.promise(() => import("@npmcli/arborist"))
const arborist = new Arborist({
  path: dir, binLinks: true, progress: false,
  savePrefix: "", ignoreScripts: true,  // ← 阻断安装脚本，不阻断解压DoS
})
arborist.reify({ add, save: true, saveType: "prod" })
```

**TDD 工作流**:

```
Phase 1: 建立回归
  □ 创建 core/test/npm-security.test.ts
  □ 测试: 正常安装 / scoped包 / file:包 / 安装失败恢复 / Windows路径

Phase 2: 升级
  □ bun update @npmcli/arborist 或 overrides: "tar": "7.5.18+"
  □ 确认 ignoreScripts: true 依然生效

Phase 3: 验证
  □ core 1305 测试 → PASS (已知4个基线失败除外)
  □ Windows 路径测试

Phase 4: 回退
  □ 若 Arborist 新版本破坏动态安装: overrides @npmcli/arborist 回旧版 + 仅 override tar@7.5.18
```

```bash
bun --cwd packages/core test --timeout 30000
```

---

### A3. DOMPurify 3.3.1 → 3.4.6+

**Layer 追踪**:
```
app(SolidJS) → session-ui/markdown.tsx → markdown-cache.tsx
                                          → DOMPurify.sanitize(html, config)
                                          → addHook("afterSanitizeAttributes")
```

**当前配置** (`markdown-cache.tsx:12-18`):
```ts
const config = {
  USE_PROFILES: { html: true, mathMl: true },
  SANITIZE_NAMED_PROPS: true,
  FORBID_TAGS: ["style"],
  FORBID_CONTENTS: ["style", "script"],
  ADD_TAGS: ["svg", "path"],
  ADD_ATTR: ["d", "viewBox", "preserveAspectRatio", "xmlns", "target"],
}
```

**注意**: `packages/ui` 的 package.json 声明了 dompurify@3.3.1。上游 opencode 在同一包中有实际使用，我们的 fork 中此导入路径可能已被删除。需在升级前验证: 若确无实际调用 → 清理声明; 若有隐藏使用 → 一并升级。

**TDD 工作流**:

```
Phase 1: 建立8个XSS探针
  □ 创建 session-ui/src/components/sanitize-regression.test.tsx
  □ (session-ui 使用 co-located 测试: package.json 中 "test": "bun test src")
  □ TEST-1: <template> 嵌套逃逸
  □ TEST-2: <svg><foreignObject>
  □ TEST-3: <math><annotation-xml>
  □ TEST-4: javascript: URL
  □ TEST-5: DOM clobbering (id/name属性)
  □ TEST-6: 自定义元素 <evil-el>
  □ TEST-7: target="_blank" → 应有 noopener noreferrer
  □ TEST-8: 正常 markdown → 完整保留

Phase 2: 升级 + 死依赖清理
  □ bun update dompurify@latest (>= 3.4.6)
  □ 验证 packages/ui 中是否有实际 dompurify 导入:
    - 若无 → 从 ui/package.json 删除声明
    - 若有 → 一并升级，确认行为不变

Phase 3: 验证
  □ 重跑8个XSS探针 → 全部PASS
  □ session-ui 54测试 → PASS
  □ app 478测试 → PASS

Phase 4: 回退
  □ 若 3.4.6+ 破坏 markdown 渲染: overrides dompurify@3.3.1 + 人工审查 3.4.x changelog
```

```bash
bun --cwd packages/session-ui test
bun --cwd packages/app test
```

---

### A4. Hono CORS（Enterprise 公开 API）

**发现**: `enterprise/.../[...path].ts:15` — `cors()` 无来源限制。
**发现**: `function/src/api.ts:116` — 完全无 CORS 中间件。

**TDD 工作流**:

```
Phase 1: Enterprise Hono
  □ bun --cwd packages/enterprise update hono@^4.12.18
  □ 添加 CORS 来源白名单 (从环境变量读取)

Phase 2: Function Worker
  □ 添加 CORS 中间件到 function/src/api.ts
  □ bun --cwd packages/function build

Phase 3: 验证
  □ enterprise build → PASS
  □ function build → PASS
  □ 手动测试 API 端点 + CORS 头

Phase 4: 回退
  □ 如果新版本破坏现有 API: overrides hono@4.10.7 + 仅修复 CORS 配置
```

```bash
bun --cwd packages/enterprise build
bun --cwd packages/function build
```

---

### A4b. Nitro Alpha 版本决策（独立决策项）

**发现**: `enterprise/package.json:29` — `nitro@3.0.1-alpha.1` 预发布版本。
**上游**: opencode 上游的 enterprise 包也使用相同的 `nitro@3.0.1-alpha.1`。这是共同问题，非 fork 独有。

这不是版本升级问题，而是 **是否应使用 alpha 版本** 的架构决策。

**决策矩阵**:

| 条件 | 行动 | 时限 |
|---|---|---|
| Enterprise 已公开部署 | 迁移到最新 nitro 稳定版 + 验证 SSR | 同批次 A (7/30前) |
| Enterprise 未公开部署 | 锁定当前 alpha 版本号，记录为已知负债 | 8/4前决策 |
| 无论何种情况 | 记录负责人 + 到期日期，纳入每周 audit 检查 | 永久 |

**行动**: 在 CLAUDE.md 或项目看板中记录此技术负债，含 owner、到期日、和 reachability rationale。

```bash
bun --cwd packages/enterprise build
bun --cwd packages/function build
```

---

### A5. minimatch 10.0.3 → 10.2.5

**Layer 追踪**:
```
core/src/util/glob.ts:32 → minimatch(filepath, pattern, { dot: true })
  ↓ 调用方:
  FSUtil.glob → 资产发现 (plugin/workflow/prompt/skill/agent/command/mcp-asset)
              → skill.ts 文件发现
              → glob tool → 用户提供的 pattern → 攻击面
```

**TDD**: `bun update minimatch` + core/tui 全量测试。旧版 8/9/3 分支来自构建依赖，不可达，可忽略。

**回退**: overrides minimatch@10.0.3 + 等待 @npmcli 生态完成迁移。

```bash
bun --cwd packages/core test --timeout 30000
bun --cwd packages/tui test --timeout 30000
```

---

### A6. AI SDK 上游同步（新增 — 上游审计发现）

**发现**: 上游 opencode 的 AI SDK 版本已明显领先我们，差距累积将增大后期 port 成本:

| 包 | 我们的版本 | 上游版本 | 差距 |
|---|---|---|---|
| `@ai-sdk/openai` | 3.0.53 | 3.0.84 | 31 个补丁版本 |
| `@ai-sdk/xai` | 3.0.82 | 3.0.102 | 20 个补丁版本 |
| `@ai-sdk/mistral` | 3.0.27 | 3.0.51 | 24 个补丁版本 |
| `@ai-sdk/azure` | 3.0.49 | 3.0.88 | 39 个补丁版本 |

AI SDK 升级通常是低风险的 leaf dependency 变更（不影响 Effect Layer 架构），但 LLM 层本身就是攻击面 (ARCHITECTURE.md §4.9)。上游的升级可能包含安全修复和模型废弃处理。

**策略**: 不是逐包升级，而是将上游的整个 AI SDK catalog 版本块同步过来:

```
Phase 1: 提取上游 catalog
  □ 从 opencode/dev 提取 workspace catalog 中所有 @ai-sdk/* 版本
  □ 对比差异，确认无 breaking changes

Phase 2: 同步
  □ 更新 catalog → bun install
  □ 此变更不触及 core/aigcfroge 架构，仅更新 provider 版本

Phase 3: 验证
  □ core test (1305) → PASS
  □ aigcfroge test (168) → PASS
  □ llm test → PASS

Phase 4: 回退
  □ 若新版本不兼容: 单包回退到旧 catalog 版本
```

```bash
bun --cwd packages/core test --timeout 30000
bun --cwd packages/aigcfroge test --timeout 30000
bun --cwd packages/llm test --timeout 30000
```

---

## 批次 B: `web-runtime` — 7月30日-8月1日

> 架构耦合高，单独 PR，不和叶子依赖混升

### B1. Astro 5.7.13 → 5.15.7+

**当前配置** (`web/astro.config.mjs`):
```js
export default defineConfig({
  output: "server",          // SSR模式，非纯静态
  adapter: cloudflare({ imageService: "passthrough" }),
  server: { host: "0.0.0.0" }, // 监听所有接口
})
```

**Layer**: web 是树外部署单元，无 Effect Layer，仅 Astro 构建链。

**TDD**:
```
Phase 1: 升级 astro + @astrojs/cloudflare
Phase 2: web build → PASS, dev server → 正常, SSR 渲染 → 正常
Phase 3: SolidStart + Seroval 一起升级验证
Phase 4: 回退 → overrides astro@5.7.13, @astrojs/cloudflare@12.6.3
```

### B2. Seroval 1.3.2 → 1.4.1+

**追踪**: SolidStart → seroval (序列化/反序列化)。项目无直接 fromJSON() 调用。

**TDD**: 随 SolidStart 升级一起 → `bun update solid-start` 或 overrides。
**回退**: overrides seroval@1.3.2 + 验证 app/web SSR 功能不变。

### B3. Nitro/h3

**发现**: `nitro@3.0.1-alpha.1` 预发布版本。h3 是传递依赖，无直接导入。
若 Enterprise 已公开部署 → 同批次 A 处理。若未部署 → 8月4日前。

```bash
bun --cwd packages/web build
bun --cwd packages/enterprise build
```

---

## 批次 C: `parser-network` — 8月1-4日

### C1. fast-xml-parser (AWS SDK路径)

**发现**: 项目直接使用 `@aws-sdk/credential-providers` 和 `@aws-sdk/client-*`，fast-xml-parser 为传递依赖。实际影响路径:

```
core/src/plugin/provider/amazon-bedrock.ts → @aws-sdk/credential-providers
aigcfroge/src/provider/provider.ts → @aws-sdk/credential-providers
stats/core/src/athena.ts → @aws-sdk/client-athena
stats/server/src/ingest.ts → @aws-sdk/client-firehose
```

**TDD**: `bun update @aws-sdk/*` 或 overrides 锁定 fast-xml-parser >= 5.7.3。SST deploy 验证。

### C2. Undici / h3 / brace-expansion 旧分支

通过升级父依赖收敛：`@effect/platform-node`, Actions packages, Nitro, Electron Builder, Arborist。

---

## 批次 D: `baseline-tests` — 8月4-7日

### D1. Core 4个失败

**根因分析**: AssetMigration首次导入 + LocationServiceMap工具目录预期。与最近的Asset/Plugin/Workflow工作直接相关。

**TDD**: 逐个诊断→修复→验证→全量。目标: 4/4修复。

### D2. TUI 8个失败

**已知类型**: Hydration竞态 / 消息窗口合并 / Workspace scope / sync崩溃。

**TDD**: 按类型分组修复，目标至少 4/8。剩余记录为known issue，新增任何第9个失败阻断合并。

```bash
bun --cwd packages/core test --timeout 30000  # 目标: 1305/1305
bun --cwd packages/tui test --timeout 30000   # 目标: ≥174/178
```

---

## 批次 E: 常规维护 — 8月11-25日

| 项目 | 优先级 | 处理方式 |
|---|---|---|
| Vite 7.1.4 | 中 | dev server漏洞，本地-only风险有限；远程开发时提前 |
| Turbo 2.8.13→2.9.14+ | 低 | 开发/CI工具 |
| PostCSS/Sharp | 中 | Web构建链；图片输入可控时提前 |
| OpenTelemetry/Protobuf | 低 | 资源消耗类 |
| UUID/Valibot/Diff | 低 | 常规维护 |
| 48 Prettier基线 | 低 | 独立commit，按包分批避免blame污染 |

---

## 全局验证矩阵

每批完成后必须通过:

```bash
# 1. 安全审计
bun run audit

# 2. 门禁
bun run lint
bun turbo typecheck --force

# 3. 受影响包测试
bun --cwd packages/session-ui test
bun --cwd packages/app test
bun --cwd packages/core test --timeout 30000
bun --cwd packages/tui test --timeout 30000
bun --cwd packages/aigcfroge test --timeout 30000

# 4. 构建验证
bun --cwd packages/web build
bun --cwd packages/enterprise build
bun --cwd packages/function build
bun --cwd packages/desktop typecheck
```

## 审计准入标准（建议新增到 CLAUDE.md）

```yaml
security-audit-policy:
  production-runtime:
    - no critical or high advisories allowed
  dev-only-high:
    - must document unreachability rationale, owner, and expiry date
  moderate:
    - resolve within 30 days
  low:
    - resolve within 90 days
  cadence:
    - bun audit weekly, automated
```
