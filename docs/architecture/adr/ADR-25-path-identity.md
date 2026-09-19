# ADR-25: Path Identity 契约（本地可证身份与 unknown 降级）

> 状态：**Accepted**（2026-09-19 Owner 裁决；首版采用 typed `unknown` 基线 + 本地可证的 `realpath` / `device+inode`，不批准 durable alias relation，不修改现有相等性或 `LocationServiceMap` key）
> 日期：2026-09-17
> 事实基线：§1.1 每条事实均于 2026-09-17 在本工作区直接读源码、`grep`、`stat` 复核（file:line 为可复跑证据）；凡未复核的不写作事实。§1.3 记录一处对侦察转述的实测勘误。
> 关联：[全局壳产品闭环计划](../../plan/global-shell-product-closure-2026-09-13.md) §4.3/§11.2/§20、[ADR-23](ADR-23-session-product-identity-capability.md)（只读投影规则）、[ADR-14](ADR-14-persistence-and-scope-strategy.md) §5（迁移与兼容）、[ADR-16](ADR-16-global-home-overview.md)（多 server 收敛）、`packages/app/e2e/coverage-manifest.json` 的 `path-identity` 条目
> 触发来源：计划 §11.2 要求「后端/平台层对本地可证明的路径提供 canonical physical identity 或明确 alias relation」；S8 开工侦察（计划 §11 内联勘误，2026-09-17）确认全仓无任何 owner，并登记 `path-identity`；§22-2 已原则同意单独立 ADR，§4.3 要求 ADR 先于任何 migration 或 endpoint。
> 实现 owner（获批后）：Core resolver `packages/core`；Schema 契约 `packages/schema`；传输走 `packages/aigcfroge` 现有 instance HttpApi group（route 脚手架现位于 `packages/server`，不新建并行投影）；App 只消费 SDK projection

## 1. 背景与问题

### 1.1 起点事实（逐条复核）

| #   | 事实                                                                                                                                                                                                                                                    | 证据（file:line）                                                                                                                                                                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **全仓不存在物理身份原语与 alias 关系。** 对 `inode`/`st_dev`/`st_ino`/`sameFile`/`dev_t` 逐词 `grep -rn` 三个包，命中数均为 0；schema 与 migration 中亦无路径 alias 表或关系（`alias` 仅在 `packages/schema/src/kb-note.ts` 命中文档语义，与路径无关） | 复核命令：`grep -rn "<pat>" packages/core/src packages/schema/src packages/aigcfroge/src`，五词 0 命中                                                                                                                                                                                             |
| 2   | **项目身份不由路径决定。** `Project.resolve` 用 git remote（`git-remote:<host>/<path>` 的 `Hash.fast`）或 repo 内 `aigcfroge` 缓存文件或 root-commit 哈希标识项目；**非 Git 目录一律落到字面量 id `global`**，且返回的 `directory` 是文件系统根         | `packages/core/src/project.ts:110-122`（`:112` 非 Git 分支、`:115` 优先级、`:73-79` remote、`:65-71` 缓存、`:105-108` root）；`ID.global` 定义 `packages/schema/src/project.ts:8`；Session 创建时写入 `project_id` 与**原始** `directory`：`packages/core/src/session.ts:448-454`、`:460`、`:463`  |
| 3   | **目录注册表以 `(project_id, directory)` 为主键，且 `Project.fromDirectory` 写入前经 realpath。** `ProjectDirectories.create` 的 upsert 目标即该复合主键；调用方 `saveProjectDirectory` 先 `FSUtil.resolve` 再 `create`                                 | 表与主键：`packages/core/src/project/sql.ts:21-34`；写入：`packages/core/src/project/directories.ts:65-82`；realpath：`packages/aigcfroge/src/project/project.ts:224-240`（`:229`）→ `packages/core/src/fs-util.ts:230-238`                                                                        |
| 4   | **Location 服务图以原始 `Location.Ref` 为键，且 ref 由 HTTP query/header 原样构造，不经 realpath。** 同一物理目录的两种拼写得到两个 `LayerMap` 条目、两套 Location-scoped 服务图                                                                        | `packages/core/src/location-layer.ts:101`（`lookup: (ref: Location.Ref)`）；`packages/server/src/groups/location.ts:76-81`（原样 decode → `Location.Ref.make`）、`:95-103`（`locations.get(ref(request))`）；`packages/core/src/location.ts:30-38`（`Location.layer(ref)` 直接用 `ref.directory`） |
| 5   | **审批出席判定是目录字符串的裸 `===`。**                                                                                                                                                                                                                | `packages/core/src/permission/approval-presence.ts:98-100`                                                                                                                                                                                                                                         |
| 6   | **App 已有且只有「拼写归一」，并明确不声称物理身份。** `pathKey` 只处理分隔符/尾斜杠/盘符；注册表注释写明「two spellings of one inode remain a backend-owned question」                                                                                 | `packages/app/src/utils/path-key.ts:1-24`；`packages/app/src/context/server.tsx:105-110`（注释 + `sameDirectory`）；单测 `packages/app/src/context/server.test.ts:130-209`                                                                                                                         |
| 7   | **项目行还存在「精确字符串相等」的归属迁移：** 打开目录时把 `project_id = global` 且 `directory` 字符串完全相等的 Session 提升到解析出的项目；非 Git 的 global worktree 被写成 `/`                                                                      | `packages/aigcfroge/src/project/project.ts:335-340`（`eq(SessionTable.directory, data.directory)`）、`:246`（`worktree = ... ? "/" : ...`）、`:245`（`projectV2.resolve`）                                                                                                                         |
| 8   | **依赖层已提供可用观测原语，无需新造 syscall。** Effect `FileSystem.File.Info` 暴露 `dev: number` 与 `ino: Option<number>`（缺失被如实建模）；`FSUtil.Service` 继承该接口，已有 `realPath`/`stat`                                                       | `packages/core/src/fs-util.ts:31`；`node_modules/effect/src/FileSystem.ts:1212-1218`（`File.Info`）、`:285-287`（`stat` 签名）                                                                                                                                                                     |

### 1.2 用户可见后果

- **两套 Location**：同一物理目录的两种拼写（分隔符、尾斜杠、符号链接、bind mount、盘符大小写）各自 boot 一套 Location 服务图（事实 4）；审批出席判定也随之分裂（事实 5）。
- **重复/错误分组**：非 Git 目录**过度合并**——所有非 Git 位置共用一个 `global` 项目、worktree 显示为 `/`（事实 2、7）；而带 alias 的同一目录在目录注册、侧栏条目、Session 的原始 `directory` 上**分组不足**（事实 3、4）。
- **路径变更后历史与别名失配**：历史行持有旧拼写（`session.directory` 原样持久化，事实 2），项目注册可能漂移到另一条（甚至已不存在的）路径。E2E 已记录实例：Session 持久 Location 写 `/media/keer/办公/aigcfroge`，项目注册指向不存在的 `/home/keer/Documents/web/aigcfroge`，真实检出在 `/media/win_data/aigcfroge`（`docs/review/global-shell-e2e-2026-09-10.md:1820`、`:1823`）。
- **系统没有「不知道」这一档**：今天所有判定只有相等/不等两种输出，无法表达「本平台无法证明」。

### 1.3 勘误（2026-09-17 实测，修正侦察转述）

计划 §11 内联勘误把 `/media/keer/办公/aigcfroge` vs `/media/win_data/aigcfroge` 引为「realpath 无法合并的同 inode 别名」。**本机实测：该别名是符号链接**（`ls -la /media/keer/` 显示 `办公 -> /media/win_data`），`os.path.realpath` 与 `readlink -f` 都把它归一到 `/media/win_data/aigcfroge`；两路径 `stat` 同为 device `2072`、inode `152473`。因此：

- realpath **可以**归一并证明这一类别名；它不是该案例的失败原因。该案例的真实失败面是原始拼写被持久化（`session.directory`）并被用作 Location 键，而项目注册发生漂移（事实 2、4）。
- realpath 的真正盲区是「不以符号链接形式出现的别名」：bind mount / mount namespace、网络文件系统导出的同一卷、Windows 盘符与 UNC 拼写、容器内重挂载。契约必须对这一类回答 `unknown`，而不是假装 realpath 已解决。
- 本机第二个观测：本仓所在 `/media/win_data` 是 **`fuseblk`（NTFS-3G via FUSE）挂载**（`/proc/mounts`）。此类文件系统的 inode 由 FUSE 合成，稳定性不能默认成立——这直接约束 §6-B，也是「不按 inode 单独判断」在本仓库的真实依据，而非抽象担忧。
- 复核同时确认计划未提及的第二条注册写入路径：`ProjectCopy` 直接调用 `directories.create`（`packages/core/src/project/copy.ts:206-212`、`:263-271`），不经过 `saveProjectDirectory` 的 realpath。该路径的拼写归一性**未复核**，落地时必须单独核对（§8 记账）。

## 2. 提议契约（DRAFT，待 Owner 裁决）

### 2.1 词汇

本词汇是 path identity 域自有词汇：沿用 ADR-23 的 reason code 纪律（kebab-case 稳定协议、不随 locale 翻译），但**不扩展、不重解释** ADR-23 的 SessionProductIdentity 词汇表。

datum 级：

| 值         | 语义                                                                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `proved`   | 本地证据证明两个引用指向同一物理目录；必须携带 `evidence`（方法与观测键，如 `realpath` 规范路径、`{device, inode}`）                             |
| `degraded` | 结论的唯一依据是一条**已记录**的关系（仅在 Owner 批准 §6-A 的 durable 部分后出现），当前无法重新证明；只可用于展示提示，**不得**据此执行新的合并 |
| `unknown`  | 无法证明；必须携带稳定 reason code                                                                                                               |

比较操作只允许两种输出：`same(refs, evidence)` 或 `unknown(reason)`。**不提供 `different` 操作**。理由：证明「不同」与证明「相同」同样困难（mount namespace 可在不同 device 上暴露同一底层文件），而两类错误的代价不对称——漏合只是维持今天的重复分组；误合会让两个本应区分的身份丢失边界，并把审批、历史、破坏性操作跨目录归并。

### 2.2 证据方法（只允许以下来源）

1. **`realpath`**：两侧 `realPath` 后规范字符串相等 ⇒ `proved`。它消解尾斜杠、`.`/`..`、符号链接拼写，并覆盖 §1.3 的实际案例。
2. **`device+inode`**：两侧均 `stat` 成功、`ino` 为 `Some`、且 `dev` 与 `ino` **同时**相等 ⇒ `proved`。**禁止只用 inode**：跨设备 inode 可重复，必须连同 `dev`。
3. **已记录的 alias 关系**（仅当 Owner 批准 §6-A 的 durable 部分）。

禁止用于判定：原始字符串相等、`pathKey`、路径字符串哈希、realpath 字符串前缀、以及任何「先合并再事后修正」的写入。`realPath`/`stat` 失败（ENOENT/EACCES/平台不支持）不得落为 `proved`；路径不存在不是「不同」，而是 `unknown`。

### 2.3 平台边界（必须能回答「不能证明」）

- **Windows**：盘符大小写、`C:\x` / `C:/x/` / `\\?\C:\x` / UNC、8.3 短名——`ino` 缺失或 `dev` 不可比时返回 `unknown`。
- **WSL**：`/mnt/c/...`、`\\wsl$\...`、`C:\...` 互不可证 ⇒ `unknown`。
- **远端 server**：前端不做任何断言；由远端回答，前端只消费 typed 结果（跨 server 合并仍受 ADR-16 约束）。
- **容器 / mount namespace / bind mount / 网络文件系统**：本层只能观测自身 namespace 的 `stat`；无法区分时 `unknown`。
- reason code 至少包含：`no-local-proof`、`stat-unavailable`、`inode-unavailable`、`not-same-realpath`（仅提示，禁止用于合并）、`recorded-relation-unverified`。扩展是加法；改名是协议破坏。

## 3. Owner 拓扑与消费面

| 层            | Owner                                                                                                             | 约束                                                                                                                                                                                                  |
| ------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core resolver | `packages/core`（Location-scoped；复用 `FSUtil.Service` 的 `realPath`/`stat`，`packages/core/src/fs-util.ts:31`） | 唯一身份判定实现；只读；首步零新增领域表；不复制授权/分组算法                                                                                                                                         |
| Schema        | `packages/schema/src/path-identity.ts`（新文件，命名沿用 `session-identity.ts` 惯例）                             | 全部类型 `annotate({ identifier })`；reason code 为协议；判别式 round-trip 测试                                                                                                                       |
| 传输          | `packages/aigcfroge` 现有 instance HttpApi group（route 脚手架现位于 `packages/server/src/groups/`）              | endpoint 必须带 `OpenApi.annotations({ identifier })`，并有一条断言证明生成后的 SDK 方法存在且可调用（计划 §4.2 硬约束、ADR-23 决策 2 同款）；生成走 `packages/sdk/js/script/build.ts`，不手改 `gen/` |
| App           | 只消费 SDK projection；拼写归一继续用 `pathKey`                                                                   | 不 `stat`、不 `realpath`、不猜测远端路径；`unknown` 时不做任何合并或「不同」断言                                                                                                                      |

**不创建第二投影 owner**：身份判定只有 Core resolver 一处实现；`packages/server` 只承载既有路由脚手架，不因本 ADR 新增并行的业务投影或第二套解析器（沿用 ADR-23 决策 2 的 `packages/server` 行）。App 不复制判定，也不把 `pathKey` 升级成身份。

## 4. 兼容与回滚（§4.3 要求）

### 4.1 本 ADR 自身（第一步）

零 durable 变更：resolver 只读 `realPath`/`stat`，不建表、不写列、不改任何现有判定点。获批后的最小交付 = Schema 契约 + Core resolver +（若批准）一个只读 endpoint。§4.2 的全部判定点第一步保持原样。

### 4.2 现存「关系裁决者」清单（后续任何变更必须逐点核对）

| 判定                | 位置                                                                                | 今天的行为                       |
| ------------------- | ----------------------------------------------------------------------------------- | -------------------------------- |
| 审批出席            | `packages/core/src/permission/approval-presence.ts:98-100`                          | 目录 + workspaceID 裸 `===`      |
| 目录注册主键        | `packages/core/src/project/sql.ts:31-34`、`directories.ts:65-82`                    | `(project_id, directory)` 字符串 |
| global→项目归属提升 | `packages/aigcfroge/src/project/project.ts:335-340`                                 | `directory` 精确字符串相等       |
| Home 项目注册       | `packages/app/src/context/server.tsx:105-110`                                       | `pathKey` 拼写（声明非身份）     |
| 路径边界            | `packages/core/src/fs-util.ts:257-265`、`:270`                                      | 词法 `contains`，不是身份        |
| 非 Git 合并         | `packages/core/src/project.ts:112`、`packages/aigcfroge/src/project/project.ts:246` | 一律 `global` + worktree `/`     |

### 4.3 若未来落地 durable alias 关系（本 ADR 不批准，仅预留要求）

- **clean fixture**：全新 DB 无 alias 行 ⇒ 行为与今天完全一致（全部 `unknown`，无合并）。
- **existing fixture**：历史 `session.directory` 与 `project_directory.directory` 原样可读；解码不得要求先归一；**不批量改写** `session.directory`（ADR-14 §5：项目移动依赖 Location/Project 解析与相对引用，而非改写绝对路径，`docs/architecture/adr/ADR-14-persistence-and-scope-strategy.md:50-52`）。
- **兼容解码**：新增字段对旧客户端可忽略；旧 SDK 不受影响。
- **forward-only 停止/回滚**：停止写入 + 读取时忽略 alias 表 + 保留行（无 down migration）。因消费端只认 `proved`，停用 endpoint 即回到今天的重复分组，不产生数据损坏。回滚单位与计划 §20 同构（`:711`、`:735`）：该能力独立停止，不牵动 S8 生命周期半边。

## 5. 必须不破坏的不变量

1. **ADR-23 只读投影规则**：身份解析不是第二 Session 表、不复制领域真源；若未来有 capability 需要身份，其贡献按 ADR-23 决策 1 的聚合规则折叠，不新建投影。
2. **Location-scoped 服务**：resolver 必须在 Location 内构造（经 `FSUtil`），不得引入进程级、字符串键的全局缓存；`LocationServiceMap` 的键语义本 ADR **不改**（改键是另一项独立决定）。
3. **Session 按项目分组**：`Project.resolve`（`packages/core/src/project.ts:110-122`）继续是项目身份唯一 owner；路径身份不得替换、重推或分叉 `project_id` 归属；不得静默改变现有 Session 的分组。
4. **App 规则**：不 realpath、不猜测（`packages/app/src/context/server.tsx:105-110`）。
5. **V2 Session Core 不变量**（`AGENTS.md`）：身份只读观测，不改变 durable admission、执行、恢复语义。
6. **ADR-16**：跨 server 合并仍为后续项（`docs/architecture/adr/ADR-16-global-home-overview.md:62`、`:68`）；本 ADR 不借路径身份提前实现。

## 6. 候选方案与失败模式（Owner 裁决项）

### Owner 裁决（2026-09-19）

批准 **D 的 typed unknown 基线 + B 的本地可证比较器，并保留 §2.2 的 realpath 证据**：

1. 两侧 realpath 相等时返回 `proved(realpath)`；否则继续尝试同一 server / mount namespace
   内的 `device+inode`。
2. 只有两侧 `dev` 与 `ino` 都存在且同时相等时返回 `proved(device+inode)`；任何失败、缺失、
   不相等或平台不可比都返回 typed `unknown(reason)`，不返回 `different`。
3. **不批准 A 的 durable alias relation**：首版无 migration、无 alias 表、无记录关系的写入面，
   因而 `degraded` 保留为未来加法词汇但首版 resolver 不产生它。
4. **拒绝 C 作为身份判定**；`pathKey`/字符串哈希继续只做拼写归一或数据结构 key，不升级为
   物理身份。
5. 首版只交付 Schema、Core resolver、现有 instance HttpApi/生成 SDK 与判别式 E1/E2；App
   不 realpath、不猜测。任何使用该结果改变项目分组、权限作用域或 `LocationServiceMap` key 的
   消费变更必须另有证据和审批。

批准依据：误合会跨 Location 边界合并审批、历史与破坏性动作，而漏合只保留今天的重复展示；
因此“不能证明就 unknown”是首版的安全默认。无持久化首版也满足计划 §4.3 的顺序要求而不引入
尚无失效策略的新真源。

### A. 可归一化 resolver + 记录 alias 关系

机制：本地能证则证（realpath、device+inode），把无法用 realpath 合并的已验证拼写记录为 durable 关系，之后直接读关系。

优点：唯一能合并「realpath 看不见」的别名（bind mount、重挂载、盘符变体）。

失败模式：新增真源且会过期（目录被替换/重挂载后关系变假，需要失效策略与观测时间）；文件系统不支持时仍必须 `unknown`，无法消灭降级；多 server 下关系是本地的，不能跨 server 传播；需要 migration 与 §4.3 全套夹具。

### B. device+inode 比较器

机制：`stat` 两侧，`dev` 与 `ino` 同时相等 ⇒ `proved`。

优点：复用现有原语（`FSUtil.stat`，事实 8），零持久化，可作为 §2.2 方法 2 的默认实现。

失败模式：网络文件系统（SMB/FUSE/gvfs）的 inode 可能由客户端合成、重启后变化——本机 `/media/win_data` 即 `fuseblk`（§1.3）；`ino` 可能缺失（Effect 已建模为 `Option`，`node_modules/effect/src/FileSystem.ts:1218`）；容器/mount namespace 中同一底层文件可有不同 `dev`；inode 在删除后被复用；**只用 inode 不成立**，必须连同 `dev`。

### C. 路径哈希比较器

机制：对（规范化或原始）路径字符串取哈希后比较。

失败模式：本质仍是字符串判定。大小写不敏感文件系统（`C:\Foo` vs `C:\foo`）、macOS 的 Unicode 归一（NFC/NFD）、8.3 短名、bind mount 全部不可证；对原始拼写取哈希还会把同一目录拆成两个值。除作为 durable 表的主键/去重辅助外，**不能承担身份判定**。

### D. 只把它类型化为 `unknown`（不做任何合并）

机制：契约落地、resolver 恒返回 `unknown(reason)`，消费端保持今天的行为（不合并，也不宣称不同）。

缺点：重复分组与 Location 分裂继续存在（产品缺陷保留）。

优点：零新真源、零迁移、跨平台诚实，且为 A/B 留出纯加法升级路径；是 §4.3「ADR 与 migration/endpoint 解耦」下唯一可立即交付且不引入错误合并的选项。

**起草方建议（非决定）**：先落 D + B 的本地可证部分（realpath 或 `dev`+`ino` 能证时才 `proved`，否则 `unknown`），把 A 的 durable 关系留给 Owner 单独立项。依据是本仓库及本机已见的真实文件系统（`fuseblk`/FUSE，可能的容器/远端）不足以支撑「inode 必稳定」的假设，而 durable 关系引入新真源与迁移成本。Owner 若选择 A，须同时给出 §4.3 的夹具、停止与回滚方案。

## 7. 明确不决定

1. **重定位 UX**：§11.2 的「历史路径失效时显示原路径、当前候选和重定位动作」属 S8 生命周期半边；候选如何发现、以什么动作执行、是否需要审批，均不在本 ADR。
2. **alias 关系是否 durable**：§6-A 的持久化形式、写入方与失效策略需另行批准（含 §4.3 的夹具与回滚）。
3. **S8 生命周期半边的任何内容**：add/edit/delete、颜色、非法/不可访问路径校验、大列表、offline、无项目恢复。
4. **跨 server / 远端路径身份**：ADR-16 仍按当前 server 收敛。
5. **消费决策**：是否/如何用路径身份改变权限 grant 作用域、项目注册去重、或 `LocationServiceMap` 的键——各自需要独立证据，本 ADR 不预设。
6. **`project.id` 是否由路径参与派生**：非 Git 的 `global` 合并行为保持不变。

## 8. 获批状态与 Slice 边界

- **获批状态**：本 ADR 于 2026-09-19 经 Owner 显式委派审批通过（Owner 将裁决权授予审查方，依据 §2 契约形状、§6 方案（不含 durable alias relation）、§3 owner 拓扑）。§22-2 原则同意 → 本次转为 Accepted。§4.3 硬门已满足：ADR 先于任何 migration/endpoint 落地，且本切片**不含 migration、不含 durable alias**。
- **已交付（首版 migration-free 切片，单元已验）**：`packages/schema/src/path-identity.ts`（annotated Schema 契约 + round-trip 测试，schema typecheck 干净 / 3 tests pass）、`packages/core/src/path-identity.ts`（Location-scoped resolver，复用 `FSUtil` `realPath`/`stat`，7 tests pass）、instance HttpApi endpoint（`packages/server/src/groups/path-identity.ts` + `handlers/path-identity.ts`，带 OpenApi identifier `v2.pathIdentity.compare`）、SDK 生成（`packages/sdk/js/src/v2/gen`）、`LocationServiceMap` 内 `pathIdentity` service 接线。
- **仍未交付（按需另立单元）**：App 消费投影、任何 alias 持久化（本 ADR 明确不批准 durable alias relation）。
- 记账：`packages/app/e2e/coverage-manifest.json` 的 `path-identity` 条目在浏览器/E2E 消费证据取得前保持 open，owner 为 S8；单元级已验，端到端消费证据待补。`ProjectCopy` 的目录写入路径（§1.3 末条）与「非 Git 的 `global` 过度合并」保持独立登记，不在本切片范围。
- **编号说明**：`docs/plan/v2-architecture-governance-slice-0-3.md`（§0.2/§7.1 与 §439 的交付物清单）已把 ADR-24 预留给 Composition scopes，因此本文让出该号、使用目录实测的下一个可用号 25。让号的理由是成本不对称：本文是新增草案，改号只需重命名一处；而占用 24 会迫使另一份计划返工它已写死的路径。若 Owner 裁定该预留作废（该计划本身仍是「草案，待人类批准开工」），把本文改回 24 同样只需一次重命名，内容不变。
