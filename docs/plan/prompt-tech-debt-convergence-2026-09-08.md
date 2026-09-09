# 技术债收敛连续实施提示词（2026-09-08 终审版）

> 对应计划：[tech-debt-convergence-2026-09-07.md](tech-debt-convergence-2026-09-07.md)
> 用途：复制 `PROMPT START` 与 `PROMPT END` 之间的正文到新的执行对话。
> 节奏：六阶段连续执行；每阶段做 CLAUDE.md 差量复审和最小有效验证，通过即继续；全部完成后统一审批。

<!-- PROMPT START -->

你是 AigcForge 仓库（`/media/win_data/aigcfroge`）的高级全栈工程师。请完整实施
`docs/plan/tech-debt-convergence-2026-09-07.md` 的六个阶段。不要只完成一节就停下来等待批准：
每阶段结束后按 CLAUDE.md 做“改完即审”和最小有效验证，验证通过便立即进入下一阶段；只有命中本文的
真实停止条件才中止。六阶段全部完成后，输出统一终审报告并等待用户一次性审批。

实现阶段不得 commit、push 或创建 PR；最终审批前只保留工作区改动。

## 0. 强制认知加载

写代码前依次精读：

```text
CLAUDE.md
AGENTS.md
ARCHITECTURE.md                              （重点 §4.1/§4.3/§6）
CONTEXT.md
DESIGN.md                                    （阶段 2/3 涉及 UI/XSS）
docs/technical-debt.md
docs/testing.md
packages/aigcfroge/AGENTS.md
packages/aigcfroge/test/AGENTS.md
packages/aigcfroge/test/server/AGENTS.md
packages/app/AGENTS.md
.aigcfroge/skills/protocols/SKILL.md
.aigcfroge/skills/enterprise-code-standard/SKILL.md
.aigcfroge/skills/reuse-first-refactor/SKILL.md
.aigcfroge/skills/quality-to-pr/SKILL.md
.aigcfroge/skills/effect/SKILL.md
.aigcfroge/skills/database/SKILL.md
.aigcfroge/skills/frontend-theming/SKILL.md
docs/plan/tech-debt-convergence-2026-09-07.md   （唯一实施真源，全文）
```

检索必须遵守协议：符号/调用链/影响面优先 codegraph；字符串、错误消息、路径模式用 rg；不得猜接口。

## 1. 开工 Gate

先执行并记录：

```bash
pwd
git branch --show-current
git status --short --branch
git log -1 --format='%H %ad %s' --date=iso main
git log -1 --format='%H %ad %s' --date=iso origin/main
git remote -v
```

要求：

1. 保留所有用户已有改动；已知 `.zed/settings.json` 删除状态属于用户工作，绝不恢复、覆盖或纳入本任务。
2. 计划文件和本提示词属于授权文档；生产实现 diff 必须与其他用户改动隔离。
3. 若当前仍在 `main`，创建/切换短分支 `tech-debt-convergence`；不得使用 slash。
4. 不执行 `git reset --hard`、`git checkout --`、`git clean`、`--no-verify` 或强推。
5. 建立阶段工作记录，保存每阶段影响文件、命令、结果和判别式证据；不要为阶段创建 commit。

## 2. 总体执行纪律

严格连续执行阶段 1 → 2 → 3 → 4 → 5 → 6：

- 阶段失败先按 CLAUDE.md 根因三步法“归类 → 找交集 → 一击必杀”在本阶段修复，不因普通测试失败向用户索要审批。
- 每阶段只改计划明确的 owner/boundary，不顺手清债。
- 新增 helper 前先做 reuse table；优先复用、删除、归并，最后才新增。
- 不用 `as any`、`@ts-ignore`、假测试、源码字符串断言、任意 sleep、catch-all 吞错或扩大 timeout 伪绿。
- Effect 测试复用 `testEffect`/既有 fixture；并发等待用 Deferred/Latch/readiness signal。
- 测试必须从所属 package 运行。禁止仓库根 `bun test`。
- “最小验证”必须覆盖真实影响边界，不能用未执行目标代码的空绿命令代替。
- 每阶段完成后按 §9 模板复审，通过即继续，不等待用户回复。

## 3. 阶段 1：EventV2 commit 同事务收口

目标：durable event 与 workflow/context epoch/composition projection 共用 EventV2 `tx`。

必须执行：

1. `workflow/event.ts` commit 参数对齐 grant/binding 的 tx 形状。
2. 删除 `workflow-run.ts` 重复 publisher，四个调用点复用 `WorkflowEvent.publish`，事务内查询/写入全走 `tx`。
3. context epoch `advance` 接受公共查询句柄并从 commit 传 `tx`。
4. composition 抽出唯一 snapshot insert 主体；服务 attach 与 createCustom commit 复用。
5. 不改 publishBatch、outer tx、replay owner 或 Session execution ownership。
6. 新建双独立 Layer 构建域回归，busy timeout 500ms，覆盖 WorkflowRun、context epoch、createCustom。

最小验证：

```bash
bun --cwd packages/core test test/s2-event-projection-transaction.test.ts test/workflow-run.test.ts test/workflow-runner.test.ts --timeout 30000
bun --cwd packages/core typecheck
bun --cwd packages/aigcfroge test test/server/httpapi-custom-workflow.test.ts --timeout 30000
```

判别式：临时把一个 commit 写回闭包 db，目标回归转红；恢复 tx 后转绿。只有完整
`bun --cwd packages/aigcfroge script/httpapi-exercise.ts --mode effect` 全绿才可移除 CI advisory；否则保留并记录真实失败分类。

## 4. 阶段 2：E2E presentation matrix

目标：让 dark、zh、zht、390×844 与 keyboard focus 成为真实门禁。

必须执行：

1. Playwright 加 `chromium`、`chromium-dark`、`chromium-zh`、`chromium-zht`、`chromium-narrow`。
2. storage origin 从 baseURL 计算；颜色写原始 `dark`，语言写 JSON locale；只安装 Chromium。
3. CI Linux 跑全部非性能 spec × 五 project，Windows 只跑 chromium；不用 continue-on-error。
4. 增加 `presentation-matrix.spec.ts` 断言真实 theme/locale/viewport；keyboard 用断言级交互，不新建 project。
5. 只修矩阵直接照亮的问题，主题走 DESIGN/frontend-theming；更新 docs/testing.md 真实标准。

最小本地验证：

```bash
bun --cwd packages/app test:e2e:local e2e/regression/presentation-matrix.spec.ts --project=chromium --project=chromium-dark --project=chromium-zh --project=chromium-zht --project=chromium-narrow
bun --cwd packages/app test:e2e:local e2e/regression/mode-slot-fallback-a11y.spec.ts --project=chromium
bun --cwd packages/app typecheck
```

本地不乘跑 36×5 全量；CI 配置承担完整矩阵。逐项做 dark/locale/narrow/focus 反向红证。

## 5. 阶段 3：sanitizer 浏览器行为证据

目标：把受 happy-dom NodeIterator 缺陷污染的行为断言迁到真实 Chromium。

必须执行：

1. markdown sanitizer E2E 的恶意 payload 前放无关元素。
2. 覆盖 script、handler、javascript URL、危险 style、form/input、img、KaTeX 必需样式。
3. session-ui 单测只留 config 形状/纯函数契约；行为证据链接到 E2E。
4. 不改 CSP、DOMPurify 版本、MathML/SVG hook 或 KB 外链策略。

最小验证：

```bash
(cd packages/session-ui && bun test src/components/sanitize-regression.test.tsx --timeout 30000)
bun --cwd packages/session-ui typecheck
bun --cwd packages/app test:e2e:local e2e/regression/markdown-sanitize.spec.ts --project=chromium
bun --cwd packages/app typecheck
```

阶段 3 不以阶段 2 为架构依赖；顺序执行而已。做 hook/profile 反向红证后恢复。

## 6. 阶段 4：OpenAPI 单一生成/漂移入口

目标：复用 `@aigcfroge/script` owner，建立无副作用 drift gate。

必须执行：

1. 新增 `packages/script/src/openapi.ts` 并导出 `./openapi` subpath。
2. SDK build 通过 workspace devDependency 复用 helper；不要复制生成逻辑。
3. script/generate.ts 复用 helper刷新 committed snapshot。
4. 新增 root adapter `script/check-openapi-drift.ts`，temp + unified diff + finally cleanup。
5. CI 加硬 gate；drift gate 不运行完整 generate，也不重生成 SDK。
6. 子进程/文件边界完整传播失败，不泄露环境或用户数据。

最小验证：

```bash
bun run script/check-openapi-drift.ts
bun --cwd packages/sdk/js typecheck
```

临时删一个 snapshot path，gate 必须红且 diff 精确；恢复后绿。

## 7. 阶段 5：文档命令增量 lint

目标：只拦新增的错误 `bun --cwd <pkg> run <script>`，不清扫历史。

必须执行：

1. 将纯 changed-lines/diff parsing owner 放到 `packages/script/src/changed-lines.ts`，导出 subpath。
2. `packages/script` 增加 test script；测试在该 package 内运行。
3. root lint adapter 复用 helper，基线顺序为显式 ref → GitHub base → origin/main → main → HEAD。
4. 只检查 Markdown 新增行；接受两种合法命令顺序。
5. 覆盖历史违规、新增/删除、空格、`--cwd=`、Windows 路径。

最小验证：

```bash
bun --cwd packages/script test src/changed-lines.test.ts --timeout 30000
LINT_BASE_REF=origin/main bun run script/lint-changed.ts
```

禁止在根运行 bun test。临时 Markdown 做违规红证和合法绿证。

## 8. 阶段 6：Solid TSX render harness

目标：建立可复现的 Bun + Solid JSX 测试入口，并把 TextDiffView 样板改成 DOM 行为测试。

依赖必须精确且直接声明：

```text
@babel/core 7.28.4
@babel/preset-typescript 7.27.1
babel-preset-solid 1.9.10
```

`babel-preset-solid` 必须与现有 `solid-js 1.9.10` 对齐；不得用 1.9.12，不得隐式升级 Solid。

必须执行：

1. manifest 前后 bun install，并检查 node_modules/.bun 零悬空链接。
2. 新增 solid-jsx-plugin.ts；只转换 app test 的 TSX，不碰 node_modules，不复制 Vite 配置。
3. test:unit/watch 加 browser condition + preload；保留 happy-dom。
4. 增加不含 `./src` 的 `test:unit:file`，追加文件参数必须真收窄。
5. 只转换 text-diff-view.test.tsx 样板；其他源码字符串断言不批量 churn。
6. 空载环境修改前后各做 warm-up + 三次 test:unit 计时，比较中位数，后值不得超过前值 2×。

最小验证：

```bash
bun --cwd packages/app test:unit:file src/pages/session/text-diff-view.test.tsx
bun --cwd packages/app test:unit
bun --cwd packages/app typecheck
```

focused 命令必须只报告目标文件。做可见行为反向红证后恢复。

## 9. 每阶段改完即审（通过后自动继续）

每阶段完成后重新阅读 CLAUDE.md“改完即审流程”，记录：

```text
阶段复查结论:
- 阶段 / 影响文件:
- 命中 skills:
- 根因是否收敛:
- 安全门禁: Catch Everything / No Null Pointer / Security First
- 工程门禁: No Cheating / Reusability / Clean Logs
- 数据流、owner、Layer 与调用链:
- 最小有效验证命令与原始结果:
- 判别式 RED/GREEN:
- 剩余风险:
- 结论: 通过并继续 / 命中停止条件
```

不要在“通过并继续”后停下来等待用户回复；同一轮继续调用工具和实施下一阶段。

## 10. 真实停止条件

仅遇到以下情况才停止整个任务并请求决策：

- Accepted ADR/AGENTS/架构不变量与计划冲突。
- 必须改变排除的产品、权限、凭据、CSP 或迁移语义。
- RED 不能仅靠生产代码变绿或判别式无效。
- 同一根因连续三轮仍不过最小有效验证。
- 关键外部状态无法取得且无本地等价验证。
- 继续会覆盖无关用户改动、丢数据或需要破坏性 Git。

普通测试失败先修，不是逐阶段审批理由。报告阻塞时必须给出证据、失败命令、三轮尝试和需要的 owner 决策。

## 11. 最终统一终审

六阶段全部完成后，更新 docs/technical-debt.md 核账，再运行最小组合：

```bash
LINT_BASE_REF=origin/main bun run script/lint-changed.ts
bun --cwd packages/core typecheck
bun --cwd packages/app typecheck
bun --cwd packages/session-ui typecheck
bun --cwd packages/sdk/js typecheck
bun --cwd packages/script test src/changed-lines.test.ts --timeout 30000
bun run script/check-openapi-drift.ts
git diff --check
bash .aigcfroge/skills/protocols/scripts/check-refs.sh
```

同时复跑六阶段 targeted tests。app unit 全量只因全局 preload 运行一次最终确认；E2E 只跑 matrix contract、a11y Chromium、sanitize Chromium。不要在本地运行 36×5 全矩阵，不要从根运行 bun test，不默认跑全仓 typecheck/test。

最终检查：

- git diff/status 只含任务文件和原有用户改动；`.zed/settings.json` 未被触碰。
- 无生成噪声、悬空链接、秘密、完整 prompt/用户文件日志。
- docs plan/prompt 若进入 Git 索引必须是 100644，不是 NTFS 显示的 100755。
- 不 commit、不 push、不建 PR。

最终报告：

```text
统一终审报告:
- 基线 / 分支 / 当前 HEAD:
- 六阶段状态:
- 每阶段影响文件与 reuse/delete/merge:
- 安全门禁与工程门禁:
- targeted tests/typechecks/lint/e2e 原始结果:
- RED/GREEN 判别式证据:
- OpenAPI drift 与生成物:
- app unit 前后中位数:
- 债表核账:
- 剩余风险与排除项:
- 建议: 批准提交 / 仍需修复
```

输出统一终审报告后停止，等待用户一次性审批。只有用户之后明确批准，才进入 commit、issue、push、PR 流程。

<!-- PROMPT END -->

## 使用说明

| 项       | 值                                                     |
| -------- | ------------------------------------------------------ |
| 复制范围 | `PROMPT START` 到 `PROMPT END`                         |
| 计划真源 | `docs/plan/tech-debt-convergence-2026-09-07.md`        |
| 执行节奏 | 六阶段连续，不逐阶段等待审批；最终统一审批             |
| 测试策略 | 所属最小 package + 最小有效行为范围；全局 preload 除外 |
| Git      | 实现期不 commit/push/PR；保留用户已有改动              |
