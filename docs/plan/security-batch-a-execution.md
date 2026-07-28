# 批次 A 安全依赖治理 — 可直接执行实施计划 v2

> **执行日期**: 2026-07-28~30
> **分支**: `security-deps`
> **基线 commit**: `07c5f53fd`
> **审批**: 有条件通过 (v1 → v2), CLAUDE.md / AGENTS.md / ARCHITECTURE.md / upstream 对照全量核验

---

## 执行顺序（按依赖关系排序）

```
Step 1 (js-yaml + @types) → Step 5 (minimatch, 仅 aigcfroge)
→ Step 2 (tar, 合并 overrides)
→ Step 3 (DOMPurify, 先装 happy-dom 再写探针)
→ Step 4 (Hono CORS fail-closed)
→ Step 6 (AI SDK 同步, 排最后因需处置 xai patch)
```

---

## 执行前检查

```bash
cd /media/keer/办公/aigcfroge
git checkout main
git checkout -b security-deps
git status  # 必须 clean
bun run lint
bun typecheck
```

---

## Step 1: js-yaml v3→v4 + 加固 + @types 同步

### 1.1 升级 js-yaml 和 @types/js-yaml

```bash
cd packages/core
bun update js-yaml@^4.2.0
bun update --dev @types/js-yaml@^4.0.0
cd ../..
```

验证:
```bash
grep '"js-yaml' packages/core/package.json
# 预期: "js-yaml": "^4.2.0"
#        "@types/js-yaml": "^4.0.0" (或 ^4)
```

### 1.2 确认 v4 CJS 互操作 — default import 仍有效

4 处均为 `import yaml from "js-yaml"` + `yaml.load(text)`。js-yaml v4 CJS 互操作层下 `yaml.load` 继续有效，**不改导入方式**。

```bash
# 快速冒烟: import 是否可直接 work
node -e "const yaml = require('js-yaml'); console.log(typeof yaml.load)" 2>/dev/null || echo "check in bun"
```

### 1.3 创建安全探针

`packages/core/test/yaml-security.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import yaml from "js-yaml"

describe("js-yaml security regression", () => {
  test("normal YAML parses", () => {
    const doc = yaml.load("name: test\ndescription: A test plugin\nversion: 1.0.0")
    expect(doc).toBeObject()
    expect((doc as any).name).toBe("test")
  })

  test("anchor + alias resolves", () => {
    const doc = yaml.load("defaults: &def\n  version: 1.0.0\nplugin:\n  <<: *def\n  name: test")
    expect(doc).toBeObject()
    expect((doc as any).plugin.name).toBe("test")
  })

  test("deeply nested YAML survives without crash", () => {
    // 1000 层真嵌套（每层递增缩进），非 1000 个平级 key
    let deep = "root: leaf\n"
    for (let i = 0; i < 1000; i++) {
      deep = `a:\n${deep.replace(/^/gm, "  ")}`
    }
    expect(() => yaml.load(deep)).not.toThrow()
  })

  test("custom tag is rejected in v4 safe load", () => {
    expect(() => yaml.load("value: !custom x")).toThrow()
  })

  test("large input (1MB) does not crash", () => {
    const large = "items:\n" + Array.from({ length: 50000 }, (_, i) => `  - id: ${i}\n    name: item-${i}\n`).join("")
    expect(large.length).toBeGreaterThan(900_000)
    expect(() => yaml.load(large)).not.toThrow()
  })
})
```

### 1.4 加固 4 处调用点

**文件 1**: `packages/core/src/plugin-asset.ts:68-77` — 在 `const text = ...` 行后插入字节上限检查:

```ts
const text = new TextDecoder().decode(raw)

const MAX_PLUGIN_YAML = 1_000_000 // 1MB
if (text.length > MAX_PLUGIN_YAML) {
  invalid.set(relativePath, { relativePath, errorTag: "parse_error" })
  yield* Effect.logWarning("Plugin asset exceeds max size", { relativePath, size: text.length })
  continue
}

let doc: unknown
try {
  doc = yaml.load(text)
} catch {
  ...
```

**文件 2**: `packages/core/src/workflow-asset.ts:68-77` — 同样位置，上限 5MB:

```ts
const MAX_WORKFLOW_YAML = 5_000_000
```

**文件 3**: `packages/core/src/tool/propose-plugin-asset.ts:113-118` — 同步纯函数，加固后:

```ts
export function validateContent(content: string): string | null {
  const MAX_PROPOSE_YAML = 1_000_000
  if (content.length > MAX_PROPOSE_YAML) {
    return `Plugin content exceeds maximum ${MAX_PROPOSE_YAML} bytes.`
  }
  let parsed: unknown
  try {
    parsed = yaml.load(content)
  } catch {
    return "Invalid YAML format in plugin content."
  }
```

**文件 4**: `packages/core/src/tool/propose-workflow-asset.ts:113-118` — 同样，上限 5MB。

> **技术债声明**: 当前加固选择"简单实现"（仅字节上限）而非路线图 Phase 3 的 `Effect.timeout` + typed error。理由: `validateContent` 是同步函数，不在 Effect fiber 内，无法用 Effect.timeout。Alias 炸弹防护依赖 js-yaml v4 safe load 自身的拒绝逻辑。若后续发现 v4 safe load 仍有 alias-DoS 的 CVE，需增补超时边界。

### 1.5 验证

```bash
# 安全探针
cd packages/core && bun test --timeout 30000 --test-name-pattern="yaml-security" && cd ../..

# 资产相关测试
cd packages/core && bun test --timeout 30000 --test-name-pattern="plugin|workflow|propose" && cd ../..

# 全量 core
cd packages/core && bun test --timeout 30000 && cd ../..

# aigcfroge 相关
cd packages/aigcfroge && bun test --timeout 30000 --test-name-pattern="plugin|workflow" && cd ../..
```

> **验证语义注意**: core 的 package.json test script 含 `--only-failures`，直接 `bun --cwd packages/core test` 只跑上次失败项。全量验证必须 `cd packages/core && bun test --timeout 30000` 绕开 script。

### 1.6 提交

```bash
git add packages/core/package.json bun.lock
git add packages/core/test/yaml-security.test.ts
git add packages/core/src/plugin-asset.ts
git add packages/core/src/workflow-asset.ts
git add packages/core/src/tool/propose-plugin-asset.ts
git add packages/core/src/tool/propose-workflow-asset.ts
git commit -m "fix(core): upgrade js-yaml 3→4 + input size bounds on 4 call sites"
```

---

## Step 5: minimatch（仅 aigcfroge 包）

### 5.1 核实

core 已是 `minimatch@10.2.5` (`core/package.json:116`)。只有 aigcfroge 仍是 `10.0.3` (`aigcfroge/package.json:129`)。

### 5.2 升级

```bash
cd packages/aigcfroge
bun update minimatch@^10.2.5
cd ../..
```

### 5.3 验证

```bash
cd packages/core && bun test --timeout 30000 && cd ../..
cd packages/tui && bun test --timeout 30000 && cd ../..
```

### 5.4 提交

```bash
git add packages/aigcfroge/package.json bun.lock
git commit -m "fix(aigcfroge): upgrade minimatch 10.0.3→10.2.5 (ReDoS)"
```

---

## Step 2: tar override 7.5.18

### 2.1 合并入已有 overrides 块

根 `package.json:133-139` 已有:

```json
"overrides": {
  "@opentui/*": "catalog:",
  "@types/*": "catalog:"
}
```

**追加** `"tar": "7.5.18"`，不要替换整个块:

```json
"overrides": {
  "@opentui/*": "catalog:",
  "@types/*": "catalog:",
  "tar": "7.5.18"
}
```

```bash
bun install
grep -A2 '"tar@' bun.lock | head -5  # 确认 >= 7.5.18
```

### 2.2 验证

```bash
cd packages/core && bun test --timeout 30000 && cd ../..
```

### 2.3 提交

```bash
git add package.json bun.lock
git commit -m "fix: override tar to 7.5.18 (tarball parse DoS)"
```

---

## Step 3: DOMPurify 3.3.1 → 3.4.6 + XSS 探针

### 3.1 确认 ui 包: 死依赖

```bash
grep -rn "dompurify\|DOMPurify" packages/ui/src/ 2>/dev/null
# 预期: 无输出 → 死依赖
```

### 3.2 清理根 catalog 死条目 + 升级

根 `package.json` workspace catalog 中存在 `"dompurify": "3.3.1"`，两处消费:
- `packages/session-ui`: 有实际使用 → 升级
- `packages/ui`: 死依赖 → 删除声明, catalog 中删除条目

```bash
# 1. 编辑根 catalog: 将 "dompurify": "3.3.1" → "3.4.6"
# 2. 从 packages/ui/package.json 删除 dompurify 声明行
```

```bash
bun install
grep '"dompurify"' packages/session-ui/package.json packages/ui/package.json
# 预期: session-ui 有, ui 无
grep 'dompurify' bun.lock | head -3  # 确认唯一版本 >= 3.4.6
```

### 3.3 安装 happy-dom — session-ui 的 DOM 测试环境

`session-ui` 无任何 DOM 环境配置。`markdown-cache.tsx:36` 在 bun test 无 DOM 时 `DOMPurify.isSupported` 返回 false → 全部探针返回 `""` → 假阳性。

```bash
cd packages/session-ui
bun add --dev happy-dom
cd ../..
```

创建 `packages/session-ui/bunfig.toml`:

```toml
[test]
preload = "./happy-dom-setup.ts"
```

创建 `packages/session-ui/happy-dom-setup.ts`:

```ts
import { GlobalRegistrator } from "@happy-dom/global-registrator"

GlobalRegistrator.register()
```

### 3.4 创建 XSS 安全探针

`packages/session-ui/src/components/sanitize-regression.test.tsx`:

```tsx
import { describe, expect, test } from "bun:test"
import { sanitizeMarkdown } from "./markdown-cache"

describe("sanitize regression", () => {
  test("<template> tag nesting is stripped", () => {
    const result = sanitizeMarkdown("<div><template><p>escaped</p></template></div>")
    expect(result).not.toContain("<template>")
    expect(result).toContain("<div>")
  })

  test("<svg><foreignObject> is stripped", () => {
    const result = sanitizeMarkdown('<svg><foreignObject><div>bad</div></foreignObject></svg>')
    expect(result).not.toContain("<foreignObject>")
  })

  test("javascript: URL is stripped from href", () => {
    const result = sanitizeMarkdown('<a href="javascript:alert(1)">click</a>')
    expect(result).not.toContain("javascript:")
  })

  test("custom elements are stripped", () => {
    const result = sanitizeMarkdown("<evil-el onclick='alert(1)'>bad</evil-el>")
    expect(result).not.toContain("<evil-el>")
  })

  test("target=\"_blank\" gets noopener noreferrer", () => {
    const result = sanitizeMarkdown('<a href="https://safe.com" target="_blank">link</a>')
    expect(result).toContain("noopener")
    expect(result).toContain("noreferrer")
  })

  test("normal markdown HTML is preserved", () => {
    const result = sanitizeMarkdown("<p>hello <strong>world</strong></p>")
    expect(result).toContain("<p>hello")
    expect(result).toContain("<strong>world</strong>")
    expect(result).toContain("</p>")
  })

  test("empty input returns empty", () => {
    expect(sanitizeMarkdown("")).toBe("")
  })
})
```

### 3.5 验证

```bash
cd packages/session-ui && bun test && cd ../..
cd packages/app && bun test && cd ../..
```

### 3.6 提交

```bash
git add packages/session-ui/package.json packages/session-ui/bunfig.toml \
        packages/session-ui/happy-dom-setup.ts \
        packages/session-ui/src/components/sanitize-regression.test.tsx
git add packages/ui/package.json package.json bun.lock  # ui 死依赖删除 + catalog
git commit -m "fix(session-ui): upgrade dompurify 3.3.1→3.4.6 + XSS regression gate; remove dead dep from ui"
```

---

## Step 4: Hono CORS fail-closed + Function fix

### 4.1 升级 hono

hono 走根 `package.json` workspace catalog（`"hono": "4.10.7"`），消费方: `packages/enterprise` + `packages/function`。直接编辑 catalog:

```json
// 根 package.json workspaces.catalog:
"hono": "4.12.18"
```

```bash
bun install
```

### 4.2 Enterprise: CORS fail-closed

`packages/enterprise/src/routes/api/[...path].ts:15`:

```ts
// 旧: .use(cors())
// 新: fail-closed — 未配置白名单时不输出 CORS 头（仅同源访问）
const allowedOrigins = process.env.AIGCFROGE_ALLOWED_ORIGINS
const app = new Hono()
  .use(cors({
    origin: allowedOrigins ? allowedOrigins.split(",") : [],
  }))
```

`origin: []` 使 Hono 不输出 `Access-Control-Allow-Origin` 头 → 浏览器仅允许同源。部署时设 `AIGCFROGE_ALLOWED_ORIGINS=https://your-domain.com`。

### 4.3 Function: 删除 CORS 反射

`packages/function/src/api.ts` — 当前完全无 CORS 中间件。Cloudflare Worker 作为内部服务（DurableObject + GitHub JWT 交换 + Feishu webhook），不需要跨域 CORS。

**不改 function**。如果外部调用方确有跨域需求，单独评估，不走本次修复批。

### 4.4 验证

```bash
cd packages/enterprise && bun build && cd ../..  # Enterprise build 检查
# Function: 无 build/test 脚本，CI 范围外；手动验证 wrangler deploy --dry-run
```

### 4.5 提交

```bash
git add package.json bun.lock  # catalog hono 版本
git add packages/enterprise/src/routes/api/[...path].ts
git commit -m "fix(enterprise): upgrade hono 4.10.7→4.12.18 + CORS fail-closed instead of wildcard"
```

---

## Step 4b: Nitro alpha — 记录已知负债

```bash
# 无需代码变更，记录到 CLAUDE.md
```

在 CLAUDE.md 末尾区域追加:

```markdown
## 已知技术负债

| 负债 | 包 | 风险 | Owner | 到期日 |
|---|---|---|---|---|
| nitro@3.0.1-alpha.1 预发布版本 | enterprise | alpha 不应用于生产 | TBD | 2026-08-04 |
| @ai-sdk/google patch | root patches/ | 功能补丁，上游 3.0.73 未内含 | TBD | 持续监控上游 |
```

```bash
git add CLAUDE.md
git commit -m "docs: record nitro-alpha and google-patch known debt with expiry"
```

---

## Step 6: AI SDK 上游同步

**排在最后执行** — 版本跨越大 (20-39 补丁)，需逐个核对 changelog + 处置 patchedDependencies。

### 6.1 从上游 dependencies 提取 @ai-sdk/* 版本（不在 catalog）

@ai-sdk/* pin 在两处:
- `packages/core/package.json:61-80` (dependencies)
- `packages/aigcfroge/package.json:60-76` (dependencies)

**不在根 catalog**。提取上游对应版本:

```bash
# 上游 core 包
git show opencode/dev:packages/core/package.json | python3 -c "
import json, sys
d = json.load(sys.stdin)
for k, v in d.get('dependencies', {}).items():
    if '@ai-sdk' in k: print(f'{k}: {v}')
"
# 上游 opencode 包
git show opencode/dev:packages/opencode/package.json | python3 -c "
import json, sys
d = json.load(sys.stdin)
for k, v in d.get('dependencies', {}).items():
    if '@ai-sdk' in k: print(f'{k}: {v}')
"
```

手动对照输出，编辑 `packages/core/package.json` 和 `packages/aigcfroge/package.json` 的 dependencies 节。

### 6.2 处置 @ai-sdk/xai patch

根 `package.json:146` 有:

```json
"patchedDependencies": {
  "@ai-sdk/xai@3.0.82": "patches/@ai-sdk%2Fxai@3.0.82.patch"
}
```

xai 同步到 3.0.102 后:

1. 检查上游 3.0.102 是否已含 PDF file-part 支持:
   ```bash
   # 上游 AI SDK xai changelog / 源码 diff
   ```
2. 若已含 → 删除 patch 文件和 patchedDependencies 条目
3. 若未含 → 对新版本重新 apply + rebase patch，更新 key 为 `"@ai-sdk/xai@3.0.102"`

> 好消息: `@ai-sdk/google@3.0.73` patch 不受影响（上游同版本，`package.json:149`）。

### 6.3 验证

```bash
bun install
cd packages/core && bun test --timeout 30000 && cd ../..
cd packages/aigcfroge && bun test --timeout 30000 && cd ../..
cd packages/llm && bun test --timeout 30000 && cd ../..
```

### 6.4 提交（独立 commit，最后推）

```bash
git add packages/core/package.json packages/aigcfroge/package.json bun.lock
# xai patch 相关:
git add patches/ package.json  # 如果 patch 发生变化
git commit -m "chore: sync @ai-sdk/* versions to upstream opencode/dev"
```

---

## 批次 A 收尾验证

全部 Steps 完成后:

```bash
# 1. 安全审计
bun run audit

# 2. 门禁
bun run lint
bun typecheck

# 3. 全量测试（注意绕过 --only-failures）
cd packages/core && bun test --timeout 30000 && cd ../..
cd packages/session-ui && bun test && cd ../..
cd packages/app && bun test && cd ../..
cd packages/aigcfroge && bun test --timeout 30000 && cd ../..
cd packages/tui && bun test --timeout 30000 && cd ../..

# 4. 构建
cd packages/web && bun build && cd ../..
cd packages/enterprise && bun build && cd ../..
# function: 无 build 脚本，CI 不覆盖
```

全部通过后:

```bash
bun typecheck  # pre-push hook 也会跑
git push -u origin security-deps
```

---

## 回退预案

```bash
# 单步回退
git log --oneline -6
git revert <commit> -m "revert: <reason>"

# 全量回退
git checkout main && git branch -D security-deps
```

---

## 上游监控点

批次 A 完成后记录:

```bash
# 上游如果做了同类修复, 记录 commit 供后续 port:
git log opencode/dev -- packages/core/package.json packages/enterprise/package.json
# js-yaml 不存在于上游 — 无需追踪
# hono/astro/nitro/minimatch 与上游同版本 — 关注上游何时升级
```

---

## 复查结论 (v2)

```
复查结论:
- 影响文件: docs/plan/security-batch-a-execution.md (完全重写)
- 命中 skills: effect (A1 加固遵循 Effect.gen/Yield + try/catch 解析边界)
- 安全门禁: B4 已修 (CORS fail-closed, 删除 function 反射 origin)
- 工程门禁: B1 已修 (AI SDK 提取位置改为上游 dependencies)
            B2 已修 (新增 xai patch 处置步骤)
            B3 已修 (新增 happy-dom preload)
            B5 已修 (新增 @types/js-yaml 升级)
- Factual fixes:
  - Step 5 仅 aigcfroge (core 已是 10.2.5)
  - Step 2 overrides 合并而非覆盖
  - 验证命令绕开 --only-failures
  - 1.4/1.5 import 方式统一 (保留 default import)
  - TEST-3 修正为真嵌套
  - 新增 Step 4b (nitro alpha 负债记录)
  - 新增 A1 技术债声明 (字节上限 vs Effect.timeout)
  - 清理根 catalog 中 dompurify 死条目
  - function 无 build → 验证方式改为 Enterprise build 检查
- 已运行命令: Read×5, Bash×3 (全部只读)
- 剩余风险: AI SDK 30+ 补丁版本跨度行为差异需执行期逐包核对 changelog;
            xai patch 处置依赖上游版本确认;
            happy-dom 安装后 session-ui 测试环境首次引入 DOM，可能暴露既有测试的 DOM 依赖问题
```

---

## 执行结果 (v3 — 2026-07-28 完成，合并 `d2e156abf`)

全部 6 步 + 收尾修订完成，批次 A 目标（直接运行时依赖 0 critical，公开请求入口 0 high）达成。

### 实际执行与计划偏差

| 步骤 | 结果 | 偏差 |
|---|---|---|
| Step 1 js-yaml | ✅ 4.3.0 + @types/js-yaml 4.0.9 + 4 处字节上限 + 5 探针 | 探针精简为 5 条（merge key 并入 anchor 用例）；TEST-3 改真嵌套 |
| Step 2 tar | ✅ overrides 合并至现有块，最终 **7.5.22** | 计划值 7.5.18 仍命中新 advisory GHSA-23hp-3jrh-7fpw（≤7.5.18），收尾时二次提升至 7.5.22 |
| Step 3 DOMPurify | ✅ 3.3.1→**3.4.6** + happy-dom preload + 7 条 XSS 探针；ui 死依赖已删 | 收尾时尝试 3.4.12 实证与 happy-dom 不兼容（p/a 误剥、foreignObject 误放），回退 3.4.6 并登记 CLAUDE.md 负债（到期 2026-08-27） |
| Step 4 Hono/CORS | ✅ catalog 最终 **4.12.32** + `"hono": "catalog:"` override 去重；enterprise CORS fail-closed | function Worker 决议不加 CORS（内部服务，反射 origin 扩大攻击面） |
| Step 5 minimatch | ✅ 仅 aigcfroge 10.0.3→10.2.5（core 已是 10.2.5） | 无 |
| Step 6 AI SDK | ✅ core+aigcfroge 同步上游 dependencies；xai patch 删除（3.0.102 已内含 PDF 支持，实证） | google patch 保留（上游仍 3.0.73），登记负债 |
| A4b nitro | ✅ 登记 CLAUDE.md 已知技术负债（到期 2026-08-04） | Owner 待指派 |

### 最终验证数字（2026-07-28 实测）

```
bun audit:        142 → 90（2 critical = seroval[B] + fast-xml-parser[C]，批次 A 项全清）
lint:             0 warnings / 0 errors
typecheck:        18/18 (turbo --force)
core:             1309 pass / 5 fail（5 个失败已全部定性，见 roadmap D1）
session-ui:       61/61（含 7 条新 XSS 探针）
app:              475/475
aigcfroge:        3118 pass / 7 fail（6 个 asset HttpApi = 并行负载 flake，隔离复跑全过；1 个 tool.write 环境性）
tui:              178 pass / 1 skip / 8 fail（与既定基线一致）
build:            web PASS；enterprise FAIL = main 基线预存（solid-start:get-manifest），非本批次回归
```

### 待办（不阻断合并）

- 部署：enterprise 环境必须配置 `AIGCFROGE_ALLOWED_ORIGINS`（fail-closed 默认拒跨域）
- CLAUDE.md 三条技术负债（nitro / google patch / dompurify）指派 Owner
- 批次 D 开工时按 roadmap D1 表修复 5 个 core 失败 + 1 个 aigcfroge 环境性失败
