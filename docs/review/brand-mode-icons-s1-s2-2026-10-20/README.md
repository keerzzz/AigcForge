# brand-mode-icons S1 / S2 / S4 实施证据（2026-10-20）

本批起点 `e02392ce1`；分支 `brand-mode-icons`；基线 `main = origin/main = 43997011e`。S1、S2 已实施，S4 命令与结果见下文。范围依据：[实施计划](../../plan/brand-mode-icons-2026-10-20.md) §3.1/§3.2/§4；S3 保持冻结。

## S1 复查结论

- 影响文件：`packages/ui/src/v2/components/icon.tsx`、`packages/app/src/context/mode.tsx`、`mode.test.ts`、`packages/app/e2e/regression/global-shell.spec.ts`。
- 命中 skills：protocols / reuse-first-refactor / frontend-theming / quality-to-pr / enterprise-code-standard。
- 安全门禁：保留内页旧 `mode-*`、ARIA、tooltip、badge；无网络、存储、权限接口变更。
- 工程门禁：ui/app 类型检查 exit 0；模式单测 5 pass / 0 fail / 53 expect；首次完整 e2e 15 passed；成员守卫修改后定向 e2e 2 passed。
- RED：完整首轮 14 passed / 1 failed（原始临时日志未保留，不能当作归档证据）；保留的生产回退复验为 1 failed / 1 passed。唯一失败为 Chat 实际 `mode-chat` 与预期 `rail-chat` 不符；内页回归始终为绿。
- GREEN：完整 e2e 15 passed (1.2m)；最终成员守卫修改后定向 e2e 2 passed (35.1s)。原始输出见 [s1-red-recheck.log](command-output/s1-red-recheck.log)、[s1-green.log](command-output/s1-green.log)、[s1-final-focused.log](command-output/s1-final-focused.log)。
- 当前视觉证据：[亮暗 × 14/16/20px × 五模式](screenshots/s1-icons-final-1.png)；通过临时 Vite 页面导入真实 `Icon` 和真实 v2 theme CSS。30 个 DOM 尺寸/href/描边值见 [s1-matrix-final-1.json](command-output/s1-matrix-final-1.json)；14px Assistant 指向 micro。临时页面已删除。
- 历史证据：`s1-icons-light.png`、`s1-icons-dark.png`、`s1-matrix-light.json` 是最初 1.5 描边的记录，当前规范以回执 ⑩ 的 1.0 为准。
- 剩余风险：未建立自动截图基线；默认亮暗之外的主题未审计，已登记到技术债 §18。

### 用户批准的描边修订

用户要求预览 1.0 与 1.25 后，明确选择「采用 1.0」。[比较图](screenshots/stroke-comparison.png)包含相同几何的亮/暗 × 14/16/20px × 1.0/1.25/1.5；[审批回执 ⑩](../brand-mode-icons-plan-approval-2026-10-20.md)覆盖原 1.5 值。五个 rail 符号和 Assistant micro 均显式使用 `stroke-width="1"`，所有坐标与实心细节保留。

原 16 网格 1.5 描边在 20px 导轨中放大为 1.875 CSS px；现 1.0 放大为 1.25 CSS px。14px 和 16px 下分别为 0.875 和 1 CSS px。

描边行为断言直接检查已注册 symbol 的计算样式。临时回退到生产 1.5 时，两轮都为 1 failed，实际 `1.5px`、期望 `1px`；恢复 1.0 后 1 passed (25.4s)。见 [stroke-red.log](command-output/stroke-red.log)、[stroke-red-recheck.log](command-output/stroke-red-recheck.log)、[stroke-green.log](command-output/stroke-green.log)。最终生产状态为 1.0。

## S2 复查结论

- 影响文件：`packages/app/src/components/mode-switcher.tsx`、同目录新增 `mode-switcher.css`、`packages/app/e2e/regression/global-shell.spec.ts`。
- 命中 skills：同 S1。
- 安全门禁：指示条 `aria-hidden="true"`；保留按钮语义、焦点、tooltip、badge；无新状态层。
- 工程门禁：ui/app 类型检查 exit 0；完整 e2e 16 passed；定向最终复验 1 passed。五次模式切换验证路由、`aria-pressed` 与 wrapper 状态一致，单激活互斥，指示条 absolute / 2×20px，按钮 bounding boxes 完全不变。
- RED：完整 15 passed / 1 failed，唯一失败为缺少 `nav[data-component="mode-switcher"]`；临时回退生产组件后的定向复验 1 failed。
- GREEN：完整 16 passed (1.2m)；恢复实现后的最终定向 1 passed (26.4s)。见 [s2-red.log](command-output/s2-red.log)、[s2-red-recheck.log](command-output/s2-red-recheck.log)、[s2-green.log](command-output/s2-green.log)、[s2-final-focused.log](command-output/s2-final-focused.log)。
- 样式：局部 `--v2-*` 变量收纳批准的 2px / 20px / 1px / 150ms；accent token；纯 CSS 显隐与 scaleY 过渡；forced-colors 用 CanvasText；reduced-motion 禁用 transition。
- 剩余风险：无自动视觉回归和真实安装包验证；已登记技术债 §18。本批不改基线按钮尺寸。

### 浏览器实测与视觉证据

| 检查                      | 结果                                         | 证据                                                                                                                                          |
| ------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 默认亮 / 暗外壳           | 导轨可见，单一 accent 指示条                 | [亮色](screenshots/s2-shell-final-light.png) / [暗色](screenshots/s2-shell-final-dark.png)                                                    |
| 实际键盘 Tab 焦点         | 两主题 `focusVisible=true`，2px 可见 outline | [亮色](screenshots/s2-focus-final-light.png) / [暗色](screenshots/s2-focus-final-dark.png)；`command-output/s2-focus-final-{light,dark}.json` |
| 390×844 窄屏中文          | documentWidth=390，railWidth=64，无横向溢出  | [截图](screenshots/s2-narrow-final.png) / [实测](command-output/s2-narrow-final.json)                                                         |
| accent / 背景对比度       | 亮色 4.886；暗色 8.671                       | [亮色](command-output/s2-contrast.json) / [暗色](command-output/s2-contrast-final-dark.json)                                                  |
| forced-colors 浏览器模拟  | 系统前景黑色，active opacity=1、其余=0       | [截图](screenshots/s2-forced-colors.png) / [实测](command-output/s2-forced-colors.json)                                                       |
| reduced-motion 浏览器模拟 | reducedMotion=true，transition=0s            | [实测](command-output/s2-reduced-motion.json)                                                                                                 |
| 浏览器错误                | errors 命令 exit 0，无输出                   | [输出](command-output/browser-errors.log)                                                                                                     |

对比度复用 `packages/ui/src/theme/color.ts:257` 的 `contrastRatio()`；亮色 `#3b5cf6` / `#ffffff`，暗色 `#a2bcff` / `#161616`。这里只证明默认两主题的指示条对比度。

真实按钮为 28×28px（`command-output/s2-style-light.json`）；审批预览的 40×40px 不是生产实测值。尺寸由现有 `packages/ui/src/v2/components/icon-button-v2.css:39` 的 large 选择器决定，本批保留该基线。

人工截图使用中文；自动 shell e2e 的现有 fixture 固定英文和桌面视口。390×844 中文证据来自独立实测，不把 fixture 的默认设置称作窄屏/中文覆盖。浏览器调用复用现有 mock server，因此未验证真实后端或桌面安装包。临时浏览器、mock 桥接与页面已清理，既有 app/server 进程未重启。

### 复用决定与影响边界

| 候选                   | 决定性证据                                                                                                                                            | 决策                                    |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| sprite 注册与回退      | `packages/ui/src/v2/components/icon.tsx:118` 的 `ensureSprite()` 注册；`:148` 的 `Icon()` 在 `:151` 选 micro、`:152` 决定未知键回退                   | 扩展字典，不改旧 `mode-*` 几何          |
| 模式定义与路由         | `packages/app/src/context/mode.tsx:60` 的 `modeDefinition()` 按 id 查找；`mode-switcher.tsx:44` 的 `active()` 同时驱动 `data-state` 与 `aria-pressed` | 只改 icon 字段和 CSS 呈现，不新增状态源 |
| IconButtonV2 属性覆盖  | `packages/ui/src/v2/components/icon-button-v2.tsx:20` 的组件返回 JSX，在 rest spread 后设置 `data-component` / `data-state`                           | data-\* 挂 nav / wrapper，保留按钮组件  |
| shell fixture 与定位器 | `packages/app/e2e/regression/global-shell.spec.ts:105` 的 `installServerMock()`；`:112` 的 `modeButton()`                                             | 复用现有服务器拦截和定位规则            |

采用现有 sprite、模式状态与局部 CSS 即可满足规格。新增状态层会重复既有 `active()` 判定，未采用；后续视觉基线属于明确登记的验证缺口。

## S4 复查结论

- 影响文件：上述 S1/S2 文件、计划与审批回执、本文证据、`docs/technical-debt.md` §18。
- 命中 skills：同 S1。
- 安全门禁：展示层限定范围；S3 资产及内页调用未改。最终 [范围审计](command-output/s4-scope-audit.log) 确认旧字典原样、源码范围限定于六个文件；命令输出如下。
- 工程门禁：以下六项已运行并全部 exit 0；增量 lint、协议引用、格式与 diff 检查结果附后。

| 命令                                                                  | 原始输出 / tally                                   | 日志                                               |
| --------------------------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------- |
| `bun --cwd packages/ui typecheck`                                     | `$ tsgo --noEmit`                                  | [日志](command-output/s4-ui-typecheck.log)         |
| `bun --cwd packages/app typecheck`                                    | `$ tsgo -b && tsgo --noEmit -p e2e/tsconfig.json`  | [日志](command-output/s4-app-typecheck.log)        |
| `bun --cwd packages/desktop typecheck`                                | `$ tsgo -b && tsgo --noEmit -p e2e/tsconfig.json`  | [日志](command-output/s4-desktop-typecheck.log)    |
| `bun --cwd packages/ui test`                                          | 20 pass / 0 fail / 216 expect；4 files，1030.00ms  | [日志](command-output/s4-ui-test.log)              |
| `bun --cwd packages/app test:unit:file src/context/mode.test.ts`      | 5 pass / 0 fail / 53 expect；1 file，2.97s         | [日志](command-output/s4-mode-unit.log)            |
| `bun --cwd packages/app test:e2e e2e/regression/global-shell.spec.ts` | 16 passed (1.3m)                                   | [日志](command-output/s4-e2e.log)                  |
| `LINT_BASE_REF=origin/main bun run script/lint-changed.ts`            | exit 0；真实 tally 见原始输出                      | [日志](command-output/s4-lint.log)                 |
| `bash .aigcfroge/skills/protocols/scripts/check-refs.sh`              | All 32 paths OK，exit 0                            | [日志](command-output/s4-check-refs.log)           |
| `bun run prettier --check <六个受影响源码文件及实施报告/checkpoint>`  | All matched files use Prettier code style!，exit 0 | [日志（含完整命令）](command-output/s4-format.log) |
| `git diff e02392ce1 --check`                                          | 无输出，exit 0                                     | [日志](command-output/s4-diff-check.log)           |

格式检查在首轮和文案更新后各报一次本报告表格未对齐，均 exit 1，见 [首轮](command-output/s4-format-first.log) / [复查](command-output/s4-format-recheck.log)；两次均仅涉及文档，修复后最终重跑通过。

全部命令输出归档在可跟踪的 `command-output/`。仅移除终端 ANSI 控制符及行尾空白，保留实际输出；原 `logs/` 被仓库忽略规则排除，现已迁移。首轮 S1 RED 原始日志缺失已单独声明，未补造。

## 未验证与未交付范围

- 未新增自动截图基线、v2 icon Storybook/a11y 门禁。
- 未审计全部 37 套主题；forced-colors / reduced-motion 是 Chromium 模拟，无真实系统实机证明。
- 未打包或验收 macOS/Windows/Linux 桌面安装包。
- S3（Mark/Splash/favicon/manifest/desktop/social-share）继续冻结，需独立视觉批准。
- 计划 §7 的延后范围与上述验证缺口已登记 [技术债 §18](../../technical-debt.md)，含 owner、来源/触发、解锁条件。
- 本批只做本地提交；未 push、未开 PR，Issue/PR 目标尚未指定。

本批提交清单由 `git log --oneline e02392ce1..HEAD` 机械生成，见 [checkpoint](checkpoint.md)。checkpoint 记载生成时的 HEAD，归档提交自身的哈希由最终汇报的同一命令输出提供。
