# V2 Delegation Client 生成审查 — 2026-10-19

审查工作区为 `/home/keer/workspace/aigcfroge-v2`，分支 `v2-dev`。2026-10-20 续审发现：初始生成结果正确呈现 HTTP wire 的可选字段省略和非有限数值，但删除了三个既有公开类型名称。主任务已完成 canonical Struct identifier 修复并恢复生成名称；保留 `Schema.Number` 及其真实 wire union。本审查不修改 generator、generated source 或业务 source，不运行类型检查。

## 结论与边界

| 项目                                                                     | 判断                                                                                  | 决定行为的位置                                                                                        |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `metaAgentID?: string` 等字段不再含显式 undefined                        | 对 HTTP JSON 正确；省略字段不需要 wire undefined/null 分支。                          | `packages/schema/src/schema.ts:18` 的 `optional`，尤其 `:22` 的 encode filter。                       |
| timestamp 为 `number \| "Infinity" \| "-Infinity" \| "NaN"`              | 对当前 `Schema.Number` 契约正确；生成器不能擅自删除分支。                             | installed Effect `src/SchemaAST.ts:1912` 的 `Number.toCodecJson` 与 `:4160` 的 `numberToJson`。       |
| `DelegationInfo`、`DelegationParticipantInfo`、`DelegationTurnInfo` 消失 | 初始公开 TypeScript 名称兼容退化；canonical identifier 修复后名称已恢复。 | `packages/httpapi-codegen/src/index.ts:1051` 判 anonymous，`:1062` 内联，`:1075` 排除匿名 reference。 |
| Effect client 的 decoded 数据类型                                        | 与 Promise wire 类型分工不同；本次不把 domain Class 类型导入 Promise 代替 wire 类型。 | generator `README.md:12`、`:13`；Client Promise JSON parser `src/promise/generated/client.ts:5431`。  |

最初审查快照：HEAD=`1a02c0e44e459bbec981b4edfd85ced533b32b89`；`git diff --numstat -- packages/client/src/promise/generated/types.ts` 为 `93 / 58`；该生成文件 SHA256=`51a213d48534f723b8808e823c8d8c9f12b6be5c2f5166dd7879e9d1578eff16`。这些值只标识修复前快照。

## 别名消失的共同根因

`normalizeTransport` 位于 `packages/httpapi-codegen/src/index.ts:1303`。它用 `Schema.toType` 重建 endpoint，再由 `sameEncoding`（`:1368`，比较 runtime 编码和 representation）决定能否使用 decoded schema。自定义 `optional` 编码会在 `toType` 中消失；重建后不再省略内存 undefined，与原 HTTP codec 不同，所以 `:1358` 保留真实 codec，并标记 `effectPortable: false`。这是保留 wire 语义所需的分支。

Promise `outputTypeOf`（`:815`）对这个 codec 调用 `Schema.toEncoded`。installed Effect `src/SchemaAST.ts:4644` 用 `toType(flip(ast))` 选编码态；它不会把 Class Declaration 上的 identifier 复制给底层 Struct。原定义只把 `Delegation.Info` 等名称附在 Class Declaration，底层 Objects 无名称。因此 generator 的 anonymous 判定与内联规则移除了三个 named aliases。不能只读调用方就声称二者编码相同；决定这个关系的是 `sameEncoding` 及其比较函数。

公开导出链可核对：`packages/client/package.json` 的 `.` 和 `./promise` 指向 `src/promise/index.ts`；该文件 `:3` re-export generated index；generated index `:3` re-export types。HEAD 生成文件确实 export 三个名称。因此外部代码 `import type { DelegationInfo } from "@aigcfroge/client"` 会失去 export，即使 endpoint 返回结构仍然可用。`rg` 没找到仓库内 Client 消费方引用这三个名称；外部使用情况未验证。Core 的同名 import alias 来自 domain Schema，与 Client 公开 export 的兼容关系无关。

## 复用修复与方案对比

| 方案                                                    | 行为与代价                                                                                                                   | 决定                           |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| 在非 generated entrypoint 加三个 indexed access aliases | 可复用生成 endpoint 类型快速恢复 package-root imports，但生成文件仍匿名，另外维护三条公开映射。这是兼容层技术债。            | 不采用。                       |
| canonical Class 接收带原 identifier 的 `Schema.Struct`  | 一处契约为 storage/HTTP 编码态提供稳定名称，原 generator 自动恢复所有引用；不重复字段、不改变 codec、不新增 generator 特例。 | 已采纳，由主任务修改生产定义。 |
| 修改通用 generator 自动搬运所有 decoded identifiers     | 涉及跨 codec 的名称语义和不同编码的冲突，扩大本批范围。                                                                      | 本批不采用。                   |

必须保留的对应关系：

| canonical Class              | 编码态 Struct identifier     | 原生成公开名称              |
| ---------------------------- | ---------------------------- | --------------------------- |
| `Delegation.Info`            | `Delegation.Info`            | `DelegationInfo`            |
| `Delegation.ParticipantInfo` | `Delegation.ParticipantInfo` | `DelegationParticipantInfo` |
| `Delegation.TurnInfo`        | `Delegation.TurnInfo`        | `DelegationTurnInfo`        |

installed Effect 4.0.1 的实现位于 `/home/keer/workspace/aigcfroge-v2/node_modules/.bun/effect@4.0.1/node_modules/effect/src/Schema.ts`：`:15186` 是接受 `Struct` 的 overload；`:15193` 的 `isStruct(schema)` 直接保留传入 Struct；`:14874` 把该 Struct 放入 Declaration type parameter；`:14897` 让 Class codec 编码回该 Struct。Class 原 identifier 仍保留在 `:14881`；这是同一公开 schema 的 decoded/encoded 两侧，不是两个重新实现的 schema。

形态如下，字段继续内联原定义，不能另外复制一份：

```ts
export class Info extends Schema.Class<Info>("Delegation.Info")(
  Schema.Struct({
    // 原 Info 字段，包括现有 optional 和 Schema.Number。
  }).annotate({ identifier: "Delegation.Info" }),
) {}
```

内存验证使用已安装 Effect 与仓库现有 `compile` / `emitPromise`，不调用 `write`。分别用现有三类的 `.fields` 构造带 identifier 的 Struct，放入同一个 LegacyState 形状。实际结果：三个 aliases 全部出现，LegacyState 引用三个 aliases，`number` 的三个非有限字符串分支继续存在。验证重用了原字段 schema 对象；这里只为只读评估建立临时 schema，生产修复不能换 Class identity 或保留第二套定义。

## JSON 数值和 undefined

HTTP `applyResponseEncoding` 在 installed Effect `src/http-api/HttpApiEndpoint.ts:1432`，Json 分支调用 `Schema.toCodecJson`。HTTP builder `handlerToHttpEffect`（`src/http-api/HttpApiBuilder.ts:823`）通过 `:833` 的 encoder 处理 handler 返回值；最终 `getResponseEncode` 的 Json 分支（`:1330`）再执行 `JSON.stringify`。这条路径先应用领域 codec，再序列化。

`Schema.Number` 包含非有限值，`numberToJson` 将它们编码成对应字符串；Promise 客户端 `JSON.parse` 不把字符串还原成数字，所以 union 反映实际响应。如果以后定义纯有限毫秒契约，可在领域源复用 `Schema.Finite`，如 `packages/schema/src/workflow-asset.ts:92`，再生成；这会收紧已接受的值，须单独决定，不通过修类型输出隐式改变。本批继续保留 Number。

custom `optional` 的编码侧为 optionalKey，encode filter 在 JSON 处理前删除 undefined。`packages/schema/test/delegation-event.test.ts:229` 测试实际 Class 实例，分别检查原 codec、`toCodecJson` 和 JSON string，完整期望值不含 null，也不含省略字段。保留原测试并增加 HTTP 直接往返断言，没有另建省略行为的重复 fixture。installed Effect 的默认 JSON undefined 到 null 规则仍存在，但该字段 codec 先删除了 undefined。

## 验证方法与交付状态

已执行的两个 read-only 内存 probe 均从 `packages/client` 运行，命令入口 `../../script/bun --eval`，exit 0：

- probe A：读取三类 domain、HTTP、compiled、encoded AST；三类 compiled 均 `effectPortable: false`；修复前 encoded 均为 Objects 且没有 identifier。
- probe B：给三类现有 fields 的 Struct 附原 identifier，再执行现有 generator；`expectedAliases=true`、`hasNonFiniteWire=true`、`aggregateReusesNames=true`。

可复现 probe B 的核心代码如下；不执行 writer：

```ts
const named = (schema) =>
  Schema.Class(schema.identifier)(Schema.Struct(schema.fields).annotate({ identifier: schema.identifier }))
const state = Schema.Struct({
  delegation: named(Delegation.Info),
  participants: Schema.Array(named(Delegation.ParticipantInfo)),
  turns: Schema.Array(named(Delegation.TurnInfo)),
  softExpired: Schema.Boolean,
}).annotate({ identifier: "Delegation.LegacyState" })
const api = HttpApi.make("Probe").add(
  HttpApiGroup.make("delegation").add(HttpApiEndpoint.get("get", "/delegation", { success: state })),
)
const types = emitPromise(compile(api), { mutableOutputs: true }).files.find((file) => file.path === "types.ts")
```

主任务随后授权扩展独占 `packages/schema/test/delegation-event.test.ts`：为三个现有 record fixture 增加精确 identifier，`:221` 检查 domain、storage encoded、HTTP encoded 的名称；在已有 HTTP JSON 往返测试中增加直接 decode/encode 断言。主任务已修改 canonical `delegation.ts:123`、`:143`、`:162`；Struct identifier 分别位于 `:140`、`:159`、`:176`。

| 实际回归 | 命令及 cwd | 实际结果 | 证据 |
| --- | --- | --- | --- |
| Schema 适配后最终回归 | cwd=`packages/schema`；`../../script/bun run test --timeout 30000 test/delegation-event.test.ts test/event-manifest.test.ts test/delegation.test.ts` | exit 0；46 pass / 0 fail / 498 expect() calls | `docs/review/evidence/v2-delegation-contract-2026-10-19/schema-client-types.{json,log}` |
| Core exact facade | cwd=`packages/core`；`../../script/bun run test --timeout 30000 test/delegation-event.test.ts` | exit 0；1 pass / 0 fail / 97 expect() calls | 同目录 `core-client-identifiers.{json,log}` |
| focused oxlint | 当前独占 Schema test | exit 0；0 warnings / 0 errors；范围启用 1 条规则 | 同目录 `identifier-lint.{json,log}` |

主任务的首轮 Schema typecheck exit 2 单独记录在 `docs/review/evidence/v2-integration-2026-10-20/schema-typecheck.log`。两个报错都来自测试类型：Bun matcher 的 mutable 重载不接受 readonly Definitions；异构 record 数组推断把其他记录不存在的字段带成 optional undefined，不能与 Json 期望类型比较。修复为 `toEqual([...DelegationEvent.Definitions])` 和 fixture `as const`，没有 unchecked cast，没有改变 runtime fixture。上表最后一轮 46/0/498 是适配后的实际测试退出；Schema typecheck 后续退出仍由主任务记录，本审查不把测试通过说成类型门禁通过。

生产源修复后另外只读调用 `compile(HttpApi.make("Probe").add(DelegationGroup))` / `emitPromise`（未调用 writer），exit 0：三个 aliases、LegacyState 引用、addParticipant/listTurns/appendTurn 的引用均恢复，非有限数值 wire union 保留。当前磁盘 generated types 已由主任务官方生成：三个名称分别见 `types.ts:1782`、`:1800`、`:1817`，三个 endpoint output 分别见 `:11384`、`:11392`、`:11480`。完整 regeneration 命令、hash 和类型门禁由主任务统一证据，不用内存 probe 代替。

依据为已安装 Effect 4.0.1 primary source、仓库 primary generator source，以及 Context7 返回的 Effect v4 Schema API 与 Class 官方说明。当前 codegraph 未初始化；未为本次只读审查建立索引。
