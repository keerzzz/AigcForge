# brand-mode-icons S3 实施证据（2026-10-20）

本批起点 `9ae07926fb1c89e1fd5e186734431487f3cb72cd`，分支 `brand-mode-icons`。用户已验收 S1/S2 并授权 S3；随后批准 Dock 固定入口换成 AIGCFORGE 开发版，并要求 GC 缩小贴在 AI 右下侧、末尾 E 补底横。授权见[审批回执 ⑪/⑫](../brand-mode-icons-plan-approval-2026-10-20.md)。S1/S2 的 1.0 描边、激活状态及内页旧 mode-\* 保持不变。

## 复查结论

- **范围**：共享 Mark/Splash/Logo、新建会话 WordmarkV2、Web favicon 两套（含实际 -v3）、manifest、三张社交图、dev/beta/prod 根目录桌面资产及生成脚本。
- **行为**：方案 04 为统一品牌；GC 高度为 AI 的 60%，紧贴右侧并与底线对齐；E 有底横。新建会话删除旧 OpenCode 的 SVG 字母并复用 Logo。
- **命中 skills**：protocols / reuse-first-refactor / frontend-theming / quality-to-pr / enterprise-code-standard。
- **安全门禁**：仅展示层与本地静态资产；没有改变 Session、timeline、权限或后端协议。Dock 更换已获用户授权，原独立 OpenCode 安装保留。
- **工程门禁**：下表各命令 exit 0。旧失败单独记账；默认亮暗与格式解码通过不代表全主题或跨平台安装验收。
- **交付状态**：本地提交，见 [checkpoint](checkpoint.md)。未 push、未创建 PR；远端目标与 issue 仍需用户提供。

## 复用与根因

| 候选 / 问题               | 决定性代码                                                                                                     | 决定                                                                            |
| ------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Mark 与 Splash 的品牌几何 | `packages/ui/src/components/logo.tsx:33` 的 BrandShape 读取 `BrandGeometry.full`                               | 复用同一几何，保留导出名、slot、Splash ref/class                                |
| 静态小尺寸简化            | `packages/ui/script/generate-brand-assets.ts:44` 的 svg 根据输出尺寸选择形状与细节                             | ≤24 compact；32/48 保留顶点；更大尺寸含 C 底座                                  |
| 真实新建会话旧品牌        | `packages/ui/src/v2/components/wordmark-v2.tsx:4` 的 WordmarkV2 直接渲染 Logo                                  | 删除八个旧字母路径及滤镜/遮罩/渐变，保留 720×129 外画布                         |
| AIGC 紧凑组合与末尾 E     | `packages/ui/src/components/logo.tsx:48` 的 Logo，GC transform 在 :62，E 底横在 :78                            | 在共享字标修一次，新建会话与社交图同步                                          |
| 社交图字标来源            | `packages/ui/script/generate-brand-assets.ts:142` 从 Logo 读取静态 SVG 组                                      | 避免另一份字标路径；JSX 格式依赖登记技术债 §18                                  |
| 主题切换                  | `packages/ui/src/theme/context.tsx:133` 的 applyThemeCss 注入 tokens；:307 的 setColorScheme 改持久配置与 mode | 测试用实际设置菜单切换主题；只改 dataset 不构成有效主题验证                     |
| 桌面运行图标              | `packages/desktop/src/main/windows.ts:65` 的 iconsDir 与 :69 的 iconPath；:115 的 setDockIcon                  | 复用原资源选择，Linux PNG / Windows ICO / macOS Dock PNG                        |
| 桌面生成资源              | `packages/desktop/scripts/copy-icons.ts:5` 选择渠道，:10–11 复制到 resources/icons                             | 同步 dev 资源；生成目录不提交；打包 ICNS 消费见 `electron-builder.config.ts:73` |

方案对冲：手工逐渠道生成会遗漏活体 -v3 和 ICNS。选用小型 Bun 脚本，复用唯一几何、v2 avatar tokens 和 Pillow ICNS 编码器。未新增依赖或运行时主题状态。技术债是工具版本未固定入 CI，以及社交图生成依赖 Logo 的静态 JSX 结构，见[技术债 §18](../../technical-debt.md)。

## 已运行命令

| 命令                                                                  | 结果（均 exit 0）                                                | 原始输出                                                                                           |
| --------------------------------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `bun --cwd packages/ui typecheck`                                     | `$ tsgo --noEmit`                                                | [日志](command-output/ui-typecheck.log)                                                            |
| `bun --cwd packages/app typecheck`                                    | `$ tsgo -b && tsgo --noEmit -p e2e/tsconfig.json`                | [日志](command-output/app-typecheck.log)                                                           |
| `bun --cwd packages/desktop typecheck`                                | `$ tsgo -b && tsgo --noEmit -p e2e/tsconfig.json`                | [日志](command-output/desktop-typecheck.log)                                                       |
| `bun --cwd packages/ui test`                                          | 20 pass / 0 fail / 216 expect；4 files                           | [日志](command-output/ui-test.log)                                                                 |
| `bun --cwd packages/desktop test`                                     | 60 pass / 0 fail / 136 expect；11 files                          | [日志](command-output/desktop-test.log)                                                            |
| `bun --cwd packages/app test:unit:file src/context/mode.test.ts`      | 5 pass / 0 fail / 53 expect                                      | [日志](command-output/mode-unit.log)                                                               |
| `bun --cwd packages/app test:e2e e2e/regression/global-shell.spec.ts` | **16 passed (1.2m)**；包含亮暗新建会话字标与关闭草稿回原 Session | [最终日志](command-output/e2e.log)                                                                 |
| 同一 e2e，`--grep 'the new-session button'`                           | 1 passed (32.6s)                                                 | [定向日志](command-output/e2e-focused.log)                                                         |
| `LINT_BASE_REF=origin/main bun run script/lint-changed.ts`            | 统计见最终命令输出                                               | [日志](command-output/lint.log)                                                                    |
| `bash .aigcfroge/skills/protocols/scripts/check-refs.sh`              | All 32 paths OK                                                  | [日志](command-output/check-refs.log)                                                              |
| 改动源文件 Prettier 检查                                              | All matched files use Prettier code style                        | [日志](command-output/format.log)                                                                  |
| `git diff --check`                                                    | 无输出，exit 0                                                   | [日志](command-output/diff-check.log)                                                              |
| `bun packages/ui/script/generate-brand-assets.ts`                     | 重生成后 177 个受审文件逐字节不变（包括本轮保留的 mobile 文件）  | [生成日志](command-output/generate.log)、[重现审计](command-output/generator-reproducibility.json) |

未跑全仓 typecheck、全 App 套件、生产性能前后 benchmark 或远端 CI。本轮没有改变 Session/timeline 控制代码，不能以页面性能 HUD 数值代替生产基准。

## 视觉与资产证据

- [组件预览](brand-component-preview.html)：需由本地 Vite 服务加载，直接 import 生产 Mark/Splash/WordmarkV2；静态尺寸部分来自统一生成器。两主题颜色在预览页固定，真实主题引擎验证另见新建页 e2e。
- [亮暗 × 16/20/24/32/48/100/160/512px 矩阵](screenshots/component-matrix.png)：512 为实际显示尺寸。Mark 40/56 和 Splash 64×80、48×60 的 DOM 实测见 [JSON](command-output/component-matrix.json)。此图证明组件渲染，不证明启动过程。
- [真实新建会话亮色](screenshots/new-session-brand-light.png) / [暗色](screenshots/new-session-brand-dark.png)：生产页面，英文桌面视口，后端为现有 mock fixture。暗色通过 Settings 选择，关闭对话框后截图。没有发送模型请求或读取用户真实会话。
- [精修字标](screenshots/wordmark-refined.png) 与 [GC/AI 边界](command-output/wordmark-bounds.json)：GC/AI 高比 0.6、底线一致、E 底横存在。
- [静态图标与社交图](screenshots/static-outputs.png)；[资产审计](command-output/asset-audit.json)：54 个桌面 PNG/ICO/ICNS 全部解码，三渠道同名文件 hash 一致；ICNS 256px 条目与 dock.png 像素一致。ICO 包含 16/20/24/32/48/64/128/256px。
- Web 实际请求 11 个路径与源文件字节一致，包含两套 favicon、manifest、apple-touch 与 web-app-manifest，记录在同一资产审计中。
- 静态默认颜色：亮 A `#3250df` / G `#0096b8` / 顶点 `#161616`；暗 A `#263fa9` / G `#005a6e` / 顶点 `#fafafa`。text-contrast 两主题为白色，C 为 cyan 55% + white 45% 的 sRGB 混合。opaque manifest/apple 图含 5% inset。
- 本机工具：Bun 1.3.14、ImageMagick 6.9.12-98 Q16、Python/Pillow 10.2.0。重复生成结果只证明此工具组合；跨版本 CI 重现尚未验证。

## 用户系统 Dock 与快捷方式

[用户 Dock 截图](screenshots/user-system-dock.png)显示方案 04 新图标，源图为用户提供的 73×59px 裁剪。原第 10 个固定入口为独立 OpenCode，已按授权替换为 `aigcfroge-development.desktop`；[之前](command-output/dock-favorites-before.json) / [之后](command-output/dock-favorites-after.json)。

本地实际 launcher：`/home/keer/.local/share/applications/aigcfroge-development.desktop` 与 `/home/keer/Desktop/aigcfroge-development.desktop`。启动当前工作区 `packages/desktop dev`，图标指向 `icons/dev/icon.png`，`StartupWMClass=aigcfroge-desktop` 与开发窗口实测一致。desktop-file-validate 通过，应用数据库已更新；内容归档见 [launcher](command-output/development-launcher.txt)。这些路径属于用户系统配置，仓库只记录证据。

## 失败历史与未验证项

1. 初次暗色断言仅改 `data-color-scheme`，收到 `rgb(22, 22, 22)`，完整轮次为 **15 passed / 1 failed**。见 [失败日志](command-output/e2e-theme-fixture-failure.log)。这是夹具操作错误，不是产品 RED。
2. 改用设置菜单后，初次 `getByRole("option")` 未匹配已显示的 Dark 条目，完整轮次为 **15 passed / 1 failed**，180s 超时。见 [选择器失败日志](command-output/e2e-theme-menu-selector-failure.log)。改为按现有 `select-v2-content` 内可见文本定位后，定向与最终完整轮次均通过。
3. 真实开发配置两条旧 Session 返回 `unsupported-history` 400：`This session's legacy history cannot be adopted. Its source history has been preserved.` 见 [错误截图](screenshots/desktop-legacy-history-error.png)。未修改或删除用户历史；此图不是新建页成功证据。开发桌面随后退出，当前 launcher 可供用户启动验收。
4. 真实启动 Splash 全过程、macOS/Windows 安装包、mobile 目录更新、37 套主题、真实系统高对比与减少动态、自动视觉基线及 CI 漂移门禁均未完成。每项 Owner、来源、解锁条件已登记于[技术债 §18](../../technical-debt.md)。

S1/S2 历史记录保留原义，见[既有证据](../brand-mode-icons-s1-s2-2026-10-20/README.md)。
