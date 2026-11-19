# P2.2A — 基础 Skill 提案与真实 HTTP/原生消费后端

状态：实现与适用验证完成，独立复审已 FINAL 冻结；于 2026-10-25T22:43:10.096336+00:00 获[限定协议审批](evidence/v2-skill-p2.2-2026-10-25/protocol-approval-skill-backend.json)。记录日期为 UTC 2026-10-25；用户时区 Asia/Shanghai 为 2026-10-26。

目标 `/home/keer/workspace/aigcfroge-v2`，分支 `v2-dev`，HEAD `251c0fe38041a326e624db464d1ee0efd1522881`，固定上游 `4617210822bdbb31e5749751afbfb4584ccedac8`。本地未提交；旧产品目录只读。关联现行 P2.2 与唯一 `AUDIT-V2-ASSET-CONSUMER`、`V2-SERVER-LEGACY`。

## 改动与决定边界

复用现有 SkillAsset/SkillAssetService，将两个既有 node 暴露在 [Instance roots](../../packages/core/src/instance.ts:97)，仍由 [LayerNode build](../../packages/util/src/effect/layer-node.ts:303) 和 [memo/dedup](../../packages/util/src/effect/layer-node.ts:253) 决定组合与复用。它们此前仅为 PluginSupervisor 的私有依赖。真实测试从公共 Location context 取得两个 owner，重取同一 Location 时对象身份一致；没有新增 registry、runner 或表。

[ProposeSkillAssetTool](../../packages/core/src/tool/propose-skill-asset.ts:66) 只新增五个持久 facts：relativePath、exists、revision、nameConflict、pathConflict；新目标 revision 明确为 null。machine Output 原本已有 relativePath，本切片没有新增它。原候选正文保留在 tool input，不重复存 metadata；framework 可继续附加 truncated 等字段。关系由 [ToolRuntime](../../packages/core/src/tool/runtime.ts:55) 的 output/content/metadata 归一化和 [Tool.Success publisher](../../packages/core/src/session/runner/publish-llm-event.ts:579) 决定。实际 proposer→唯一 Session runner→持久 Tool 结果→消息 HTTP readback 已验证。

四个现有 Skill asset HTTP handler 复用原 [SkillAssetHandler](../../packages/server/src/handlers/asset-stubs.ts:33)。保留 flat 路径和原 response 形状：/skill-asset list/content、/session/:sessionID/skill-asset apply/delete，无 data wrapper。写操作读取真实 Session，再由 [atSessionLocation](../../packages/server/src/handlers/asset-stubs.ts:51) 比较 canonical directory/workspace；跨 Location 返回 resource=Session ID 的 ConflictError，不转成资产覆盖。asset revision CAS 的 resource 由原 owner-relative path 决定。

基础 subset 为 slash=false、triggers/tags=[]；扩展行为尚未映射时明确拒绝。HTTP optional String baseRevision 保持不变；新目标不发 null，而在 handler 映射回 owner null。文件路径、mutex、SHA CAS、overwrite、原子写、回读、删除与回滚继续由 [SkillAssetService](../../packages/core/src/skill-asset-service.ts:200) 和原 FileMutation/LocationMutation 决定。没有改 public Protocol/HttpApi 定义；生成 Client 保持原字节，因此本切片不运行无必要的重新生成。

HTTP 完成只证明文件与 asset catalog 回读。真实 [ConfigSkillPlugin watcher](../../packages/core/src/config/plugin/skill.ts:171) 发布 native Skill 更新，之后才观察 native list、当前 Session 的 [guidance](../../packages/core/src/skill/instructions.ts:76) 与 [正文 materialization](../../packages/core/src/session/prompt.ts:65)/请求组装。测试在 HTTP 写之前注册 native 事件信号，等待真实文件 watcher，并核对后续 Session 请求中的同一更新正文。

## 验证与保留失败

固定 script/bun 1.4.2，主线单包串行。完整 command/cwd、退出码、日志 SHA、23 个显式源与七个改动输入 pin 见 [最终输入包](evidence/v2-skill-p2.2-2026-10-25/p22-backend-final-input-v2.json)，SHA `66de5609c95e3488d8f699e238790e1cef6023304dc79f3b215824f1c3c8e262`。显式源与 pre-command dirty hashes 是限定输入绑定，不代表完整不可变 WIP/runtime 快照。

- 最终 Server 全包：151 pass /1 skip /0 fail，7154 expect，38 files。
- 最终 Core 六个相关文件：55 pass /0 fail，169 expect。
- 最终 Server typecheck 与 Core typecheck：分别 exit 0。
- 五个源/测试文件定向 oxlint：exit 0，实际只运行 1 rule，不称完整 GUI 或全仓 lint。
- 四生产文件 AST、六个触碰文件格式：分别 exit 0。

新增 keeper 的三个纵向 case 位于 [skill-asset.test.ts](../../packages/server/test/skill-asset.test.ts:1)，其中真实模型请求分别为5、2、2次。覆盖 proposer facts/不自动写、认证、Session placement、public roots 复用、create/read/list、显式 overwrite与stale CAS、name/path conflict、基础 subset拒绝、无效名称、真实 native watcher、guidance+持久正文+后续请求、删除后新附件拒绝及历史正文保留。独立单文件前格式化绿为3 pass/0 fail/87 expect，最终候选输入以全包151轮为准，数字不累计。

真正产品 red 为0 pass/3 fail/9 expect：completed proposer 和持久消息读取缺 relativePath/facts。更早的 @aigcfroge/ai 加载失败及 private SessionExecution getter 的 fixture 装配失败均未到产品断言，分别保留且不计产品 red。Server 直接引用 AI testing 入口，因此新增一条 workspace devDependency；固定 Bun install 已物化 link，锁文件相对本次备份只增加 Server AI devDependency 一行，原锁 WIP 保留。

first-green 实际为2 pass/1 fail：plain Core record 与 Schema Class matcher比较失败，字段输出相同；使用同一个公开 Info schema 解码后做完整 toEqual，未减少字段断言。随后3/0/87保留其原输入。格式首检失败、四个类型错误与前format typecheck输入绑定不足也原样保留；最终 decoder 用显式 array callback，revision 期望由既有 branded schema 解码，最终类型与记录绑定重新验证。

最终 Server 日志有 MaxListenersExceededWarning，原样保留；不以 green tally 宣称无 warning。AST 有既有 postinstall 未运行的 binary-resolution提示，扫描 exit0。没有输出用户凭据或用户 prompt；测试使用有界、隔离的合成数据。

## 未交付与接续

本切片证明生产 createRoutes WebHandler、SQLite、原生文件 watcher 和 Session runner 的同一链，模型由 TestLLM 提供有界响应。它不证明真实浏览器 GUI、外部 provider、现用 managed service、整个七资产族或 P6。GUI 保存/独立覆盖确认与 native消费由后续 P2.2B 继续；当前 GUI patch 与其红测/类型/lint按各自输入另行记录。

`AUDIT-V2-ASSET-CONSUMER` 继续开放，Owner：Core/Server/App；解除：首族真实GUI→HTTP→native/@skill→当前Session消费，删除refs/Profile health/frozen history用户链，以及扩展slash/triggers/tags、其余六族和导入。`V2-SERVER-LEGACY` 的其他占位/兼容消费者保持开放。简单只接HTTP的方案不足以证明原生消费；本实现复用既有完整owner链，不增加统一资产框架。未交付功能为登记技术债，不以本次后端绿替代完整P2.2。

源码/package/锁预应用备份为 `/home/keer/.codex/backups/aigcfroge-v2/p2.2-preapply-202610252132`。所有历史失败与记录保留。未执行 commit、push、merge、publish、用户现用服务或数据库操作；提交列表只能由 `git log --oneline 251c0fe38041a326e624db464d1ee0efd1522881..HEAD` 生成，当前输出为空。

独立复审新增真实读取缺陷：缺失 name 时81字符文件名绕过既有 Name 限制，HTTP list实际500（0/1 red）。修复 [loadDir](../../packages/core/src/skill-asset.ts:88) 在原Frontmatter decode前仅对undefined name注入basename；80/short正常、81/null/空名统一bad_frontmatter，content失败400且不请求模型。最终151轮包含扩展case；1/0/8单例是前扩展输入，不改绑。旧final packet与150轮、前别名清理151/7173轮各自保留。本次也删除了新触碰owner中的旧value import alias，Core类型、四生产AST和最终回归分别通过。
