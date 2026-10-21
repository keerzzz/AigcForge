# 新会话提示词：brand-mode-icons 实施交接（S1/S2）

> 用法：在新会话中直接粘贴本文件全文作为首条消息。本文件是交接真源；与聊天记录冲突时，以本文件列出的仓库文档为准。

## 0. 角色与目标

你是 AigcForge 仓库的高级全栈工程师，负责继续执行 `brand-mode-icons` 任务的 **S1、S2 切片**（TDD），完成后走 S4 门禁。S3（品牌资产全渠道收敛）**冻结**，必须等用户单独视觉批准后才能动。不要重新设计，不要扩大范围。

- 工作区：`/home/keer/workspace/aigcfroge`（Linux，Bun + TypeScript + SolidJS + Effect monorepo）。
- 分支：`brand-mode-icons`；基线 `main = origin/main = 43997011e`；当前 HEAD 应为 `e57f09992`（docs 提交）或其后续提交。
- 交付物：完整的 S1/S2 代码 + 测试 + 门禁证据；本次不要求完成 S3。
- 语言：中文；输出精简、可执行；引用文件用相对路径。

## 1. 必读真源（按顺序）

1. `docs/plan/brand-mode-icons-2026-10-20.md`（423 行，**唯一实施计划**；已审批 + 视觉确认）。
2. `docs/review/brand-mode-icons-plan-approval-2026-10-20.md`（255 行，审批记录；含 P0/P1 修正、chat 图标改版、亮色顶点修正、基线迁移回执 ⑨）。
3. `CLAUDE.md`（执行宪法：九荣九耻、四大拒绝、根因收敛、极致减法；测试/类型检查/Lint/Format/CSS Token/Effect/Schema/模块组织边界）。
4. `AGENTS.md`（分支与提交、Slice Checkpoint 四规则、代码检索分层、codegraph/grep 协同、测试命令）。
5. `DESIGN.md`（quiet & dense；`data-component`/`data-slot`/`data-state`；禁止硬编码 hex/rgb/px；Token；无障碍；Verification 清单）。
6. `docs/testing.md` **§10 测试书写红线**（156–182 行）；`packages/app/AGENTS.md`（本地开发、SolidJS、并行工具、browser automation）。
7. `ARCHITECTURE.md`（包拓扑与边界；本任务只碰展示层）。
8. Skills：`.aigcfroge/skills/protocols/SKILL.md`、`.aigcfroge/skills/reuse-first-refactor/SKILL.md`、`.aigcfroge/skills/frontend-theming/SKILL.md`、`.aigcfroge/skills/quality-to-pr/SKILL.md`、`.aigcfroge/skills/enterprise-code-standard/SKILL.md`。`effect`/`database` 本切片不需要。
9. 视觉真源：`docs/research/brand-mode-icons/brand-mode-icons-preview-2026-10-20.html` + `screenshots/01–12`。

## 2. 开工前的机械校验（不通过就停并报告）

```bash
cd /home/keer/workspace/aigcfroge
git status --short --branch          # 期望：## brand-mode-icons，工作树 clean
git rev-parse HEAD main origin/main  # 期望 main/origin/main = 43997011e；HEAD = e57f09992 或其后
git log --oneline -3
```

- main/origin/main 不是 `43997011e`，或工作树脏（除本任务未提交文件外）→ 先报告，不要开始改代码。
- S1/S2 的开工条件已在审批记录 ⑨ 中满足；不要再要求重新审批，也不要重开设计讨论。

## 3. 任务边界（硬约束）

**允许：**

- S1：`packages/ui/src/v2/components/icon.tsx` 新增 5 个 `rail-*` 键；`packages/app/src/context/mode.tsx` 的 `MODE_DEFINITIONS.icon` 指向 `rail-*`；`mode.test.ts:26` 更新为 `rail-`；`global-shell.spec.ts` 增加符号断言。
- S2：新增 `packages/app/src/components/mode-switcher.css`；`mode-switcher.tsx` 注入 `data-component`/`data-slot`/`data-state` 与 2px 激活条；e2e 断言。
- S4：跑门禁、贴证据、更新 slice checkpoint；必要时在 `packages/app/e2e/coverage-manifest.json` 或 `docs/technical-debt.md` 登记缺口（owner + unlock + 来源）。

**禁止：**

- ❌ 改任何 S3 资产（`logo.tsx`、`logo.css`、favicon、`site.webmanifest`、桌面图标、social-share）。
- ❌ 修改内页 11 文件 / 21 处 `mode-*` 语义图标（保留旧键不变）。
- ❌ 改 `Logo` 字标几何、导出名 `Mark`/`Splash`/`Logo`、或 `mode-*` 旧几何。
- ❌ 引入 SplashLoader/splash-loader.tsx/facet-\* 动画槽（基线不存在）。
- ❌ per-mode 彩色激活条、glow、渐变、呼吸脉冲（已被用户收回）。
- ❌ 硬编码 hex/rgb/px（组件 CSS 必须走 `--v2-*`；2px 指示条尺寸按计划固定值，可在 CSS 注释说明来源）。
- ❌ `as any` / `@ts-ignore` / 假测试 / 源码字符串断言 / 从根目录跑测试。
- ❌ push 或开 PR（用户未给 issue 编号与 PR 目标前不执行；需先问）。

## 4. 代码地图与上下游契约

### UI 注册表（实现 S1 的地方）

- `packages/ui/src/v2/components/icon.tsx`（145 行）：`icons` 字典 :3–88；sprite id 生成 `aigcfroge-v2-icon-<name>` :90–117；`Icon` 渲染 `<svg><use href="#..."/></svg>` :124–145；尺寸 14/16/20 :128；**未知键回退 `plus`** :126（所以 typecheck 抓不到漏注册，必须用 e2e 门禁）。
- 计划 §3.1 有 5 个 symbol 的最终 16×16 几何（stroke 1.5、round caps/joins、currentColor；`rail-chat` 是 2026-10-20 改版后的「对话气泡 + 三点」；`rail-assistant` 宽体手账 + 14px 微缩变体）。**照抄计划，不要重新画**。

### App 契约（消费方）

- `packages/app/src/context/mode.tsx`：`MODE_DEFINITIONS` :7–48，5 项 id/href/icon/labelKey/descriptionKey/surface；`icon` 当前为 `mode-*`。
- `packages/app/src/context/mode.test.ts`（60 行）：:19 图标唯一性；:26 `expect(definition.icon).toBe("mode-" + definition.id)` → 改为 `"rail-" + definition.id`；共 5 个 test。
- `packages/app/src/components/mode-switcher.tsx`（91 行）：nav :35–38；active 判定 :42 = `location.pathname !== "/" && mode.currentMode === item.id`；wrapper `div.relative` :45；`IconButtonV2` :46–54（`variant=neutral|ghost-muted`、`aria-pressed`）；Assistant badge :55–59；底部 help/settings :66–88。当前无 CSS import。
- 只有 `ModeSwitcher` 消费 `definition.icon`（`mode-switcher.tsx:50`）；`home-overview` 的 `modeFilters` 只读 id/labelKey（`home-overview-model.ts:23–47`），不受影响。

### 上游/下游与资产真相

- 上游：`packages/schema` 的 `ProductMode` union（`mode.test.ts` 对其做双向覆盖断言）；`packages/core/product-mode-agent-policy` 仅被 mode.tsx import，**不要改**。
- 主题：`packages/ui/src/v2/styles/theme.css`（light :2 / `[data-color-scheme="dark"]` :334+；`--v2-icon-icon-accent` :31/:149；`--v2-border-border-focus` :39/:156；avatar blue/cyan :73/:81、暗色 :398/:406）；`colors.css`；37 套主题（`packages/ui/src/theme/themes/*.json`）。
- `--v2-text-text-contrast` 明暗都近白：只用在 color-mix（C 底座）；**Mark 顶点已改为 `--v2-text-text-base`（自适应）**，不要回退。
- 资产真相（S3 才动，先记住）：`logo.tsx` Mark :8–32 / Splash :34–61 / Logo :63–100；slots `logo-mark-a/g/c/i`、`logo-splash-a/g/c/i`；无 gradient/filter；加载态是 `<Splash animate-pulse>`（app.tsx:584,623；desktop renderer index.tsx:344）。活体 favicon 是 `-v3` 套件（index.html:10–13、favicon.tsx:6–8、entry.tsx:72）；`site.webmanifest` 仍写 "OpenCode"；桌面 `icons/{dev,beta,prod}` 共 160 文件（含 .icns/.ico/dock/tiles），`convert` 不能写 ICNS。
- 测试：`global-shell.spec.ts`（349 行）rail describe :135–177；`modeButton` helper :112–116 依赖英文 `nav[aria-label="Mode switcher"]`；badge 测试 :162–176；`home-mode-filter.spec.ts` 是模式契约上下文。`packages/ui` 无 icon/logo 测试；e2e 无 `toHaveScreenshot`。
- 脚本：`packages/app/package.json` `test:unit:file` :24、`test:e2e` :26；root `typecheck` = `bun turbo typecheck`；`script/lint-changed.ts`；`.aigcfroge/skills/protocols/scripts/check-refs.sh`。

## 5. 已批准的设计规格（S1/S2 只实现这些）

- **D1**：单一强调色 `var(--v2-icon-icon-accent)`；**2px × 20px** 垂直指示条，绝对定位、150ms、无 glow、无 per-mode 色；已收回 3.5px/12% 柔光/呼吸脉冲。
- **D2**：新增 `rail-chat|rail-coding|rail-work|rail-assistant|rail-custom`；旧 `mode-*` 原样保留；内页零改动。
- **§3.1 图标**：16×16 viewBox、`fill=none stroke=currentColor stroke-width=1.5 stroke-linecap=round stroke-linejoin=round`；实心细节（assistant 双耳/书签、custom 旋钮、chat 三点）单独 fill；`rail-assistant` 在 14px 用 `rail-assistant-micro`；14px 其他图标同一几何。
- **§3.2 DOM**：`nav[data-component="mode-switcher"]`；每条目 wrapper `div[data-slot="rail-item"][data-mode][data-state="active|inactive"]`；指示条 `<span data-slot="active-indicator" aria-hidden="true">`。**禁止**把 data-\* 传给 `IconButtonV2`（它在 spread 后覆盖 `data-component`/`data-state`，见 icon-button-v2.tsx:23,27；titlebar.tsx:950–951 有同类陷阱）。CSS 写同名 `mode-switcher.css`。
- **保留**：`aria-pressed`、`aria-label`、tooltip、Assistant badge、focus-visible 轮廓；不得布局位移。

## 6. 实施顺序（TDD，逐切片）

### S0（已完成前置，可复查）

- 已在 `brand-mode-icons` 分支提交 docs：`e57f09992 docs(plan): record brand mode icons approval and preview`。

### S1 — rail 图标入驻与解耦

1. **RED**：在 `global-shell.spec.ts` 增加断言：5 个 rail 按钮内 `use[href]` 的 symbol id 以 `#aigcfroge-v2-icon-rail-` 开头、互不相同、不是 `plus` fallback；并加内页回归断言（`/mode/assistant` 内仍用 `mode-assistant`；该断言变更前就是绿，属回归保护，不算 RED）。
2. 跑：`bun --cwd packages/app test:e2e e2e/regression/global-shell.spec.ts` → 期望失败（RED）。
3. **GREEN**：`icon.tsx` 注入 5 键（按计划 §3.1）；`mode.tsx` 五个 `icon` 改 `rail-*`；`mode.test.ts:26` 改 `rail-`；`mode.test.ts` 唯一性 :19 应自然通过。
4. 跑：`bun --cwd packages/app test:unit:file src/context/mode.test.ts`、`bun --cwd packages/ui typecheck`、`bun --cwd packages/app typecheck`、e2e。
5. **REFACTOR/证据**：14/16/20px × 亮/暗渲染证据（可用预览 HTML 或 Storybook/screenshot；不要新增 `toHaveScreenshot` 基线，除非用户批准）。
6. 提交：`feat(ui): add decoupled rail mode icons with 16px geometry` + `test(app): assert rail icon symbol ids and preserve in-surface glyphs`（或合并，按 AGENTS.md 类型）。

### S2 — 激活光轨

1. **RED**：e2e 断言 `nav[data-component="mode-switcher"]`、`[data-slot="rail-item"]` 的 `data-mode`/`data-state` 互斥、`[data-slot="active-indicator"]` 存在、`aria-pressed` 与路由一致、切换时按钮 bounding-box 不变；跑同一 e2e 期望失败。
2. **GREEN**：新增 `mode-switcher.css` 并 import；nav/wrapper 注入属性；渲染指示条 span；保留 IconButtonV2 variant 与 badge。
3. 跑 e2e + app/ui typecheck；**REFACTOR**：亮/暗对比度目检、focus-visible、高对比模式。
4. 提交：`feat(app): add quiet rail active indicator with single accent`。

### S4 — 全量门禁（S1/S2 完成后）

```bash
bun --cwd packages/ui typecheck
bun --cwd packages/app typecheck        # 含 e2e tsconfig
bun --cwd packages/desktop typecheck
bun --cwd packages/ui test
bun --cwd packages/app test:unit:file src/context/mode.test.ts
bun --cwd packages/app test:e2e e2e/regression/global-shell.spec.ts
LINT_BASE_REF=origin/main bun run script/lint-changed.ts
bash .aigcfroge/skills/protocols/scripts/check-refs.sh
```

## 7. 质量与协议红线

- **AGENTS.md Slice Checkpoint 四规则**：提交清单必须来自 `git log --oneline <base>..HEAD` 粘贴；已验证与未验证分开写；关系型结论必须落到决定性函数 `file:line`，否则标 UNVERIFIED；未交付范围登记到 `packages/app/e2e/coverage-manifest.json` 或 `docs/technical-debt.md`（含 owner + unlock + 来源）。
- **docs/testing.md §10**：不做源码字符串断言；RED 必须只靠改生产代码即可变绿；行为用 e2e/纯函数/类型级断言；只在包内跑测试；禁止 `Effect.sleep` 等待；新增 RED 前后要跑「改生产→绿→还原→两次输出」。
- **代码检索**：符号/调用链/影响面 → codegraph MCP（search/node/callers/callees/impact；`explore` 每项目限 2 次）；字符串/flag/i18n/路径 → Grep/Glob；单点行范围 → Read。
- **样式**：颜色/间距/圆角全部 `--v2-*`；组件同目录 CSS；`data-component/data-slot/data-state`；禁止 BEM/CSS Modules。
- **无障碍**：图标按钮必须 `aria-label`；指示条 `aria-hidden`；保留可见 focus；不靠颜色单独传达状态（WCAG 1.4.1）。
- **提交**：conventional `type(scope): summary`；每切片独立 commit；不改无关文件；每次提交前 `git diff -- <files>` 确认影响面。
- **本地验证**（如需手看 UI）：`packages/aigcfroge` 起后端 `bun run --conditions=browser ./src/index.ts serve --port 4096`；`packages/app` 起前端 `bun dev -- --port 4444`；打开 `http://localhost:4444`。**绝不重启 app/server 进程**（packages/app/AGENTS.md）。有 browser automation 需求时用 `agent-browser`。

## 8. 已知陷阱（不要重犯）

1. `SplashLoader`/`splash-loader.tsx`/`facet-a/g/c`/`pillar-i`/飞入动画在基线**不存在**；S3 已重写，禁止复活旧实现。
2. 旧梯度版 logo 路径（`M11.25 2.8…` 等）已被 P0 修正废弃；方案 04 使用 100 网格多边形 + 顶点 + C 底座（C = 候选 2 color-mix）。
3. `IconButtonV2` 会覆盖调用方传入的 `data-component`/`data-state`；data-\* 必须挂在 wrapper/nav。
4. `typecheck` 抓不到漏注册 rail-\*（Icon.name 接受任意字符串 + plus fallback）；e2e 符号断言是唯一门禁。
5. 活体 favicon 是 `-v3` 套件；`site.webmanifest` 仍为 "OpenCode"；`entry.tsx:72` 远程图标；S3 处理，别在 S1/S2 动。
6. 桌面图标 160 文件含 icns/ico/tiles；ImageMagick 不能写 ICNS；S3 延期项已登记。
7. `--v2-text-text-contrast` 两主题近白；Mark 顶点已改用 `--v2-text-text-base`（自适应），不要回退成白点。
8. e2e 的 locator 依赖英文 `nav[aria-label="Mode switcher"]` 与 `getByRole("button", { name: "Coding" })`；不要本地化该 label 或改 helper。
9. Playwright 位置参数按正则匹配绝对路径；计划里的全路径写法可用，但优先用包内相对路径 `e2e/regression/global-shell.spec.ts`。
10. `packages/ui/AGENTS.md` 不存在；不要伪造引用。
11. `docs/plan/brand-mode-icons-2026-10-07.md` 已在 main 入仓（445 行），是历史版；**不要**用它覆盖 10-20 计划。
12. S3 的视觉回归门禁不存在（无 `toHaveScreenshot`）；如果要补，需用户批准并登记 coverage/debt。

## 9. 汇报格式（每个切片结束必须给）

按 CLAUDE.md 模板：

```text
复查结论:
- 影响文件:
- 命中 skills:
- 安全门禁:
- 工程门禁:
- 已运行命令:（粘贴真实输出与 tally；不得只写“通过”）
- 剩余风险:
```

并附 AGENTS.md slice checkpoint：`git log --oneline <base>..HEAD` 的原始输出；明确列出未验证项；未交付范围写入 coverage-manifest 或 debt ledger。

## 10. 待用户决策 / 本批不做

- S3 资产（Mark/Splash/favicon/desktop/social-share）需单独视觉批准；不在本会话执行。
- 关联 Issue 编号（`Fixes #N`）与 PR 目标未知；push/PR 前先问用户。
- 旧 `brand-splash-redesign`（commit `06872530f`）代码不迁移；用户若要，另行立项。
- 视觉回归基线、`.icns`/tiles、静态资产生成脚本：已登记债务，不在 S1/S2。

## 11. S1/S2 完成定义（DoD）

- S1：5 个 `rail-*` 注册；`mode.test.ts` 5 test 绿；e2e 符号断言绿（含内页 `mode-*` 回归）；ui/app typecheck 绿；14/16/20px × 亮/暗证据。
- S2：`data-*` 契约、单一激活互斥、2×20px accent 指示条、零布局位移、`aria-pressed` 正确；e2e + app typecheck 绿；亮/暗与 focus-visible 证据。
- S4：§6 全部命令 exit 0，输出贴入复查结论；分支仅包含 S1/S2 相关改动。

## 12. 第一轮回复要求

先只做三件事：①贴出 `git status`/`git rev-parse` 校验结果；②复述你读到的 S1/S2 范围与门禁命令；③给出 S1 的 RED 断言清单（先不写代码）。等确认后再执行 S1。

---

## 附录 A：关键命令速查

```bash
# 单测（app）
bun --cwd packages/app test:unit:file src/context/mode.test.ts
# e2e（app）
bun --cwd packages/app test:e2e e2e/regression/global-shell.spec.ts
# 类型检查（单包）
bun --cwd packages/ui typecheck
bun --cwd packages/app typecheck
bun --cwd packages/desktop typecheck
# UI 包测试
bun --cwd packages/ui test
# 增量 lint（必须显式基线）
LINT_BASE_REF=origin/main bun run script/lint-changed.ts
# 协议引用检查
bash .aigcfroge/skills/protocols/scripts/check-refs.sh
# 本地 UI（可选；不要重启已有进程）
# 后端：cd packages/aigcfroge && bun run --conditions=browser ./src/index.ts serve --port 4096
# 前端：cd packages/app && bun dev -- --port 4444
```

## 附录 B：本任务相关文件清单

| 类别             | 文件                                                                                                                                                         | 本批是否修改 |
| :--------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------- |
| 计划/审批        | `docs/plan/brand-mode-icons-2026-10-20.md`、`docs/review/brand-mode-icons-plan-approval-2026-10-20.md`                                                       | 只读         |
| 视觉预览         | `docs/research/brand-mode-icons/brand-mode-icons-preview-2026-10-20.html`、`screenshots/01–12`                                                               | 只读         |
| icon 注册表      | `packages/ui/src/v2/components/icon.tsx`                                                                                                                     | S1 改        |
| 模式契约         | `packages/app/src/context/mode.tsx`、`mode.test.ts`                                                                                                          | S1 改        |
| 导轨组件         | `packages/app/src/components/mode-switcher.tsx`、新增 `mode-switcher.css`                                                                                    | S2 改        |
| e2e              | `packages/app/e2e/regression/global-shell.spec.ts`                                                                                                           | S1/S2 改     |
| 品牌资产（冻结） | `packages/ui/src/components/logo.tsx`、`logo.css`、`assets/favicon/*`、`packages/app/index.html`、`public/*`、`site.webmanifest`、`packages/desktop/icons/*` | S3 才动      |
| 协议             | `CLAUDE.md`、`AGENTS.md`、`DESIGN.md`、`ARCHITECTURE.md`、`docs/testing.md`、`packages/app/AGENTS.md`                                                        | 只读         |
| Skills           | `.aigcfroge/skills/{protocols,reuse-first-refactor,frontend-theming,quality-to-pr,enterprise-code-standard}`                                                 | 只读         |
