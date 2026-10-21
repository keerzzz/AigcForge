# brand-mode-icons 交付前闭环核对（2026-10-20）

核对对象为实施计划 §4 的 S0–S4、后续 GC/E/R 与汇聚修订、§7 延期项以及 §8 PR 要求。代码基线 `origin/main=43997011e`，首次核对代码 HEAD `2f1896398`。2026-10-21 恢复中断任务，提交标题栏 P2 修复 `851db3cf7`；导轨分支包含相同修复 `f174e0300`，通过 merge `d7103f4fc` 成为品牌分支祖先。合并前后 `packages/` diff 为空，当前验证与历史收据分开列出。

**结论：核心实现与本地工程门禁通过，整个计划尚未全部闭环。** S1/S2 已有用户验收；S3 最终视觉、实机发布和远端 PR/CI 仍开放。技术债登记只是跟踪，不能替代交付。

## 计划与证据逐项对应

| 项目                                          | 当前状态                             | 可复核证据 / 剩余条件                                                                                                                                   |
| --------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S0 工作区、分支与计划提交                     | 已交付；历史命令收据不完整           | Git 基线与提交可复核；实现前 ui/app/desktop typecheck、UI/mode 测试原始输出未全归档，登记技术债 §18                                                     |
| S1 五个独立 rail 图标、micro、1.0 描边        | 已实现、已验收                       | [S1/S2 证据](../brand-mode-icons-s1-s2-2026-10-20/README.md)：RED/GREEN、30 格真实图标矩阵、micro href、旧 mode-\* 保留；首次 S1 RED 原日志缺失独立声明 |
| S2 2×20px 单一 accent、ARIA、badge、零位移    | 已实现、已验收                       | 同上：互斥状态与 bounding box e2e，默认亮暗、键盘、390px 中文、forced-colors/reduced-motion 实测；非全主题/真实系统覆盖                                 |
| S3 Mark/Splash、Web/favicon、manifest、社交图 | 已实现、本地验证通过；最终视觉待验收 | [S3 证据](../brand-mode-icons-s3-2026-10-20/README.md)：8 个尺寸亮暗矩阵、11 个 Web 请求与源文件一致、实际新建页；后续字标以精修证据为准                |
| S3 Desktop 根目录 PNG/ICO/ICNS 三渠道         | 已生成与解码；实机发布未完成         | 54 个桌面资产解码、ICO 尺寸、ICNS/Dock 像素审计、Linux Dock 用户截图；macOS/Windows/mobile 在 §18                                                       |
| GC 60%、E 底横、R 镂空与斜腿                  | 已实现、本地验证通过；最终视觉待验收 | [精修证据](../brand-mode-icons-refinement-2026-10-20/README.md)与外壳 e2e；共享 Logo 同步新建页和社交图                                                 |
| 四周向中心汇聚、1100ms、单次、减少动态        | 组件行为通过；完整桌面启动录屏未完成 | 生产 Splash/CSS/ThemeProvider 夹具、逐帧数据、组件录屏；独立真实桌面 xvfb 冒烟 1/1 未断言完整启动视觉流程                                               |
| S4 包级与全仓门禁                             | 本地通过                             | 下表本轮输出与精修包级/desktop build/smoke 日志；远端 CI 另行 readback                                                                                  |
| S3 品牌实际对比度                             | 已补测；可读性待 Design/UI 验收      | 下节记录实际背景和 opacity 后值，不以导轨结果宣称品牌通过                                                                                               |
| §7 所有延期项                                 | 已登记，仍开放                       | [技术债 §18](../../technical-debt.md)逐项含 Owner、来源与解锁条件；未把延期转换为完成                                                                   |
| §8 S3 单独 PR、Issue、push、CI                | PR 已创建；首轮 CI 格式失败，修复中  | S1/S2 #136 `mode-rail-icons` → `main`；S3 #137 `brand-mode-icons` → `mode-rail-icons`，独立 draft；最终视觉与修复后的 CI 仍开放                         |
| 独立 Bugbot                                   | 新实例完成评审；P2 已修复并复核      | 原实例 Azure resource HTTP 400 不计通过；新实例发现标题栏误用 rail glyph，末轮定向复核确认已修复、无新增 finding，见下节                                |

## 本轮最小验证

以下命令退出码均为 0。日志只清理 ANSI 控制符与行尾空白，没有删改失败或统计内容。

| 命令                                                                                                      | 结果                                | 原始输出                                 |
| --------------------------------------------------------------------------------------------------------- | ----------------------------------- | ---------------------------------------- |
| `bun --cwd packages/ui test`                                                                              | 20 pass / 0 fail / 216 expect       | [UI](command-output/ui-test.log)         |
| `bun --cwd packages/app test:unit:file src/context/mode.test.ts`                                          | 5 pass / 0 fail / 53 expect         | [模式](command-output/mode-unit.log)     |
| `bun --cwd packages/app test:e2e e2e/regression/global-shell.spec.ts e2e/regression/brand-splash.spec.ts` | 20 passed (1.6m)                    | [浏览器](command-output/e2e.log)         |
| `bun typecheck`                                                                                           | 16 successful / 16 total；13 cached | [全仓类型](command-output/typecheck.log) |

Desktop 60/60、构建、xvfb 冒烟与 177 文件重生成引用修复前[精修切片](../brand-mode-icons-refinement-2026-10-20/README.md)的历史收据。资产及 Desktop 自身代码未改；当前标题栏修复由下节 App 21/21 和类型检查复核，Desktop 构建/冒烟未重跑。本轮不是全 App 测试、真实系统验收或远端 CI。

## 2026-10-21 标题栏修复与恢复验证

`packages/app/src/context/mode.tsx:60` 的 `modeDefinition()` 返回 `MODE_DEFINITIONS` 对应记录，该记录的 `icon` 已改为 `rail-*`。标题栏原来通过同一字段读取图标，因此也替换了 Session 模式面板按钮，超出计划 D2 的导轨范围。`titlebar.tsx:987` 现直接使用已有 `mode-${mode.currentMode}`；新增 `global-shell.spec.ts:170` 在 700px Chat Session 中分别验证标题栏 `mode-chat` 与导轨 `rail-chat`。复用现有 IconV2、mode 状态和 Session 测试夹具，无新图标映射或状态层。

独立评审实例 `01a159ef-b271-7082-ba17-30ce893ee294` 已完成：发现上述 1 项 P2；修复后的最后一轮定向复核没有新增 finding。恢复时读取其最终结果，没有再次调用失败实例。旧 `/tmp` 红绿日志未保留，不能补造；以下为本次实际运行并归档的结果，旧 20/20 收据仍只代表修复前的代码。

| 命令                                                                                                      | 结果                                        | 当前原始输出                                         |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ---------------------------------------------------- |
| `bun --cwd packages/app test:e2e e2e/regression/global-shell.spec.ts e2e/regression/brand-splash.spec.ts` | exit 0；21 passed (1.4m)                    | [浏览器](command-output/e2e-current.log)             |
| `bun --cwd packages/app typecheck`                                                                        | exit 0                                      | [App 类型](command-output/app-typecheck-current.log) |
| `LINT_BASE_REF=origin/main bun run script/lint-changed.ts`                                                | exit 0；14 changed files / 9499 added lines | [增量 lint](command-output/lint-current.log)         |
| `bash .husky/pre-push`                                                                                    | exit 0；16 successful / 16 total，15 cached | [完整 pre-push](command-output/prepush-current.log)  |

协议引用 32/32、两个源码文件的 Prettier 检查与 `git diff --check` 通过。新增 e2e 初次格式检查失败，按 Prettier 修正后通过；修正仅折叠断言换行。当前回归为 Chromium + mock 后端与生产 Splash 夹具，不代表全 App 套件、最终视觉或目标系统验收。

导轨分支已单独取得标题栏反证 RED（1 failed，实际 `rail-chat`、预期 `mode-chat`），恢复后完整 shell GREEN 17/17、UI 20/20、模式 5/5、App typecheck、增量 lint 与完整 pre-push 16/16 通过。日志与边界见[独立导轨交付](../mode-rail-delivery-2026-10-21/README.md)。导轨文档 HEAD `cdffd5f06` 已合入品牌分支，包源码仍与 `851db3cf7` 完全一致。

## 品牌对比度补证

实际浏览器夹具 `/e2e/fixtures/brand-splash.html` 直接 import 生产 Splash、ThemeProvider 与 App CSS。通过持久设置并刷新得到默认亮暗；复用 `packages/ui/src/theme/color.ts:257` 的 `contrastRatio()` 和 `:271` 的 `blend()`。用 Canvas sRGB 像素转换 CSS `color(srgb ...)`，再计入父级 50% opacity。

| 模式 / 实际背景 | A 固有 / 合成后 | G 固有 / 合成后 | 顶点固有 / 合成后 | C 固有 / 合成后 |
| --------------- | --------------- | --------------- | ----------------- | --------------- |
| 亮 `#f8f8f8`    | 5.53 / 2.21     | 3.29 / 1.82     | 15.24 / 3.32      | 1.87 / 1.35     |
| 暗 `#121212`    | 2.03 / 1.33     | 2.19 / 1.37     | 15.98 / 4.66      | 6.07 / 2.39     |

[亮色数据](command-output/splash-contrast-light.json)与[暗色数据](command-output/splash-contrast-dark.json)包含解析后的颜色与未取整比值。这是默认主题的品牌可读性数据，不作 WCAG 合规判定，也不能推出 37 套主题通过。计划 R3 的“真实对比度实测”现已补证；实测偏低部分保留已批准 token/混色，交由 Design/UI 在 S3 最终视觉验收中裁决，已登记 §18。

## 远端交付

目标仓库 `keerzzz/AigcForge`。两个 PR 已创建并 readback：导轨 [#136](https://github.com/keerzzz/AigcForge/pull/136) 为 `mode-rail-icons` → `main`、非 draft，正文 `Closes #134`；品牌 [#137](https://github.com/keerzzz/AigcForge/pull/137) 为 `brand-mode-icons` → `mode-rail-icons`、draft，正文 `Closes #135`。最初远端 HEAD 分别为 `cdffd5f06` / `19ecc9ffd`，与 `git ls-remote` 一致，见[导轨 readback](command-output/rail-pr-initial-readback.json)与[品牌 readback](command-output/brand-pr-initial-readback.json)。远端品牌 PR 文件清单没有 titlebar 或 mode-switcher 差异；完整范围按 Git diff 核对，GitHub 文件响应有分页限制，不以响应数量作总文件数。

首轮规范、合规和贡献者标签检查通过；CI `Lint, Test, and Typecheck` 在全仓 Prettier 门禁失败，后续类型、OpenAPI 与 Test 步骤没有执行。导轨 7 个文档/证据文件未格式化，品牌另有两个 S3 文件；局部格式检查未覆盖这些文件。原始[导轨失败日志](command-output/rail-ci-format-failure.log)与[品牌失败日志](command-output/brand-ci-format-failure.log)保留。

导轨格式修复 `54500300f` 只改上述 7 文件，两个 JSON 解析结果相同，[全仓格式门禁](command-output/rail-format-fixed.log) exit 0。品牌 merge `682b12a9e` 保留当前 S3 计划内容并接入共同格式修复；S3 的 HTML 和 asset-audit JSON 同步格式化，JSON 解析结果相同。所有包源码与已验证的 `851db3cf7` 一致。CI 修复是证据格式化，没有新增实现技术债；新一轮远端门禁完成前不宣称 CI 通过。

修复后本地 `LINT_BASE_REF=mode-rail-icons bun run lint` 整条链路 exit 0：全仓 oxlint 231 warnings / 0 errors、全仓格式通过、增量 lint 9 changed files / 5283 added lines、918 个测试文件中的 129 条异步断言检查通过。见[完整输出](command-output/full-lint-fixed.log)。没有通过忽略文件或绕过门禁隐藏格式失败。

S3 最终视觉与发布未闭环，品牌 PR 保持 draft；导轨合并后再将品牌 base 改为 `main`。本轮没有合并 PR 或发布。
