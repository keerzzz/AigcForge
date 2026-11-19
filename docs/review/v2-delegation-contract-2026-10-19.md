# V2 委派事件契约验证 — 2026-10-19

工作区 `/home/keer/workspace/aigcfroge-v2`，分支 `v2-dev`。本切片只新增 Schema/Core 的 `delegation-event.test.ts`，扩展 Schema `event-manifest.test.ts`；生产 source、generator 和另一个 agent 所有的 `delegation-projector.test.ts` 未修改，无提交、无远程操作。

协议与技能沿用已读取的 V2 `AGENTS.md`、主仓 `CLAUDE.md`、Effect/enterprise-code-standard/reuse-first-refactor skills，本切片另外读取 `packages/schema/AGENTS.md`。复用 canonical `Event`、`optional`、现有 codec 和 registry，不新建 Schema、registry 或 public event generator。

## 契约与分类

委派事件分类为 **shared transitional retained domain**。本批 admission/query 需要持久日志解码，没有当前客户端 SSE 消费需求。23 个 canonical definitions 进入 Durable registry；不加入 Server/Latest。

决定关系的函数为 `packages/schema/src/event.ts:178` 的 `durableMap`：用 `versionedType(type, durable.version)` 建 key，重复 key 会抛错，并将原 definition 对象放入 map。Schema/Core exact identity 来自 `packages/core/src/delegation/event.ts:1` 的直接 re-export；测试使用 `toBe` 验证，不从两处输入的文本相似推断。公开边界由 `packages/schema/src/event-manifest.ts:71` 的 ServerDefinitions 和 `:86` 的 Definitions 决定，两者没有委派定义，`Server`/`Latest` 分别从它们生成。

## 已覆盖行为

- 所有 23 个定义都在 durable registry，版本 key 精确匹配，definition 对象与 canonical 值完全相同，每个只出现一次；version=1，aggregate=`delegationID`，identifier 固定为事件 type。
- Core facade 的 namespace、Definitions、全部 runtime 导出、事件 definition 和 `.data` 均为 canonical Schema 的同一对象，没有重建 Schema identity。
- 每个事件的有效 payload、durable v1 envelope 可 encode/decode 往返；v2 envelope 必须拒绝。
- 事件可选 payload 以显式 `undefined` 编码时省略 key；三个 review verdict 的 nested finding 可选 file/line/message 同样省略。
- Delegation.Info、ParticipantInfo、TurnInfo 的全部可选字段在原 codec、HTTP `toCodecJson` 和 JSON string 编码中省略；JSON 解码后回到原 codec 的语义值一致。
- manifest 旧 key inventory 的新委派部分从 `DelegationEvent.Definitions` 经 `Event.versionedType` 生成，避免手写 23 个新 durable key。
- ServerDefinitions、Definitions、Server、Latest 均没有委派事件；没有扩展 current SSE 面。

可选字段省略由 `packages/schema/src/schema.ts:18` 的 `optional` 决定，其 encode transform 过滤 undefined。该 helper encoded 侧区分字段缺失与显式 undefined；省略测试直接执行 encoder，decode 测试输入用有效 wire shape。Class record 测试保留 decoder 返回的实例，在实例上设置 undefined；不能 spread 后把 plain object 当 Class value 送入 encoder。

## 实际命令与证据

测试全部从对应 package 目录运行，固定 `../../script/bun` 为 1.4.2。本次续跑使用 package 的 `run test` 入口；既有直接 `test` 命令保留为历史证据。每个完整命令、cwd、退出码、是否超时和耗时在 `docs/review/evidence/v2-delegation-contract-2026-10-19/` 同名 `.json` 与 `.log` 中。

| 通过验证               | 命令或范围                                                                                                                                     | 实际结果                                                         | 证据                                 |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------ |
| Schema 契约续跑        | cwd=packages/schema；`../../script/bun run test --timeout 30000 test/delegation-event.test.ts test/event-manifest.test.ts`                     | exit 0；35 pass / 0 fail / 439 expect() calls                    | `schema-contract-resumed.{json,log}` |
| Core exact facade 续跑 | cwd=packages/core；`../../script/bun run test --timeout 30000 test/delegation-event.test.ts`                                                   | exit 0；1 pass / 0 fail / 97 expect() calls                      | `core-facade-resumed.{json,log}`     |
| Schema 既有三文件回归  | cwd=packages/schema；`../../script/bun test --timeout 30000 test/delegation-event.test.ts test/event-manifest.test.ts test/delegation.test.ts` | exit 0；43 pass / 0 fail / 486 expect() calls                    | `schema-contract-final.{json,log}`   |
| 固定 runtime           | cwd=packages/schema；`../../script/bun --version`                                                                                              | exit 0；1.4.2                                                    | `bun-version.{json,log}`             |
| 三个测试范围 oxlint    | root 下只查本切片三文件                                                                                                                        | exit 0；0 warnings / 0 errors；当前仓库对该范围启用 1 条通用规则 | `lint-final.{json,log}`              |
| 测试与报告 Prettier    | root 下查本切片三个测试与报告                                                                                                                  | exit 0；格式符合项目配置                                         | `format-evidence-final.{json,log}`   |

历史失败单独记录：

| 失败轮次             | 实际结果                                   | 根因与修复                                                                                                                                                                            | 证据                                                                    |
| -------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 旧 manifest baseline | exit 1；6 pass / 1 fail / 68 assertions    | durable key inventory 缺少 23 个新委派事件，补 canonical Definitions 生成的 key。                                                                                                     | `manifest-baseline.{json,log}`                                          |
| 合同测试初稿         | exit 1；11 pass / 21 fail / 324 assertions | 测试先 decode 显式 undefined，把 decoded 内存 shape 错送到 encoded wire 侧；改为直接 encode omission，未放宽生产 decoder。                                                            | `schema-contract-initial.{json,log}`                                    |
| 查询记录测试初稿     | exit 1；32 pass / 3 fail / 416 assertions  | spread Class 实例成 plain object 后 encoder 拒绝 `Expected Delegation.Info/ParticipantInfo/TurnInfo`。保留真实 Class 实例后 35/0/439，再扩展现有委派 Schema 回归后得到最终 43/0/486。 | `schema-record-initial.{json,log}`、`schema-record-instance.{json,log}` |

`summary.json` 自动读取完整命令记录、提取日志计数，并记录本次收尾时的 source/test hash。续跑验证当前 canonical Schema 与 Core facade；三文件回归的 43/0/486 是已留存结果，本次没有重跑第三个文件。缺少同名 JSON 的 `report-format-final.log` 属于中断 capture，不作为成功证据；完整 Prettier capture 已补齐。`git diff --check` 对 tracked manifest test exit 0；两个新增测试仍为 untracked，另执行行尾空白与 Prettier 检查，不能把空 tracked diff 称为全部验证。

## 未交付范围

| 范围                                                                | 状态                                                                                             | Owner                              | 解除条件                                                                                  |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------- | ----------------------------------------------------------------------------------------- |
| 生产 Service/HTTP、真实 durable append、projector/rebuild、发布 API | 本切片仅验证契约和 canonical facade，不修改或声明其集成测试通过。                                | 主智能体及 Service/projector agent | 在统一生产图运行真实 admission/query 与投影回放测试，独立登记退出码和计数。               |
| 类型检查与全仓门禁                                                  | 主智能体统一运行；本切片没有重复启动构建。                                                       | 主智能体                           | 完成本批 source/test/generator 集成后运行单包及全仓检查。                                 |
| 当前客户端 SSE 的委派事件                                           | 未交付，也没有本批需求。                                                                         | 委派客户端 owner                   | 明确当前客户端消费事件的契约和用例，先分类，再决定 curated Server/Latest 与客户端生成面。 |
| durable aggregate 字段与 envelope 值一致性的运行时校验              | 本切片断言 definition aggregate 固定、有效 fixture envelope 值一致；没有新增跨字段 Schema 规则。 | Bus/Service owner                  | 在真实事件写入与 replay 路径验证 aggregate 归属；该责任不应被合同 fixture 冒充。          |

复查：所有新增测试使用实际 canonical encoder/decoder，没有复制规范实现、创建第二 Schema、绕过 Event.data 编码或扩大 SSE 面。类型门禁、HTTP 和 projector 验证须采用它们各自的实际证据。
