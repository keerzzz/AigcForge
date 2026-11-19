# V2 接续检查点（2026-10-20）

实现目录 `/home/keer/workspace/aigcfroge-v2`，分支 `v2-dev`。本批基准 `1a02c0e44e459bbec981b4edfd85ced533b32b89`。运行时为项目 `script/bun` 的 Bun 1.4.2。测试均从对应包目录执行；根目录只执行 canonical lint/typecheck `check`。

本批完成资产 YAML 运行时归一、跨 Session 分享工具、Custom Profile CRUD、workspace routing、Delegation 持久准入与查询，以及 OpenAPI 生成修复。Delegation execution/recovery、Workflow 执行、Custom resolver/snapshot、AI 适配、客户流程、Desktop 和隔离数据库升级仍未交付，登记在 [技术债账本](../technical-debt.md)。本地检查点不是整体迁移完成声明。

## 交付范围

| 范围            | 最终行为与决定函数                                                                                                                                                                                                                                                                                    |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| YAML            | 七个资产 owner 复用 `AssetYaml.parse/stringify`；真实 Node/Bun probe 通过。语义兼容与字节兼容分别登记，见 [YAML 报告](v2-yaml-resumption-2026-10-19.md)。                                                                                                                                             |
| 分享            | `SessionShareV2.share` 调用 `Session.synthetic`，先持久 inbox 后 advisory wake；生产 `PluginInternal` 注册真实工具，叶权限沿既有 Permission。见 [分享清单](v2-remaining-inventory-2026-10-19.md)。                                                                                                    |
| Custom Profile  | Location nodes 进入 `Instance`；生产 handler 调用现有读写服务；保留路径验证、revision CAS、原子写入和回滚。Schema Class 响应由真实 HTTP 测试覆盖。                                                                                                                                                    |
| 路由            | `workspaceRoutingLayer` 和 `instanceContextLayer` 复用 LocationServiceMap、Environment、Workspace.exists；显式远程 workspace 拒绝，不提供伪造本地上下文。见 [路由报告](v2-workspace-routing-2026-10-19.md)。                                                                                          |
| Delegation 准入 | Schema 统一 durable 事件；Bus manifest 可解码；真实 projector 和唯一 Service 接入 Server。`serialized` (`packages/core/src/delegation/service.ts:183`) 决定同 Delegation mutation 顺序；`requireBinding` (`:226`) 统一 add/bind 的 child/thread 所有权规则。准入 Turn 与 fanout Delivery 同事务提交。 |
| Bus             | `publishAll` (`packages/core/src/bus.ts:634`) 在同事务保留逐项历史前缀；新 aggregate 的 sequence FK 在首事件插入前建立；通知仍在 commit 后。真实 rollback、fanout 和重建回归通过。                                                                                                                    |
| Client 测试     | `packages/client/test/service.test.ts:451` 的 startup replacement 测试用既有 controlled fixture 和就绪信号建立次序，删除 500ms 调度假设；没有修改生产 lifecycle。                                                                                                                                     |
| OpenAPI         | 六个 `/pty` 端点用 `OpenApi.Override` 唯一化文档 operationId，保留原 Identifier。客户端路径由 `clientEndpointPath` (`packages/httpapi-codegen/src/index.ts:972`) 决定，编译读取原 Identifier (`:177`)；生成文件 hash 与修复前一致。                                                                   |

官方 Protocol generate 补齐此前陈旧的生成文档：HEAD 为 118 paths / 142 operations / 282 schemas，最终为 291 / 340 / 741。没有删除原路径；原有路径上的 operationId 没有变化。新增保留端点也包括仍明确拒绝执行的占位契约，文档出现端点不代表该业务已实现。`check:generated` exit 0。

## 实际验证

命令、cwd、退出码及日志 SHA256 见 [verification.json](evidence/v2-resumption-2026-10-20/verification.json)。表内 tally 来自日志，不将失败、skip 或中断日志合并为绿色。

| 范围                    | 实际结果                                                                                                                                 |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Schema 全包             | exit 0；350 pass / 0 fail / 1225 expect；41 files。                                                                                      |
| Protocol 最终全包       | exit 0；10 pass / 0 fail / 41 expect；4 files。                                                                                          |
| Server 全包             | exit 0；99 pass / 1 skip / 0 fail / 6030 expect；33 files。保留 MaxListeners 警告。                                                      |
| Core 宿主环境全包       | exit 1；7015 pass / 365 skip / 11 fail / 107230 expect。11 项 GitLab OAuth 回调与宿主 8080 占用相对应。                                  |
| Core 独立网络全包       | exit 0；7026 pass / 365 skip / 0 fail / 107542 expect；353 files。保留 UID 1000，启用 loopback 后清除 capability；未停止宿主端口占用者。 |
| Client 最终全包         | exit 0；224 pass / 0 fail / 906 expect；20 files。OpenAPI 修复后再次运行，结果相同。                                                     |
| Delegation binding 回归 | RED exit 1，23 pass / 1 fail / 160 expect；统一规则后 GREEN exit 0，24 pass / 0 fail / 161 expect。                                      |
| 官方生成                | Protocol generate、Protocol check:generated、Client generate 均 exit 0。                                                                 |
| 单包 typecheck          | Schema、Core、Protocol、Server、Client 最终均 exit 0；历史失败保留于 manifest。                                                          |
| 最终根 check            | exit 0；19 successful / 19 total，0 cached。lint 为 1487 warnings / 0 errors；另有 unused suppression 提示。                             |
| 最终格式与范围 lint     | Prettier 首次 exit 1，格式修复后 exit 0；范围 oxlint exit 0，0 warnings/errors，仅启用 1 条规则，不声称完整风格审计。                    |

失败记录仍保留：Core 两轮 typecheck exit 2；Client 首次全包 223 pass / 1 fail；Protocol 原测试 8 pass / 1 fail，新增回归 RED 8 pass / 2 fail；初次格式检查 exit 1。此前中断且无 tally/exit 的 Core 日志不作通过证据。三个接续子智能体均因上游资源错误结束，主智能体接管；不计作独立复核通过。

客户端生成 SHA256：

```text
9a97df70da2d9e1f606abce871f1e2ef3aaacf64359494f1ac6b3a83397f8954  packages/client/src/promise/generated/types.ts
b67467ad5a768f8cd0a6e3eecdba5466ddb37163a9bd488e35e52e5ae0c2c064  packages/client/src/promise/generated/client.ts
```

## 下一切片

委派多次投递必须按目标 Session 输入结算，不能将最后 20 条消息中的最后 assistant 当作每次 Delivery 的结果。决定边界的是 `SessionStep.attempt` (`packages/core/src/session/runner/step.ts:285`) 的实际 continuation 判断，执行终态只覆盖整个 busy period (`packages/core/src/session/execution.ts:128`)。下一切片先建立 Session 自有的可恢复结果归属，再复用 Job/Session 执行；不新增 runner、registry 或投递状态表。详细边界见 [执行设计](v2-delegation-execution-boundary-2026-10-20.md)。

提交清单须由 `git log --oneline 1a02c0e44e459bbec981b4edfd85ced533b32b89..HEAD` 生成。授权仅覆盖本地实现、验证与检查点；不包含远程交付或生产数据变更。
