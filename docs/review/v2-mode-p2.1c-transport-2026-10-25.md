# P2.1C Session.list mode 运输检查点

状态：2026-10-26T00:23:27.362475+00:00已获[限定协议审批](evidence/v2-mode-p2.1c-2026-10-25/protocol-approval-mode-list-transport.json)，独立[FINAL复审](evidence/v2-mode-p2.1c-2026-10-25/p21c-transport-review.md)findings=[]。完整P2.1与Home UI仍开放。

工作树 `/home/keer/workspace/aigcfroge-v2`；分支 `v2-dev`；HEAD `251c0fe38041a326e624db464d1ee0efd1522881`；固定上游 `4617210822bdbb31e5749751afbfb4584ccedac8`。没有commit/push/merge/publish。

## 行为与决定函数

- Protocol `SessionsQueryFields`（`packages/protocol/src/groups/session.ts:62`）运输可选 `ProductMode.ID`，不设query默认；`withCursor:89`保留筛选，排除请求limit。
- `SessionStore.list`（`packages/core/src/session/store.ts:104`）在`:113`把mode加入现有SQL条件，随后执行anchor/order/limit。`SessionTable.mode`在`packages/core/src/session/sql.ts:39`持久化NOT NULL与既有Coding默认。
- Server `packages/server/src/handlers/session.ts:71`复用cursor优先与spread查询，`:79`仅从当前请求取limit；没有另造字段拼装。
- 未提供mode保持全量inventory；直接get仍全量。Custom只在Core Store fixture投影已存在mode行，Server普通Custom创建保持拒绝，本轮不宣称完整Custom入口。

## 最终当前源码门禁

- `mode-list-client-full`：238 pass / 0 skip / 0 fail / 973 expect，20 files，exit 0。
- `mode-list-server-full`：152 pass / 1 skip / 0 fail / 7227 expect，38 files，exit 0。
- `mode-list-core-related`：49 pass / 0 skip / 0 fail / 194 expect，2 files，exit 0。
- `mode-list-protocol-final-cursor`：2 pass / 0 skip / 0 fail / 4 expect，1 files，exit 0。

四包类型、五文件1-rule lint、两生产AST、五文件格式、OpenAPI检查及Client/Protocol重复正式生成分别exit0。AST的postinstall fallback warning与Server MaxListenersExceededWarning保留；不能把1-rule lint当全仓完整lint。12生成面和64既有dirty package文件在重复生成前后逐一相同。

## 证据绑定

[FINAL input](evidence/v2-mode-p2.1c-2026-10-25/p21c-transport-final-input.json)，SHA256 `0c64715ca6e48f902a92dff8408e2db65576d02a8c7b0009d856e7bead6e5310`，24显式源、10changed pins、14required green，每项24输入与当前冻结副本一致。

[source locator erratum v2](evidence/v2-mode-p2.1c-2026-10-25/p21c-transport-final-input-owner-erratum-v2.json)只纠正QueryFields/withCursor/SQLmode行号；原packet及v1保留，未重绑任何旧测试。

[preapply/结构review](evidence/v2-mode-p2.1c-2026-10-25/transport/preapply-review.md)已FINAL，限定结构范围无阻塞；它不替代当前源码/生成产物最终review。

## 失败与边界

Original Core/Protocol/Server red rounds and both failed cursor-fixture red rounds remain with their own input hashes. Server TS2345 JSON cursor typing, Server TS2322 closure narrowing, aborted Core -15 after overlapping queue startup all retained. Focused 10/0/70 binds prior Server test; final full binds current source. No overlapping tally accumulation.

Pre-explicit red records did not include unchanged Core store; tests-only apply receipt+preapply backup independently bind its preimage. No later hash is added to old records. Pregen backup preserves listed WIP bytes and diff, excluding ignored runtime/dependencies/build outputs. Current gates each bind all 24 explicit source inputs, not a full immutable runtime snapshot.

实际生成promise Client通过in-process ServerFetch/SQLite验证mode、omitted及冲突cursor；原raw HTTP验证工作目录/Project/parent/search/invalid。Core覆盖五mode混合数据、双方向与ID/time并列游标。Effect生成面仅正式生成、类型与原full regression，不声称新增Effect mode专门运行证明；没有TCP/GUI/provider/Desktop/PWA证明。

## 未交付范围

AUDIT-V2-MODE-META继续开放。Owner：Core/App/Meta负责人及主智能体；解除：Home列表/搜索/palette、持久化与跨scope、五模式创建/继承/capability/Custom/Agent/Meta完整用户链实际验收。Home既有12preimages仍未应用，生产baseline与独立preapply复查正在准备。P6性能/旧库副本/平台/切换单独开放。

审批SHA256 `9b481eae75d968791abd44032fc8c1a3c51edb840067cce6c8c5b4ee02a227f4`；MD/JSON FINAL review SHA分别 `117efae18955b41d54ad0a97eebf030e3d3dd577f33b0cf3e8fae1ae217fb41b` / `e5457c0f427be8a90ef59209105d64aeffe9cd8c4254a73863e8d9d0ee4bc52e`。审批24源/10changed/14门禁均再次匹配，源定位erratum v2单独绑定；未扩大到UI或全产品。

Home原输入真实entry baseline已40/40有效样本，7281列明包/根输入与运行时named pins前后相同；Home-index baseline已80/80有效。UI v1独立复查发现键盘/server或Project水合切换后的旧exact残留与跨ctx remember路径，已要求原作者准备v2 owner修复和真实keeper。该缺口纳入本次Home范围，不以债务代替修复。

Home生产baseline已冻结于[baseline-final-input](evidence/v2-mode-p2.1c-2026-10-25/validation-plan/baseline-final-input.json)：entry40、Home-index80、Home keeper11、既有palette6各自通过，四运行7281源码及named runtime一致；各产物单独绑定/回读，不相加成完整验收。两构建16个sourcemap仅嵌入Vite资产reference IDs不同，其他3159文件哈希同；原字节差异与决定函数记录保留。UI v2 scope修复仍prepared进行中，尚未应用。
