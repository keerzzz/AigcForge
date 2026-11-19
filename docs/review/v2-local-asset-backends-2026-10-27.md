# 三类资产后端本地提交复审

2026-10-27。主线到 P2.2E Prompt 后端；本次提交合并其未提交的 Skill/Command 服务接线前置。范围为 21 个生产、测试、依赖及生成文件。独立 Prompt 源码复审未发现阻塞项，依赖闭包静态审查与隔离实测一致；主智能体批准此限定本地提交。

## 行为和依赖

[Instance](../../packages/core/src/instance.ts:80) 在既有 Location 图暴露三类资产 owner。三个 proposer 持久记录目标、存在性、revision 和冲突事实；候选正文仍在 tool input。既有 HTTP 路由调用既有资产服务，不新增模型执行路径。[AssetLocation.atSessionLocation](../../packages/server/src/handlers/asset-location.ts:27) 规范化后同时比较 directory 与 workspaceID，确保修改所属 Session 的 Location。

[Prompt loader](../../packages/core/src/prompt-asset.ts:86) 采用 canonical Template 校验；无效正文归入 bad_template，content 返回类型化 404。Skill loader 的缺省名称进入已有 Name codec。Command 序列化保留显式空 args。

HEAD 已支持 Session.create 的 mode，因此本切片无需引入待提交的 Mode/Session/Event 变更。正式 Client 和 OpenAPI 生成各仅增加 bad_template 枚举值；P0.1 Codegen 修复及其他公共接口改动留在原工作区。Server 测试所需 ai devDependency 与已有 lock 的对应 workspace 行纳入提交。

## 隔离验证

从已提交 Task 基线与本次精确补丁导出隔离源码，workspace 链接只指向该副本。源 tree、每文件哈希、命令、退出码及日志哈希见 [asset-validation.json](evidence/v2-local-commits-2026-10-27/asset-validation.json)。正式生成首次允许预期输出变化；后续重复生成保持字节一致。

| 范围                                                | 结果                                               |
| --------------------------------------------------- | -------------------------------------------------- |
| Server 全包                                         | 150 pass / 1 skip / 0 fail；7275 expects；40 files |
| Core 三类资产                                       | 23 pass / 0 fail；58 expects；3 files              |
| Client 全包                                         | 224 pass / 0 fail；906 expects；20 files           |
| Core、Server、Schema、Protocol、Client 包 typecheck | 各 exit 0                                          |
| Client 正式生成及稳定性、OpenAPI 生成及 check       | 各 exit 0                                          |
| 17文件 lint、13生产文件 AST、格式、diff check       | 各 exit 0                                          |

早期 Server 类型检查使用了 Core 旧声明，表现为多处相同的 Requires 服务依赖错误。复制源码保留的旧 mtime 是根因；更新候选源码 mtime 并重编译 Core 后，未改变任何生产字节，Server 所有类型错误消失。该失败与旧 Core 增量空转记录保留，不计最终有效检查。lint 当前一条规则；Server listener 和 AST binary-resolution 警告保留。

HTTP 夹具使用真实 routes、文件、内存 SQLite 与 TestLLM，验证 Auth、placement、CAS、回读、同 Session 消费与失败分支。它不是 TCP、GUI、外部 provider、磁盘数据库冷重启或 Desktop 验收。原工作区159项Server记录与本次隔离150项记录属于不同输入，不累计。

## 剩余范围

AUDIT-V2-ASSET-CONSUMER / V2-SERVER-LEGACY 继续开放。Owner：主智能体与 Core/Server/App/GUI 负责人。解除条件：Prompt GUI 查看/确认/取消/原文插入，默认 Project 和显式个人全局存储，编辑/导入/引用删除及冷恢复，其他四类资产。完整 P2.2 与 P0–P6 未完成。
