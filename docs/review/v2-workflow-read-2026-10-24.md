# V2 Session 快照与 Workflow 状态读取检查点（2026-10-24）

实施目录 `/home/keer/workspace/aigcfroge-v2`，分支 `v2-dev`，接续点 `d3b433f247`。本批关闭两个只读端点及其 JSON/客户端合同；Workflow 执行仍开放。检查 start time 使用 UTC，报告日期使用 Asia/Shanghai。

## 已交付

`GET /session/:sessionID/composition` 与 `GET /session/:sessionID/workflow` 使用既有 Session/Location 归属检查。前者读取 SessionComposition；缺快照返回 404，坏快照返回固定的 400 诊断。后者读取最新 run 和 steps，无 run 返回 `{ steps: [] }`。V1/V2 快照仍可读，不推进 Workflow frontier、不调用执行服务。

决定函数：`SessionInstanceHandler`（`packages/server/src/handlers/session-instance-stubs.ts:143` / `:157`）复用 `requireSession`；`SessionComposition.get`（`core/src/session/composition.ts:363`）保留历史读取；`WorkflowRun.getBySession`（`core/src/workflow/workflow-run.ts:431`）按 session_id 选择，`getSteps`（`:442`）返回 owner 状态。WorkflowRun.node（`:1613`）复用 Database/Bus，全局服务由现有 routes 应用图提供。没有将主仓的 Location layer 或旧 TaskDriver runtime 回植。

真实 HTTP 暴露了旧响应模型的类型/JSON 错位：Schema.optional 的 undefined 被 JSON codec 编成 null，而 Promise 客户端把原始 JSON 当作不含 null 的类型返回。`HttpApiEndpoint.applyResponseEncoding` 调用 Schema.toCodecJson；`SchemaAST.Undefined` 的 JSON codec 执行 undefinedToNull。生成器 `normalizeTransport`（`packages/httpapi-codegen/src/index.ts:1303`）决定返回 decoded Schema 还是原 codec，`renderPromiseTypes`（`:815`）投影编码类型；本批没有修改生成器。

`WorkflowRunInfo`、`StepRunInfo`、`WorkflowStatusResponse` 的 15 个可选字段现在复用 `packages/schema/src/schema.ts:18` 的 canonical optional。Type 仍接受 undefined，编码省略缺省字段。三个 Class 内的同一 Struct 标注既有 identifier，沿用 Delegation 的配方，保留 WorkflowAssetWorkflowRunInfo、WorkflowAssetStepRunInfo 和 WorkflowAssetWorkflowStatusResponse 三个已公开类型名。没有新建并行 Schema 或手改生成物。

方案对冲：在 handler 手工删除 null 会重复 Schema 规则，通用改写生成器会扩大所有 API 的兼容影响。本批修正现有响应 owner 和编码名称，生成客户端继续使用当前官方工具。其他领域的同类可选字段/transport 差异不计为本批已验证。

## 验证

完整命令、cwd、退出码、源码/日志 SHA256 与历史差异见 [verification.json](evidence/v2-workflow-read-2026-10-24/verification.json)。使用项目 Bun 1.4.2，所有测试和类型检查按单包串行执行；Core/Client 全包使用保留当前 UID 的隔网环境。

- Core 最终全包：workflow-read-core-full-final，exit 0，7320 pass / 365 skip / 0 fail，364 文件。
- Server 最终全包：workflow-read-server-full-final，exit 0，134 pass / 1 skip / 0 fail，36 文件；保留已有 MaxListenersExceededWarning。
- Schema 全包：workflow-read-schema-checked，exit 0，361 pass / 0 fail，42 文件。
- Client 全包：workflow-read-client-full，exit 0，224 pass / 0 fail，20 文件。
- Protocol 全包：workflow-read-protocol-tests，exit 0，10 pass / 0 fail，4 文件。
- 新增读取 + Custom + Task HTTP 三文件：26 pass / 0 fail；涵盖 V1/V2、缺失/坏 JSON、脱敏、目录别名、鉴权/归属、空 run、ready/dispatching、原始 JSON 缺省字段、持久状态与 sequence 不变、隔离数据库关闭重开。
- Core、Server、Schema、Protocol、Client 单包 typecheck 均 exit 0。最终 Core Error 整理后再次检查及全包，Server 也再次全包。
- Protocol generate/check 与 Client 官方 generate exit 0；再次生成后客户端与 OpenAPI SHA256 不变，见 generated-proof.json。三个既有 Promise 类型名逐项确认仍存在。
- Prettier、最终 Effect ast-grep、git diff --check exit 0；7 个 TS 文件 oxlint 0 warning/error，当前该范围仅 1 条规则，使用 1 个线程。没有以 GUI-only 增量 lint 的空筛选作为证据。

失败记录单独保留：初次测试使用了错误的 Effect.Success 函数类型及旧 StepDef prompt 字段；Schema codec encode 的宽 Json 类型不能直接访问属性；已修正测试类型。初次 HTTP 误把 JSON codec 当普通 Schema 解码，又误把首 step 视为 pending；owner 实际创建 ready。三个 DTO 的 null 错位属于生产问题，已通过 owner 修复。首次生成内联删除类型名，已通过编码 identifier 恢复。最后专项命中旧 Effect.die(string)，改为 Error 后复扫与最终全包通过。早期成功不是最终源码验证，JSON 证据保留版本差异。

history_recent 子智能体实施限定三文件，并独立复核装配、DTO、生成类型和读边界；最终无新增阻塞。它还指出测试残留 null 断言，主智能体修正后联合/全包通过。未把子智能体静态复核计为独立复测。

## 未交付

本批仅关闭读取子范围。workflowRun、workflowCancelRun、workflowCancelStep、workflowRetryStep 四执行端点仍明确 not_implemented。WorkflowRunner/WorkflowExecution、Session/Job 适配、run/step CAS、取消、retry lineage、冷恢复和产品 UI 均登记在 V2-C-WORKFLOW。其他 TaskPanel/Work 调度、外部 CLI/attended/review、AI 与 remaining handlers、CI/发布及全产品验收继续保留。

未运行 canonical 根 check、产品 E2E、Electron/PTY 或真实数据库升级；隔离文件数据库重开不冒充存量升级演练。没有 push/PR/merge/release，也没有修改参考工作区的 UI 改动或用户数据。Task 更正与取消来源 unarchive 语义已经向用户提出待裁决问题，未按默认选项改变业务。

## 提交核算

```sh
git log --oneline d3b433f247..HEAD
```

以下为代码提交后、报告提交前实际输出：

```text
a50d4d2409 feat(server): expose composition and workflow status
```
