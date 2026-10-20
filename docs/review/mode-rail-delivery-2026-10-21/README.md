# 导轨分支交付验证（2026-10-21）

S1/S2 从 `9ae07926f` 分出为 `mode-rail-icons`，接入标题栏 P2 修复 `f174e0300`。基线 `origin/main=43997011e`。S1/S2 已于 2026-10-20 获用户验收；本轮独立验证该分支，不包含 S3 品牌代码。提交清单由 `git log --oneline origin/main..HEAD` 生成，见[命令输出](command-output/commits.txt)；本文提交不在生成时的清单中。

## 修复与复用

`packages/app/src/context/mode.tsx:60` 的 `modeDefinition()` 返回注册表记录，记录的 `icon` 已改为 `rail-*`。标题栏原来读取该字段，因此非导轨的 Session 模式面板按钮也变了。`titlebar.tsx:987` 现显式复用 `mode-${mode.currentMode}`；新增 `global-shell.spec.ts:170` 在 700px Chat Session 中断言标题栏 `mode-chat` 与导轨 `rail-chat`。复用现有 IconV2、模式状态、Session 夹具与定位器，没有新增映射或状态层。

独立评审发现 1 项 P2；修复后的定向复核没有新增 finding。所有其他 S1/S2 几何、1.0 描边、Assistant micro、激活条、ARIA、focus 与 badge 保持已验收状态。

## 当前命令实录

除标记为 RED 的反证命令外，下表命令退出码均为 0。日志只移除 ANSI 控制符与行尾空白。测试使用独立 Vite 端口 3107 与 2 个 workers，未重启已有应用或服务。

| 命令                                                                                                                                                                                                    | 结果                                                     | 原始输出                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------- |
| 临时只回退标题栏修复的一行；`PLAYWRIGHT_PORT=3107 PLAYWRIGHT_WORKERS=2 bun --cwd packages/app test:e2e e2e/regression/global-shell.spec.ts --grep 'preserves the session panel glyph outside the rail'` | RED exit 1；1 failed；预期 `mode-chat`，实际 `rail-chat` | [RED](command-output/red.log)           |
| 立即按原字节还原标题栏；`PLAYWRIGHT_PORT=3107 PLAYWRIGHT_WORKERS=2 bun --cwd packages/app test:e2e e2e/regression/global-shell.spec.ts`                                                                 | GREEN；17 passed (1.7m)                                  | [浏览器](command-output/e2e.log)        |
| `bun --cwd packages/app typecheck`                                                                                                                                                                      | 包类型与 e2e 类型检查通过                                | [App](command-output/app-typecheck.log) |
| `bun --cwd packages/ui test`                                                                                                                                                                            | 20 pass / 0 fail / 216 expects                           | [UI](command-output/ui-test.log)        |
| `bun --cwd packages/app test:unit:file src/context/mode.test.ts`                                                                                                                                        | 5 pass / 0 fail / 53 expects                             | [模式](command-output/mode-unit.log)    |
| `LINT_BASE_REF=origin/main bun run script/lint-changed.ts`                                                                                                                                              | 6 changed files / 4357 added lines                       | [lint](command-output/lint.log)         |
| `env -u AIGCFROGE_SKIP_TYPECHECK bash .husky/pre-push`                                                                                                                                                  | 16 successful / 16 total；13 cached                      | [pre-push](command-output/prepush.log)  |

独立工作树以 frozen lockfile 安装依赖，随后执行 `bun run prepare` 恢复正常 Husky hook，见[输出](command-output/prepare.log)。最终 `git diff --check`、源码 diff 与工作树状态均为空。RED 的截图与视频被下一轮 Playwright 输出覆盖，完整 RED 日志已保留，不以缺失媒体冒充证据。

## 范围与剩余条件

历史[实现证据](../brand-mode-icons-s1-s2-2026-10-20/README.md)仍代表其当时的 HEAD 与状态；当前交付以本报告为准。Issue 为 [#134](https://github.com/keerzzz/AigcForge/issues/134)，PR base 为 `main`。品牌独立 draft PR 的 base 为本分支；S3 视觉与平台验收不能由导轨通过推出。

本轮是 Chromium + mock 后端的行为回归。全主题、真实系统无障碍、安装包及自动截图基线未交付，继续由[技术债 §18](../../technical-debt.md)跟踪。原始 S0 基线与首次 S1 RED 日志缺口仍保留历史声明。本轮不新增实现技术债；提交拆分保留已验证历史。
