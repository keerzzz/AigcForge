# 构建警告 + lint 高信号子集 清理计划（协议审计修订版）

## 0. 协议审计结论（应"用 CLAUDE/AGENTS/DESIGN/ARCHITECTURE + skills + git 工作流审批计划"要求）

| #   | 发现                                                                                       | 级别 | 裁定                                                                                                                                                                                                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------ | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | dialog 静态导入者是否主包（决定动态改静态是否违背 AGENTS.md line 92 "偏好重模块动态导入"） | HIGH | **已核查解决**：`mode-switcher.tsx:9` 静态导入 `DialogSettings` -> `dialog-settings-v2` -> `providers.tsx` -> DialogSelectProvider/ConnectProvider。整簇确认主包。动态导入是死优化，改静态不违背协议（line 92 偏好动态的前提是"能真正延迟加载"，此处不能）。协议理想（DialogSettings 整体 lazy）声明为技术债延后 |
| 2   | 计划未提查阅 frontend-theming / effect skill（CLAUDE.md 改完即审 step 2 强制）             | HIGH | **已补**：context.tsx 改动依据 frontend-theming SKILL.md（oc-2 = V2_PRIMITIVES_DEFAULT 默认主题，Phase 4 验证要求）；Effect lint 修复依据 effect SKILL.md（"不得引入 any/非空断言/unchecked cast 满足类型"，对照 effect-smol）                                                                                   |
| 3   | oc-2 改动缺主题列表/切换验证（frontend-theming Phase 4 强制 light+dark visual）            | MED  | **已补**：验证增加 OC-2 仍在 picker、oc-2<->其他主题切换正常                                                                                                                                                                                                                                                     |
| 4   | 分支/提交策略未声明（AGENTS.md Branch/Commit）                                             | MED  | **已补**：在 v2-release（非默认分支，可直接工作）；不主动提交；若提交按 conventional `fix(app)`/`fix(ui)`/`chore(lint)` 分 scope，不混包                                                                                                                                                                         |
| 5   | lint `no-misused-spread`（Schema class）修复方式未约束                                     | MED  | **已补**：禁 `as any`/cast（effect skill + No-Cheating）；逐个用构造器或重新 decode；故意行为用 `// eslint-disable-next-line <rule> -- <reason>` 带 reason                                                                                                                                                       |
| 6   | manualChunks 拆 effect 可能循环依赖                                                        | LOW  | 可接受，已声明剩余风险，构建验证兜底；solid 不拆（保守，避免破坏响应式图）                                                                                                                                                                                                                                       |
| 7   | lint 范围边界                                                                              | INFO | **已对齐**：跳过 vendor 桥接包 effect-drizzle-sqlite/effect-sqlite-node（ARCHITECTURE §4.8 豁免）、console/stats（.oxlintrc ignore）、sdk.gen.ts/\*.d.ts ✓                                                                                                                                                       |
| 8   | 代码检索分层（CLAUDE.md）                                                                  | LOW  | **已补**：dialog 改动前用 codegraph callers/impact 评估爆炸半径，不只用 grep                                                                                                                                                                                                                                     |

## 1. 背景与分支审批结论（回答"有没有必要修复"）

本地 4 分支拓扑（已核实）：

- `main`(c21bd96) -> 祖先 of `v2-release`
- `meta-v2-closure`(80bdddb) 与 `subagent-visibility`(80bdddb) **同一 commit**，已 `merge: subagent-visibility into v2-release` 合入
- `v2-release`(7c5b974) = **所有工作超集 HEAD**（领先 main 63 commits，当前分支）

**结论**：构建警告源文件在 main 与 v2-release 字节一致，git log 显示自 brand 迁移后未动 -> **全部警告为既存基线，非任何分支回归**。只在 v2-release 修一次，合入即全分支消除；其余分支无需独立修。今天差分审查残留风险正列这两项，本计划收口。

## 2. 必要性判定

| 类别                                                             | 数量 | 判定     | 理由                                                                                                                                              |
| ---------------------------------------------------------------- | ---- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| settings-keybinds 5 个死 `lazy()`                                | 5    | 必修     | 导入的是已被全包静态加载的 V2 **通用原语**（非"选中路径重模块"，AGENTS.md line 92 不适用），lazy 零收益只增开销。删除即资产                       |
| oc-2.json 同文件双导入                                           | 1    | 必修     | 静态导入已保证默认主题同步可用；glob 的 oc-2 动态 loader 永不调用（store.themes["oc-2"] 提前命中 + line 201 `if(!file)` 兜底）                    |
| 3 dialog 混合静态/动态                                           | 3    | 必修     | 簇经 mode-switcher->DialogSettings 确认主包（审计#1），动态 `void import().then()` 是死优化 + AGENTS.md 禁止的 inline-chain 形式。改静态          |
| index 2.5MB                                                      | 1    | 必修     | 缺 manualChunks，vendor 揉进 index                                                                                                                |
| Shiki 语法块 600-780kB                                           | 多   | 调高阈值 | 已按需分块、体积固有、非关键路径，桌面端本地加载                                                                                                  |
| no-unused-vars                                                   | 34   | 必修     | 死导入，删除即资产，oxlint type-aware 准确                                                                                                        |
| no-floating-promises/no-implied-eval/no-unsafe-optional-chaining | 5    | 必修     | bug 邻近                                                                                                                                          |
| no-misused-spread/no-base-to-string                              | 35   | 逐个核查 | 含真实 bug（展开 Schema class 丢原型、String(error) 产 [object Object]）+ 故意行为（tui [...line] 按字符绘制）。修真的，留故意的带 reason disable |
| no-unsafe-type-assertion(1483)+consistent-return(739)            | 2222 | **不修** | suspicious:warn 类型风格噪音，门禁 0-error，差分审查已接受为基线。盲修=巨 diff+零行为收益，违背极致减法                                           |
| 其余类型风格                                                     | ~560 | **不修** | 同上                                                                                                                                              |

## 3. 实施方案（仅 v2-release）

### Phase 1 - 构建动态导入（9->0）

**前置（审计#8）**：对 dialog-select-provider/connect-provider/select-model 跑 `codegraph_callers`/`impact` 确认爆炸半径后再改。

**1.1 `packages/app/src/components/settings-keybinds.tsx`**（零风险）

- 删 line 15-25 的 5 个 `lazy(()=>import(...))`（ButtonV2/IconV2/IconButtonV2/TextInputV2/SettingsListV2）
- 顶部改静态导入，与 line 4-7 V1 静态导入风格一致；移除不再用的 `lazy` import
- 5 组件无 Suspense 包裹、被全包静态导入 -> 主包，转 static 无行为变化

**1.2 `packages/ui/src/theme/context.tsx`** oc-2 去重（依据 frontend-theming skill）

- line 28：`import.meta.glob("./themes/*.json")` -> `import.meta.glob(["./themes/*.json", "!./themes/oc-2.json"])`
- `themeIDs()`(line 32-38)：glob keys 不再含 oc-2，手动补回保证 picker 仍显示 OC-2
- 安全已核：oc-2 经 store.themes["oc-2"](line 196 静态 oc2ThemeJson 预填) 提前命中，永不走到 getFiles()[oc-2]，line 201 兜底

**1.3 dialog 簇动态导入改静态**（7 call site，审计#1 已证主包）

- `dialog-connect-provider.tsx:28`、`dialog-select-model.tsx:122,204`、`dialog-select-model-unpaid.tsx:23,29`、`usage-exceeded-dialogs.tsx:79`、`use-session-commands.tsx:253`
- `void import("./x").then(x => x.Fn(...))` -> 顶部 `import { Fn } from "./x"` + 直接调用。保留调用时序（模块已加载，同步调用等价）
- `dialog-select-model-unpaid` 本身是纯 lazy 模块（不在警告列表，prompt-input.tsx:1397 的动态导入有效分块）-> **不碰其导入者**，只改它内部对上述 3 模块的动态导入
- **技术债声明（方案对冲）**：协议理想是把 DialogSettings 整体改 lazy（mode-switcher.tsx:9 当前静态导入），实现真正的设置面板代码分割。但那是 settings-shell 重构 + Suspense/loading UX，超出"警告清理"范畴，延后

### Phase 2 - 构建大 chunk

**2.1 `packages/app/vite.config.ts`** 加 manualChunks + 调高阈值

```ts
build: {
  target: "esnext",
  sourcemap: true,
  chunkSizeWarningLimit: 1000,
  rollupOptions: {
    output: {
      manualChunks(id) {
        if (id.includes("node_modules")) {
          if (id.includes("/shiki/") || id.includes("@shikijs/")) return "shiki"
          if (id.includes("/effect/") || id.includes("@effect/")) return "effect"
          return undefined // solid-js 与 app 同块，拆分破坏响应式图，不拆
        }
      },
    },
  },
}
```

- 健壮但保守：只拆 shiki/effect（非 Solid 大块）。预期 index 2.5MB -> ~1.5-1.8MB。若 effect 拆出产生循环依赖警告（审计#6），退化 effect 也留 index（只拆 shiki）

### Phase 3 - lint 高信号子集（~50-70，依据 effect skill）

按包内执行 + `bun --cwd packages/<name> test` 验证：

- **34 no-unused-vars**：删死导入/变量（最低风险）
- **5 bug 邻近**：no-floating-promises 加 void/await；no-implied-eval 改显式函数；no-unsafe-optional-chaining 收窄
- **35 no-misused-spread + no-base-to-string 逐个核查**（审计#5）：
  - 真实 bug 修：`String(error)` -> `error instanceof Error ? error.message : String(error)`；Schema class 展开丢原型 -> 构造器重建或重新 decode，**禁 as any/cast**
  - 故意行为留：`// eslint-disable-next-line <rule> -- terminal renders by code point` 等，带 reason（No-Cheating 要求）
- **跳过**：effect-drizzle-sqlite/effect-sqlite-node（vendor 豁免）、console/stats、sdk.gen.ts/\*.d.ts

### Phase 4 - 交付分析报告

仓库根写 `AIGCFORGE_WARNING_CLEANUP_2026-07-14.md`（与既有 `AIGCFORGE_DIFFERENTIAL_REVIEW_2026-07-14.md` 同惯例）：分支审批结论 + 必要性判定表 + 修复前后 lint/build 警告对比 + 残留技术债（2222 类型风格噪音为何不修；DialogSettings lazy 延后）。

## 4. 验证（改完即审，含审计#3 主题验证）

| 命令                                          | 预期                                                                                 |
| --------------------------------------------- | ------------------------------------------------------------------------------------ |
| `bun --cwd packages/app build`                | 0 动态导入警告；index 显著缩小；0 大 chunk 警告                                      |
| `bun run lint`                                | 0 errors；warnings 2817 -> ~2740                                                     |
| `bun --cwd packages/app typecheck`            | Pass                                                                                 |
| `bun --cwd packages/ui typecheck`             | Pass                                                                                 |
| `bun --cwd packages/app test --timeout 30000` | Pass（含 theme/keybinds/dialog）                                                     |
| **主题验证（frontend-theming Phase 4）**      | OC-2 仍在 picker；oc-2<->其他主题切换正常；light+dark 无异常（用现有 test 或 smoke） |
| 受影响包 test（core/tui/session-ui 等）       | Pass                                                                                 |
| `git diff --check`                            | 无空白错误                                                                           |

## 5. 分支与提交策略（审计#4）

- 在 `v2-release`（当前，非默认分支）直接工作，不新建分支（非 main，无需 branch first）
- **不主动 commit/push**（除非用户要求）
- 若提交：按 AGENTS.md conventional，分 scope 提交：`fix(app): remove dead lazy imports in settings-keybinds`、`fix(ui): dedupe oc-2 theme static and glob import`、`fix(app): convert dead dialog dynamic imports to static`、`build(app): split shiki/effect vendor chunks`、`chore(lint): remove dead imports and fix bug-adjacent warnings`，不混包

## 6. 剩余风险

- manualChunks 拆 effect 可能循环依赖 -> 构建验证，必要时退化只拆 shiki
- dialog 改静态：模块已主包，无加载语义变化；逐个核对调用时序
- lint no-misused-spread 逐个判断有主观性，报告标注哪些留 disable 注释

## 7. 不做（显式技术债）

- 2222 no-unsafe-type-assertion + consistent-return 类型风格噪音：不修，违背极致减法
- 拆 solid-js：风险过高，不做
- DialogSettings 整体 lazy 重构：超范围，延后
- meta-v2-closure/subagent-visibility/main 独立修复：无需，v2-release 是超集 HEAD
