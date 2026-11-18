# P2.2O Skill 所选目标后端检查点（2026-10-28）

本片已实现显式 Project/global/location 后端目标，准备限定本地提交。基线为 `f26548b1eb4d40c23365cf69e1f3a71a1c52a6b7`；固定上游为 `4617210822bdbb31e5749751afbfb4584ccedac8`。实施仓 `/home/keer/workspace/aigcfroge-v2`，分支 `v2-dev`；参考仓只读。用户已授权本地实施、验证、复审及提交，未授权 push/merge/发布。下片仍需同时接通新工具默认 Project 和 GUI 目标确认，本片不声称用户纵链已完成。

## 交付与决定函数

- `packages/core/src/asset-placement.ts:41` 从有限 scope 决定 owner；Project 取当前 `Location.project.directory`，global 取 `Global.config/skills`，兼容 Location 取当前 Session 目录。`targetMismatch:72` 同时比较 scope/root；请求 root 只作相等证据，不能选任意写入路径。`resolveWithin:78` 检查 owner 下目录、文件和 dangling symlink，允许安全缺根。
- `packages/core/src/skill-asset.ts:216` 的 selected view 每次复用原 loader 读取单 owner，不引入持久混合 catalog。`reload:174` 与 `migration:172` 决定旧方法第一次调用的迁移；selected view 不执行旧资产导入。
- `packages/core/src/skill-asset-service.ts:175` 的 inspectOwner 统一冲突事实；`propose:237` 保留旧五 facts 和旧空路径调用，`inspect:255` 返回 required target。`apply:269` 与 delete 共用绝对路径 FileMutation 整事务锁，在锁内完成读取/CAS/写入/回读/条件回滚；现存文件 null revision 不能绕过删除 CAS。回滚不覆盖外部改写或重建。
- `packages/protocol/src/groups/skill-asset.ts` 仅新增只读 inspect，原 list/content 加可选 scope、apply/delete 加可选 target。`packages/server/src/handlers/asset-location.ts:27` 继续决定 Session directory/workspace 归属；`asset-stubs.ts` 保留认证和原 Session 路由，target mismatch 为 400，资产 CAS 为 409。
- Schema 的 Target/Inspection/Info 为 canonical class。新 optional 字段复用 `packages/schema/src/schema.ts:18` 的 omission codec，无历史默认值；Info/Summary/InvalidEntry 的编码 identifier 复用既有 Plugin 模式保留旧公开类型名。Effect 入口暴露 canonical namespaces；Promise 入口保持 structural types，不新增 Effect runtime 依赖。
- 保留现有 Composition sourceLocation 和冻结正文。旧 proposer、共享 GUI Facts、其他六族合同在本片源码清单外，未把新 target 回填为历史事实。

完整拟定合同见 [scope](evidence/v2-skill-placement-backend-2026-10-28/scope.md)，精确 28 文件见 [source-files](evidence/v2-skill-placement-backend-2026-10-28/source-files.json)。最终可提交源码与未改决定 owner 的哈希见 [manifest](evidence/v2-skill-placement-backend-2026-10-28/validation-manifest.json)，主工作区生成文件因保留原 WIP 而另列哈希。

## 实际验证

只由 root 串行执行，使用隔离验证仓、固定 `script/bun`（1.4.2）；测试均在包目录，类型通过包脚本并限 `GOMAXPROCS=2 GOMEMLIMIT=3GiB`。隔离仓 HEAD 较旧，不能用其 HEAD 当本片基线；每轮原始日志、源码哈希和相对最终版本差异由 runner 生成。以下是各轮原始 tally，不累加重复运行。

| 记录                     | exit | 命令生成的 tally                                                                       | 相对最终树的文件差异                                                                                                                 |
| ------------------------ | ---- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `schema-final`           | 0    | 389 pass; 0 fail; 1434 expect() calls; Ran 389 tests across 44 files. [615.00ms]       | `packages/core/test/skill-asset.test.ts`, `packages/schema/test/asset-placement.test.ts`, `packages/server/test/skill-asset.test.ts` |
| `schema-keeper-verified` | 0    | 16 pass; 0 fail; 80 expect() calls; Ran 16 tests across 1 file. [319.00ms]             | 无                                                                                                                                   |
| `core-regression-final`  | 0    | 126 pass; 0 fail; 941 expect() calls; Ran 126 tests across 14 files. [10.73s]          | `packages/core/test/skill-asset.test.ts`, `packages/schema/test/asset-placement.test.ts`, `packages/server/test/skill-asset.test.ts` |
| `core-keeper-verified`   | 0    | 21 pass; 0 fail; 169 expect() calls; Ran 21 tests across 1 file. [3.85s]               | 无                                                                                                                                   |
| `server-full-final`      | 0    | 167 pass; 1 skip; 0 fail; 7733 expect() calls; Ran 168 tests across 44 files. [83.64s] | `packages/core/test/skill-asset.test.ts`, `packages/schema/test/asset-placement.test.ts`, `packages/server/test/skill-asset.test.ts` |
| `server-keeper-approved` | 0    | 6 pass; 0 fail; 225 expect() calls; Ran 6 tests across 1 file. [9.96s]                 | `packages/core/test/skill-asset.test.ts`, `packages/schema/test/asset-placement.test.ts`                                             |
| `client-full-final`      | 0    | 225 pass; 0 fail; 926 expect() calls; Ran 225 tests across 20 files. [38.98s]          | `packages/core/test/skill-asset.test.ts`, `packages/schema/test/asset-placement.test.ts`, `packages/server/test/skill-asset.test.ts` |

生产实现从最终全包测试至源码冻结没有变动；表中较早版本差异只在测试的品牌期望、错误 payload、service 绑定与导出身份测试的无 alias 写法。Core/Server/Schema 各改动 keeper 已在对应最终修正后重跑。Server 全包有 1 skip 和 MaxListenersExceededWarning，均保留原日志；没有把它描述为无警告或全部运行。未运行 Core 整包、App 单元/浏览器全包或 GUI/E2E 行为；本片没有 GUI 改动，下一纵片独立验证。

Core、Schema、Protocol、Server、Client、App、GUI 及 App E2E 类型脚本分别 exit 0。Protocol check:generated exit 0；Client 正式重生成与五个路径的 git diff --exit-code 均为 0。23 文件 scoped oxlint 为 0 warnings / 0 errors，28 文件 Prettier 与精确源码 diff --check 为 0。GUI 专用 lint-changed 脚本显示无匹配 GUI 文件，不能替代上述 scoped oxlint。

最终 22 文件 AST exit 0。扩大至所有手写测试时，Composition keeper 有 11 处基线原有 Effect.die(string)，该扩展检查未通过；[baseline 对照](evidence/v2-skill-placement-backend-2026-10-28/ast-existing-baseline.json)逐项记录相同语句和基线/当前行号。没有用局部 AST 通过覆盖存量失败。

## 真实失败与修复

1. 旧后端 + 新合同的 HTTP 红测：0 pass / 2 fail / 5 expects，inspect 返回 404 而预期 200。最终 HTTP keeper 通过。
2. Client 首轮全包 224 pass / 1 fail / 926 expects：旧 apply 多发 target:null。根因是新字段使用 raw Schema.optional；改共享 omission helper，保留原 baseRevision:null wire 语义。
3. 生成时曾丢失旧 SkillAssetInfo/Summary/InvalidEntry 名称。基线确实存在这些导出；从 Schema 编码 identifier 修正并正式重生成，没有改 App 消费者来掩盖公共回归。
4. Core 首轮类型因旧 fixture Layer 缺依赖；后续 Core/Server 类型因测试期望缺品牌和 nullable bytes 未收窄。复用现有 tempGlobalLayer/LocationMutation，并修正测试值，未减少断言。
5. AST 检出新增 runtime import alias、nested service yield 与字符串 defect 写法，已修正并保留失败日志。Schema canonical identity 的三个断言仍保留，改为局部 dynamic module import。独立 reviewer 复核修正没有降低正文、磁盘、目标、CAS 或回滚断言强度。

## WIP、复审与剩余范围

原有 64 tracked WIP 的绑定见 [unrelated-wip-pins](evidence/v2-skill-placement-backend-2026-10-28/unrelated-wip-pins.json)。五个重叠生成文件三方合并均无冲突；[合并记录](evidence/v2-skill-placement-backend-2026-10-28/generated-merge-result.json)确认 1,479 个非 Skill Promise export body 逐字节保留、13 个旧 Skill 公共名保留。提交取隔离正式生成物，工作区保留原 Codegen WIP；账本提交取 HEAD 内容加本片 appendix，工作文件保留原前缀。没有 reset/clean/stash、整仓 add 或触碰用户服务。

独立复审见 [independent-review](evidence/v2-skill-placement-backend-2026-10-28/independent-review.md)，最终冻结绑定以该报告为准。未交付项已在唯一 [技术债账本](../technical-debt.md) 追加 owner 与解除条件：工具默认/GUI目标审阅、原生 watcher 双 Location 真实消费、其余六族、导入编辑/引用、Workflow/Composition 用户链、冷恢复/provider/Desktop/跨平台与性能。本片选择有限 resolver 加现有 Skill owner，保留族别局部分派维护债；没有引入七族统一框架或跨进程事务承诺。

下一片执行依据为 [GUI preflight](evidence/v2-skill-placement-backend-2026-10-28/next-gui-preflight.md)。实际 GUI/TCP 链必须移除旧 harness 的显式 skills 路径注入，先激活并等待两个 Location 的原生监听，再执行一次写入并观察准确路径、原生 ID 和正文。静态 readiness 风险须用红测证实，不能凭静态预判称缺陷已复现。
