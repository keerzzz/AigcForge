# 当前分支审批审查 · 2026-09-20

## 结论

**REQUEST CHANGES — 不批准当前 HEAD，不推送、不创建 PR。**

确认 11 项新增问题：2 项 P1、9 项 P2；另列交付门禁失败和未归因问题，避免混算。

这是针对本分支高风险调用链、协议与交付门禁的差异审查，不是全仓逐行安全认证。产品代码未作修改。第一次会话中断的检查未计为通过；下面只将有最终结果的运行列为已验证。

## 范围与依据

- 分支：`global-shell-e2e`；HEAD：`6f03ea69bd80e5d4936320710e2d204b2fa25c03`。
- 基线：`origin/main = ac334d85395f8c980683f7c799231db1b1ad9583`。已 fetch；`git rev-list --left-right --count origin/main...HEAD` 为 `0 159`。
- `git diff --name-only origin/main...HEAD`：267 个文件；8 个受影响包：app、core、schema、server、aigcfroge、sdk/js、desktop、ui。
- 原有未跟踪文件未纳入提交：`docs/plan/prompt-global-shell-remaining-closure.md`、`docs/review/v2-five-mode-ux-audit.md`。
- 依据：CLAUDE.md、根/适用包 AGENTS.md、ARCHITECTURE.md、CONTEXT.md、DESIGN.md、docs/testing.md、ADR-23/25、全局 Shell 与 S9A 计划、技术债台账、CONTRIBUTING、PR 模板、CI/PR workflows、pre-push。
- 使用 protocols、quality-to-pr、enterprise-code-standard、Effect、差异审查与误报复核方法。Codegraph 请求超时后使用精确源码、Git 和文本检索；未假称完成调用图工具分析。
- 提交清单来自 `git log --oneline origin/main..HEAD`，原始输出存 `/tmp/aigc-review-commits.txt`；没有手写提交清单。

## 新增问题

### F01 · P1 · 桌面 sidecar 的有效 Tab / Draft 被当作无效连接清理

- 定位：`packages/app/src/context/server.tsx:246`；决定清理的函数：`packages/app/src/context/tabs.tsx:129–140`。
- `ServerConnection.key()` 给内置连接返回 `sidecar`，`canonicalKey()` 却无条件调用 URL 规范化，返回 `http://sidecar`。服务器集合存前者，Tab 过滤查后者，导致有效 Tab 和其 memory 被移除。
- Desktop 实际注册 base sidecar：`packages/desktop/src/renderer/index.tsx:352–364`。Draft 丢失后路由无法再找到对应草稿；不声称后端 Session 被删除。
- 主线程直接执行生产 key/规范化函数及 Tab 过滤语句：`{"key":"sidecar","canonical":"http://sidecar","retainedTabCount":0}`。HTTP、WSL、SSH 对照均保留 1 个 Tab。
- 引入行 `git blame`：`75130c6505`。修复应让连接身份 owner 保留非 URL key，补 key→canonicalKey→Tab 保留的联动回归，而非单独绕开某个页面。

### F02 · P1 · E4 子进程仍会读取真实用户配置与认证来源

- 定位：`packages/app/e2e/real/orchestrator.ts:371–378`、`:73–77`。
- spawn 只过滤 `AIGCFROGE_*`，继承 HOME/XDG 及其他环境；临时配置目录和 SQLite 并没有隔离全局用户目录。
- 路径决定者：`packages/core/src/global.ts:10–14` 从 XDG 计算 config/data；`Global.Path` 不因临时 `AIGCFROGE_CONFIG_DIR` 被替换。
- 配置决定者：`packages/aigcfroge/src/config/config.ts:258–260` 仍加载 Global.Path.config；`:41–42`、`:350–352` 是合并而非替换。认证读取 `src/auth/index.ts:10,65` 的 Global.Path.data/auth.json；wellknown 认证可在 config.ts:355–361 发出非测试远程配置请求。
- E4 Playwright config 的 env 仅设置 E4 端口/runDir 等，没有补 HOME/XDG 隔离。引入行 `git blame`：`278bdc4a2d`。
- 静态链已核实；没有读取用户凭据、没有做真实网络污染实验，也不声称已经发生凭据泄漏。修复应集中在进程环境/用户目录隔离边界；此前不宜直接在开发机启动完整 E4。

### F03 · P2 · 相同目录的隐式本地 Location 可能分裂成两套服务缓存

- 定位：`packages/schema/src/location.ts:10`。
- 改用 optionalOmitUndefined 后，`Ref.make({directory})` 和 `Ref.make({directory, workspaceID: undefined})` 的对象键形状不同。调用方实际同时存在：`core/src/session/info.ts:49–52` 显式传 undefined，identity handler `aigcfroge/src/server/routes/instance/httpapi/handlers/session.ts:188–191` 省略该键。
- 缓存决定者：`packages/core/src/location-layer.ts:102` 的 LocationServiceMap/LayerMap，底层以 Equal/Hash 比较 Ref；不是只观察调用点后猜测。
- 独立复核使用实际 Schema、Equal、MutableHashMap、LayerMap：基线 `equal=true / ownerBuilds=1 / sameOwner=true`，HEAD `equal=false / ownerBuilds=2 / sameOwner=false`，exit 0。`schema/src/schema.ts:12` 仅在 encode 时省略 undefined；实际查表不经过编码往返，故没有归一化。这不是已登记的“路径别名不同”债，而是完全相同目录字符串的新差异。
- 修复应分离传输字段省略与内部缓存 key 规范化，不能逐个补调用点。完整真实服务状态错配及权限影响尚未执行，不声称权限绕过。

### F04 · P2 · 修改权限成功后，Header / StatusBar 仍显示旧权限

- 定位：`packages/app/src/components/session/session-identity-query.ts:12–22`；mutation：`context/permission.tsx:284–287`。
- 共享 identity query 仅以 scope/Session ID 定位；权限更新成功后未更新或失效它。`app.tsx:406–415` 又关闭 mount/focus/reconnect 自动刷新。
- 显示决定者：`components/status-bar/current-session-source.ts:88–107` 读缓存，`permission-display.ts:21–24` 决定默认 propose 不显示 full-access 警告。
- 主线程复现（生产 query/mutation + 真实 TanStack QueryObserver，SDK 为内存边界）：`{"serverTier":"full","displayedIdentityTier":"propose","identityReads":1}`。
- 应在共享 owner 接通 mutation/Session identity 变更后的统一缓存更新或失效，避免 Header、StatusBar 分别打补丁。此复现不是浏览器 E2E。

### F05 · P2 · Custom 关闭时只读 identity 被执行门禁提前拒绝

- 定位：`packages/aigcfroge/src/server/routes/instance/httpapi/handlers/session.ts:184`。
- 已有 Custom Session 且客户端 capability 正确时，identity 调用 requireRuntimeSession，进入 `ProductModePolicy.assertRuntimeSupported`（core/src/product-mode-policy.ts:78–85），返回 400。
- 因而无法到达 `core/src/session/session-identity.ts:235–245` 已实现的 `custom-mode-disabled / blocked` 投影分支，客户端只能看到请求失败而不是禁用原因。
- 应按 ADR-23 将只读身份查询与执行准入区分；不能为修查询而放宽真正的执行门禁。独立策略探针 flag=false/true 均 exit 0：带 capability 的 Custom 始终可读，但 runtime 门禁在关闭时失败；ADR-23:24–26,96 以及 core/test/session-identity.test.ts:369–375 明确要求 blocked。未启动真实 HTTP 服务；400 由 packages/server/src/errors.ts:113–120 的映射确认。

### F06 · P2 · Work 工作流新内容被绑定到旧列表 revision

- 定位：`packages/app/src/pages/mode-workspace-slots.tsx:720–731`。
- startWorkflow 从 content 响应读当前 steps，却从先前列表条目读 `asset.revision` 写 workContract。资产在两次请求之间变化时，prompt 与持久化契约描述不同版本。
- 响应 owner：`aigcfroge/src/server/routes/instance/httpapi/handlers/workflow-asset.ts:69–84` 已在同一个 Info 中返回内容及 revision；应使用同一权威响应形成契约，或拒绝 stale launch。
- 写入路径：`components/prompt-input/submit.ts:407–416` 将 draft contract 写入 session metadata；`core/src/session/info.ts:25` 读回。
- 主线程提取并执行实际 startWorkflow，SDK 返回 revision B/新 steps，旧列表为 A：结果 `contentResponseRevision=B, persistedDraftRevision=A, mismatch=true`。非浏览器/E4 验证。

### F07 · P2 · 公开 workContract 字段未同步到 SDK / OpenAPI 快照

- 定位：`packages/schema/src/session.ts:41`，引入提交 `803300877`。
- `packages/server/src/groups/session.ts` 直接暴露 SessionV2.Info；但 `packages/sdk/js/src/v2/gen/types.gen.ts` 的 SessionV2Info 和 `packages/aigcfroge/test/server/openapi.snapshot.json` 均没有 workContract 属性。
- 决定差异方向的断言：`test/server/openapi-drift.test.ts:63` 以文件快照为 received、live serialized 为 expected。实测 **1 pass / 1 fail，exit 1**；是 live 新增而快照缺失，不是反向。
- 已有 `SessionIdentityWorkContract` 不是这个新增 Session 字段。未把另一个 packages/sdk/openapi.json 的基线状态混入此结论。
- 应按仓库生成脚本重生成并审核 SDK/快照，而非手工改生成物或更新快照掩盖未经确认的 API 变化。

### F08 · P2 · 新 globalSetup 相对路径破坏 benchmark 配置加载

- 定位：`packages/app/playwright.config.ts:29`；继承点 `e2e/performance/playwright.config.ts:9`。
- performance 展开根配置后，`./e2e/global-setup.ts` 按 performance 配置目录解析，路径不存在。
- 主线程安全复跑 `bun run test:e2e --config e2e/performance/playwright.config.ts --list --reporter=line`：**exit 1，Cannot find module './e2e/global-setup.ts'**。
- 错误发生在列举阶段，未启动浏览器/webServer。应使用基于配置模块的稳定路径，验证所有继承配置。

### F09 · P2 · coverage manifest 的新状态不能通过自身校验器

- 定位：`packages/app/e2e/coverage-manifest.json:157`；规则：`e2e/real/manifest.spec.ts:104`。
- 新条目使用 `verified-unit`；校验器仅接受 `red-fixme | flake-observed-once | red-stable`。
- 主线程执行原文件四条纯断言：**3 pass / 1 fail，exit 1**。未经过 Playwright setup，不涉及服务或浏览器。
- 应统一“缺陷登记”与“已验证范围”状态模型/存放位置，不能删除登记或放宽断言来制造绿色。

### F10 · P2 · PTY 测试不执行命令也能通过

- 定位：`packages/app/e2e/real/session-pty.spec.ts:63–74`。
- 发送的是字面量反斜杠 n，而非提交命令的换行；成功条件又是输入自身包含的 `s5-pty-ok`。终端输入回显足以满足断言。
- 主线程用原字符串及裸 PTY、无 shell/子进程复现：`Read without any shell/child process: b'printf s5-pty-ok\\n'`；现有 sentinel 判断仍通过。
- 应发送真实命令结束符，并断言只有执行后才可能生成、输入回显中不存在的结果及清理状态。

### F11 · P2 · 大文件 E4 测试对错误成功响应 fail-open

- 定位：`packages/app/e2e/real/session-files.spec.ts:127–131`。
- 200 响应只有在 content 已是字符串时才进入断言；`200 {}` 等缺字段响应直接跳过全部成功分支检查。
- 主线程执行原测试函数，仅替换 HTTP/文件边界，证实 `HTTP 200 {}` 被接受。没有真实文件写入、服务或网络。
- 应先断言成功响应结构，再断言内容非空、边界/类型约束；错误响应也需验证约定的错误结构。

## 已运行验证与失败分类

### 已通过（仅指对应范围）

- Schema：包目录内 `bun run test`，**248 pass / 0 fail，exit 0**，24 文件。
- Core 聚焦：`bun test --timeout 30000` 加 work-review-lifecycle、session-identity、path-identity、product-mode-agent-policy、custom-mode-upgrade、agent-asset-bridge、tool-path-containment 七个文件，**81 pass / 0 fail，exit 0**。
- 路由补查：在 app 包执行 app-router-boundary、utils/session-route、utils/url-params、utils/route-error-i18n 四文件，**19 pass / 0 fail，73 assertions，exit 0**；另 9 个离线路由探针通过。与其他套件可能重叠，不相加冒充总覆盖数。
- 协议引用脚本：`bash .aigcfroge/skills/protocols/scripts/check-refs.sh`，子智能体运行，**All 32 paths OK，exit 0**。它不是任意 Markdown 链接的全仓验证。
- F01/F04/F06/F10/F11 的反例探针退出 0，含义是**成功证明缺陷存在**，不是产品通过。

### 未通过

- `bun typecheck --concurrency=1`：**exit 2；13 successful / 15 total，7 cached**。失败于未改动的 `session-ui/src/components/markdown-shiki.worker.ts:74,85,86`，两条安装路径的同版本 Shiki/TextMate 类型不兼容。尚未在干净安装环境复证，**不认定由本次分支引入**，但不能绕过 pre-push。
- `bun run script/lint-changed.ts`：**exit 1**，`core/src/session/work-review.ts:54:1 typescript-eslint(consistent-return)`。
- 五个新增/修改 Work 文件的 `prettier --check`：**exit 1**；work-review.ts、work-preset.ts 未格式化。这不是完整 Prettier 扫描。
- `git diff --check origin/main...HEAD`：**exit 2**；`docs/plan/s9a-work-review-lifecycle-contract.md:38` trailing whitespace。
- App 聚焦 12 文件：**93 pass / 1 fail，exit 1**。submit.test.ts 在加载时 `SyntaxError: export 'showToast' not found in '@aigcfroge/ui/v2/toast-v2'`；该文件单独复跑仍 **0 pass / 1 fail，exit 1**。未完成基线执行对照，不列作新产品回归；这意味着 submit 行为本轮没有被该套件验证。
- OpenAPI：**1 pass / 1 fail，exit 1**（F07）。
- Manifest 原断言：**3 pass / 1 fail，exit 1**（F09）；benchmark `--list`：**exit 1**（F08）。

### 未验证

- 第一次中断的全 App 套件、全 lint、类型检查没有完整结束结果，不算通过；本轮补跑范围见上。
- 未跑完整 E3、真实 E4（先修隔离）、production benchmark、Electron packaged smoke、Windows/WSL 验证、真实后端故障/重启矩阵。
- 已补查 canonical/legacy/target Session 路由、root boundary、错误分类和 URL 参数；未动态验证迟到响应、真实 UI retry/navigation 并发及完整历史栈。
- 未逐项核验所有 267 个变更文件、全部 i18n/UI 状态及每条调用链；UI 其余大页面、resize-handle/真实焦点行为等仍有覆盖缺口。
- WorkArtifact 仅投影当前内存状态是 ADR-23 允许的范围，不把重启后 missing 本身重复报为新问题。已登记的 V2 continuation、identity cross-server/historical、Work/Assistant 后续 producer/E4 等债也没有冒充新发现。

## 文档和 PR 交付门禁

- GitHub 查询：当前分支没有 PR，亦未发现覆盖本次全局 Shell 改动的已确认 Issue。现有 #44 属其他 Custom M1 范围，不可为满足模板而冒用。
- 仓库 CONTRIBUTING / quality-to-pr 要求关联 Issue、确认最终 diff/base/remote，PR 使用 `.github/pull_request_template.md`，UI 带截图/录像并如实填写测试。
- E4 workflow 在 PR 事件跳过；普通 PR 绿灯不能代替 E4。当前分支也没有可回读的远端执行结果。
- 现有闭环报告 `docs/review/global-shell-remaining-closure.md:1050–1056` 还有 8/9/5 与 7/10/5 的计数冲突；两处都不支持 READY，不能将历史报告当当前 HEAD 证据。
- quality-to-pr 引用的 references/delivery-gates.md 本地存在但被 references/ ignore、未跟踪；协议引用脚本未覆盖该路径。作为工具链可复现性缺口，未归因本分支引入。
- **没有修改产品代码、提交、push、创建/关闭 Issue 或 PR，也没有绕过 hooks。**

## 收敛修复顺序

1. 修连接/Location 身份 owner 的规范化与只读/执行边界，覆盖实际消费者链。
2. 修共享 identity 缓存失效与 Work 内容/revision 同源，再生成 SDK/快照。
3. 统一 E4 环境隔离、配置路径、manifest 状态和执行证据，堵住测试假绿。
4. 解决或在干净环境复证类型/测试加载问题，修 lint/格式门禁，重跑受影响单测/API；随后在隔离主机跑 E3/E4、benchmark、Desktop。
5. 确认关联 Issue、最终范围、未交付项 owner/unlock，证据通过后才按模板创建 PR。

不采用“逐个绕开失败、跳过 hooks 或增加 retry”的简单方案；本报告也不把声明技术债当作已经审批通过。

## 原始证据位置

- `/tmp/aigc-review-typecheck-resumed.log`、`/tmp/aigc-review-lint-resumed.log`、`/tmp/aigc-review-format.log`、`/tmp/aigc-review-diff-check.log`。
- `/tmp/aigc-review-schema-test.log`、`/tmp/aigc-review-core-resumed.log`、`/tmp/aigc-review-app-focused.log`、`/tmp/aigc-review-submit-isolated.log`、`/tmp/aigc-review-openapi-test.log`。
- `/tmp/aigc-review-sidecar-repro.ts`、`/tmp/aigc-review-permission-repro.ts` 及对应 `.log`；`/tmp/aigc-review-workflow-repro.log`。
- `/tmp/aigc-review-e2e/` 内原脚本、原归档和主线程 `.rerun.log` / `.rerun.exit-code`。反例测试 exit 0 与产品测试通过严格区分。
- `/tmp/aigc-review-verification/VERDICT.md`、location-key-probe.log、policy-probe.log：独立误报复核。
- `/tmp/aigc-route-review-report.md`、aigc-route-review-unit.log、aigc-route-review-probe.log：补充路由审查。
- 临时目录不是永久归档；关键命令、输出、SHA 和失败证据已内嵌于本报告。

## 后续修复（2026-09-20）

F01–F11 已在后续工作树中修复；上述审查失败记录保留，不改写为历史绿色。最新实现、可运行回归、未完成检查与用户限定的 E4 范围见[修复记录](current-head-fixes-2026-09-20.md)。尚不构成完整发布 READY。
