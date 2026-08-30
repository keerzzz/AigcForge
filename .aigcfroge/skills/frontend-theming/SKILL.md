---
name: frontend-theming
description: "AigcForge frontend theming — v1/v2 token system, DesktopTheme JSON, Oklch color engine, CSS variable injection, 37 built-in themes, custom theme loading, and theme plugins. Activates when working on CSS, theme JSON, color tokens, color.ts/color manipulation, ThemeProvider, or design-system colors in packages/ui/ or .aigcfroge/themes/"
allowed-tools: Read Edit Write Bash Glob Grep
---

# Frontend Theming

## Essential Principles

### 1. Token双系统

AigcForge 同时运行 v1 和 v2 两套 token，**新 UI 必须用 v2 token（`--v2-*`）**。v1 用于兼容旧组件，不许在新代码中新增 v1 token 引用。

|          | v1                                             | v2                                                            |
| -------- | ---------------------------------------------- | ------------------------------------------------------------- |
| 命名示例 | `--surface-base`, `--text-weak`                | `--v2-background-bg-base`, `--v2-text-text-muted`             |
| 色阶数量 | 12 阶 (0-11)，`generateScale`                  | 12 阶 (100-1200)，`generateV2HueScale`                        |
| 亮度方向 | 0=暗端，11=亮端 (isDark 时反转)                | 100=最亮，1200=最暗 (恒等)                                    |
| 中性色   | `generateNeutralScale(seed, isDark, ink?)`     | `generateV2NeutralScale(neutral, ink, isDark)`                |
| 语义层   | `resolveThemeVariant` 返回平铺 `ResolvedTheme` | `resolveThemeVariantV2` = primitives + semantics + foreground |
| 引用方式 | 直接 hex (`#xxxxxx`) 或 CSS var                | 纯 CSS var 引用（`var(--v2-grey-100)`）                       |
| Alpha    | `blend(fg, bg, alpha)` 预混合                  | `v2-alpha-light-*` / `v2-alpha-dark-*` CSS var                |

### 2. Theme 结构只有一种入口格式

`DesktopTheme` JSON 始终是 `{ name, id, light, dark }`。每个 variant 可以是 `seeds` 模式（旧/传统）或 `palette` 模式（compact 新风格），**禁止同时定义**。

```jsonc
// seeds 模式（传统，非 compact）：传入 9 个 seed color，引擎自动生成全部分阶
{ "seeds": { "neutral": "#...", "primary": "#...", ... } }

// palette 模式（compact 新风格）：传入 11 个精确调色板颜色，引擎按 compact 逻辑生成
{ "palette": { "neutral": "#...", "ink": "#...", "primary": "#...", ... } }
```

- `seeds` 模式 → `compact: false`，生成固定 syntax/markdown 颜色（硬编码 hex）
- `palette` 模式 → `compact: true`，syntax/markdown 颜色来自语义衍生（`var(--text-*)` 引用）

### 3. 永远通过 CSS 变量引用颜色

禁止在组件代码中使用硬编码 hex 或 `rgba()`。通过 `var(--v2-background-bg-base)` 或 `var(--surface-base)` 引用。参考 `DESIGN.md` 的 token 引用规则。

### 4. 主题引擎在 color.ts 中使用 Oklch 色彩空间

调色板生成全部基于 Oklch（亮度-色度-色调），非 sRGB/HSL。修改颜色算法必须通过 `color.ts` 中定义的 Oklch 函数链。

---

## When to Use

- 创建或编辑主题 JSON 文件（`packages/ui/src/theme/themes/*.json`、`.aigcfroge/themes/*.json`）
- 添加或修改 CSS token（v1 `--surface-*` / v2 `--v2-*`）
- 修改主题引擎（`resolve.ts`、`color.ts`、`v2/resolve.ts`、`mapping.ts`、`foreground.ts`）
- 处理 ThemeProvider、applyTheme、theme 缓存逻辑
- 设计新组件时需要引用正确的 token
- 调试 light/dark 模式颜色显示问题
- 检查主题对比度或无障碍合规性

## When NOT to Use

- 纯布局/间距/动画 CSS（不涉及颜色 token）— 使用常规 CSS 知识
- TUI 主题（走 `tui.json` 或插件系统，不在此 skill 范围）
- 不在 `packages/ui` 或 `.aigcfroge/themes` 范围内的通用 CSS

---

## Architecture

```text
DesktopTheme JSON           -- 主题定义（37 个内置 + 用户自定义）
    ├── light: ThemeVariant  -- { seeds | palette, overrides, v2Overrides }
    └── dark: ThemeVariant   -- 同上

resolveThemeVariant(variant, isDark)
    ├── color.ts             -- Oklch 色彩转换、色阶生成、混合工具
    ├── resolve.ts           -- v1 token 系统 (~200 tokens): surface/text/border/icon/syntax/markdown/avatar
    └── v2/resolve.ts        -- v2 token 系统: primitives + semantics + foreground

ThemeProvider (context.tsx)  -- SolidJS context，管理加载/缓存/预览/切换
applyTheme (loader.ts)       -- 将 token 注入为 :root 的 CSS 变量
```

---

## Phase 1: 判断主题模式与种子来源

**Entry**: 面对一个主题 JSON 或需要修改的 token

**Actions**:

1. 判断模式：检查 variant 中是否有 `palette` 字段 → compact 模式；仅有 `seeds` → legacy 模式
2. 确认 id 和 name 唯一，id 符合 `[a-z0-9-]+` 格式
3. 检查是否同时定义了 `palette` 和 `seeds` → 这是错误，`getColors()` 会 throw

**Exit**: 明确当前处理的模式和数据来源

## Phase 2: 确定 v1/v2 token 修改范围

**Entry**: 知道要改什么 token

**Actions**:

1. 如果是新组件 → 只使用 `v2-*` token
2. 如果是修复现有组件 → 检查使用的是 v1 还是 v2，保持一致性
3. 如果要修改 `resolve.ts` 中的 v1 token → 同步考虑 `v2/resolve.ts` 中对应的语义 token（如果存在）
4. 检查 `overrides`（v1 override）和 `v2Overrides`（v2 override）是否需要同步更新

**Exit**: 明确修改涉及的 token 列表和对应的文件位置

## Phase 3: 实现修改

**Entry**: 确定了 token 名称和值

**Actions**:

1. 调色板衍生：修改 `seeds`/`palette` 中的 seed color 会在下次 resolve 时自动再生全部分阶
2. 精确覆盖：用 `overrides` 覆盖单个 v1 token，用 `v2Overrides` 覆盖单个 v2 token
3. 新增 token：在对应 resolve 函数中添加，按类别归组（surface → border → text → icon → syntax → ...）
4. 注意 `color.ts` 函数是纯函数，修改算法不影响已有主题数据

**Exit**: 实现完成，token 值符合预期

## Phase 4: 验证

**Entry**: 主题 JSON 或 token 修改已完成

**Actions**:

1. 解析 JSON 验证格式：用 `desktop-theme.schema.json` 校验结构
2. 检查 `light` 和 `dark` 变体都有定义
3. 确保 hex 颜色值符合格式（`#rgb`/`#rrggbb`）
4. 运行 `bun --cwd packages/ui typecheck`
5. 在浏览器/桌面端查看实际效果（light + dark 模式）

**Exit**: 主题修改已验证通过

---

## Quick Reference

### Token 语义分类

| 前缀             | 用途                       | 示例                                                |
| ---------------- | -------------------------- | --------------------------------------------------- |
| `--background-*` | 背景色                     | `--background-base`, `--background-strong`          |
| `--surface-*`    | 表面色（面板、卡片、浮层） | `--surface-base`, `--surface-raised-base`           |
| `--text-*`       | 文字色                     | `--text-base`, `--text-weak`, `--text-strong`       |
| `--border-*`     | 边框色                     | `--border-base`, `--border-hover`, `--border-focus` |
| `--icon-*`       | 图标色                     | `--icon-base`, `--icon-hover`, `--icon-brand-base`  |
| `--input-*`      | 输入框色                   | `--input-base`, `--input-focus`, `--input-disabled` |
| `--button-*`     | 按钮色                     | `--button-primary-base`                             |
| `--syntax-*`     | 语法高亮                   | `--syntax-string`, `--syntax-keyword`               |
| `--markdown-*`   | Markdown 渲染              | `--markdown-heading`, `--markdown-link`             |
| `--avatar-*`     | 头像色                     | `--avatar-background-pink`, `--avatar-text-cyan`    |
| `--v2-*`         | v2 token 全系              | `--v2-background-bg-base`, `--v2-text-text-muted`   |

### v2 Token 层级

```text
primitives (generateV2Primitives)
  ├── grey/hue ramps: v2-grey-100~1200, v2-blue-100~1200, ...
  ├── v2-alpha-light-*, v2-alpha-dark-* (来自 colors.css)
  └── V2_PRIMITIVES_DEFAULT (OC-2 默认值)

semantics (mapV2Semantics)
  ├── v2-background-*, v2-text-*, v2-border-* — 引用 primitives
  ├── v2-overlay-*, v2-state-*, v2-elevation-*, v2-illustration-*
  └── v2-avatar-* (固定值，theme-independent)

foreground (mapV2Foreground)
  └── v2-text-text-base/muted/faint, v2-icon-icon-* — 动态计算前景色

mergeV2Tokens(primitives, semantics, foreground, v2Overrides) → ResolvedV2Theme
```

### 常用 color.ts 函数

| 函数                                       | 用途                      |
| ------------------------------------------ | ------------------------- |
| `hexToOklch(hex)`                          | hex → Oklch 转换          |
| `oklchToHex(oklch)`                        | Oklch → hex 转换          |
| `generateScale(seed, isDark)`              | 12 阶色阶（v1）           |
| `generateNeutralScale(seed, isDark, ink?)` | 12 阶中性色阶（v1）       |
| `generateV2HueScale(seed, isDark)`         | 12 阶色阶（v2，扩展分布） |
| `blend(color, bg, alpha)`                  | 混合颜色                  |
| `mixColors(c1, c2, amount)`                | Oklch 插值混合            |
| `shift(color, {l?, c?, h?})`               | Oklch 偏移                |
| `contrastRatio(fg, bg)`                    | WCAG 对比度计算           |
| `fitOklch(oklch)`                          | 将 Oklch 钳制到 sRGB 色域 |

### 文件位置

| 路径                                              | 内容                                                           |
| ------------------------------------------------- | -------------------------------------------------------------- |
| `packages/ui/src/theme/types.ts`                  | DesktopTheme, ThemeVariant, ResolvedTheme, V2ColorValue 等类型 |
| `packages/ui/src/theme/color.ts`                  | Oklch 色彩空间工具函数                                         |
| `packages/ui/src/theme/resolve.ts`                | v1 token 解析引擎 (~200 tokens)                                |
| `packages/ui/src/theme/v2/resolve.ts`             | v2 token 解析引擎 (primitives + semantics + foreground)        |
| `packages/ui/src/theme/v2/mapping.ts`             | v2 语义 token 映射 (light/dark)                                |
| `packages/ui/src/theme/v2/foreground.ts`          | v2 前景色动态计算                                              |
| `packages/ui/src/theme/v2/default-primitives.ts`  | v2 默认 primitives (OC-2)                                      |
| `packages/ui/src/theme/v2/avatar.ts`              | v2 头像色 (theme-independent)                                  |
| `packages/ui/src/theme/context.tsx`               | ThemeProvider (SolidJS)                                        |
| `packages/ui/src/theme/loader.ts`                 | applyTheme、loadThemeFromUrl                                   |
| `packages/ui/src/theme/default-themes.ts`         | 37 个内置主题注册                                              |
| `packages/ui/src/theme/themes/*.json`             | 37 个内置主题 JSON 定义                                        |
| `packages/ui/src/theme/desktop-theme.schema.json` | 主题 JSON Schema                                               |
| `packages/ui/src/styles/colors.css`               | 基础 CSS 变量                                                  |
| `.aigcfroge/themes/*.json`                        | 用户自定义主题                                                 |
| `.aigcfroge/plugins/*.json`                       | 主题插件                                                       |

## Success Criteria

- [ ] 新 UI 组件使用 `--v2-*` token 而非 `--surface-*` 等 v1 token
- [ ] 主题 JSON 通过 `desktop-theme.schema.json` 格式校验
- [ ] light 和 dark 变体都定义且视觉可用
- [ ] 没有硬编码的颜色值出现在组件 CSS 中
- [ ] typecheck 通过（`bun --cwd packages/ui typecheck`）
