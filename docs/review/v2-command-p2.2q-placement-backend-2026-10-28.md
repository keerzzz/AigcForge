# P2.2Q Command 所选目标后端检查点（2026-10-28）

本片完成 Command 显式 Project/global/location 后端目标，准备限定本地提交。基线 `e9967a9dbc855d45fc2f7e2656172fd1f0fc50c7`，固定上游 `4617210822bdbb31e5749751afbfb4584ccedac8`；实施仓 /home/keer/workspace/aigcfroge-v2，分支 v2-dev。用户已授权实施、验证、独立复审和本地提交；不 push、merge 或部署。新 proposer 默认 Project 与 GUI 接线留给下一片同步交付，本片不声称 GUI 用户链完成。

## 实现与决定函数

- `packages/core/src/asset-placement.ts:41` 从有限 scope 选择服务端 owner，保留默认 Skill 族别；Command 显式使用 commands 目录。Project 取当前 Location.project.directory，各 worktree/clone 独立。`targetMismatch:74` 同时比较 scope/root，请求根只作相等证据。`resolveWithin:80` 保护 owner 下的文件和祖先，不接受目录重定向或悬空 symlink。
- `packages/core/src/command-asset.ts:234` 的 select 建立单 owner 视图，建图、inspect/list/content 不执行迁移或写 marker。`:179` 的缓存迁移和 `reload:195` 保留旧入口首次实际消费时的 Config/singular 来源、优先级及 marker；旧无参 API 继续 Location 语义。
- `packages/core/src/command-asset-service.ts:260` 的 inspect 返回 canonical Command Inspection。`apply:278`、`deleteAsset:346` 复用 FileMutation 的绝对路径整事务共享锁，锁内重验目标，比较原 revision，写前固定预期字节，完整 raw/semantic 回读。`rollback:198` 仅在当前字节仍属本次写入时恢复，外部重写或重建不被覆盖。selected delete 严格 CAS；旧无 target/null revision 删除及 missing 幂等保持。
- Schema 复用 canonical Target、Command 自己的 Revision 和已有 optional omission helper。Info.target 可省略，缺失 args 与空字符串分开；Core loader 不产生自有 args:undefined。Protocol 新增 inspect，list/content 加可选 scope，apply/delete 加可选 target。原 Session directory/workspace 校验在 `packages/server/src/handlers/asset-location.ts:27` 保留，target mismatch 为 400、资产 CAS 为 409。
- 原生同名覆盖关系由 `packages/core/src/config.ts:230` 的 entries 顺序、`packages/core/src/config/plugin/command.ts:73` 的注册顺序和 `packages/core/src/command.ts:61` 的 Map.set 共同决定；实际消费经 `packages/core/src/session/command.ts`。native Info 只有名称和描述，正文赢家以同一 Session 的最新模型 user 正文断言证明。Composition sourceLocation 和已冻结正文没有改变。

精确源码/测试/生成写集为 [files.json](evidence/v2-command-placement-backend-2026-10-28/files.json) 的 21 个路径。最终候选、决定 owner 和每轮原始日志绑定见 [manifest](evidence/v2-command-placement-backend-2026-10-28/validation-manifest.json) 与 [source pins](evidence/v2-command-placement-backend-2026-10-28/source-pins.json)。Config、Watcher、FileMutation、Session、Composition 生产实现及 Command proposer 未改。

## 实际验证

root 在隔离验证仓串行执行，固定 script/bun 1.4.2；测试在包目录，类型走包脚本并限 GOMAXPROCS=2/GOMEMLIMIT=3GiB。隔离 HEAD/index 较旧，每轮工作文件哈希才是执行源码依据；不把 staged reference tree 当本片基线。以下 tally 从原始日志机械生成，不相加。

| 记录 | exit | 原始 tally | 相对最终绑定的路径差异 |
| --- | --- | --- | --- |
| `core-related` | 0 | 156 pass; 0 fail; 1173 expect() calls; Ran 156 tests across 7 files. [7.52s] | `packages/schema/src/command-asset.ts`, `packages/schema/test/asset-placement.test.ts`, `packages/server/test/command-asset.test.ts`, `packages/server/test/fixture/asset-http.ts`, `packages/protocol/openapi.json`, `packages/client/src/promise/generated/types.ts`, `packages/client/src/promise/generated/client.ts`, `packages/client/src/effect/generated/client.ts`, `packages/client/src/effect/api/api.ts` |
| `schema-full-repaired` | 0 | 401 pass; 0 fail; 1485 expect() calls; Ran 401 tests across 44 files. [1003.00ms] | `packages/server/test/command-asset.test.ts` |
| `server-full-final` | 0 | 184 pass; 1 skip; 0 fail; 8632 expect() calls; Ran 185 tests across 44 files. [100.65s] | `packages/schema/test/asset-placement.test.ts`, `packages/server/test/command-asset.test.ts` |
| `server-command-repaired` | 0 | 14 pass; 0 fail; 661 expect() calls; Ran 14 tests across 1 file. [40.50s] | 无 |
| `client-full-final` | 0 | 229 pass; 0 fail; 968 expect() calls; Ran 229 tests across 20 files. [36.47s] | `packages/schema/test/asset-placement.test.ts`, `packages/server/test/command-asset.test.ts`, `packages/server/test/fixture/asset-http.ts` |

Core 相关回归后的生产差异仅为 Command Summary/InvalidEntry 的编码 identifier；该命名修正已通过 Schema 全包、正式生成、Client 全包和 Server 全包。Server 全包后仅修正 Schema/Command 测试的类型期望和动态 import，最终 Command keeper 已重跑；生产实现保持。其它较早记录与最终绑定的差异完整保留在 manifest，不能据较早轮声明整个最终树已运行全包。

八项类型检查分别通过：Core、Schema、Protocol、Server、Client、GUI、App、App E2E。Client tsconfig 现纳入已有 test/api.types.ts，build tsconfig 仍只包含 src。Protocol check:generated 通过；Client 现有 check:generated 在独立临时 index 上比较正式产物，通过且重生成前后哈希相同，未改普通 index。四个 Client 文件的所有旧公开名称保留，仅增加 inspect 相关名称，见 [公共名称差集](evidence/v2-command-placement-backend-2026-10-28/public-type-preservation.json)。

15 个手写 TypeScript 文件的 scoped oxlint 为 0 warning/0 error，AST exit 0；21 文件 Prettier 和显式本片基线 diff --check 均 exit 0。GUI 专用 lint-changed 使用显式基线但没有匹配 GUI 文件，不把这条空范围记录当作后端 lint 证据。AST 的 runtime binary fallback 警告、Server 既有 MaxListenersExceededWarning 和 hg skip 保留；不声称无警告或全部用例运行。

## 真实链与失败归因

真实 Web Request handler、文件系统、SQLite、两个活 Location、原生 Watcher 与 TestLLM 覆盖四拓扑：Project commands 已存在、仅 commands 缺失、整个 Project .aigcfroge 缺失、global commands 缺失。每次写前安装原生监听并等真实 onReady，不注入额外 commands 路径，不手工 reload/emit，不用探针或重试写催发现。16 次 mutation 和 3 次同 Session 消费的原始 JSON 样本见 [最终观察索引](evidence/v2-command-placement-backend-2026-10-28/watch-observations-final.json)；正文只输出哈希，原源码保留严格正文断言。

同名同描述、不同 source 的 Project/global 用例证明：global 保存后同一 Session 仍消费 Project；删除 Project 后消费 global；全删后 command 返回 404，没有新增 input/provider 工作。这是 Web Request 与 TestLLM 证据，不是 TCP、GUI、外部 provider、进程崩溃恢复或 Desktop 验收。

失败与修复分别保留：

1. 基线红包括缺 inspect/select/target、旧整事务锁/回滚行为和 Effect optional revision 编码为 null；按实际报错分组记录在 red-analysis.json，不把接口缺失与行为失败合计为同类。
2. Promise fetch 夹具原丢 RequestInit，修正后原 legacy keeper 通过；其余 inspect 和 Effect 编码红继续保留。Client 首次 typecheck 未包含 api.types.ts，不能算类型合同证据；纳入后记录真正的类型红及最终绿。
3. Core loader 原自有 args:undefined 导致新 omission codec 下 HTTP 500；在产生对象的源头省略该属性，保留空串与旧无 args wire。raw Target 与 Class 比较、Revision identifier 读取、EISDIR 和测试品牌期望分别作为夹具失败修复，没有放宽产品 schema 或完整断言。
4. 首次正式生成丢失旧 CommandAssetSummary/CommandAssetInvalidEntry；给原 Schema 输入 Struct 保留稳定 identifier 后正式重生成。决定引用匿名内联的函数是**隔离生成源** `packages/httpapi-codegen/src/index.ts:1040` 的 structuralTypes 和 `:1183` 的 normalize；实施仓该文件有原 WIP，不能用其行号解释正式产物。生成器未改，最终旧名差集为空，Client 类型/回归通过。
5. TestConsole 成功时捕获 Effect.logInfo，初轮通过不代表已持久化观察样本。复用 shared observeWatchers 的可选测试观察回调，在真实 acquire/ready/event/release 边界输出 JSON，经原 runner 持久化；生产 Watcher 和通用 testEffect 未改。最终 Command 类型/行为/AST 再次通过。

完整失败、修正与独立核对见 [independent-review](evidence/v2-command-placement-backend-2026-10-28/independent-review.md)，所有原始失败日志保留；以该报告的最终冻结状态为准。

## WIP 与后续

原 64 项 tracked WIP 全部保留：58 项字节不变，5 个生成文件三方无冲突合并，账本保留原前缀追加本片内容。提交使用隔离正式生成 blob；工作区继续保留原 WIP，二者哈希单列。检查点生成时普通 index 为空，没有 reset/clean/stash、整仓 add、切分支或触碰用户服务。见 [WIP 记录](evidence/v2-command-placement-backend-2026-10-28/wip-preservation-final.json)。提交后另机械记录实际 git log 与 committed blobs，不手写提交列表。

未交付范围已写入唯一 [技术债账本](../technical-debt.md)：Command proposer/GUI 同步目标接线、其余五族 placement、编辑/导入/引用感知删除、alias/权限、Workflow/Composition 用户链、跨进程 fencing/崩溃恢复、外部 provider/Desktop/跨平台及 P6 均有 owner 与解除条件。有限 skill/command resolver 保留族别局部分派维护债，没有新增七族框架。

后端限定提交后立即进入 [下一 GUI 片实施计划](evidence/v2-command-placement-backend-2026-10-28/next-gui-implementation-plan.md)：已有 Chat 自然入口、Project/global 显式确认、target-bound GUI 删除和同一 Session 的真实正文消费须独立验证。后台删除不能代替 GUI 删除，cold graph 不能代替崩溃恢复。
