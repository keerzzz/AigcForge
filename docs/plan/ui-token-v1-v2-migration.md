# v1 全面移除 & v2 全量迁移方案

> 目标：消除 v1 token 依赖，全量切换至 v2 token + v2 组件体系
> 范围：packages/ui（组件层）→ packages/app（应用层）→ packages/session-ui → packages/core（引擎层）
>
> ⚠ 最终审计日期: 2026-06-30 — 审计了 5 个维度（旧组件TSX/CSS、v2组件API、styles/app/desktop、主题测试/插件），发现关键风险详见下文。

---

## 现状快照

| 层级                                | v1 color token       | v2 token   | 说明                                                                                  |
| ----------------------------------- | -------------------- | ---------- | ------------------------------------------------------------------------------------- |
| **ui/src/components/** (旧组件)     | **78 处**            | 0          | 53 个文件，44 个组件                                                                  |
| **ui/src/v2/components/** (v2 组件) | 0                    | **324 处** | 27 个组件，已纯 v2                                                                    |
| **app/src/** (应用层)               | **61 处** (审计修正) | 79 处      | **17 个文件** (审计修正，原记录12)                                                    |
| **session-ui/**                     | **~40 处** (新发现)  | 0          | session-ui/markdown.css, session-turn.css, tool-error-card.css, tool-status-title.css |
| **theme/resolve.ts** (v1 引擎)      | 540 行               | —          | 死代码待删                                                                            |
| **theme/context.tsx + loader.ts**   | 注入 v1              | 注入 v2    | 双注入                                                                                |
| **desktop/**                        | 少量                 | —          | 1 个文件                                                                              |

### 审计修正补充

**session-ui 包**（原计划遗漏）：

- `packages/session-ui/src/markdown.css` — 引用 text-strong, font-family-sans, text-interactive-base, syntax-string, border-weaker-base, icon-base 等大量 v1 token
- `packages/session-ui/src/session-turn.css` — 引用 text-weak, text-on-critical-base, background-stronger 等
- `packages/session-ui/src/tool-error-card.css` — 引用 surface-critical-base, text-on-critical-base
- `packages/session-ui/src/tool-status-title.css` — 引用 text-strong

**app 层补充文件**（原计划遗漏）：

- `app/src/components/session-context-tab.tsx` — 引用 syntax-info, syntax-success, syntax-property, syntax-warning, syntax-comment
- `app/src/components/status-popover.tsx` / `status-popover-body.tsx` — 引用 shadow-lg-border-base
- `app/src/components/debug-bar.tsx` — 引用 shadow-lg-border-base
- `app/src/components/help-button.tsx` — 引用 shadow-lg-border-base

**硬编码颜色值待修复**（3 个 CSS 文件）：

- `ui/src/components/switch.css` — `rgba(19, 16, 16, 0.04/0.06/0.08)` (box-shadow)
- `ui/src/components/text-field.css` — `rgba(19, 16, 16, 0.25/0.08/0.12)` (box-shadow)
- `ui/src/components/image-preview.css` — `rgba(19, 16, 16, 0.35/0.25/0.2)` (box-shadow)

### 两个独立的主题系统

审计确认项目**同时运行两套独立的主题系统**：

|            | TUI (终端)                                                                     | UI Desktop (桌面)                                                |
| ---------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| 使用方     | tui/包, aigcfroge/cli/run, .aigcfroge/themes/_.json, .aigcfroge/plugins/_.json | packages/ui, packages/app, packages/desktop, packages/session-ui |
| token 命名 | `backgroundPanel`, `backgroundElement`, `borderActive`, `syntaxString`         | `--background-base`, `--text-strong`, `--syntax-string`          |
| 本方案范围 | **不影响**。外部主题文件(plugins/themes)是 TUI 格式，不依赖 UI Desktop v1      | ✅ 本方案的 v1→v2 迁移**不改变 TUI 系统**                        |

### 组件覆盖矩阵

| 分类                        | 组件                                                                                                                                                                                                             | 数量                           |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| **有 v2 替代品 → 直接替换** | accordion, avatar, button, checkbox, dialog, diff-changes, icon-button, inline-input, keybind, radio-group, select, switch, tabs, text-shimmer, toast, tooltip                                                   | **16 个**                      |
| **无 v2 替代品 → 手工创建** | card, collapsible, context-menu, dock-surface, dropdown-menu, hover-card, list, popover, progress, progress-circle, scroll-view, tag, text-field, text-reveal, file-icon, image-preview, sticky-accordion-header | **17 个**                      |
| **样式无关 / 零 v1 引用**   | spinner, animated-number, typewriter, text-strikethrough, motion-spring, resize-handle                                                                                                                           | **6 个**(可直接迁移无需改颜色) |
| **非组件目录**              | icon, logo, app-icon, favicon, provider-icon, font, thinking-heading                                                                                                                                             | **7 个**(CSS 含 v1)            |

### app 导入依赖 (影响面)

| import 路径               | 旧              | v2                  |
| ------------------------- | --------------- | ------------------- |
| `@aigcfroge/ui/xxx`       | 33 个组件被引用 | —                   |
| `@aigcfroge/ui/v2/xxx-v2` | —               | 12 个 v2 组件被引用 |

---

## Phase 0: 扩展 v2 token 系统（确保 feature-complete）

**耗时**: ~2-3 天

**这是前置条件**。当前 v2 有 52 个语义 token，缺失 syntax、markdown、diff、input、button 类别。必须先补齐 —— 且必须按 v2 现有架构模式（primitives → semantics → foreground），不能照搬 v1 的硬编码 hex。

### 架构原则

v2 的 token 引用模式是**层级引用**，不是 v1 的平铺 hex：

```text
primitives (v2-grey-100~1200, v2-blue-100~1200, ...)
  ← 引用：语义 token 用 var(--v2-grey-xxx) 引用 primitives，不用 hex
semantics (v2-background-*, v2-state-*, v2-border-*, ...)
  ← 引用：组件 CSS 用 var(--v2-background-xxx) 引用语义 token
foreground (v2-text-text-*, v2-icon-icon-*, ...)
  ← 计算：动态从 ink/body + primitives 推算，也引用为 CSS var
```

新类别必须遵守同一模式：

- **semantics 层级**：input、button → 静态映射，放 `mapping.ts`
- **foreground 层级**：syntax、markdown → 从 primitives 计算，放新文件
- **混合**：diff 有 bg（semantics）+ text/icon（foreground）

---

### 0.1 新增文件结构

```text
packages/ui/src/theme/v2/
├── resolve.ts               (已有：generateV2Primitives + resolveThemeVariantV2)
├── mapping.ts               (已有：mapV2Semantics + mergeV2Tokens)
├── foreground.ts            (已有：mapV2Foreground)
├── avatar.ts                (已有)
├── default-primitives.ts    (已有)
├── diff.ts                  ← 新增：diff token 计算
├── syntax-markdown.ts       ← 新增：syntax + markdown token 计算
```

### 0.2 `v2/mapping.ts` 中新增语义 token

**Input 系列（6 tokens）** — 语义级，静态 light/dark 映射：

```ts
// 新增到 light mapping:
"v2-input-bg":             "var(--v2-background-bg-base)",
"v2-input-bg-hover":       "var(--v2-background-bg-layer-01)",
"v2-input-border":         "var(--v2-border-border-muted)",
"v2-input-border-hover":   "var(--v2-border-border-strong)",
"v2-input-border-focus":   "var(--v2-border-border-focus)",
"v2-input-bg-disabled":    "var(--v2-background-bg-deep)",

// dark 同理但注意 bg-button-neutral 在 dark 是 alpha-light-6:
"v2-input-bg":             "var(--v2-background-bg-base)",           // dark: v2-grey-1000
"v2-input-bg-hover":       "var(--v2-background-bg-button-neutral)", // dark: v2-alpha-light-6
// ...其余同 light（border 和 focus 跨主题一致）
```

**Button 系列（+2 tokens，补齐已有）** — 语义级：

```ts
// 已有：v2-background-bg-button-neutral
// 已有：v2-elevation-button-neutral, v2-elevation-button-contrast
// 新增：
"v2-button-secondary-bg":    "var(--v2-background-bg-base)",
"v2-button-secondary-hover": "var(--v2-overlay-simple-overlay-hover)",
```

### 0.3 新增 `v2/syntax-markdown.ts`

核心逻辑：从 v2 hue ramp 取**按 hue 差异化的步阶**，避免 v1 `content()` 的动态亮度偏移（v2 ramp 步阶 100-1200 已有语义一致性，100=最亮 1200=最暗，不需要再动态调）。

**关键设计决策**: 不同 hue 在 dark/light 背景下的 luminance 差异巨大，不能统一用 `isDark ? 400 : 600`。以下设计基于实际 WCAG 对比度预计算：

| Hue           | Dark 模式步阶 | Light 模式步阶 | 依据                                          |
| ------------- | ------------- | -------------- | --------------------------------------------- |
| green         | 400           | 600            | green luminance 中等，400/600 双方OK          |
| blue/cyan     | **200**       | **700**        | blue luminance 天然低，dark 取 200 保证对比度 |
| purple        | **300**       | **600**        | purple 同 blue，但略暖，300 处于安全区        |
| yellow/orange | 400 (or 500)  | 600            | yellow luminance 高，对比度天生好             |
| red           | 400           | 600            | red luminance 中等，400/600 安全              |

```ts
// 引用：primitive ramp + 已解析的 foreground/text token
import type { V2ColorValue } from "../types"

const ref = (name: string): V2ColorValue => `var(--${name})`

export function mapV2Syntax(isDark: boolean): Record<string, V2ColorValue> {
  // Syntax 颜色语义 vs v2 hue ramp 映射：
  //   string  → green   (v1: content(success, scale))
  //   keyword → purple  (v1: content(accent, scale))
  //   primitive → blue  (v1: content(primary, scale))
  //   type    → yellow  (v1: content(warning, scale))
  //   property → cyan   (v1: content(info, scale))
  //   constant → purple (v1: content(accent, scale))
  //   comment/operator/punctuation → text-muted/faint
  //   variable/object → text-base
  //
  // 步阶选择规则：blue/cyan/purple 在 dark 模式用 200-300 确保 contrast
  return {
    // 引用语义 foreground token（复用已算好的 text 颜色）
    "v2-syntax-comment": ref("v2-text-text-faint"),
    "v2-syntax-regexp": ref("v2-text-text-muted"),
    "v2-syntax-string": ref(isDark ? "v2-green-400" : "v2-green-600"),
    "v2-syntax-keyword": ref(isDark ? "v2-purple-300" : "v2-purple-600"),
    "v2-syntax-primitive": ref(isDark ? "v2-blue-200" : "v2-blue-600"), // blue dark 用 200 ⚠️
    "v2-syntax-operator": ref("v2-text-text-muted"),
    "v2-syntax-variable": ref("v2-text-text-base"),
    "v2-syntax-property": ref(isDark ? "v2-cyan-200" : "v2-cyan-600"), // cyan dark 用 200 ⚠️
    "v2-syntax-type": ref(isDark ? "v2-yellow-500" : "v2-yellow-600"),
    "v2-syntax-constant": ref(isDark ? "v2-purple-300" : "v2-purple-600"),
    "v2-syntax-punctuation": ref("v2-text-text-muted"),
    "v2-syntax-object": ref("v2-text-text-base"),
    "v2-syntax-success": ref(isDark ? "v2-green-400" : "v2-green-600"),
    "v2-syntax-warning": ref(isDark ? "v2-orange-400" : "v2-orange-600"),
    "v2-syntax-critical": ref(isDark ? "v2-red-400" : "v2-red-600"),
    "v2-syntax-info": ref(isDark ? "v2-blue-300" : "v2-blue-500"),
    "v2-syntax-diff-add": ref(isDark ? "v2-green-400" : "v2-green-500"),
    "v2-syntax-diff-delete": ref(isDark ? "v2-red-400" : "v2-red-500"),
    "v2-syntax-diff-unknown": ref("v2-red-500"), // 纯 #ff0000 对比度不足且刺眼
  }
}

export function mapV2Markdown(isDark: boolean): Record<string, V2ColorValue> {
  return {
    "v2-markdown-heading": ref(isDark ? "v2-blue-200" : "v2-blue-600"),
    "v2-markdown-text": ref("v2-text-text-base"),
    "v2-markdown-link": ref(isDark ? "v2-blue-300" : "v2-blue-500"),
    "v2-markdown-link-text": ref(isDark ? "v2-blue-200" : "v2-blue-400"),
    "v2-markdown-code": ref(isDark ? "v2-green-400" : "v2-green-600"),
    "v2-markdown-block-quote": ref(isDark ? "v2-yellow-500" : "v2-yellow-600"),
    "v2-markdown-emph": ref(isDark ? "v2-yellow-500" : "v2-yellow-600"),
    "v2-markdown-strong": ref(isDark ? "v2-orange-500" : "v2-orange-600"),
    "v2-markdown-horizontal-rule": ref("v2-border-border-muted"),
    "v2-markdown-list-item": ref(isDark ? "v2-blue-300" : "v2-blue-500"),
    "v2-markdown-list-enumeration": ref(isDark ? "v2-blue-200" : "v2-blue-400"),
    "v2-markdown-image": ref(isDark ? "v2-blue-300" : "v2-blue-500"),
    "v2-markdown-image-text": ref(isDark ? "v2-blue-200" : "v2-blue-400"),
    "v2-markdown-code-block": ref("v2-text-text-base"),
  }
}
```

**为什么取固定步阶？**
v2 的 `generateV2HueScale` 已经根据 seed color 动态生成了 12 阶 hue ramp。固定步阶（如 600）在不同主题下自然呈现不同色值，不需要 v1 `content()` 那层额外动态。v1 的 `content()` 本质上是为了补偿其 `generateScale` 输出不统一的缺陷。

**为什么不能用统一步阶？**
不同 hue 的 luminance 差异很大。OC-2 主题下 blue-400 (#a2bcff) 的 luminance ≈ 0.48，blue-600 (#3b5cf6) 的 luminance ≈ 0.066。在 dark 背景 (#242424, luminance ≈ 0.015) 上：

- blue-600 对比度 **(0.066+0.05)/(0.015+0.05) = 1.78:1** ❌ 远低于 3:1
- blue-200 (#d7e2fc) 对比度 ≈ 4:1 ✅

所以 blue/purple/cyan 在 dark 模式必须取 200-300 步阶。

### 0.4 新增 `v2/diff.ts`

Diff token 需要与 state token 有视觉区分，否则用户无法区分"diff 增加"和"操作成功"：

- `v2-state-bg-success` → green-100（最淡，用于成功提示背景）
- `v2-diff-add-bg` → green-200（深一度，用于代码 diff，需在代码上下文中可见）
- `v2-state-fg-success` → green-800（深色，用于按钮/标签）
- `v2-diff-add-text` → green-600（中等，用于 diff 行内文字）
- `v2-diff-add-icon` → green-500（中等偏深，用于 diff gutter 图标）

```ts
export function mapV2Diff(isDark: boolean): Record<string, V2ColorValue> {
  return {
    // 背面色 (bg) — diff 背景比 state 背景深一度以在代码上下文中可辨
    "v2-diff-add-bg": ref(isDark ? "v2-green-1200" : "v2-green-200"),
    "v2-diff-add-bg-strong": ref(isDark ? "v2-green-1000" : "v2-green-300"),
    "v2-diff-delete-bg": ref(isDark ? "v2-red-1200" : "v2-red-200"),
    "v2-diff-delete-bg-strong": ref(isDark ? "v2-red-1000" : "v2-red-300"),
    "v2-diff-unchanged-bg": ref("v2-background-bg-base"),

    // 前景色 (text/icon) — 取 ramp 中段，与背景有足够对比
    "v2-diff-add-text": ref(isDark ? "v2-green-400" : "v2-green-600"),
    "v2-diff-delete-text": ref(isDark ? "v2-red-400" : "v2-red-600"),
    "v2-diff-add-icon": ref(isDark ? "v2-green-400" : "v2-green-500"),
    "v2-diff-delete-icon": ref(isDark ? "v2-red-400" : "v2-red-500"),

    // diff hidden (交互式 diff 中"隐藏区域"的背景)
    "v2-diff-hidden-bg": ref(isDark ? "v2-alpha-light-4" : "v2-alpha-dark-4"),
    "v2-diff-hidden-bg-hover": ref(isDark ? "v2-alpha-light-8" : "v2-alpha-dark-8"),
  }
}
```

**与 state 色对比**:

| 用途                  | Light 步阶    | Dark 步阶      | 角色                             |
| --------------------- | ------------- | -------------- | -------------------------------- |
| `v2-state-bg-success` | green-100     | green-1200     | 成功提示背景                     |
| `v2-diff-add-bg`      | green-**200** | green-**1200** | diff 新增背景（比 state 深一度） |
| `v2-state-fg-success` | green-800     | green-500      | 成功文字/按钮                    |
| `v2-diff-add-text`    | green-**600** | green-**400**  | diff 行内文字（与 bg 有对比）    |

### 0.5 整合到 `v2/resolve.ts`

```ts
import { mapV2Syntax, mapV2Markdown } from "./syntax-markdown"
import { mapV2Diff } from "./diff"

export function resolveThemeVariantV2(variant: ThemeVariant, isDark: boolean): ResolvedV2Theme {
  const primitives = generateV2Primitives(variant, isDark)
  const semantics = mapV2Semantics(isDark)
  const foreground = mapV2Foreground(readPalette(variant).ink, isDark, primitives, variant.overrides)
  const syntax = mapV2Syntax(isDark)
  const markdown = mapV2Markdown(isDark)
  const diff = mapV2Diff(isDark)
  return mergeV2Tokens(primitives, semantics, foreground, syntax, markdown, diff, variant.v2Overrides ?? {})
}
```

### 0.6 token 汇总（新增 40 个）

| 类别     | token 数 | 文件                    | 类型                   |
| -------- | -------- | ----------------------- | ---------------------- |
| syntax   | 18       | `v2/syntax-markdown.ts` | 按 light/dark 切换步阶 |
| markdown | 14       | `v2/syntax-markdown.ts` | 按 light/dark 切换步阶 |
| diff     | 12       | `v2/diff.ts`            | 按 light/dark 切换步阶 |
| input    | 6        | `v2/mapping.ts`         | 静态语义引用           |
| button   | 2        | `v2/mapping.ts`         | 静态语义引用           |
| **总计** | **52**   |                         |                        |

**产出**: v2 从 52 语义 token → ~104 语义 token，完整覆盖 syntax/markdown/diff/input/button，旧组件迁移时有对应的 v2 token 可用，且全部遵守 primitives 引用模式（非硬编码 hex）

---

## Phase 1: 批量替换 — 有 v2 替代品的旧组件

**耗时**: ~1-2 天

16 个组件有 v2 替代品，但审计发现 **v2 组件不是 drop-in replacement**。大多数有 API 破坏性变更，每个组件替换时需要同步更新 app 调用处的 props。

### API 差异对照表（审计发现）

| 组件                  | 旧版 API                                                                       | v2 API                                                                                | 变更类型                                          |
| --------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- | ------------------------------------------------- |
| **button**            | `variant: "primary"\|"secondary"\|"ghost"`                                     | `variant: "neutral"\|"contrast"\|"ghost"\|"ghost-muted"`                              | **破坏性** — variant 名全变                       |
| **icon-button**       | `variant: "primary"\|"secondary"\|"ghost"`, `icon: IconProps["name"]` (字符串) | `variant: "neutral"\|"contrast"\|"ghost"\|"ghost-muted"`, `icon?: JSX.Element` (临时) | **破坏性** — variant 名 + icon 类型都变           |
| **checkbox**          | `children` (label 内容), `description?: string`, `icon?: JSX.Element`          | `label: JSX.Element` (必填), `description?: JSX.Element`                              | **破坏性** — children → label, description 类型变 |
| **icon**              | `size: "small"\|"normal"\|"medium"\|"large"`, ~106 icons                       | `size: "small"\|"normal"\|"large"`, ~30 icons                                         | **破坏性** — 移除 medium size, 图标集减少 70%     |
| **switch**            | `description?: string`                                                         | `description` 移除                                                                    | **轻度破坏**                                      |
| **select**            | `triggerStyle`, `triggerVariant`, `triggerProps`, `use remeda`                 | 移除 trigger 样式 props, 简化 group 逻辑                                              | **破坏性**                                        |
| **dialog**            | `transition?: boolean`, `useI18n`                                              | 移除 transition, 硬编码 "Close"                                                       | **轻度破坏**                                      |
| **diff-changes**      | `variant: "default"\|"bars"` (bars 有 SVG 条图)                                | 完全移除 `"bars"` variant                                                             | **破坏性**                                        |
| **tabs**              | `variant: "normal"\|"alt"\|"pill"\|"settings"`                                 | `variant: "normal"\|"pill"\|"settings"`                                               | **轻度破坏** — 移除 "alt"                         |
| **radio-group**       | `RadioGroup<T>` (泛型, options 数组, @kobalte/segmented-control)               | `RadioGroupV2` + `RadioItemV2` (compound, @kobalte/radio-group)                       | **完全重写** — 使用模式完全不同                   |
| **toast**             | `showPromiseToast`, `ToastProgressTrack/Fill`, `ToastVariant`, `useI18n`       | 移除 promise/进度/变体, 硬编码 "Dismiss"                                              | **破坏性**                                        |
| **tooltip**           | `TooltipKeybind` 子组件                                                        | 移除 `TooltipKeybind`                                                                 | **轻度破坏**                                      |
| **text-field**        | `TextField` (Kobalte, 含 copyable/multiline)                                   | 拆分为 `TextInputV2` + `TextareaV2` + `FieldV2` (三个独立组件)                        | **完全重写**                                      |
| **avatar**            | 无 `kind`                                                                      | 添加 `kind?: "user"\|"org"`                                                           | 兼容 (可选)                                       |
| **keybind**           | 无 props (children)                                                            | `keys: string[]`, `variant?`                                                          | **完全重写**                                      |
| **segmented-control** | 无 (旧版是 RadioGroup 包装了 segmented-control)                                | `SegmentedControlV2` (custom context 实现)                                            | **新增组件**                                      |

### 替换策略修正

===== 修正前 =====
旧计划认为这些是"直接替换"，需要改为：

```
每个组件替换 = 两步：
Step 1: ui/src/components/xxx.tsx → 删除
Step 2: app/src/ 中所有引用处同步更新 props（使用上表对照）
```

建议替换前先在 `packages/app` 中用 `rg '@aigcfroge/ui/xxx'` 搜索所有调用点，逐一更新 props 后再切 import 路径。

### 标准替换操作（每个组件）

```text
Step 1: ui/src/components/xxx.tsx → 删除
Step 2: ui/src/components/xxx.css → 删除
Step 3: ui/src/styles/index.css → 移除 @import "./components/xxx.css" 行
Step 4: 对照 API 差异表，更新所有调用处的 props
Step 5: app/ + session-ui/ + desktop/ 中的 import 替换为 "@aigcfroge/ui/v2/xxx-v2"
Step 6: bun --cwd packages/ui typecheck + bun --cwd packages/app typecheck
```

### 特殊处理

| 组件            | 注意点                                                                                              |
| --------------- | --------------------------------------------------------------------------------------------------- |
| **avatar**      | 旧名 `@aigcfroge/ui/avatar` → 新名 `@aigcfroge/ui/v2/project-avatar-v2`                             |
| **radio-group** | 旧名 `@aigcfroge/ui/radio-group` → 新名 `@aigcfroge/ui/v2/radio-v2`                                 |
| **icon**        | 同时存在 old `components/icon.tsx` + v2 `v2/components/icon.tsx`，v2 版已独立，删旧版时确保不误删   |
| **dialog**      | `@aigcfroge/ui/dialog` 是 dialog 组件，`@aigcfroge/ui/context/dialog` 是 context 提供者（**不删**） |
| **icon-button** | 旧 `components/icon-button.tsx` → `v2/components/icon-button-v2.tsx`                                |

### 替换顺序（按视觉区域分批）

**原则：每批组件属于相近的视觉区域。一批替换后，不包含该区域的页面完全不受影响，可以独立验证。**

```
Batch A: 后台/辅助组件（用户不常感知）
  text-shimmer, sticky-accordion-header, diff-changes, inline-input, keybind, radio-group

Batch B: 独立面板/浮层组件（不干扰主界面）
  dialog, toast, tooltip, accordion, tabs, avatar, checkbox

Batch C: 核心交互组件（最后替换，让前两批充分验证）
  button, icon-button, icon, select, switch, toast
```

**验证**：每完成一个 batch 后：

1. `bun --cwd packages/ui typecheck` + `bun --cwd packages/app typecheck`
2. 截图对比该 batch 组件在 light + dark 下的表现（迁移前后）
3. 确认无颜色空白（CSS 变量未定义时会显示透明或浏览器默认色）

```

---

## Phase 2: 创建 + 替换 — 无 v2 替代品的旧组件

**耗时**: ~3-5 天

17 个组件需要先创建 v2 版，再替换。策略：新组件用 v2 token，直接替代旧组件功能。

### 优先级分组

| 优先级 | 组件 | App 引用数 | 策略 |
|---|---|---|---|
| **P0**（高引用） | list (11), text-field (9), dropdown-menu (8), tag (4), scroll-view (4), dock-surface (4) | 4-11 | 必须优先做，影响面最大 |
| **P1**（低引用） | card (1), collapsible (2), popover (2), hover-card (1), context-menu (1), progress-circle (1), text-reveal (2) | 1-2 | 次优先 |
| **P2**（纯样式） | file-icon (9), progress, image-preview, sticky-accordion-header | 纯图标/样式 | 可推迟 |

### 创建新 v2 组件的标准流程

```

1. 在 v2/components/ 创建 xxx-v2.tsx（复制旧逻辑，v1→v2 token 映射替换）
2. 创建 xxx-v2.css（用 v2 token 替换全部 v1 token）
3. 创建 xxx-v2.stories.tsx（可选，Storybook 验证）
4. 删除旧组件 ui/src/components/xxx.tsx + xxx.css
5. 更新 ui/src/styles/index.css（移除 @import）
6. 更新 app/src/ 中全部 import 指向 @aigcfroge/ui/v2/xxx-v2
7. bun typecheck + bun test 验证

````

### v1→v2 token 映射要点

| v1 | v2 对应 | 备注 |
|---|---|---|
| `--surface-base` | `--v2-background-bg-base` | 基础面板背景 |
| `--surface-base-hover` | `--v2-overlay-simple-overlay-hover` | hover 交互态 |
| `--surface-base-active` | `--v2-overlay-simple-overlay-pressed` | pressed 交互态 |
| `--surface-raised-base` | `--v2-background-bg-layer-01` | 浮层面板 |
| `--surface-weak` | `--v2-background-bg-deep` | 弱感表面 |
| `--text-base` | `--v2-text-text-base` | 正文色 |
| `--text-weak` | `--v2-text-text-muted` | 弱文字 |
| `--text-weaker` | `--v2-text-text-faint` | 更弱文字 |
| `--text-strong` | `--v2-text-text-contrast` | 强调文字 |
| `--border-base` | `--v2-border-border-base` | 基础边框 |
| `--border-weak-base` | `--v2-border-border-muted` | 弱边框 |
| `--border-strong-base` | `--v2-border-border-strong` | 强边框 |
| `--border-focus` | `--v2-border-border-focus` | 焦点边框 |
| `--icon-base` | `--v2-icon-icon-base` | 图标色 |
| `--icon-hover` | `--v2-icon-icon-muted` | 图标 hover |
| `--icon-strong-base` | `--v2-icon-icon-contrast` | 强调图标 |
| `--background-base` | `--v2-background-bg-base` | 背景 |
| `--background-stronger` | `--v2-background-bg-deep` | 强背景 |
| `--surface-critical-weak` | `--v2-state-bg-danger` | 危险状态背景 |
| `--text-error` | `--v2-state-fg-danger` | 错误文字 |
| `--border-error` | `--v2-state-border-danger` | 错误边框 |
| `--button-primary-base` | `--v2-background-bg-button-neutral` | 主按钮 |

---

## Phase 3: 应用层 + session-ui 直接引用修复

**耗时**: ~1 天（审计后范围扩大）

app/src/ + session-ui/ 中 ~17 个文件的 ~61 处 v1 token 直接引用（不在组件内，在样式/页面代码中）。

### 文件清单

| 包 | 文件 | v1 引用 |
|---|---|---|
| **app** | `app/src/index.css` | 全局 CSS |
| | `app/src/context/layout.tsx` | `avatar-background-*`, `avatar-text-*`, `surface-info-base`, `text-base` |
| | `app/src/components/file-tree.tsx` | `icon-diff-*`, `icon-weak-base` |
| | `app/src/components/settings-*.tsx` (5 个) | `surface-stronger-non-alpha` (gradient) |
| | `app/src/pages/layout/sidebar-items.tsx` | `icon-interactive-base` |
| | `app/src/pages/session/composer/session-todo-dock.tsx` | `animate-pulse-scale`, `text-weak`, `text-strong`, `background-base` |
| | `app/src/pages/session/timeline/message-timeline.tsx` | `surface-raised-stronger-non-alpha`, `border-weak-base`, `background-stronger`, `icon-*` |
| | `app/src/components/session-context-tab.tsx` | `syntax-*` (4 处) |
| | `app/src/components/status-popover.tsx` | `shadow-lg-border-base` |
| | `app/src/components/debug-bar.tsx` | `shadow-lg-border-base` |
| | `app/src/components/help-button.tsx` | `shadow-lg-border-base` |
| **session-ui** | `session-ui/src/markdown.css` | `text-strong`, `text-interactive-base`, `syntax-string`, `border-weaker-base`, `icon-base` + 排版 (+~15 处) |
| | `session-ui/src/session-turn.css` | `text-weak`, `text-on-critical-base`, `background-stronger`, `surface-float-base` (+~10 处) |
| | `session-ui/src/tool-error-card.css` | `surface-critical-base`, `text-on-critical-base` |
| | `session-ui/src/tool-status-title.css` | `text-strong` |
| **desktop** | `desktop/src/renderer/index.html` | `background-base` |

**操作**: 逐文件搜 `var(--xxx)` → 用 Phase 0 的 v2 token 映射替换为 `var(--v2-xxx)`。session-ui 文件中的排版 token（`--font-*`、`--line-height-*` 等）保留不变，这些不是 color token，v2 暂不覆盖。

---

## Phase 4: 引擎层清理

**耗时**: ~0.5 天

只有在 Phase 1-3 全部完成后（`ui/src/components/` 中无活动引用）才可安全执行。

### 4.1 删除 `resolve.ts`

```diff
- packages/ui/src/theme/resolve.ts  删除
````

### 4.2 清理 `color.ts`

删除 v1-only 函数：

```diff
- export function generateScale(seed, isDark)       // v1-only，v2 用 generateV2HueScale
- export function generateAlphaScale(scale, isDark)  // v1-only，v2 alpha 在 CSS 中静态定义
```

保留 v2 仍依赖的共享函数：

```
hexToRgb, rgbToHex, rgbToOklch, oklchToRgb, hexToOklch, fitOklch, oklchToHex,
generateNeutralScale, mixColors, shift, contrastRatio, blend, lighten, darken, withAlpha
```

### 4.3 简化 `context.tsx`

```diff
- import { resolveThemeVariant, themeToCss } from "./resolve"
- const tokens = resolveThemeVariant(variant, isDark)
- const css = themeToCss(tokens)
- write(STORAGE_KEYS.THEME_CSS_*, `${css}\n  ${v2}`)
+ // 只注入 v2 CSS
```

### 4.4 简化 `loader.ts`

同上：只调用 `resolveThemeVariantV2`，不调用 `resolveThemeVariant`

### 4.5 更新 `styles/index.css`

移除所有旧组件的 `@import "../components/xxx.css"`，只保留 base + utilities + v2 相关。

```diff
- @import "../components/accordion.css" layer(components);
- @import "../components/button.css" layer(components);
  // ... 全部 40+ 个 @import 行移除
+ // v2 组件 CSS 由组件自身 import 加载，无需在这里 @import
```

### 4.6 更新 `package.json` 导出

```diff
- "./*": "./src/components/*.tsx",
+ "./*": "./src/v2/components/*.tsx",
```

当旧组件全部清空后，将通配符导出指向 v2 目录。如果希望保持命名简洁（`@aigcfroge/ui/button` 而非 `@aigcfroge/ui/v2/button-v2`），可考虑逐个添加别名：

```json
{
  "./button": "./src/v2/components/button-v2.tsx",
  "./dialog": "./src/v2/components/dialog-v2.tsx"
  // ...
}
```

---

## Phase 5: 目录收尾

**耗时**: ~0.5 天

```diff
- packages/ui/src/components/    → 删除整个目录（空）
- packages/ui/src/styles/colors.css  → 检查是否还有引用，无则删除
```

---

## 回滚策略

Phase 1-3 期间，**保留所有旧组件文件直到 Phase 3 全部完成**。切换通过 `packages/ui/package.json` 的 exports 控制：

```json
{
  // 新组件优先
  "./button": "./src/v2/components/button-v2.tsx",
  // 旧组件保留作为 fallback，改一行即可切回
  "./button-legacy": "./src/components/button.tsx"
}
```

如果某个组件迁移后出现视觉回归（颜色异常、对比度不足、交互行为差异）：

1. 立即将 app 中该组件的 import 切回旧版（`@aigcfroge/ui/button-legacy`）
2. 记录回归原因到 issue
3. 修复后再重新切换

**注意事项**：

- 旧组件文件在 Phase 3 结束后才能物理删除
- `rg 'resolveThemeVariant'` 零引用后才可删除 `resolve.ts`
- 建议在删除 `resolve.ts` 前 `git tag v1-token-system` 以便需要时恢复

---

## 自定义主题兼容性

当前 `.aigcfroge/themes/mytheme.json` 使用 v1 格式（`background`、`text`、`border` 等字段）。迁移后：

- v2 引擎仍然通过 `readPalette()` 兼容 v1 格式的 ThemeVariant（`seeds` 模式）
- 用户自定义主题 JSON 的 `theme` 字段名需要更新为 `DesktopTheme` 格式（`name`、`id`、`light`、`dark`）
- 或者在 `desktop-theme.schema.json` 中添加兼容层

**建议**：Phase 0 中同步更新 `desktop-theme.schema.json` 以同时支持新旧格式，并提供迁移脚本。

---

## 视觉回归防护

每个 Phase 结束后，必须进行以下验证：

### 截图对比（人工）

1. 在 light 和 dark 模式下分别截图关键界面
2. 与迁移前的 baseline 截图对比
3. 重点关注：对比度、颜色一致性、组件状态（hover/active/focus）表现

### DESIGN.md 合规检查

```
□ 所有新 token 引用 CSS 变量，无硬编码 hex 值
□ Light + dark 变体都已定义且可切换无感
□ 空状态 / loading / disabled / error 状态的颜色有合理表现
□ WCAG 对比度：body text ≥ 4.5:1，large text ≥ 3:1
□ 中英文文本都未受 token 变更影响（overflow/visibility）
□ 交互状态（hover / focus / active / disabled）视觉可辨
```

### 组件迁移验证清单（Phase 2 专用）

```
每个迁移后的组件逐项检查：
□ Props API 与旧版兼容（或 app 调用处已更新）
□ 所有交互状态：default, hover, focus, active, disabled
□ 键盘可访问性：tab 顺序、focus 可见
□ Light + dark 切换
□ 含内容时的溢出和文本截断行为
□ 与 ThemeProvider 配合（预览/切换主题）
□ 第三方主题（自定义主题）下的表现
```

---

## 风险评估

| 阶段    | 风险                                            | 缓解措施                                                                                                                     |
| ------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Phase 1 | v2 组件 API 不同导致 app 构建失败               | 替换前用 `rg '@aigcfroge/ui/xxx'` 找出所有调用处，逐一对照 API 差异表更新 props                                              |
| Phase 1 | 替换后 Storybook 故事不匹配                     | 批量替换后跑 `bun typecheck` + 人工抽查 3-5 个关键组件（button、dialog、tabs）                                               |
| Phase 2 | 新创建的 v2 组件 UI 表现与旧版不同              | 每个新组件创建后对照 Storybook 快照验证                                                                                      |
| Phase 3 | app + session-ui 中遗漏 v1 引用，运行时颜色空白 | 用 `rg 'var\(--(surface\|text\|border\|icon\|background\|button\|syntax\|markdown)'` 全局扫一遍收尾                          |
| Phase 4 | 删 resolve.ts 后遗漏引用导致构建失败            | 先 `rg 'resolveThemeVariant'` 确认零引用，再删除；确认 desktop/src/main/windows.ts 和 app/src/components/terminal.tsx 已更新 |
| 全流程  | CSS 变量名前后不一致导致视觉回归                | 每个 Phase 结束后用 `rg 'var\(--surface-'` 确认 v1 引用归零                                                                  |

---

## 时间估算

| Phase    | 内容                                                | 工时       |
| -------- | --------------------------------------------------- | ---------- |
| 0        | 扩展 v2 token（syntax/markdown/diff/input/button）  | ~3 天      |
| 1        | 替换 16 个旧组件 + 同步更新 app 调用处 props        | ~3 天      |
| 2        | 创建 17 个新 v2 组件                                | ~4 天      |
| 3        | App + session-ui 层 v1 引用修复（~17 文件, ~61 处） | ~1 天      |
| 4        | 引擎层清理（resolve.ts/context.tsx/loader.ts）      | ~0.5 天    |
| 5        | 目录收尾 + 验证                                     | ~0.5 天    |
| **总计** |                                                     | **~12 天** |

---

## 关键决策点

1. **v2 组件命名**：是否需要保持 `@aigcfroge/ui/button` 简洁路径？还是接受 `@aigcfroge/ui/v2/button-v2`？建议 Phase 4 统一重导出，新旧切换期先接受 `-v2` 后缀
2. **桌面端同时迁移**：desktop/ 中的 v1 引用在 Phase 1 顺手改，不单独成阶段
3. **Storybook 兼容性**：旧 stories 引用旧组件，替换后需确认 v2 stories 已覆盖主要场景
