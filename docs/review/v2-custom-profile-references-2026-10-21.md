# Custom Profile 反向引用检查点（2026-10-21）

实现目录 `/home/keer/workspace/aigcfroge-v2`，分支 `v2-dev`，接续基准 `4f65b63fb`。本切片接通既有 `GET /custom-composition/references`，复用 Location-scoped CustomProfile 读模型。已完成真实文件与 HTTP 回归、受影响包全量和根检查。其余 composition plan/health/start/upgrade、运行时快照及产品消费链仍开放。

## 合同与边界

公开合同返回 `{ profiles: CustomProfile.Summary[] }`，查询字段为 `kind` 和 `path`；六类引用为 agent、prompt、skill、workflow、command、mcp。Profile 内 agent、workflow、consumer bindings 的 prompts/skills/commands 和 mcpBindings.ref 都参与反向查询。Revision 不参与匹配，查询不要求目标资产当前存在。

方案对冲：建立通用 Resolver 会把查询绑定到 Tool/MCP/Model 的运行事实，增加目标已删除时的失败面。当前完整查询直接扩展已有 Profile 读模型，无新增索引、表或并行 registry。更广的 Session Snapshot/Workflow/Command/Plugin 反向消费者，以及 health/start 的完整运行事实属于独立范围；本切片没有用查询结果冒充运行可用性。

路径双侧复用各资产的 `validateRelativePath`：去除首尾空白，反斜杠转 `/`，拒绝空段、`.`、`..`、绝对路径、错误后缀和平台非法名称。不剥资产根前缀；`.aigcfroge/agents/x.md` 与 `x.md` 是不同路径。旧主仓 `CompositionResolver.findReferencingProfiles`（`:839`）只比较字面路径；本次双侧规范化是明确新增查询规则，不声称旧实现已有该行为。V2 目标 registry 的 `getByPath` 仍按 Map 原键查找；本切片不改变资产正文读取合同。

有效 Profile 来自现有 strict loader。坏 YAML/Schema 与同名冲突排除；合法 Profile 中路径无效的单个引用不匹配，其余有效引用仍可查询。不隐式把 Profile 当作完整健康检查。当前引用扫描不构成持久索引或文件 watcher 的强一致事务。

## 验证与决定函数

| 决定函数                                                                           | 已实现关系                                                                                                                                                    |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CustomProfile.referencesProfile`，`packages/core/src/custom-profile.ts:168`       | kind 选择六个实际引用槽；stored path 用该 owner validator；无效 edge 独立跳过，revision 不参与。                                                              |
| `CustomProfile.references`，`:211`                                                 | query 用同一 validator；typed InvalidPathError；从有效 assets Map 过滤，每 Profile 生成一次 Summary，`:225` 按 JS `<` 的 UTF-16 字典序排列。                  |
| `CustomProfile.loadDir`，`:133`；reload，`:197`                                    | 同名冲突移除所有匹配条目；reload 完成后替换整个 registry Map。没有另建健康筛选或目标资产存在检查。                                                            |
| `CustomCompositionHandler`，`packages/server/src/handlers/composition-stubs.ts:33` | HTTP 只解码 kind 一次，借 route Location context，调用现有 Profile owner；unknown kind 与非法 path 返回 400；Protocol middleware 保留 auth/routing/instance。 |

准确命令、cwd、退出码、日志与源文件 SHA256 见 [verification.json](evidence/v2-custom-profile-references-2026-10-21/verification.json)。项目 Bun 1.4.2；测试从包目录运行，定向与全包数量不相加。

| 范围                                       | 实际结果                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------- |
| Core references RED                        | exit 1；0 pass / 4 filtered / 6 fail / 4 expect；1.349s                   |
| Core references 最终 GREEN                 | exit 0；6 pass / 4 filtered / 0 fail / 288 expect；789ms                  |
| Core registry+mutation 两文件              | exit 0；20 pass / 0 fail / 349 expect；3.24s                              |
| Core 全包，同 UID 隔网且清除 capability    | exit 0；7101 pass / 365 skip / 0 fail / 106910 expect；355 files；230.91s |
| Custom Profile HTTP                        | exit 0；5 pass / 0 fail / 209 expect；6.89s                               |
| Server Routing/Policy 相邻两文件           | exit 0；9 pass / 0 fail / 77 expect；7.60s                                |
| Server 全包，同 UID 隔网且清除 capability  | exit 0；114 pass / 1 skip / 0 fail / 6475 expect；34 files；37.33s        |
| Core / Server typecheck                    | 各 exit 0；tsgo project build                                             |
| Client generate / check:generated          | 各 exit 0；生成目录无差异                                                 |
| 根 check                                   | exit 0；19/19 successful，16 cached；1487 lint warnings / 0 errors        |
| 最终五文件 lint、代码/文档格式与 diff 检查 | 各 exit 0；五文件 lint 0 warnings / 0 errors                              |

真实文件测试涵盖六类引用、不同 revision、同一 Profile 多次引用、路径双侧规范化、owner prefix/basename/跨 kind 的身份区分、非法 query 与 schema-valid Profile 的坏引用、目标删除、registry reload、新增/引用改走/Profile 删除、目录重新打开和 Location 隔离。HTTP 从真实生产 router 获取摘要；目标中的字面 `%2F` 经 `URLSearchParams` 只解码一次，与标准路径保持不同身份；目录中的字面 `%2F` 和 `/.` 路由也有实际覆盖。资产 Creation flag 显式关闭时，read endpoint 仍可查询；本 endpoint 没有新增 Custom runtime gate，未另做该 flag 的显式开关测试；未授权请求返回 401。plan/health/start/upgrade 四 stub 继续返回 not_implemented。

独立 `history_audit` 审查决定函数与身份规则，不重复运行测试。未独立复测未知/不存在 workspace query；依赖既有 WorkspaceRouting/InstanceContext 门禁。本切片不证明 watcher 并发强一致、产品删除 UI、Electron/PTY 或真实外部 MCP 连接。Server 全包仍有 MaxListenersExceededWarning，原因未调查。

## 失败证据

Core RED 准确捕获 `service.references` 不存在。首次 GREEN 的双 Location fixture 因 Layer memo 复用而失败（5 pass / 1 fail），改为 fixture 的 fresh layer；未改生产 Location owner。Core 首次 typecheck 因测试期望未使用 branded Name 返回 TS2769，改为现有 Name.make。HTTP RED 准确返回 not_implemented（0 pass / 1 fail），首轮 Server typecheck 因测试 `find` 返回 Summary|undefined 失败，用 type guard 过滤。失败日志与后续 GREEN 都保留。

Effect 4.0.1 当前真实 Schema API 为 `Schema.TaggedError`（installed `effect/src/Schema.ts:15517`）；不存在协议文字中的 TaggedErrorClass。本切片使用已核对的 tagged Schema error，没有新增兼容接口。

## 未交付登记

Owner：主智能体。Resolver plan/health 需复用当前资产/Tool/Model/MCP owner 的 revision、provenance、binding 和运行事实；start/upgrade 需原子 Session+snapshot、source-idle、exact retry、运行时 allowlist 与冻结正文。Session 快照/Workflow/Command/Plugin 等非 Profile 反向消费者与产品删除提示未交付，解除条件是对应真实生产消费者和流程测试。上述范围登记于 `V2-D-COMPOSITION` 与 `V2-D-REFERENCES`。

## 本地核算

提交列表以 `git log --oneline 4f65b63fb..HEAD` 生成。本轮开始时参考工作区 `/home/keer/workspace/aigcfroge` 为干净的 `brand-mode-icons`，收口核查发现该目录已由外部切换到干净的 `main`，HEAD `90edd7dafeae07e77a4d044c498dea2c21f703bf`。本智能体与子智能体没有切换、编辑或提交该参考目录；实施仍在 V2 的 `v2-dev`。只进行本地实现与验证。
