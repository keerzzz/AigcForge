# P2.1A 四普通模式创建运输检查点

计划：2026-10-25 V2 alignment execution plan。Phase P2，Slice P2.1A。实施目录 `/home/keer/workspace/aigcfroge-v2`，分支 `v2-dev`，HEAD `251c0fe38041a326e624db464d1ee0efd1522881`，固定上游 `4617210822bdbb31e5749751afbfb4584ccedac8`。记录采用明确的 UTC 日期与时间；文件名沿用 2026-10-25 切片日期。

状态：实现及适用串行验证完成，[独立复审](evidence/v2-mode-p2.1a-2026-10-25/p2-mode-transport-review.md) findings=[]，已获 [限定协议审批](evidence/v2-mode-p2.1a-2026-10-25/protocol-approval-mode-transport.json)。未提交、推送、合并或发布。P2.1、Meta 和完整产品验收仍开放。

## 实现与复用

`packages/protocol/src/groups/session.ts` 的 session.create 增加可选 canonical `ProductMode.ID`；`packages/server/src/handlers/session.ts:134` 将同一字段交给既有 Core。Protocol 保留完整 mode ID，使现有 Custom child 合同继续由 Core 判断。普通 Custom root 仍由 `Session.create` 的 composition 分支拒绝，不能给全部 child 套 generic-root gate。

关系由 `packages/core/src/session.ts:454` 的 create 决定：已有普通 ID 直接 adopt；`mode = parent?.mode ?? input.mode ?? ProductMode.Default` 决定继承与默认；Custom root 和 parent/executor 分支保留。Core、Schema、SQL、projector、migration 的生产代码未因本切片修改。Core fork 既有测试改用真实 Work 创建，删除直接更新 mode 投影的测试捷径。

`packages/client/src/solid/data.ts:1557` 的 create 接受 `GenericSessionMode`，fresh optimistic Info 使用请求值或 canonical Default；canonical response 仍归既有 reconcile。公开 Client 由正式 generate 生成。创建模式不改 Agent、Model 或执行循环。

本轮整文件 AST 扫描发现凭据 refresh 继承的 `JSON.parse(key) as ...`。同 owner 的 `locationKey` 只生成二元 JSON 键；已在 `data.ts:147` 使用 Schema JSON Tuple 解码，`data.ts:1231` 的 credential refresh 消费 typed 结果。没有另建 Location map 或默认丢弃非法键。既有多 Location 凭据刷新回归原样复用并实际通过。

简单方案是扩展当前 create payload 与乐观投影；扩大方案会引入模式注册表、平行缓存或新 runner，本切片没有必要。技术债是尚缺 UI 持久选择/过滤及第五 Custom 用户入口，继续在 canonical AUDIT-V2-MODE-META 登记。

## 验证边界

全部命令、cwd、退出码、日志与源 SHA 见 [最终输入包](evidence/v2-mode-p2.1a-2026-10-25/p2-mode-final-input.json)。它绑定 16 个显式输入及每轮自己的记录，不能把先前 Data SHA 的结果套给本轮解码修复。

- Server 产品红测：3 pass / 6 fail / 17 expect。Client 产品红测：0 pass / 2 fail / 2 expect，34 filtered。
- 修复后 Server 定向：9 pass / 0 fail / 29 expect；当前 Server 全包：147 pass / 1 skip / 0 fail / 7150 expect，37 files。两条 MaxListeners warning 保留；原基线也有同类日志，未宣称根因已解决。
- Client 修复后全包：238 pass / 0 fail / 973 expect，20 files。此前 mode 全包 238 轮及之后 Schema 修复 238 轮分别保存，不相加。
- Core create：46 pass / 0 fail / 169 expect。Protocol、Server、Client、Core 包类型检查 exit 0；Server 首次类型检查 TS2741 是 fetch 夹具缺少 Bun preconnect，失败与修复后成功分别保存。
- 六文件 oxlint exit 0，0 warnings/errors，实际仅 1 rule；三生产文件 Effect AST 扫描修复前 exit 1、修复后 exit 0。六文件 Prettier check exit 0。
- Client 正式 generate exit 0，之后重复正式 generate exit 0、四份生成源 SHA 无漂移。Protocol OpenAPI 先 stale exit 1，再正式 generate exit 0、check:generated exit 0。
- `mode-client-fixed-full` 虽 exit 0，实际只输出 Bun 帮助，没有执行测试；`mode-client-fixed-full-actual` 才是之后在 Client 包目录取得的真实全包结果。

Server 四模式用例走真实 generated promise Client → ServerFetch WebHandler → SQLite → canonical GET；非法 mode/Custom 普通 root 为直接 HTTP 拒绝且没有 fallback Session。该路径没有监听 TCP。Client 两例只证明序列化 body、optimistic 分类、canonical response 和 creating 状态；不扩大成完整 ACK/echo/rollback 并发矩阵。Core fork 用真实创建和事件 replay 证明继承。

## 继续开放

AUDIT-V2-MODE-META，Owner Core/App/Meta 负责人：持久 GUI 选择、非法 Draft 提交 guard、同次 create 捕获、路由/重载/过滤、完整 capability/Custom 用户入口与 Meta Instructions 消费。P2.1B 先保存修改前生产 benchmark，再应用现有 Draft/Select/adapter 补丁。

AUDIT-V2-ASSET-CONSUMER，Owner Core/Server/App 负责人：首基础 Skill propose → 明确确认 → 真实 HTTP apply → 原生注册 → Session 消费，随后其余六类与导入。

本切片没有操作用户现用服务或数据库，未修改 App Session 生产代码。完整 P0.4、真实 provider/进程崩溃、其他平台和 P6 迁移/发布/性能仍由原账本持有。
