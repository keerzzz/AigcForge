# AigcForge main 审批报告（第二轮）

- 日期：2026-08-10
- 审查范围：`d896ae0e..main`（115 个提交，`d896ae0e..e4e93d76f`，承接 2026-08-05 审批报告之后）
- 变更规模：279 文件，`+23,462/-1,520`
- 覆盖合并：PR #13 todo-task-upgrade、PR #14 task-review-fixes、PR #15 external-cli-fix、PR #16 desktop-startup-perf、work-m2、work-m3（Mermaid）、work-m3.5（HTML artifact iframe）、PR #17 work-m3-closure、PR #18 fix-release-version-base、PR #19 work-session-sidebar，及 core 记忆子系统、V2 doom_loop 移植、标题重试、工具活动统计等直接提交
- 结论：**有条件通过（批准保留 main，需跟进修复 4 项 P1 代码/测试缺陷 + 1 项 P1 流程问题）**

## 一、门禁与验证记录

| 门禁 | 结果 |
|---|---|
| 增量 lint（`LINT_BASE_REF=d896ae0e bun run script/lint-changed.ts`） | 退出码 0，221 文件 / 22,888 新增行，无新违规 |
| typecheck（core / app `tsgo -b` / aigcfroge / ui） | 全绿 |
| `git diff --check d896ae0e..main` | **失败**：398 处 trailing whitespace，全部在 `docs/research/{agent,industry}/` 3 篇调研 Markdown，无源码涉及 |
| app 测试 | 735 + 3 pass / 0 fail |
| aigcfroge `test/session/prompt.test.ts`（含标题重试 3 用例） | 57 pass / 0 fail |
| core memory/doom/task/外部 CLI 聚焦测试（各复审组实跑） | 27 + 106 + 92 pass / 0 fail |
| session-ui / tui / desktop 聚焦测试 | 107 / 7 / 14 pass / 0 fail |
| core `cli-sdk-live-smoke` 2 skip | 环境门控（`AIGCFROGE_LIVE_CLI_SMOKE` 未开启），opt-in 设计，非失败 |

## 二、上轮阻断项复核

- **BLOCKER-1（writeLock 非全局）**：已修复。`packages/core/src/session/task.ts:401` 模块级 `Semaphore.makeUnsafe(1)`，全部 8 条写路径包裹，无绕过写入方（scheduled-job / todo 桥接 / 迁移均经服务接口）。**但其回归测试空转，见 P1-3。**
- **BLOCKER-2（陈旧 task 复活）**：已修复。`pickProgressTodos` 按 recency 裁决且空 todo 可胜出；`directory-sync.ts:551-557` 空拉取不盖戳。两处 P2 残余见下。

## 三、P1 发现（放行条件）

### P1-1 iframe `csp` 属性缺 `style-src`/`img-src`，内联样式与 data: 图片被拦

`packages/session-ui/src/components/html-artifact.tsx:15`。iframe `csp` 属性作用于 srcdoc 且与 meta CSP 取交集；属性版未含 `style-src 'unsafe-inline'` 与 `img-src 'self' data:'`，回落 `default-src 'none'`。Chromium 探针实证：内联样式容器高 0、data: 图片不加载——LLM 产物图表（vis-network 等）会塌陷。e2e 恰好被 canvas 默认尺寸兜底而未暴露。
**修复**：`IFRAME_CSP` 与 `CSP_META` 对齐（补 `style-src 'unsafe-inline'; img-src 'self' data:'`），e2e 增"内联 style 容器 computed height > 0"断言。安全姿态不变。

### P1-2 `v2InfoToV1` 运行时丢失顶层 `presetCategoryId`

`packages/aigcfroge/src/server/routes/instance/httpapi/session-adapter.ts:20-45`。返回类型声明了顶层字段，字面量只写进 `metadata`。children / revert / unrevert 三条响应路径静默丢字段，客户端据此刷新时该会话掉入"未分类"。主 list 路径（`session.list` → `fromRow`）不受影响。
**修复**：字面量补 `presetCategoryId: info.presetCategoryId`，加 adapter 层测试。

### P1-3 BLOCKER-1 跨实例回归测试空转

`packages/core/test/session-task-service.test.ts:898-905`。探针实证：ambient provide 下 `Layer.build` 复用外层 memo map，两个"独立构建"的 SessionTask 实为同一实例（`same service: true`）——把锁改回实例级该测试照样绿，给人虚假安全感。
**修复**：第二次构建改用 `Layer.fresh(SessionTask.layer)` 并注入共享的同一个 Database 实例（"不同 SessionTask 实例 + 同一 DB"的真实生产形态）。

### P1-4 config 定义的 CLI agent 永远拿不到 resume id

`packages/core/src/tool/cli-config-adapter.ts:38-50`。`parseResumeHint` 只认 `session.resume_hint`，但 `claude-jsonl` 真实输出是 `type:"result" + session_id`、`codex-jsonl` 是 `thread.started.thread_id`——config 路径均不匹配，`external_cli_session` 永不写入，PR #15 的核心特性 resume 对 config 定义 agent 静默失效。
**修复**：委托 `claudeCodeAdapter.parseResumeHint` / `codexAdapter.parseResumeHint`，与 `parseOutput` 的委托方式一致。

### P1-5 d72605311 提交信息违规且虚假（流程项）

"Refactor code structure for improved readability and maintainability" 实际是纯研究文档新增（4 篇，无代码改动），非 conventional 格式，污染 main 历史并误导 changelog 生成。已入历史无法改写；**收口措施**：PR title 校验或 commitlint 流程兜底。

## 四、P2 发现（排期跟进，不阻断）

- core 记忆子系统：fact 长度上限只在工具边界 enforce（服务层可绕过，建议存储层 CHECK 或服务层 guard）；`search`/`query` 无 LIMIT 输出无界；baseline 注入是跨 session prompt-injection 通道（默认关闭、有测试保证 byte-identical，建议记录信任假设 + "never store secrets"）；memory 开启后 DB 故障使 baseline load 可 defect（建议降级空事实）；`top_n` 无上界。
- doom_loop：`settleTool` 未用 `Effect.fn(Untraced)` 命名；检测器进程内存态与 V1 持久化判定有重启语义差（建议声明为已接受）；`MAX_TRACKED_SESSIONS` FIFO 驱逐无测试。
- todo/task：挂载种子守卫对清空态不对称（`session-todo-progress.tsx:126-132`，窗口窄可自愈）；`directory-sync.ts` 空拉取跳过分支无单测；组合写两次顺序加锁非原子、stale revision 映射 404 语义误导（建议 409）。
- 外部 CLI：`task-driver.ts:434/497` `as unknown as` 双重断言、`:593` 裸 `new Error` 失败通道；重型 SDK import 时静态实例化（违启动敏感入口动态 import 规约）；注册逻辑与 `registry.ts` 双份平行；ACP allow 兜底可能选中 reject 选项。
- desktop：`shellEnvPromise` await 位置抵消并发收益（`index.ts:246`，建议移至 sidecar spawn 前）；`forkDetach` 属有注释论证的门禁例外，建议改应用级 Scope + forkIn；`probeAsync` 用 `console.log` 绕过 logger；超时 kill 无 SIGKILL 升级。
- release 脚本：fetch 网络层 rejection 未捕获（`script/src/index.ts:42-46`）；限流时静默回落 `0.0.1` 基线（建议 CI 传 `GITHUB_TOKEN` + warning）；非标准 tag `Number()||0` 解析脆弱（建议 `semver.parse`）。
- HTML artifact：`onError` 错误边界对 sandboxed srcdoc 是死代码；图表库 `?raw` 静态导入 ~950KB 进主 bundle 且 `includes("Chart")` 启发式误注入；Mermaid 缓存主题切换旧色、`DOMPurify.isSupported` 为 false 静默空串、`app.tsx:350` 潜在 unhandled rejection。
- 标题重试：失败分支只计数不日志（排障困难，建议 `Effect.logWarning`）；"backoff" 实为熔断无时间退避，措辞夸大；`titleFailures` Map 达上限条目不清理（按会话数有界）。
- 杂项：`work-sidebar-groups.ts:32-34` 一处 `else`；`work-artifact-extract.ts:42` fence 正则对空格/CRLF 脆弱；`git diff --check` 398 处 docs 空白错误待清理。
- app 契约测试用 `readFileSync + toContain` 断言源码文本，重构即误报（有先例，建议后续换真实渲染测试）。

## 五、通过面（已核验）

- **HTML artifact sandbox 三重防御真实有效**：`allow-scripts` 无 `allow-same-origin`（opaque origin 实证）、iframe csp + meta CSP 双层取交集、storage polyfill 非摆设；Mermaid 链 `securityLevel:"strict"` + DOMPurify（FORBID foreignObject/script/style）+ 占位符 URI 编码 + escapeHtml fallback；dompurify 3.4.6 锁定负债未触碰。
- **doom_loop fail-closed 双防线成立**：fail-closed agent 显式补 `doom_loop: ask`（findLast 后写胜出）；无人值守子 Session ask→deny 硬拒不挂死；`settleTool` 用 `Effect.exit` 捕获含 defect 的全部失败；bdda2f960 消除了"非权限失败误报 blocked"的统计假阳性源，app 已知负债（文案匹配统计）未恶化且已登记根治方案。
- **core 记忆子系统**：LIKE 转义与 ESCAPE 子句一致、参数全绑定；迁移/schema.gen/schema.json/sql.ts 四方一致；memory 注入默认关闭且关闭时 baseline 与旧版逐字节一致（有测试）；工具经 Location 作用域注册，无 V2 架构违规。
- **标题重试**：`MAX_TITLE_FAILURES=3` 熔断、`Effect.exit` + `Effect.ignore` + `forkIn(scope)` 无 unhandled rejection、drain 串行无并发重复。
- **archived 过滤在数据源层**：后端 SQL + list/count 条件一致 + 客户端四层兜底，分页计数一致。
- **revision 乐观并发**：expectedRevision 检查在 writeLock 内、事务内 max revision 比对、组合写链式守卫，正确。
- **外部 CLI 安全模型**：全程 argv 数组 spawn 无 shell 插值、权限桥断言到父 Session、`acquireRelease`/`AbortController`/超时兜底齐全、outputDigest 脱敏。
- **Effect/工程门禁**：全范围无 `Effect.fork`/`forkDaemon`、无 `Effect.sleep` 等待、无新增 `as any`/`@ts-ignore`（P2 双重断言两处除外）、错误均 `Schema.TaggedErrorClass`、testEffect + Layer.mock 普及。

## 六、结论

**有条件通过**。无 P0；安全门禁（sandbox、fail-closed、注入面）核验通过；上轮两项 BLOCKER 生产代码修复正确。放行条件：跟进修复 P1-1（CSP 对齐）、P1-2（adapter 丢字段）、P1-3（空转测试）、P1-4（resume hint 委托）四项一行级~小改动缺陷；P1-5 以流程约束收口；P2 排期。`git diff --check` 的 398 处 docs 空白错误建议随下一次 docs 提交清理。

## 复查结论

- 影响文件：279（`d896ae0e..main`），核心涉及 packages/{core, aigcfroge, app, session-ui, ui, desktop, script}
- 命中 skills：effect（Effect 规约核验）、database（迁移/schema 核验）、frontend-theming（v2 token 核验）、protocols
- 安全门禁：通过（sandbox 三重防御实证有效、fail-closed 双防线、注入面无新增；P1-1 为功能缺陷非安全回退）
- 工程门禁：基本通过（P1-5 流程违规、P2 双重断言/裸 Error/平行实现若干）
- 已运行命令：`script/lint-changed.ts`（0 违规）、4 包 typecheck（全绿）、`git diff --check`（docs 空白 398 处）、app 738 pass、aigcfroge prompt 57 pass、core 聚焦 225+ pass、session-ui/tui/desktop 128 pass
- 剩余风险：P1-1~P1-4 五项跟进项未修前，对应功能（图表样式保真、v2 分类字段、锁回归防护、config agent resume）处于降级/无防护状态；声明风险≠可以忽略，建议下一个迭代窗口清零 P1。
