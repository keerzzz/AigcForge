# 审批问题修复记录 · 2026-09-20

## 范围与结论

- 基于 `global-shell-e2e` / `6f03ea69b`，实现[审批报告](current-head-approval-2026-09-20.md)的 F01–F11；未提交、推送或创建 PR。
- 4 个实现子智能体按互不重叠的范围修改，主线程复核、补齐生成物与最终集成。原有两份用户未跟踪文档未修改。
- **11 项代码修复已落地；这不是全仓、真实 E4 或发布 READY 声明。** 已通过和未完成的验证分开列出。
- 按用户补充要求，本轮不启动真实 E4/backend/browser、不反复尝试受限构建或平台，不增加 E4 timeout/retry。只执行当前系统可承受的单元、配置和内存 HTTP 验证。

## 修复落点

### 身份、权限与只读边界

- **F01**：`app/src/context/server.tsx` 的 `canonicalKey/sameKey` 共用 native key 保护，sidecar/SSH/WSL 不再进入 URL 规范化；实际 Tab owner 回归覆盖保留 Tab/Draft/memory 与失效连接清理。
- **F03**：`schema/src/location.ts` 复用 `optionalOmitUndefined`，为构造和解码提供相同内部默认值；缺键和显式 undefined 归一化，JSON 仍省略该字段。使用实际 Equal/Hash/LayerMap 回归，不修改通用 helper 或逐个打补丁。
- **F04**：`session-identity-query.ts` 统一 query key、旧请求取消、mutation/event 失效；固定原始 scope/session，避免切换服务器后刷新错目标。已成功写入不因重读失败变成“写入失败”；失败时隐藏旧投影，Header 显示不可用、StatusBar 显示降级且使用现有 i18n，不猜测 effect。真实 `session.updated` owner 同样触发刷新。
- **F05**：identity endpoint 复用 `requireSession`，不再走执行门禁。Custom 关闭仍能返回 blocked；capability、prompt/admission 的执行拒绝保持不变。

### Work 契约与生成物

- **F06**：在既有 `work-preset-launch.ts` 增加 `workflowDraft`，从同一 content 响应同时生成 prompt 和契约。调用方不再用列表旧 revision；内容失败时保留原澄清体验，但作为 ad-hoc，不伪造固定 workflow 契约。
- **F07**：通过 `packages/sdk/js/script/build.ts` 重生成 SDK；SDK 文档快照通过 `OpenApi.generateOpenApiSpec()` 更新，测试快照通过其 `UPDATE_OPENAPI_SNAPSHOT=1` 入口更新，未手改生成字段。
- 两种快照不可直接互拷：`cli/cmd/generate.ts` 会添加 `x-codeSamples` 并用 Prettier 格式化；测试 `openapi-drift.test.ts` 比较的是 `Server.openapi()` 的原始序列化。初次混用入口导致的失败已纠正，历史日志未冒充绿色。
- 修复 submit 测试的 V2 toast mock 导出名，保留真实 adapter；补齐 preset/workflow/ad-hoc、草稿隔离、已有 Session 复用等请求断言。
- `WorkReviewMachine.transition` 用 `absurd(never)` 显式保证穷尽，消除 consistent-return；既有 12 项状态机测试通过。未扩大到尚无 producer 的 Work review 完整流程。

### E4 可测试门禁

- **F02**：新增共享 `Environment` owner，统一 HOME/XDG、临时目录、Git/npm 配置、凭据环境和 Bun/Vite dotenv 隔离；Playwright 合并父环境不能恢复敏感变量。backend 首次启动和重启共用绝对入口与临时 workspace cwd。
- **F08**：globalSetup 使用模块相对的绝对路径，performance/uncapped/real/zoom 配置可列举。
- **F09**：保留原 unit 记录并与 open entries 分开，共用 owner/校验规则；`verified-unit` 必须同时满足 unit、Bun、unit 测试路径约束，增加负例，不用宽泛 regex 放行。
- **F10**：PTY 输入有真实换行；成功结果必须是 shell 组装出的完整输出行，输入回显不能满足。PTY 列表结构错误也不再退化为空列表。
- **F11**：播种大文件必须返回正确的 200 text 结构、完整内容和预期大小；`200 {}`、缺字段、截断以及任意 4xx 不再通过。
- `test:e2e:contracts` 复用现有测试入口执行 `e2e/unit`，并接入默认 app `test` 链；单独进程避免 src mocks 污染。**它不启动真实 E4。**

## 已验证

以下数字是各次命令自己的结果，存在覆盖重叠，不相加冒充全仓覆盖。

- `bun --cwd packages/app typecheck`：最终 **exit 0**（含 E2E tsconfig）。
- `bun --cwd packages/schema typecheck`、`packages/core typecheck`、`packages/sdk/js typecheck`：均 **exit 0**。
- `bun run script/lint-changed.ts`：源代码修复完成后的运行 **exit 0**，`218 changed files, 107117 added lines`。随后只追加/格式化审查文档；最终整树复跑在 180 秒预算结束（exit 124），因此只声明前述源码范围通过，不声明最终整树 lint 完成。
- 最终身份/权限/Tab/Server 三文件回归：**46 pass / 0 fail，163 assertions，exit 0**。包含主线程对失败显示本地化和 Consumer DOM 类型的修正。
- Work launch + submit + request-parts：**34 pass / 0 fail，110 assertions，exit 0**。
- `bun --cwd packages/app test:e2e:contracts`：**39 pass / 0 fail，153 assertions，exit 0**。
- Location schema + session-identity：**23 pass / 0 fail，exit 0**；实际 LayerMap + location：**2 pass / 0 fail，exit 0**。
- WorkReview 状态机：**12 pass / 0 fail，exit 0**。
- SDK 生成脚本：**exit 0**；测试 OpenAPI 刷新命令：**2 pass / 0 fail，exit 0**。此后默认 OpenAPI 漂移门禁单独复跑：**2 pass / 0 fail，exit 0**；SDK 文档漂移检查：**OpenAPI snapshot is up to date，exit 0**。
- Playwright `--list`：主配置 **349**、performance **12**、uncapped **12**、real **28**、zoom **2**，均 **exit 0**。列举不代表执行通过。
- Custom HTTP worker 在生产修复后：**8 pass / 0 fail，51 assertions，exit 0**，其中禁用 Custom 的 identity RED 为“预期 200、实际 400”，GREEN 返回 blocked 且执行仍拒绝。负例 header 夹具改为原生 Headers 后，最终定向复跑：**1 pass / 7 filtered / 0 fail，13 assertions，exit 0**。

## 当前树复验（2026-09-21，主线程，合并树重跑）

子智能体分头修改后，主线程在合并后的当前工作树上独立重跑了本机可测门禁，确认修复为真、非假绿（数字为各命令自身结果，覆盖有重叠，不相加）：

- `bun --cwd packages/app typecheck`（`tsgo -b` + e2e tsconfig）：**exit 0**。解决了修复文档记录的初次 `permission-identity.test.ts` 类型冲突；`app-typecheck-final(=1)` 是修复前历史记录，非当前状态。
- `bun --cwd packages/schema test test/location.test.ts`：**3 pass / 0 fail，exit 0**（F03）。
- `bun --cwd packages/core test test/location-cache.test.ts test/work-review-lifecycle.test.ts test/session-identity.test.ts`：**24 pass / 0 fail，exit 0**（F03 缓存 / 状态机 / F05 blocked 投影）。
- `bun --cwd packages/app test:unit:file`（tabs-server + permission-identity + server + work-preset-launch + submit）：**67 pass / 0 fail，228 assertions，exit 0**（F01/F04/F06）。
- `bun --cwd packages/aigcfroge test test/server/httpapi-custom-composition.test.ts`：**8 pass / 0 fail，51 assertions，exit 0，[344.71s]**（F05 集成；此前 `http-final=124` 是 180s 预算超时截断，非失败）。
- OpenAPI drift + SDK 文档快照：**2 pass / 0 fail（×2 次），exit 0**；`workContract` 已存在于 `types.gen.ts`、`openapi.snapshot.json`、`sdk/openapi.json` 各 1 处（F07）。
- 修复文件 `as any` / `@ts-ignore` / `@ts-nocheck` / `eslint-disable` 静态扫描：**0 处**。

## 未完成／不作为绿色的检查

- `aigcfroge` 包 typecheck 的主线程尝试在 180 秒预算结束；另一次重检查运行超过 5 分钟、RSS 约 5.7 GB，引发宿主明显交换压力，已主动终止。**不判为通过，也不据此宣称发现功能回归。** 不再重复重检查。
- 最终整树 `lint-changed` 复跑在 180 秒预算结束；此前的源码修复范围 lint 已通过，文档仅做 Prettier、链接和 `git diff --check` 验证。
- 初次 App typecheck 暴露的新测试类型错误（品牌值、map 回调参数、Consumer 返回 Accessor）均已修复，最终 App typecheck 为 0；保留失败记录。
- 审查阶段另有未修改 session-ui 文件的 Shiki/TextMate 双安装路径类型冲突。未用 cast/skip 掩盖，也未为追逐全仓绿灯重装依赖。
- 未执行完整 app/core 套件、真实 E3/E4、provider/PTY/文件生命周期、生产性能、Desktop packaged smoke、Windows/WSL。

## 剩余验证归属

- `coverage-manifest.json` 的 `e4-isolated-runtime-revalidation` 登记真实运行缺口、owner/unlock；[技术债台账 §8](../technical-debt.md#8-全路由-e2e-审计新增债2026-09-12)补充本轮用户范围和资源限制。
- **S5/E4 与 S11/Desktop 维护者**：在具备隔离目录、稳定 ext4/CI 构建和对应平台的环境验证真实链路；不通过增加 retry、删除断言或跳过失败冒充闭环。
- **S12/交付与开发环境维护者**：在资源稳定、锁文件一致的环境完成 aigcfroge/全仓 typecheck；若仍有异常，再溯源类型复杂度或依赖布局，而不是认定“只是环境”。
- 关联 Issue、最终远端 diff 与 PR 证据尚未确认，本轮没有推送 PR。

## 待验证清单（用户裁决：暂不推 PR，先在具备资源/平台的环境补齐）

本机为 FUSE 挂载 + 内存压力，以下项目跑不动或跑不完，**不算通过、也未归因本分支引入**。需在 ext4/CI 或对应平台执行；不得靠加 retry、删断言、跳过失败冒充闭环。

| #   | 命令                                                                   | 通过判据                                                                                                                                        | 本机跑不了的原因                                       |
| --- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| V1  | `bun turbo typecheck`（或先 `bun --cwd packages/aigcfroge typecheck`） | exit 0；并在**干净安装**下复证 `session-ui/src/components/markdown-shiki.worker.ts:74,85,86` 的 Shiki/TextMate 双安装路径类型冲突是否为分支引入 | aigcfroge 包 tsgo 约 5.7GB RSS，本机 OOM/超时          |
| V2  | `LINT_BASE_REF=origin/main bun run lint`                               | exit 0（oxlint + format --check + lint-changed + unawaited-assertions 全绿）                                                                    | 全树 lint 超 180s 预算；源码范围增量 lint 已 exit 0    |
| V3  | `bun --cwd packages/app test:e2e:real`                                 | F02 隔离 / F09 manifest / F10 PTY / F11 大文件门禁对**真实后端**绿                                                                              | 需隔离 HOME/XDG + 真实 backend/browser，本机受限不启动 |
| V4  | `bun --cwd packages/app test:bench`                                    | 生产性能基准通过（非 `--list`）                                                                                                                 | 同 V3，需真实 webServer                                |
| V5  | Desktop packaged smoke                                                 | 打包产物可启动、核心链路通                                                                                                                      | 无桌面打包/运行时环境                                  |
| V6  | Windows / WSL 验证                                                     | 路径/PTY/文件链路在目标平台通                                                                                                                   | 本机 Linux                                             |

**补齐后推 PR 的前置**（沿用审批报告 §交付门禁）：

1. V1–V3 在 CI 绿（V4–V6 至少有 owner 认领并在 `coverage-manifest.json` 的 `e4-isolated-runtime-revalidation` 登记 unlock 条件）。
2. 确认覆盖本次 global-shell 改动的关联 Issue（**不能**冒用 #44 Custom M1）。
3. 本机推送时 pre-push 钩子会跑 `bun typecheck`（全仓，本机 OOM）——需 `AIGCFROGE_SKIP_TYPECHECK=1 git push -u origin global-shell-e2e` 跳过本地钩子，并在 PR 描述如实标注"全仓 typecheck 由 CI 补跑"。
4. PR 用 `.github/pull_request_template.md`，如实填测试矩阵（已跑 / 未跑 / 环境受限）。

## 日志

- 主线程：`/tmp/aigc-fix-app-typecheck-verified.log`、`aigc-fix-typecheck-{schema,core,sdk-js}.log`、`aigc-fix-lint-final.log`、`aigc-fix-identity-final.log`、`aigc-fix-work-submit-final.log`、`aigc-fix-e4-contracts.log`。
- 生成/未完成检查：`/tmp/aigc-fix-sdk-build.log`、`aigc-fix-openapi-refresh.log`、`aigc-fix-http-final.log`、`aigc-fix-sdk-spec-check.log`、`aigc-fix-typecheck-aigcfroge.log`。
- RED/GREEN：`/tmp/f03-*.log`、`/tmp/f05-*.log`、`/tmp/aigc-f01-f04-*.log`、`/tmp/aigc-e4-gates-fix/`。
- 临时日志不是永久归档；关键命令、结果与限制已内嵌本记录。
