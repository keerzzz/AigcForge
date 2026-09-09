# 技术债收敛修复方案（Tech-Debt Convergence Remediation）

> 状态：**终审通过，批准连续实施（2026-09-08）**
> 原始日期：2026-09-07；终审修订：2026-09-08
> 依据：[CLAUDE.md](../../CLAUDE.md)（根因收敛 / 极致减法 / 方案对冲 / 改完即审）· [AGENTS.md](../../AGENTS.md) · [ARCHITECTURE.md](../../ARCHITECTURE.md) §4.1/§4.3/§6 · [CONTEXT.md](../../CONTEXT.md) · [docs/technical-debt.md](../technical-debt.md) · [docs/testing.md](../testing.md) · skills：`protocols` / `enterprise-code-standard` / `reuse-first-refactor` / `quality-to-pr` / `effect` / `database` / `frontend-theming`
> 人类裁决：一次连续执行完整计划；阶段完成后按 CLAUDE.md 做差量复审和最小有效验证，验证通过即继续，不逐阶段等待审批；全部阶段完成后统一终审。sanitize 只迁行为证据，不顺带改 CSP/DOMPurify。
> 交付边界：实现阶段不 commit、不 push、不创建 PR。最终终审通过后，再由用户决定提交、拆 PR、issue 关联与远程交付。

---

## 0. 终审结论、基线与总节奏

### 0.1 根因收敛

开放债按共同根因收敛为六个阶段：

1. EventV2 durable projection 丢失事务句柄。
2. Playwright presentation matrix 只有纸面目标，没有真实 CI 入口。
3. sanitizer 行为证据受 happy-dom NodeIterator 缺陷污染。
4. OpenAPI 快照没有单一、无副作用的生成/比较入口。
5. 文档命令规范没有增量门禁。
6. app `.tsx` 测试缺少可复现的 Solid JSX 转换入口。

原计划中的 lint warn 晋级没有统一行为结果，移出本计划；spawn 敏感测试已有 60s/120s 用例级 timeout，不重复加宽，只更正债表。

### 0.2 已复核事实

| 编号 | 事实                                                                                   | 结论                                            |
| ---- | -------------------------------------------------------------------------------------- | ----------------------------------------------- |
| V1   | `workflow-run.test.ts` 当前 16 pass；单 MemoMap 图不复现                               | 不能证明跨连接安全                              |
| V2   | `s2-atomic-batch-deadlock-probe.test.ts` 的 P2/P3 可出现 `LockTimeoutError`            | 跨连接写锁形状成立                              |
| V3   | workflow/context epoch/composition commit 仍经闭包 db；grant/binding 已吃 EventV2 `tx` | 阶段 1 是根因修复                               |
| V4   | workflow mutation exerciser 场景由 `397635241` 落地                                    | 只补债表记账                                    |
| V5   | app typecheck 已覆盖 e2e tsconfig                                                      | 只补债表记账                                    |
| V6   | app 当前 36 份非性能 E2E spec，Playwright 只有 Chromium 基线 project                   | CI 矩阵需显式按 OS 分流                         |
| V7   | 先前 app unit 29.25s 仅作参考；并发负载下曾测得 69.20s                                 | 阶段 6 必须在空载同机重采基线，不能沿用单次旧值 |
| V8   | `babel-preset-solid@1.9.12` 要求 `solid-js ^1.9.12`，仓库固定 `solid-js 1.9.10`        | 必须改用 `babel-preset-solid@1.9.10`            |
| V9   | `packages/core/test/delegation-task.test.ts` 不存在                                    | 回归网改用真实的 `workflow-runner.test.ts`      |
| V10  | 根目录 `bun test` 被协议禁止；`packages/script` 是现有 package owner                   | changed-lines helper/test 归 `packages/script`  |

### 0.3 连续执行规则

- 开工前在当前基线创建或切到短分支 `tech-debt-convergence`；保留所有用户已有改动，尤其不得恢复或覆盖 `.zed/settings.json`。
- 阶段顺序固定为 1 → 2 → 3 → 4 → 5 → 6。阶段 3 技术上不依赖阶段 2，但顺序执行便于最终 E2E 汇总；不得把它描述成架构依赖。
- 每阶段完成后执行 CLAUDE.md“改完即审”：锁定 diff、匹配 skills、安全门禁、工程门禁、数据流、最小有效测试。通过后直接进入下一阶段，不向用户索要常规批准。
- 阶段失败先在本阶段内按根因归类并修复；只有命中 §8 的真实停止条件才中止整个流程。
- 不为阶段创建 commit/PR。最终统一终审通过后，用户再决定是否按阶段拆提交或 PR。

### 0.4 “最小有效验证”定义

最小不是少跑，而是覆盖本阶段真实影响边界的最小集合：

- 改一个 core owner：新回归 + 直接 owner 回归 + core 单包 typecheck。
- 改 Playwright config：一个专用 matrix contract spec 跑全部 project；不本地乘跑全部 36 spec。
- 改 sanitizer：只跑 sanitizer 单测与 Chromium spec。
- 改生成入口：只跑 drift gate 与 SDK 单包 typecheck。
- 改共享 lint helper：只跑 `packages/script` 对应 test 与增量 lint。
- 改全局 app test preload：先跑单文件，再跑一次 app unit 全量；全量是该 preload 的最小真实影响面。

---

## 1. 阶段 1 — EventV2 commit 同事务收口（P0）

### 1.1 根因与边界

`EventV2.publish` 在 `BEGIN IMMEDIATE` 事务内调用 `commit(seq, tx)`。workflow、context epoch 和 custom session composition 丢弃 `tx`，再经闭包 Database 写库；当 AppLayer 与 Location layer 来自独立 MemoMap 时，连接 c1 等 c2 写锁，c2 又等待 commit 回调，最终 `SQLITE_BUSY`。正确边界是 durable event 与本地 projection 共用 EventV2 提供的事务句柄。

### 1.2 改动

1. `packages/core/src/workflow/event.ts`：wrapper 改为 `commit: (tx: EventV2.Transaction) => Effect.Effect<boolean>`；revision/accepted 校验仍由 wrapper 所有。
2. `packages/core/src/workflow/workflow-run.ts`：删除重复 `publishWorkflowEvent`；四个调用点复用 `WorkflowEvent.publish`；事务内 re-check/insert/update 全走 `tx`，事务外预读保留 `db`。
3. `packages/core/src/session/context-epoch.ts`：commit 改为 `(seq, tx) => advance(tx, ...)`；`advance` 参数收窄成 tx 与 db 共有的查询句柄。
4. `packages/core/src/session/composition.ts`：抽出接受查询句柄的 snapshot insert 主体；服务 `attach` 与 `session.ts` createCustom commit 复用该主体。
5. 不改 `publishBatch`、outer transaction、EventV2 replay ownership 或 V2 Session execution ownership。

### 1.3 RED/GREEN 与最小验证

新增 `packages/core/test/s2-event-projection-transaction.test.ts`：同一 DB 文件、两个独立 Layer 构建域；busy timeout 500ms；覆盖 `WorkflowRun.getOrCreate(requestID)`、context epoch `advance`、custom `createCustom` composition attach。先证旧路径可得到 LockTimeout；若无法稳定复现，不硬造 RED，保留结构回归并如实记录。

```bash
bun --cwd packages/core test test/s2-event-projection-transaction.test.ts test/workflow-run.test.ts test/workflow-runner.test.ts --timeout 30000
bun --cwd packages/core typecheck
```

判别式：GREEN 后临时把一个 commit 写回闭包 `db`，目标测试必须转红；恢复后转绿。HTTP 边界只跑直接相关测试：

```bash
bun --cwd packages/aigcfroge test test/server/httpapi-custom-workflow.test.ts --timeout 30000
```

若计划删除 effect advisory 的 `continue-on-error`，完整 effect exerciser 是该 gate 的最小语义范围，必须完成；未完成或存在非本根因失败就保留 advisory：

```bash
bun --cwd packages/aigcfroge script/httpapi-exercise.ts --mode effect
```

---

## 2. 阶段 2 — E2E presentation matrix 真实化（P1）

### 2.1 project 与 CI

`packages/app/playwright.config.ts` 增加：

- `chromium`：Desktop Chrome、light、en。
- `chromium-dark`：localStorage `aigcfroge-color-scheme` 写原始字符串 `dark`。
- `chromium-zh`：`aigcfroge.global.dat:language` 写 `{"locale":"zh"}`。
- `chromium-zht`：写 `{"locale":"zht"}`。
- `chromium-narrow`：390×844、light、en。

storage state origin 从 `baseURL` 解析，不硬编码端口。全部 project 使用 Chromium，Playwright cache/install 仍只含 Chromium。

`.github/workflows/test.yml` 显式分流：

```bash
# Linux：全部非性能 spec × 五 project
bun --cwd packages/app test:e2e:local --project=chromium --project=chromium-dark --project=chromium-zh --project=chromium-zht --project=chromium-narrow

# Windows：全部非性能 spec × 基线 project
bun --cwd packages/app test:e2e:local --project=chromium
```

不得用 `continue-on-error`，不得删 spec 控成本。CI 超 30min 时先依据实际 worker/重试/冷启动数据调 workers，再调整 job timeout。

### 2.2 专用 contract spec 与最小验证

新增或扩展一个 `presentation-matrix.spec.ts`，按 project 名断言真实主题、locale 和 viewport；keyboard 作为断言级路径，不新建 project。新增矩阵后先归类新红，只修矩阵直接照亮的 token/i18n/窄屏/测试契约问题。

```bash
bun --cwd packages/app test:e2e:local e2e/regression/presentation-matrix.spec.ts --project=chromium --project=chromium-dark --project=chromium-zh --project=chromium-zht --project=chromium-narrow
bun --cwd packages/app test:e2e:local e2e/regression/mode-slot-fallback-a11y.spec.ts --project=chromium
bun --cwd packages/app typecheck
```

判别式：分别临时去掉 dark/locale/narrow/focus 接线，对应断言转红，恢复后转绿。落地后更新 `docs/testing.md` §4 的真实标准。

---

## 3. 阶段 3 — sanitizer 行为证据迁真实浏览器（P1）

### 3.1 边界

happy-dom NodeIterator 在当前节点移除后可能跳过后续节点。本阶段只迁行为证据，不修改 CSP `img-src`、DOMPurify 版本、MathML/SVG hook 或 KB 外链策略。阶段 3 不依赖阶段 2 的五 project；只复用现有 Chromium 基线。

### 3.2 改动与最小验证

1. 扩展 `packages/app/e2e/regression/markdown-sanitize.spec.ts`；恶意 payload 前放无关元素，覆盖盲区位置。
2. 覆盖 script、event handler、`javascript:`、危险 style、form/action/input、img 与 KaTeX 必需样式；只断言最终 DOM/几何/行为。
3. `packages/session-ui/src/components/sanitize-regression.test.tsx` 只保留 config 形状与纯函数契约，移除受 happy-dom 缺陷影响的行为断言，并链接浏览器证据。

```bash
(cd packages/session-ui && bun test src/components/sanitize-regression.test.tsx --timeout 30000)
bun --cwd packages/session-ui typecheck
bun --cwd packages/app test:e2e:local e2e/regression/markdown-sanitize.spec.ts --project=chromium
bun --cwd packages/app typecheck
```

判别式：临时移除对应 hook/profile，使每组危险输入至少一条断言转红；恢复后转绿。

---

## 4. 阶段 4 — OpenAPI 快照单一生成入口（P1）

### 4.1 方案对冲与 owner

禁止直接把 `packages/sdk/js/script/build.ts` 当 drift gate：它会重生成 SDK、执行编译并删除临时规范。共享脚本逻辑归现有 `@aigcfroge/script` package，而不是在根 `script/` 新造第二个 helper owner。

### 4.2 改动

1. `packages/script/src/openapi.ts` 提供无副作用的 OpenAPI 文本生成边界；外部子进程失败完整传播 stderr/exit code。
2. `packages/script/package.json` 暴露 `./openapi` subpath。
3. `packages/sdk/js` 以 workspace devDependency 声明 `@aigcfroge/script`，`build.ts` 复用 helper 写自己的临时 spec，再继续既有 codegen。
4. `script/generate.ts` 复用 helper 刷新 `packages/sdk/openapi.json`，保留完整生成职责。
5. 新增 `script/check-openapi-drift.ts`：在 OS temp 写生成结果，与 committed snapshot 比较；不一致输出 unified diff 并 exit 1；finally 清理。
6. `.github/workflows/ci.yml` 加硬 gate，不使用 `continue-on-error`。

快照刷新与 gate 逻辑保持可拆分 diff，但实现期间不 commit。

### 4.3 最小验证

```bash
bun run script/check-openapi-drift.ts
bun --cwd packages/sdk/js typecheck
```

判别式：临时删除 snapshot 一个 path，gate 必须失败且 diff 指向该 path；恢复后通过。不得以 `script/generate.ts` 作为 CI gate。

---

## 5. 阶段 5 — 文档错误命令增量门禁（P1）

### 5.1 owner 与复用

历史违规不清扫，只拦新增。不得复制 `script/lint-changed.ts` 的 git diff parser：把纯 added-lines 逻辑迁到 `packages/script/src/changed-lines.ts`，root lint adapter 与 package test 共用。

### 5.2 改动

1. `packages/script/package.json` 暴露 `./changed-lines`，增加 package 级 `test` script。
2. `packages/script/src/changed-lines.test.ts` 覆盖历史违规不报、新增违规报错、删除不报、两种合法命令、`--cwd=`、空格路径与 Windows 路径。
3. `script/lint-changed.ts` 复用 helper，并按 `LINT_BASE_REF` → `GITHUB_BASE_REF` → `origin/main` → `main` → `HEAD` 解析基线。
4. 只扫描 `.md/.mdx` 新增行，拒绝 `bun --cwd <path> run <script>`，接受 `bun --cwd <path> <script>` 与 `bun run --cwd <path> <script>`。
5. 保持 `bun run lint` 现有入口，不新增绕过路径。

### 5.3 最小验证

```bash
bun --cwd packages/script test src/changed-lines.test.ts --timeout 30000
LINT_BASE_REF=origin/main bun run script/lint-changed.ts
```

判别式：临时 Markdown 新增违规命令时 exit 1；改成合法顺序后 exit 0。禁止从仓库根执行 `bun test`。

---

## 6. 阶段 6 — Solid `.tsx` 可渲染测试 harness（P2）

### 6.1 依赖边界

在根 catalog 固定并在 app `devDependencies` 直接声明：

- `@babel/core` `7.28.4`
- `@babel/preset-typescript` `7.27.1`
- `babel-preset-solid` `1.9.10`（与仓库 `solid-js 1.9.10` peer 对齐）

不得依赖 hoist，不从 `node_modules/.bun` 私有路径 import，不隐式升级 Solid。

### 6.2 改动

1. manifest 前后各运行一次 `bun install` 并确认 `find node_modules/.bun -xtype l` 为零；lockfile 只允许预期解析变化。
2. 新增 `packages/app/solid-jsx-plugin.ts`，Bun `onLoad` 只处理 app test 加载的 `.tsx`，使用 Solid + TypeScript preset，不处理 node_modules，不复制 Vite 配置。
3. `test:unit` / `test:unit:watch` 加 `--conditions=browser` 和 preload，保留 happy-dom。
4. 新增 `test:unit:file`，不硬编码 `./src`，使追加文件参数真能收窄到单文件。
5. 只把 `text-diff-view.test.tsx` 样板转成真实 DOM 断言，其余源码字符串断言机会式转换。

### 6.3 基线与最小验证

修改 preload 前在空载环境对当前 `test:unit` 做一次 warm-up + 三次计时，取中位数；修改后同样测量。不能使用先前 29.25s 或并发负载下 69.20s 作为硬基线。后中位数须 ≤ 前中位数 2×。

```bash
bun --cwd packages/app test:unit:file src/pages/session/text-diff-view.test.tsx
bun --cwd packages/app test:unit
bun --cwd packages/app typecheck
```

单文件命令必须只报告目标文件；若仍运行全量，先修 script，不得把假 focused test 当绿。判别式：临时破坏 TextDiffView 一个可见行为，DOM 测试转红；恢复后转绿。

---

## 7. 阶段改完即审模板

每阶段完成后输出到工作记录，但不等待审批：

```text
阶段复查结论:
- 阶段 / 影响文件:
- 命中 skills:
- 根因是否收敛:
- 安全门禁: Catch Everything / No Null Pointer / Security First
- 工程门禁: No Cheating / Reusability / Clean Logs
- 数据流与 Layer/owner:
- 最小有效验证命令与结果:
- 判别式 RED/GREEN:
- 剩余风险:
- 结论: 通过并继续 / 命中停止条件
```

阶段复查必须重新阅读 CLAUDE.md“改完即审流程”相关段落；不用每次全文复述。

## 8. 必须停止整个连续流程的情况

仅以下情况停止并请求用户决策：

- 计划与 Accepted ADR、AGENTS、架构不变量发生真实冲突。
- 需要改变排除项中的产品行为、权限、凭据、CSP 或数据迁移。
- RED 不能仅靠生产代码变绿，或判别式无法证明测试有效。
- 同一根因连续三轮修复仍无法通过最小有效验证。
- 外部依赖、浏览器、网络或 CI 状态使关键事实无法取得，且没有本地等价验证。
- 继续执行会覆盖用户无关改动、丢数据或需要破坏性 Git 操作。

普通测试失败不是立即向用户索要审批的理由：先归类、找交集、修共同根因并复测。只在满足上述停止条件时报告。

## 9. 最终统一终审

六阶段全部完成后才进行统一审批。最终只运行受影响 package/boundary 的最小组合，不跑根目录 `bun test`，不默认跑全仓测试：

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

另复跑各阶段列出的 targeted tests；app unit 全量只因全局 preload 改动运行一次最终确认；E2E 只跑 presentation matrix contract、a11y Chromium 和 sanitizer Chromium，不在本地乘跑 36×5 全矩阵，完整矩阵由 CI 配置承担。

最终报告包含：六阶段状态、文件清单、reuse/delete/merge 结果、测试命令与结果、判别式证据、基线/耗时、未解决风险、债表更新、是否建议提交。最终报告后等待用户统一审批；未经批准不 commit、不 push、不创建 PR。

## 10. 排除项与债表核账

排除：lint warn 批量晋级、继续加宽 spawn timeout、V1 退役前置、CSP/DOMPurify/信标、凭据加密、960px 主列、Assistant scope、未知 API 404 vs SPA、`timeoutSeconds` 默认、App 表面归并、Storybook OOM、Custom M3 后续、toast owner 与权限档位遗留。

每阶段结束即时更新 [technical-debt](../technical-debt.md) 的状态，但只有满足该债全部验收才移入 §5。阶段 1 补记 workflow mutation exerciser 与 app E2E typecheck 已闭环；spawn 条目改为“已有 60s/120s per-test timeout，等待新 CI 证据决定是否串行化”。CLAUDE.md 只保留债表指针。

> 文件模式：本仓 docs 正常为 `100644`。当前 NTFS mount 可能显示 `777` 且 `core.filemode=false`；最终若进入暂存，必须用 Git 索引确保本文件和配套 prompt 记录为非可执行模式，不得提交 `100755`。
