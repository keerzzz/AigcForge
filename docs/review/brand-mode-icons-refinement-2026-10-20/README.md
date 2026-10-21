# brand-mode-icons R 与加载汇聚修订（2026-10-20）

本批起点 `f128b7a1b`，分支 `brand-mode-icons`。依据指定实施对话 `01a1572c-f83d-77c3-90ff-a67a357b4def` 的最后一项需求：修复 R，并补齐四周向中心汇聚。用户实施授权见[审批回执 ⑬](../brand-mode-icons-plan-approval-2026-10-20.md)。

## 复查结论

- 影响范围：共享 Logo / Splash、App 连接门禁、Desktop 启动调用、三张社交图、R 页面断言及独立动画夹具。S1/S2 图标和激活状态没有生产代码变更。
- 行为：R 具有连续竖干、镂空上半部及斜腿；Splash 的左右片、上方顶点和下方底座在 1100ms 内汇聚一次，结束时精确归位。减少动态时直接显示完整图标。
- 复用：现有 `Logo`、`Splash`、`BrandShape`、`BrandGeometry`、资产生成器、ThemeProvider 和外壳测试。没有新增运行时加载器、依赖或主题状态。
- 命中技能：protocols、reuse-first-refactor、frontend-theming、quality-to-pr。
- 安全门禁：仅展示、静态资产和测试；没有修改 Session / timeline、权限、IPC、历史数据或后端协议。桌面冒烟使用现有隔离环境。
- 工程门禁：下表通过项均实际执行并 exit 0；失败历史另列。组件录屏与虚拟显示桌面冒烟不等于完整真实系统启动录屏或跨平台发布验收。
- 交付：本地切片提交清单见 [checkpoint](checkpoint.md)；远端交付未执行。

## 根因与决定性代码

| 问题                         | 决定性代码                                                                                                                                  | 修复                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| R 上半部实心且下半部断开     | `packages/ui/src/components/logo.tsx:50` 的 Logo，R 位于 :74–79                                                                             | 原两条 R 路径改为镂空上半部和斜腿；保持 AIGC 缩放与末尾 E                      |
| 新建会话与社交图采用同一字标 | `packages/ui/src/v2/components/wordmark-v2.tsx:4` 的 WordmarkV2；`packages/ui/script/generate-brand-assets.ts:142` 提取共享 Logo 静态组     | 在 Logo 修正一次，重生成三张社交图                                             |
| 加载只做整体脉动             | `packages/ui/src/components/logo.tsx:18` 的 Splash；`logo.css:6` 的四部件规则、:42 的 keyframes                                             | `animate` 控制拼合，App `app.tsx:584` 与 Desktop `renderer/index.tsx:344` 接入 |
| 减少动态                     | `packages/ui/src/components/logo.css:55` 的媒体规则                                                                                         | 四部件停止动画，保持原始完整形状                                               |
| Web 入口没有连接启动动画     | `packages/app/src/entry.tsx:177` 显式传入 disableHealthCheck                                                                                | 独立夹具直接渲染生产 Splash、CSS 和 ThemeProvider，不改变 Web 入口行为         |
| 暗色设置后快捷键偶发丢失     | `packages/ui/src/context/dialog.tsx:58` 延后移除 stack 并归还焦点；`packages/app/src/context/command.tsx:423` 在 dialog.active 时拒绝快捷键 | 外壳测试等待 Settings 恢复焦点，再按关闭草稿快捷键；没有增加固定等待           |

方案对冲：共享 Splash 上的 CSS 拼合足以覆盖当前四个静态部件；独立 JS 动画控制器会增加计时与生命周期状态。采用共享组件的 CSS 动画，不新增运行时技术债。继承技术债：生成器依赖 Logo 静态 JSX 结构、CI 工具版本未固定，继续登记[技术债 §18](../../technical-debt.md)。

## 已运行命令

归档日志仅清理行末空白以满足仓库 diff 门禁，保留命令输出、退出结果和失败内容。

| 命令                                                                                                         | 结果（exit 0）                            | 输出                                                                                           |
| ------------------------------------------------------------------------------------------------------------ | ----------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `bun --cwd packages/ui typecheck`                                                                            | tsgo --noEmit                             | [日志](command-output/ui-typecheck.log)                                                        |
| `bun --cwd packages/app typecheck`                                                                           | tsgo -b + e2e tsgo --noEmit               | [日志](command-output/app-typecheck.log)                                                       |
| `bun --cwd packages/desktop typecheck`                                                                       | tsgo -b + e2e tsgo --noEmit               | [日志](command-output/desktop-typecheck.log)                                                   |
| `bun --cwd packages/ui test`                                                                                 | 20 pass / 0 fail / 216 expect             | [日志](command-output/ui-test.log)                                                             |
| `bun --cwd packages/desktop test`                                                                            | 60 pass / 0 fail / 136 expect             | [日志](command-output/desktop-test.log)                                                        |
| `bun --cwd packages/app test:unit:file src/context/mode.test.ts`                                             | 5 pass / 0 fail / 53 expect               | [日志](command-output/mode-unit.log)                                                           |
| `bun --cwd packages/app test:e2e e2e/regression/global-shell.spec.ts e2e/regression/brand-splash.spec.ts`    | 20 passed (1.1m)                          | [最终日志](command-output/e2e.log)                                                             |
| `bun --cwd packages/desktop build`                                                                           | Sidecar、main、preload、renderer 构建通过 | [日志](command-output/desktop-build.log)                                                       |
| 在 packages/desktop 执行 `xvfb-run -a ../../node_modules/.bin/playwright test --config=playwright.config.ts` | 1 passed (9.4s)，真实隔离桌面栈           | [日志](command-output/desktop-smoke.log)                                                       |
| `bun packages/ui/script/generate-brand-assets.ts`                                                            | 177 个受审文件再次生成后 0 变化           | [日志](command-output/generate.log)、[重现审计](command-output/generator-reproducibility.json) |
| `LINT_BASE_REF=origin/main bun run script/lint-changed.ts`                                                   | 增量检查通过，最终计数见日志              | [日志](command-output/lint.log)                                                                |
| `bash .aigcfroge/skills/protocols/scripts/check-refs.sh`                                                     | 32 paths OK                               | [日志](command-output/check-refs.log)                                                          |
| 变更文件 Prettier 与 `git diff --check`                                                                      | 格式与空白检查通过                        | [格式日志](command-output/format.log)、[diff 日志](command-output/diff-check.log)              |

未运行全仓 typecheck、全 App 套件、远端 CI 或生产 Session/timeline 性能基准；当前切片不改变 Session/timeline 控制路径。

## 视觉证据

- [精修字标](screenshots/wordmark-r-refined.png)与[亮暗矩阵](screenshots/wordmark-splash-matrix.png)：生产 Logo / Splash 实渲，R 局部与 64×80 加载尺寸。
- [汇聚录屏](screenshots/splash-assemble.webm)：2.36s，包含预览中的四个生产 Splash 共 16 个部件动画。不是桌面启动全过程。
- [逐帧数据](command-output/animation-frames.json)：0 / 150 / 550 / 1100ms 的 transform 与 opacity；结束时为单位矩阵。录屏脚本与 0 page errors 见[脚本](command-output/record-preview.cjs) / [输出](command-output/video.log)。
- 自动化夹具：`packages/app/e2e/fixtures/brand-splash.html`；直接 import 生产 Splash、ThemeProvider 与 App CSS。测试覆盖亮暗、390px、减少动态，方向、靠近中心、单次执行、最终归位及静态降级均有行为断言。
- [亮色归位](screenshots/loading-light-settled.png)、[暗色归位](screenshots/loading-dark-settled.png)、[390px](screenshots/loading-narrow-settled.png)、[减少动态](screenshots/loading-reduced-motion-settled.png)。
- [可交互预览](preview.html)由本地 Vite 加载，支持重播与逐帧拖动；色值是固定预览样本。真实 ThemeProvider 验证由自动化夹具完成。

## 失败历史与边界

1. 最初把 Web 连接门禁当作启动测试入口，4 项找不到 Splash。`entry.tsx:177` 显式关闭健康启动检查，页面已进入外壳。改用生产组件夹具后 4 项通过。[首轮日志](command-output/loading-web-entry-failure.log)。不是产品 RED。
2. 两次完整轮次各为 19 passed / 1 failed，失败均发生在切换暗色后按关闭草稿快捷键；R 和动画断言通过。单独重跑该例通过。根因是对话框隐藏与 stack 锁释放不同步，测试改为等待焦点归还，最终完整轮次 20/20。[第一次](command-output/e2e-shortcut-failure.log) / [第二次](command-output/e2e-shortcut-second-failure.log)。
3. 桌面冒烟最初没有 DISPLAY，Electron 在 `Missing X server or $DISPLAY` 后退出。使用 xvfb-run 后真实桌面冒烟 1/1 通过；这是虚拟显示证据。
4. agent-browser 录屏停止未完成，没有可用产物；改用 Playwright 录制生产预览。预览位于 docs/@fs，其 Solid 依赖使用 Vite 的预构建浏览器模块路径；独立 e2e 夹具位于 App 内，使用包导入。两者均复用生产组件。
5. 桌面构建中 models.dev 请求超时后使用已有本地快照，最终成功；此轮不证明远端 models.dev 可用。
6. 完整真实桌面启动到主页的连续录屏、用户最终视觉验收、macOS/Windows 安装包、mobile 资产、37 主题与真实系统减少动态/高对比仍未完成。Owner 与解锁条件继续在[技术债 §18](../../technical-debt.md)跟踪。
