# 统一右侧栏实施计划审批

日期：2026-11-09。审批对象：[会话 UI 对齐与统一右侧栏实施方案](/home/keer/workspace/aigcfroge-v2/docs/research/upstream-v2-sync/2026-11-09-unified-right-sidebar-implementation-plan.md)。

结论：**完成本记录中的减法修订后，批准该实施计划。** 产品位置、统一宿主与实际模块迁移可按计划进入具体实施。当前源码尚未执行该 UI 改动，运行接受由各 RS 小节取得。

## 1. 依据与审查范围

审查以用户提供的第一性原理、按需防御与按需抽象协议为准，核对本仓 [CLAUDE 第一性原理](/home/keer/workspace/aigcfroge-v2/CLAUDE.md:220)、[复用与最小修改](/home/keer/workspace/aigcfroge-v2/CLAUDE.md:241)、[边界与交付](/home/keer/workspace/aigcfroge-v2/CLAUDE.md:273)、App 与 GUI 指南及既有生产源码。

用户已明确主任务：对话占主区域，持续管理内容在统一右侧栏，模块可以插拔。该目标有可执行的最小充分信息，不再增加产品确认轮次。审批检查的是位置、数据归属、新增结构和验证范围；没有改变执行层的片不重验完整 Meta 链。

## 2. 第一性推导与批准项

| 基本事实 | 推导 | 批准的实现 |
| --- | --- | --- |
| 主列纵向空间有限；当前 TaskPanel 位于 Timeline/Composer 之间 | 持续管理占据主列时会减少对话空间；修复应改变真实挂载位置 | 任务、协作、Meta、工作流和产物迁到右侧，五类功能可达后立即移除主列聚合区 |
| File/Review/Browser 已使用同一 Panel 宿主 | 统一能力已有多个真实消费者，复用宿主足够 | 使用现 Panel/createRegion/SideRegion/RegionContent，不建立第二注册表、事件总线或布局缓存 |
| Panel 与 Extension 是不同粒度；一个扩展能注册多个 Panel | 五个可插拔视图不要求五个 setup/扩展发布单元 | 默认一个 session-management 扩展，贡献五个独立 Panel/菜单/显示偏好 |
| 询问、权限与联网选择需要即时回应；Form/Permission 选择独立 | 不能用隐藏另一请求换取视觉紧凑，也不应把即时请求放入可能收起的管理栏 | 保留原 response dock 与 blocked 规则；Queue 留在 Composer 附近 |
| Task 与 Todo 从同一 owner 投影 | 两个编辑数据源会把同一任务分裂 | Todos 消费原 Task 来源，不新增编辑库 |
| 业务执行生命周期长于单次 Panel render | 关闭视图应收回 UI；在飞操作不能因卸载丢失后再次提交 | 业务继续由原 owner 执行；UI token/pending/ACK 在扩展的同 Session 内存状态保留 |

位置由 [screen 挂载](/home/keer/workspace/aigcfroge-v2/packages/app/src/session/screen.tsx:359)决定；宿主集合、选择与实例由 [createRegion](/home/keer/workspace/aigcfroge-v2/packages/app/src/runtime/extension/panels.tsx:98)决定；同扩展多 Panel 的具体归属由 [provider](/home/keer/workspace/aigcfroge-v2/packages/app/src/runtime/extension/host-apis.tsx:636)决定。现有 [Skill/Command 两个 Panel](/home/keer/workspace/aigcfroge-v2/packages/gui-extensions/src/skill-proposals/renderer.tsx:169)提供真实实现参考，按各自 tab ID 列出，而非假设新接口存在。

## 3. 已落实的减法修订

### A. 独立视图，减少扩展实例

原计划建议五个目录分别定义扩展，部署和生命周期粒度超过当前需求。改为一个真实管理扩展，五个标准 Panel，各自保存 UI 状态和显示设置。只有出现独立发布、硬依赖或整个扩展独立启禁需求时再拆 Extension。此项是实现粒度的减法，不削弱五个模块独立插拔。

### B. 删除 Custom 的“两输出前置”

原 RS09 要求至少两个输出才能验收接入，把新增抽象的条件误用到既有宿主复用。已删除这一完成门槛。明确的一个 Custom producer 产生实际输出即可沿 File/Browser/Panel 接入并验证完整链；两个已运行用例只约束确需新增的共享抽象。外部 renderer 安装能力仍按真实需求另行实现，不阻挡现成内容展示。

### C. 提前交付位置修复

RS02 产生可操作的右侧路径；RS03 确认五类功能均在右侧可达后，立即执行 RS06 主列归位。RS04 资源核对和 RS05 完整显示设置随后完善，不再作为移除主列 TASKS 的前置。迁入的旧分支同片退出，避免新旧 UI 重复消费数据。不强制经过“聚合面板整体搬一次、再全部重做”的两次移植。

### D. 按影响选择验收

保留 Session/Timeline 改动前后的 production 基准。本次默认 streaming 的右栏开/关及主列几何；缓存/路由/Panel 挂载实际改变时加 tabs，启动/首屏加载改变时加 entry。各片更新实际迁移入口、状态归属、可见性与接缝用例，不重复证明未变化的宿主或领域合同。

命令清单是可选入口，不能机械当成每片全量任务。没有执行层改变时，真实模型调用、路由 preflight、完整 MC 重验均不属于本次 UI 完成条件。样本次数用于获得当前场景的可比较原始记录，不建立机器相关硬阈值。

### E. 保存原布局关系与现有入口

隐藏普通管理 Panel 时保留原已存标签与顺序；恢复沿原 selection/fallback，尊重用户隐藏期间的新选择，不另建隐藏标签缓存。in-flight 状态留在内存 UI owner，可序列化草稿使用既有存储，不新增持久执行日志。

本次也纠正了 Details 的位置描述：其 [renderer](/home/keer/workspace/aigcfroge-v2/packages/gui-extensions/src/details/renderer.tsx:53)提供标题入口与窄窗抽屉，桌面 list 为空。本次保留这些真实入口，不为“统一”额外新建桌面详情标签。

## 4. 保留的防御及其实际触发点

| 实际触发 | 依据 | 保留动作 |
| --- | --- | --- |
| 切 Session/服务或重连后异步结果迟到 | 原 Task/Meta/Workflow owner 与 live ServerRef | 在拥有结果的边界保留原身份与连接代次比较 |
| 同伴 SSE 修改正在编辑的 Task | 原 Task CAS、stale draft 合同 | 原 revision 冲突与草稿保持，不增加第二 CAS 或全局校验 |
| 普通 Panel 切换卸载；在飞写操作尚未结束 | [Task mutate](/home/keer/workspace/aigcfroge-v2/packages/app/src/session/tasks/session-task-panel.tsx:271)、[WorkArtifact cleanup](/home/keer/workspace/aigcfroge-v2/packages/app/src/session/tasks/work-artifact-panel.tsx:266) | 原 pending/token/ACK 跨视图保留，复开继续观察原请求 |
| 隐藏 Browser Panel 后 File 仍可能转交 HTML | [File.openResolvedFile](/home/keer/workspace/aigcfroge-v2/packages/gui-extensions/src/file/renderer.tsx:563)、[Browser.canOpen](/home/keer/workspace/aigcfroge-v2/packages/gui-extensions/src/browser/renderer.tsx:49) | 同一显示偏好参与原路由可用性；保留 File fallback 与明确恢复入口 |
| 新 lazy 视图或 refetch 会向 Session 传播 suspension | 原 RegionContent 与 GUI 局部 Suspense 合同 | 使用原局部边界/latest，不让 Timeline 重挂载 |
| 显示/停用变化影响监听、embed 或 PTY | 原 Panel 可见性和 extension cleanup | UI reads 随可见性，浏览器/终端生命周期继续按原 owner，不把隐藏误作业务取消 |

这些措施均对应本次迁移的具体状态转换。类型化内部值不重复解码，权限仍由原业务边界处理。动态 renderer 等未来入口在本期尚未引入，已从当前防御矩阵移出。

## 5. 实施边界与完成裁决

继续沿原 Task、Delegation、Meta、Workflow、Client Data 与文件/浏览器边界实施。两个 SDK 接缝保留：关联会话导航和已有连接代次读取。它们对应已运行的多个消费者；与首个实际 Panel 同片接入，不为类型接口先新增演示扩展，也不要求后继消费者提前全部迁完。

任务身份仍为 RS00–RS09，本期九项、Custom 后继一项。实际依赖为：

`RS00 → RS01/RS02 → RS03 → RS06 → RS04 → RS05 → RS07 → RS08`。

已有共享文件归属只在实际写入冲突时按原 owner 处理，不增加全仓开工审批。未改动的执行层与原 Meta 功能接受保持；新增 UI 行为由现 keeper/实际窗口验证。外部 renderer、完整 Git 管理或新 Custom 类型按其具体功能链接受。

## 6. 验证声明

本轮为计划审批与文档修订。原始计划 SHA256 为 `a37410d66a2387a8a0c2221500850613a8e62caeecc3646565e1ea04e0d5ef2b`，保存在本次输出目录。两个独立只读复核支持以上宿主与验收减法；路径/行数、RS 编号、修订条款、允许文档差异、HEAD/暂存与既有 WIP 由确定性脚本核验。

生产源码未修改，UI 行为测试与基准在实施时运行。批准对象是修订后的具体计划，源码实施通过必须由其运行工件授予。
