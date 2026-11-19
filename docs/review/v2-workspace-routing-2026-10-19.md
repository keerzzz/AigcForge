# V2 Workspace 路由切片（2026-10-19）

实现工作区：`/home/keer/workspace/aigcfroge-v2`；分支：`v2-dev`。Owner：runtime 子智能体；主智能体负责集成、账本和提交。

## 已实现行为

- `packages/server/src/middleware/workspace-routing.ts:27` 替换 WorkspaceRouting stub。读取 flat `directory` / `workspace` query；目录优先级由 `:36` 决定：非空 query、百分号解码一次的 `x-aigcfroge-directory`、进程 cwd。相对目录由 `locationRefForRoute`（`:18`）按当前平台 `path.resolve` 归一化，再交给既有 `LocationServiceMap.canonical`（`packages/core/src/location-service-map.ts:39`）。query 的 URL 解码结果不会再次解码，保留文件名中的字面 `%2F`。
- workspace 使用既有 `Workspace.ID` schema；无效 ID、NUL 目录、重复 query 返回声明的 400。Protocol 上下文只有目录和 workspaceID；未修改 Protocol schema，也未把 Core 服务隐藏进上下文。
- `instanceContextLayer`（`:54`）捕获现有 Workspace / LocationServiceMap。先检查逻辑工作区存在，再在请求 Scope 中借用 Location 图，使用该图的 `Environment.typeFollowing` 验证目录。缺失工作区、缺失目录、非目录及失效 symlink 返回既有 `ApiNotFoundError`，保留 `{ name: "NotFoundError", data: { message } }`。其他启动/provider 故障仍为 defect；取消不会转换成 404。
- `Workspace.exists`（`packages/core/src/workspace.ts:43`、`:262`）复用已有 `find`（`:97`），只查询持久 Workspace 行，不调用 provider、不新增 registry 或数据库表。必须有这个边界：`Workspace.connect`（`:266`）返回惰性包装；实际文件操作才获取连接（`:303`），调用 connect 本身不能证明工作区存在。初版 Server 直接 import Drizzle 无法解析，已删除；Server 没有新增 Drizzle 依赖。
- 生产装配改为 `packages/server/src/routes.ts:187` / `:188` 的真实 Layers。真实 Handler 明确使用 `locations.contextEffect(locationRefForRoute(route))` 和 `Effect.provideContext`。`InstanceContext` 自身不声明提供 Core services；不依赖类型 cast 来掩盖服务要求。

## 验证证据

日志和退出码记录在 `docs/review/evidence/v2-workspace-routing-2026-10-19/verification.json`。测试均通过永久项目启动器，日志实际为 **Bun 1.4.2**。网络隔离仅打开 namespace loopback，不读取用户全局 config。

| cwd               | 命令                                                                                                                                                                                                                         | 退出码与结果                                  |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `packages/core`   | `unshare -Urn sh -c 'ip link set lo up && exec ../../script/bun run test --timeout 30000 test/workspace.test.ts'`                                                                                                            | exit 0；22 pass / 0 fail / 80 expect；8.79 秒 |
| `packages/server` | `unshare -Urn sh -c 'ip link set lo up && exec ../../script/bun run test --timeout 30000 test/workspace-routing.test.ts'`                                                                                                    | exit 0；5 pass / 0 fail / 42 expect；3.82 秒  |
| repo root         | `./script/bun x oxlint packages/server/src/middleware/workspace-routing.ts packages/server/src/routes.ts packages/server/test/workspace-routing.test.ts packages/core/src/workspace.ts packages/core/test/workspace.test.ts` | exit 0；0 warnings / 0 errors                 |
| repo root         | 同五文件 `./script/bun x prettier --check ...`                                                                                                                                                                               | exit 0                                        |
| repo root         | `git diff --check`                                                                                                                                                                                                           | exit 0                                        |

**类型检查待最终轮，不能将本报告当作全部绿色验收。** 第二次 Server `../../script/bun typecheck` exit 2：CustomProfile 测试 fixture 的 Name / Description 品牌字段两条错误，以及本路由测试直接调用可选 MemoryDriver overrides 的四条错误；后者已改用 `Environment.makeFiles`。首轮更早的 typecheck 遇到并发 share 实现的 Core 循环，以及 CustomProfile handler 的 Layer API / 品牌字段问题；已向各 owner 反馈，不归因于 baseline，不记为绿色。`typecheck-first.log` 保留第二次检查的完整输出，最终轮单独记录。

真实覆盖来自 `packages/server/test/workspace-routing.test.ts`：

- `:147`：相对目录、路径段规范化、带空格与字面 `%2F` 的目录、header 一次解码、query 优先和 cwd；等价目录由 `locationRefForRoute` / `canonical` 决定并命中同图；请求 header 保留到真实处理器。
- `:175`：无效 workspace、query/header NUL、重复 directory/workspace 400；未创建任何 Location 图。
- `:202`：真实 `/custom-profile` 在目标校验前认证；未认证的无效/未知 workspace 均 401，未建图；认证后分别 400/404，本地目标返回真实空资产集合。
- `:228`：未知工作区 404 且未建图；目录从缺失到创建恢复；普通文件 404、目录 symlink 成功、删除已缓存目录及 dangling symlink 后重新拒绝；生产 `/custom-composition/health?path=test` 经过真实中间件到达 business `not_implemented`。
- `:261`：真实 Workspace 创建、持久存在性与销毁；两个 workspace 的同目录分别读出不同 MemoryDriver 内容，且该目录在 host 不存在；每个 workspace 只创建/连接一次，workspaceID 决定独立 Location key。
- `:323`：持久工作区的 provider 未注册、create/connect/stat 失败均返回 500；每次恢复同一个 workspace ID；持久存在性不依赖 provider；最终 Environment 读出真实文件，只有一个 Location 缓存键。
- `:386`：Deferred 确认处理器启动，AbortController 取消后 finalizer 被触发并收到 499；后续请求成功。无定时 sleep 等待。
- `packages/core/test/workspace.test.ts:95`：未知、未 provision、销毁后的 exists；存在性查询未调用 provider。

这组测试在 `setup`（`:49`）先构造完整 `createRoutes` 图，再注册一个真实 HttpApi Probe consumer，共用生产 HttpRouter、Workspace 和 LocationServiceMap。生产 composition endpoint 另外验证真实装配。Probe 是测试处理器，不代表尚缺业务端点已实现。

## 保留失败证据

- `routing-first.log`：exit 1；1 pass / 4 fail / 20 expect。三处测试将 `RcMap.keys` 的 Iterator 用作有 length 的数组；另一次 Probe 响应 decode 对缺少 optional 字段的断言不匹配。已用 `Array.from` 和现有 `Location.Ref` 契约修正。
- `routing-second.log`：exit 1；2 pass / 3 fail / 28 expect。Probe 自制 response schema 的 `optionalKey` 不接受 route 上的显式 `workspaceID: undefined`，被全局 schema-error transform 返回 400。Probe 复用 `Location.Ref` 后最终轮全部通过；生产中间件未为这个测试错误新增兼容逻辑。
- 定向测试不与其他切片的统计相加；没有运行 Core/Server 全量套件，没有推送或提交。

## 未交付范围与技术债

当前适配采用已有 Location / Environment owner。不是旧 `WorkspaceAdapterRuntime`、Fence 或跨 server HTTP/WebSocket proxy 的移植。该旧 control-plane 边界仍需独立产品与架构裁决；不能由一个成功路由请求推导为 remote API proxy 完成。

Workspace 下 `core/filesystem.ts:121` 的 boot-only host realpath 跳过已有，但实际 read/list 仍访问 host（既有 #44568）。本测试证明 Environment placement 与读操作，未证明所有 filesystem endpoint 可远端执行。

| 未交付范围                                       | Owner                                  | 解除条件                                                                                               |
| ------------------------------------------------ | -------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 旧控制面 proxy/Fence 与远端 HTTP/WebSocket 契约  | Server/Core，业务歧义由项目 Owner 裁决 | 明确旧 contract 的保留/替代决定；实现真实远端请求、授权与取消验证                                      |
| workspace filesystem API 完整环境适配（#44568）  | Core/FileSystem                        | 所有实际文件操作使用该 placement 的 Environment 或既定替代 owner；真实 workspace 文件端点回归          |
| 仍为 business stub 的 legacy instance endpoints  | 各 Phase C/D owner，主智能体集成       | 每个 handler 的真实 service、生产装配及用户流程测试完成                                                |
| 全量检查、E2E、桌面及迁移演练                    | 主智能体                               | 同一运行时完成各套件与隔离数据库副本验收；本定向证据不能替代                                           |
| Workspace 冷唤醒中 HTTP abort 等待 provider 完成 | Core/Workspace，主智能体集成           | 可中断冷获取，保持共享 provision、锁、active/refcount、destroy/idle/reconnect 契约；真实 HTTP 中断回归 |

以上范围保留在已有 `docs/technical-debt.md` 的 V2-SERVER-LEGACY / V2-D-COMPOSITION / V2-VALIDATION；主智能体更新具体 owner 与解除条件后关闭本切片。当前报告不关闭整个 V2 目标。

## 2026-10-19 接续复核

本轮保留已有 middleware 和 `Workspace.exists` 实现，仅增强 Server/Core 回归与证据。独占变更范围为两个测试文件、本报告及 `docs/review/evidence/v2-routing-resumption-2026-10-19/`。未改 `routes.ts`、`handlers.ts`、`instance.ts`，未提交、未执行远程操作。

复用裁决如下。主仓 CLAUDE、Effect/reuse-first-refactor 技能及 V2 `AGENTS.md` 已读。

| 候选                    | Evidence                                                                                                                                                                                                                                                                                                                               | Compatibility                                                            | Decision / Reason                                                                                        |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| 目录归一化与缓存键      | `locationRefForRoute`（`packages/server/src/middleware/workspace-routing.ts:18`）、`canonical`（`packages/core/src/location-service-map.ts:39`）；`RcMap.get`（`packages/server/node_modules/effect/src/RcMap.ts:535`）按键调用 `MutableHashMap.get`，其 Equal 比较见 `packages/server/node_modules/effect/src/MutableHashMap.ts:1598` | 保持 directory + workspaceID；相对目录先 `path.resolve`                  | 保留 owner；真实两 workspace 同路径读出不同内容，等价本地目录只有一图                                    |
| 请求上下文与服务借用    | `LayerMap.contextEffect` 通过 `RcMap.get` 请求 Scope 借用；`Effect.provideContext` 合并边界见 `packages/server/node_modules/effect/src/internal/effect.ts:2285` 与 `Context.merge`（`packages/server/node_modules/effect/src/Context.ts:1778`）                                                                                        | 提供 Location services 并保留 HttpServerRequest/WorkspaceRouteContext    | 保留显式 consumer，Probe 请求 marker 与 Location ID 实际验证；不新增 Protocol services 或 unchecked cast |
| 持久存在性              | `Workspace.exists`（`packages/core/src/workspace.ts:262`）复用 `find`（`:97`）；`connect`（`:266`）只造 lazy wrapper，实际获取见 `:303`                                                                                                                                                                                                | provider 未注册仍能查询已有 Workspace 行                                 | 保留轻量域边界；Core 现有 provider 缺失用例增添 exists 与未调用 driver 断言                              |
| 404 / 500 分类          | `instanceContextLayer`（`packages/server/src/middleware/workspace-routing.ts:54`）只把 DirectoryNotFound、Environment.NotFound、由 Workspace.NotFound 包裹的 Failed 映射为 404；其他 Failed 为 defect                                                                                                                                  | provider 未注册及 create/connect/stat 故障保留服务器失败；不误报目标缺失 | 保留分类；新增真实 HTTP 500→恢复同 ID 回归                                                               |
| 旧 flat/header 目录逻辑 | 当前嵌套 Location query owner 为 `packages/server/src/location.ts:86`；flat Workspace query 契约在 Protocol middleware；主仓旧 routing 同时包含 retired control-plane                                                                                                                                                                  | 两者的 query schema、Workspace 身份与错误契约不同                        | 保留本适配；不提取一个一次性万能 route helper，不复制 retired runtime                                    |

最终命令结果存于新目录的 `verification.json`；每条命令有独立 argv/cwd/exit 记录与完整日志。未将前后轮计数相加。

| cwd               | Command                                                                                                                                                                                        | Exit / Result                                                   |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `packages/core`   | `unshare -Urn sh -c 'ip link set lo up && exec ../../script/bun run test --timeout 30000 test/workspace.test.ts'`                                                                              | 0；22 pass / 0 fail / 0 skip / 82 expect；`workspace-final.log` |
| `packages/server` | `unshare -Urn sh -c 'ip link set lo up && exec ../../script/bun run test --timeout 30000 test/workspace-routing.test.ts'`                                                                      | 0；7 pass / 0 fail / 0 skip / 70 expect；`routing-final.log`    |
| repo root         | `./script/bun x oxlint packages/server/src/middleware/workspace-routing.ts packages/server/test/workspace-routing.test.ts packages/core/src/workspace.ts packages/core/test/workspace.test.ts` | 0；0 warnings / 0 errors；4 files；`lint-after-review.log`      |

`../../script/bun typecheck` 本轮由主智能体统一执行。主智能体明确保留 tsgo project-reference 共享缓存，路由子智能体没有并行执行；本报告不声称类型检查通过。全量 lint/check、单包全量套件、E2E、桌面与迁移演练也未执行。

冷唤醒取消是保留失败，不属于上表绿轮。`cold-wake-diagnostic.test.ts` 在 evidence 目录，需从 Server 包显式选择，未注册到包内自动测试 glob。它通过真实 `/custom-profile` router 与 Deferred 确认 driver.create 已启动，触发 AbortController 后等待结果的 2000ms 有界超时；`Effect.ensuring` 释放 gate，再检查取消请求结束。实测 `cold-wake-diagnostic-second.log`：exit 1，0 pass / 1 fail / 2 expect；输出 `completed_within_bound:false`，释放 gate 后状态 499。初次诊断 fixture 的 Effect 路径解析错误另外保留在 `cold-wake-diagnostic.log`，不当作产品失败。

根因位于既有 `Workspace.connect` 的 `Effect.acquireRelease`（`packages/core/src/workspace.ts:267`），acquire 覆盖 provision 与 open。Effect 默认将整个 acquire 遮罩成不可中断，规则见 `packages/server/node_modules/effect/src/internal/effect.ts:4134`；现有 `TODO(workspace-plan)`（`workspace.ts:364`）已延后可中断冷唤醒。主智能体要求保留该生命周期边界，本轮未扩大为 RcMap/Workspace 重构。简单适配继续复用现有 owner；健壮方案需要保持 provision 共享尝试、连接 lock/Scope、active/refcount、idle 与 destroy 契约，不能仅将诊断失败改为 skip。Owner 与解除条件已列入本报告，交主智能体登记 `V2-SERVER-LEGACY`。
