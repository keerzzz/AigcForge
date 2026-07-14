# **基于12种工种终端流仿真的多智能体自适应研运协同系统（Micro-Pod）产品需求文档**

> **文档性质：非规范性研究材料（NON-NORMATIVE）**
> 本文不是 AigcForge 已批准的 PRD、ADR 或实现协议。文中的产品能力、外部数据、指标和安全判断可能随时间变化；任何内容进入 `docs/prd/`、`docs/architecture/adr/` 或代码前，必须依据当前一手来源、仓库实现和 owner 评审重新核验。

本产品需求文档致力于定义一套专为企业级软件开发、运维、营销及合规场景设计的多智能体自适应协同微型研运舱（Micro-Pod）1。该系统通过协议化交付、确定性状态机和动态控制门禁，实现多岗位智能体的无缝协作与自动化交付1。

## **12种核心工种PC终端办公流深度仿真与需求真伪判定**

为了构建高效的人机协同网络，系统对12个典型工种的电脑办公流程进行了深入调研1。通过模拟智能体在PC终端上扮演这些角色时的操作路径、屏幕视窗切换以及工具链调用逻辑，本系统提炼出以下核心流程与痛点，并对需求的真伪进行了严格论证1。

### **规划设计域**

产品负责人（PO）日常工作通常需要在Productboard的需求漏斗、Jira的开发看板以及Excel数据统计表之间进行高频切换1。其面临的瓶颈在于商业逻辑到技术实现的链路经常脱节，常常引发项目scope creep。因此，能够自动评估功能ROI、并根据系统依赖拓扑建立可追溯的需求依赖关系是真正的核心需求1。而由AI自动批量生成数个未经商业验证的功能列表则是典型的伪需求，它只会向待办列表（Backlog）中灌入垃圾信息，增加团队的排期负担1。
业务分析师（BA）在PC终端上频繁使用Draw.io绘制业务流图，在Confluence中编写庞杂的需求规格说明书，并在Swagger中审查接口语义规范1。痛点在于由于技术细节不匹配导致业务规则在传递中失真。真正的需求在于利用领域驱动设计思维，将繁杂的业务说明自动化解构成符合BDD规范的、包含明确 Given-When-Then 结构的Gherkin标准故事1。而类似“会议录音自动总结”这样的通用转录工具则是伪需求，因为缺乏领域建模的转录文本无法直接被后续研发智能体直接消费1。
体验设计师（UI/UX）日常在Figma画布上进行高密度的矢量操作，并借助Tokens Studio插件维护企业级设计系统1。其核心痛点是设计图中的色彩、边距和排版参数在向代码转换时极易出现微观维度的失真漂移。真正的需求在于建立一条能从Figma Styles与Variables中自动提取并同步语义化Design Tokens的代码级管道4。然而，由大模型根据草图直接生成不附带任何组件库映射、缺乏响应式自适应布局的静态HTML界面则是伪需求，无法被工业级的前端工程采纳1。

### **技术研发域**

系统架构师通常在终端中通过Mermaid.js或Archimate绘制系统拓扑结构，并在Markdown文件中撰写复杂的架构决策记录（ADR）1。真正的痛点在于代码库的演进在长周期中逐渐脱离了最初的技术决策，累积了大量技术债。因此，架构师的真需求在于ADR决策与代码结构规则之间的强一致性双向校验1。而一键生成完整的大型服务脚手架则是伪需求，因为脱离了安全合规、认证授权以及特定网络拓扑的脚手架代码无法具备直接上线的可行性1。
前端开发（FE）在VS Code中编写组件，频繁在Figma Dev Mode、Chrome DevTools以及Playwright之间进行视窗切换1。在PC终端上的核心痛点在于繁琐的样式像素微调和冗长的接口Mock假数据编写6。真需求在于自动加载Figma Variables生成的Tokens单例，并通过自动化UI比对迭代机制降低联调损耗5。相对而言，不带约束、不关联已有组件库的通用AI“氛围感编程”（Vibe Coding）是典型的伪需求，会带来灾难性的冗余代码与维护危机1。
后端开发（BE）的PC界面通常由IntelliJ IDEA或GoLand、Docker终端以及DataGrip数据库客户端构成1。高并发场景下的数据幂等性、并发冲突和数据库迁移（Migration）错误是其面临的主要系统运行威胁1。因此，后端工程师的核心真需求是对API契约和多线程临界区进行静态及动态的幂等性检验与并发冲突分析1。相对地，自动生成没有锁机制、没有空值异常防线和合规审查的裸CRUD代码则是伪需求，这往往会导致严重的生产事故1。

### **运维质保域**

测试质保（QA）频繁在Playwright、Selenium或Postman等自动化测试及接口测试工具中编写测试脚本1。最大的挑战是前端代码的小幅改动常导致自动化测试中的硬编码元素定位器（Selectors）大面积失效，产生极高的脚本维护成本11。因此，QA的真需求在于利用演示驱动学习（Demonstration-based Learning）建立自适应的Web元素检测算法11。而纯粹的手工录制回放则是伪需求，无法抵御敏捷交付下的高频回归压力11。
运维可靠性（SRE）专家经常在Kubeconfig关联的终端、Lens、Prometheus监控面板以及Grafana看板之间进行高频巡检12。在发生高等级系统故障（SEV-1）时，传统的手工拉取日志和关联排查耗时长，认知过载严重12。SRE的真需求在于集成K8sGPT这一类具备规则检测和AI根因分析能力的探针，将低级错误自动转译，并通过自愈算法生成修复补丁12。而无人类监督审计、直接在线运行并能改动集群全局路由的全自动故障自愈则是伪需求，会带来极大的系统失控风险15。

### **增长营销域**

增长黑客（Growth）常驻Optimizely、Google Analytics和HubSpot等系统，其瓶颈在于需要耗费大量时间手工编写分析脚本并验证A/B测试的置信度1。其核心真需求是通过PandasAI对原始数据进行清洗，并运用CUPED算法进行方差削减计算，快速确定实验的统计学显性1。而追求无品牌约束、无统计置信度验证的纯爆款文案自动投递，是无意义的伪需求1。
营销运维（MarOps）在Salesforce、Zapier和邮件发送系统之间编排复杂的自动化销售管道，面临多渠道内容同步断裂与版权/合规性漏洞1。其真需求是在营销发布管道中配置智能追踪门禁，如通过Kai CMO Harness追踪文案声明的证据链，验证其与底座产品库功能的一致性1。手工导数或无合规控制的一键全网推送，是导致企业品牌资产受损的伪需求1。
数据分析师（Data）在Jupyter Notebook中进行ETL数据清洗和复杂因果推断1。痛点在于临时取数（Ad-hoc Query）请求过度淹没日常，沟通效率极低18。真需求是利用大语言模型将自然语言转换为可直接运行、且经过schema字典强校验的SQL分析流1。而只报不析的静态仪表盘堆积，是典型的伪需求1。
合规风控官操作OneTrust和敏感词扫描仪，其PC终端的核心任务是拦截隐私数据通过大模型API向外流动20。真需求是基于Presidio网关构建双向的去标识化代理，在API传输入口实现不带业务摩擦的动态加解密20。而由于不信任技术、采取简单粗暴的断网或完全阻断大模型API使用的做法，则是伪需求，它完全破坏了业务研发的吞吐效率17。

| 职能领域 | 角色名称 | 核心工具链 | 核心真需求 | 伪需求判断 |
| :---- | :---- | :---- | :---- | :---- |
| **规划设计** | PO | Jira, Productboard1 | 商业ROI指标量化、可追溯的需求依赖关系拓扑1 | 自动生成海量未经验证的功能列表1 |
|  | BA | Confluence, Draw.io1 | 领域驱动设计、BDD Gherkin标准故事自动生成1 | 会议录音一键总结等通用转录1 |
|  | UI/UX | Figma, Tokens Studio1 | Figma 语义化 Design Tokens 提取与同步4 | 无法直接被研发消费的静态UI图生成1 |
| **技术研发** | 架构师 | Archimate, Mermaid1 | ADR 技术决策与代码结构规则双向校验1 | 缺乏安全合规机制的脚手架一键生成1 |
|  | FE | React, Next.js1 | 基于Tokens的样式绑定、自动响应式与UI自愈1 | 缺乏工程约束和组件映射的“氛围感编程”1 |
|  | BE | Spring Boot, Go1 | 接口幂等性保证、多级并发控制、SQL静态审计1 | 缺乏并发控制和异常处理的裸CRUD生成1 |
| **运维质保** | QA | Playwright, PyRIT1 | 演示学习自适应元素检测、测试左移合规拦截1 | 依赖静态定位器且易碎的录制型UI测试11 |
|  | SRE | K8s, k8sgpt1 | 基于K8sGPT的Telemetry分析、AIDE代码自愈12 | 无人类验证的、具有高系统风险的自动变更15 |
| **增长营销** | Growth | Optimizely, HubSpot1 | PandasAI 数据清洗、A/B测试CUPED方差削减1 | 缺乏品牌约束和置信度检验的文案乱投1 |
|  | MarOps | Salesforce, Zapier1 | 跨渠道营销流编排、文案声明证据链事实校验1 | 手工导数与无合规保障的自动发布1 |
|  | Data | SQL, PandasAI1 | 基于Schema字典校验的SQL自然语言分析流1 | “报而不析”的指标看板与静态图表堆叠1 |
| **垂直/安全** | 风控官 | 渗透工具, Presidio1 | 跨境资金流向追溯、PHI/PII敏感数据在线脱敏1 | 简单粗暴的断网或完全阻断AI API调用17 |

## **Micro-Pod 协同状态机与底层通信协议规范**

Micro-Pod摒弃了基于非结构化文本会话（Conversational）的协作模式，转而采用以“协议”和“状态机”为核心的控制架构，以此消解多智能体交互中的信息熵1。

### **智能体通信协议与交付物规范**

系统中每个独立智能体都配有一个 .agf.yaml 规格描述文件作为其向外界暴露的接口契约24。此文件不仅定义了其身份和输入输出格式，还严格圈定了其可调用的操作空间、执行策略与约束边界24。

YAML
\# 智能体规格定义规范 (.agf.yaml)
metadata:
  name: "BackendDeveloperAgent"
  version: "2.1.0"
  classification: "Development.Backend" \[cite: 24\]
interface:
  inputs:
    api\_schema: "application/json"
    database\_migration\_script: "text/x-sql"
  outputs:
    executable\_patch: "text/x-patch"
    unit\_test\_report: "application/json" \[cite: 24\]
action\_space:
  tools:
    \- "database\_connector"
    \- "code\_compiler"
  mcp\_servers:
    \- "secure\_sandbox\_mcp" \[cite: 6, 24\]
execution\_policy:
  pattern: "agf.sequential"
  max\_iterations: 5 \[cite: 24, 25\]
constraints:
  token\_budget: 150000
  restricted\_paths:
    \- "/infra/secrets/\*" \[cite: 24, 26\]

系统内部采用 A2A（Agent-to-Agent）协议通信24。各智能体通过在端口暴露 /.well-known/agent.json（智能体名片）来发布其自身能力，以便其他智能体进行动态发现与任务派发25。系统交互的状态转移由确定性的工作流图 ![][image1] 规定，确保每一步交付均有对应的验证逻辑进行闭环控制2。

### **运行时控制与防线管理**

在多智能体系统运行期间，为防止智能体发生逻辑死锁或无限循环等失控行为，Micro-Pod在底层通信网关中引入了以下运行时保护机制：

* **追加式历史审计（Append-only History）**：所有智能体对共享状态（Shared State）的修改仅能以日志追加的形式写入，绝对禁止覆写历史记录，从而提供完整的黑匣子审计链路26。
* **单智能体状态回滚（Per-agent Rollback）**：当某一阶段的交付物未通过后续验证门禁时，系统支持仅撤销该特定开发智能体所做的状态变更，而不影响先前的稳定状态26。
* **Token 配额限制（Token Budget Tracking）**：每个 .agf.yaml 中配置了明确的单次运行 Token 消耗上限，网关在检测到某一智能体陷入无限代码编译纠错循环时，会自动触发中断并强制挂起，等待人类干预24。

## **核心功能模块详细设计**

### **模块一：Compliance-as-Code（协议化交付引擎）**

该模块旨在消除产品业务决策到技术实现之间的语义偏离，将所有需求变动转换为强类型的数据结构1。

* **BDD/Gherkin 解析转化管道**：业务分析师（BA）智能体在Confluence需求池中识别到新故事后，自动调用Gherkin生成工具将其转译为结构化的 Feature 描述文件1。此格式文件可直接被QA智能体消费，并使用Playwright直接翻译为自动化测试脚本1。
* **OpenAPI 3.0 双向契约网关**：架构师与后端智能体协同制定 API 契约，直接生成 OpenAPI 3.0 规范文件1。当前端或后端智能体尝试擅自修改接口参数或返回值类型时，解析引擎会判定该修改违反了契约，并在代码提交前予以阻断。

### **模块二：自动化设计还原与视觉走查门禁**

本模块建立了从Figma设计文件到前端可执行代码的自动化验证链路，消除了“样式不一致”的行业顽疾5。

* **Figma 语义 Design Tokens 提取**：利用Figma MCP（Model Context Protocol）服务器，系统连接并解析指定的Figma设计框图，定位其间定义的 Styles 和 Variables5。提取出来的原始设计变量经过 Style Dictionary 转换，自动生成前端专用的 QML Singleton 或 React Tailwind 配置文件4。
* **Playwright 响应式与视觉差对比系统**：前端智能体（FE）基于提取的 Tokens 自动生成UI组件5。之后，Playwright 启动 Headless 浏览器渲染该页面，自动在 Desktop（1920x1080）和 Mobile（375x812）等多个分辨率下捕获屏幕图像4。系统使用差分算法对比浏览器截图与 Figma 原始导出的 variant 设计稿，若像素不一致性比例超过 ![][image2] 门槛，或者由于缺失语义组件导致 DOM 结构异常，Stop Hook 会强制拦截其 Git 提交，并生成视觉差异报告发回前端智能体进行再校准6。

### **模块三：多智能体红队攻防安全网关（基于 PyRIT 与 Rampart）**

为了杜绝由于引入AI自动编码而导致的供应链漏洞或代码注入等安全威胁，系统在 CI/CD 中嵌入了动态红队与静态安全审计模块23。

* **PyRIT 动态红队靶场**：在编译完成的代码进入测试沙箱后，系统集成 PyRIT 框架自动对智能体系统实施对抗性评估23。它能模拟攻击者发起 CrescendoAttack（渐进式升级攻击）或 TreeOfAttacksWithPruning（TAP，剪枝树攻击），探查系统对于 SQL 注入、系统提示词窃取以及未授权越权操作的防护底线，并在检测到逃逸时自动挂起部署流28。
* **Rampart 管道级持续漏洞扫描**：Rampart 插件直接作用于代码提交与编译入口（Dev-Time），在智能体编写代码的过程中实时拦截不安全的依赖注入，对可能包含敏感越权操作、数据库越权访问的补丁进行直接封禁，提供强有力的底层安全防线29。

### **模块四：SRE 智能体自愈与联合会诊系统（基于 K8sGPT 与 AIDE ML）**

此模块是生产环境和沙箱的核心自愈引擎，负责在系统崩溃时自动分析并生成修复补丁1。

* **K8sGPTTelemetry 分析网关**：K8sGPT 作为 Model Context Protocol（MCP）服务器，通过 kubeconfig 与 Kubernetes 保持双向 JSON 通信13。它负责实时监控集群并运行 podAnalyzer、pvcAnalyzer、ingressAnalyzer 等模块，提取诸如 CrashLoopBackOff、PVC 无法挂载等底层复杂异常12。K8sGPT 提取的故障日志，经过脱敏处理后，封装为标准化诊断报告投递至修复队列13。
* **AIDE ML 树搜索代码自愈引擎**：AIDE ML 智能体接收到故障报告后，利用树搜索算法在代码和配置解空间内寻找最佳补丁16。自愈算法的核心实现逻辑在 aide/agent.py 与 aide/journal.py 中体现33：
  * **Journal 树状解存储**：整个自愈演进过程存储于 Journal 数据结构中，每个尝试的修复方案都被建模为一个 Node，包含 plan（修复思路）、code（补丁代码）、term\_out（沙箱运行终端输出）、analysis（AI自我诊断结果）、metric（测试评价分数，用于评估修复程度）以及 is\_buggy（是否导致编译报错的布尔标识）33。
  * **自愈演化策略**：AIDE 依据 search\_policy 执行以下三类动作33：
    1. **Draft 动作**：当故障初始输入时，智能体根据原始环境信息创建 num\_drafts 个基准修复节点33。
    2. **Improve 动作**：选择无 bug 且 metric 指标最优的节点作为 parent，由 AI 进行原子级别的代码或配置微调（例如尝试更换镜像版本或修正 PVC 存储卷声明），繁衍 child 修复节点33。
    3. **Debug 动作**：当某一修复方案的 is\_buggy 状态为 true 时，系统依据 debug\_prob 概率配置，将当前异常的 stderr 日志和代码直接注入调试模块，强制生成 debug 节点来修正当前链路上的语法或运行时报错33。

### **模块五：Presidio 隐私保护与去标识化网关**

为防止智能体在与公网大模型 API 交互或将日志落地时泄露机密和用户隐私，系统集成了全套数据脱敏代理1。

* **APIM 边缘双向加解密网关**：系统在 Azure API Management (APIM) 网关入口配置了反向代理，所有的智能体大模型交互流均须通过此代理20。
* **AnalyzerEngine 敏感识别**：代理接收到智能体发送的 prompt 后，调用 Presidio 核心的 AnalyzerEngine21。结合基于预训练模型（如 spaCy 或 Stanza）和命名实体识别（NER）技术，实时捕捉 PII（个人身份信息）与 PHI（受保护健康信息）21。
* **AnonymizerEngine 与对称加密**：检测到的敏感实体（如“张三”）会被 AnonymizerEngine 替换为对称加密的 surrogate token（如 \[SECURE\_TOKEN\_9481\]），其加密密钥动态从 Azure Key Vault 获取，且映射字典仅临时托管在 APIM 本地 context 变量中20。
* **反向去标识化（Re-identification）**：外部大模型仅在密文 Token 环境下进行推理，当推理回复通过 APIM 网关流回时，APIM 提取本地字典进行反向解密，使最终人类用户在终端屏幕上看到的回复依然包含完整语义，而公网传输和日志记录中不留存任何明文隐私20。

## **运行时质量门禁与人机协同治理框架**

为了确保智能体集群在进行自动化交付时不会因自主行为引发非预期的系统崩溃，Micro-Pod 架构确立了严密的四级运行时质量门禁与 RACI 协同治理体系1。

### **四级质量门禁（Quality Gates）**

针对智能体交互和状态转移中的每一个关键控制点，系统设置了以下四类不同控制级别的质量门禁36：

* **1级：建议门禁（Advisory）**：无阻塞，仅在后台追溯数据库（如 Neo4j 知识图谱）中记录事件，不干扰流程运行36。
* **2级：验证门禁（Validating）**：非阻塞异步网关，智能体可正常生成其制品，但该制品在未获得人类相关角色签字（Sign-off）前，不允许合并至主开发分支36。
* **3级：阻断门禁（Blocking）**：强同步阻塞。一旦触发，智能体的当前执行步骤会立刻挂起（Stop Hook 激活），并迫使智能体根据反馈提示重新演化，通过门禁后方能释放流水线27。
* **4级：升级门禁（Escalating）**：强同步阻塞。若触发严重异常（如 AIDE 纠错 Token 耗尽或检测到高危安全攻击），流程暂停，自动开启服务级别协议（SLA）升级机制，并在 15 分钟内通过即时通讯软件向人类负责人发出紧急求助26。

### **人机协同 RACI 矩阵**

系统摒弃了盲目无监管的“全自治”，建立了智能体作为主要执行人、人类作为最终责任人的明确问责链条1。

| 研发阶段与状态转换 | 执行者 (R) | 问责者 (A) | 审阅者 (C) | 知会者 (I) | 门禁级别 |
| :---- | :---- | :---- | :---- | :---- | :---- |
| **业务需求 Gherkin 标准定义** | BA 智能体1 | 人类 PO1 | 架构师智能体1 | 全体开发智能体 | 2级 (Validating)36 |
| **视觉 Design Tokens 同步** | UI/UX 智能体1 | 人类 UI 组长 | 前端智能体1 | 业务分析师智能体 | 2级 (Validating)36 |
| **功能代码与单元测试生成** | FE/BE 智能体1 | 人类 技术负责人1 | QA 智能体1 | 架构师智能体 | 3级 (Blocking)36 |
| **红队攻防与 PII 合规检测** | QA / PyRIT1 | 人类 安全合规官1 | 架构师智能体 | SRE 智能体1 | 3级 (Blocking)36 |
| **生产发布与基础设施配置** | SRE 智能体1 | 人类 运维总监17 | 安全合规官1 | 全体项目组成员 | 4级 (Escalating)36 |

### **动态风险自适应审核模型**

在决定是自动执行变更还是诉诸人类介入时，系统通过预置的动态评分器计算风险值。该模型的参数构成与计算方式如下17：
![][image3]

| 变量名称 | 业务含义 | 评估基准 | 预设权重系数 |
| :---- | :---- | :---- | :---- |
| **![][image4]** | 变更影响力 | 涉及的核心微服务、系统底层依赖层级。取值范围 ![][image5]。 | ![][image6] |
| ![][image7] | 变更可逆性 | 衡量回滚恢复的难易程度。完全可逆时取值为 ![][image8]；不可逆时为 ![][image9]。 | ![][image10] |
| ![][image11] | 爆炸半径 | 评估变更若引发故障所影响的 QPS 数量。取值范围 ![][image5]。 | ![][image12] |
| ![][image13] | 证据可信度 | 涵盖单元测试覆盖率、边界断言密度等。取值范围 ![][image5]。 | ![][image14] |
| ![][image15] | 合规敏感度 | 是否涉及核心支付、PHI/PII、跨境资产等。取值范围 ![][image5]。 | ![][image16] |

根据计算得出的风险评估结果，系统自动映射到以下对应的执行和审批轨道上17：

* ![][image17]：**全自动化部署轨道**。系统完成单元测试和 SAST 静态分析后，自动合并代码并发布，无需任何人类确认17。
* ![][image18]：**条件验证轨道**。系统依赖智能体 Verifier 判定安全指标与测试断言，如果置信度评分超过 ![][image19]，允许无感合入17。
* ![][image20]：**人类单签轨道 (HITL Gate)**。系统挂起流水线，自动汇总包含“架构变动说明、安全红队 PyRIT 报告、测试覆盖凭证、可逆回滚脚本”的审计包发给相关技术组长，由其进行一键确认后方能继续17。
* ![][image21]：**双签升级审批轨道**。此区间涉及可能导致数据不一致或严重合规问题的操作，必须由两名人类技术主管和安全主管共同进行数字硬签名，并且在审批挂起期间强制启动 24 小时 SLA 倒计时17。

## **垂直领域适配与边缘部署配置**

### **金融服务：PCI-DSS 超级安全配置**

在金融微型舱部署中，系统底层全面激活零信任网络拓扑，禁止任何明文凭证（Credentials）在智能体代码及环境中存储。所有的 API 通信密钥均由 A2A 通信总线从 HashiCorp Vault 进行短周期动态拉取。同时，流水线中强制实施 3 级阻断门禁，一旦 SAST 扫描发现代码中存在明文泄露或任何可注入路径，系统立即阻断并清除相关代码上下文，向安全合规官触发升级报警1。

### **医疗健康：HIPAA/GDPR PHI 本地去标识化配置**

在医疗健康场景中，Micro-Pod 采用全本地化的去标识化架构38。当涉及临床病历、医学图像（如 X 光 DICOM 文件）或患者敏感属性的读写请求时，数据在离开医院专网防火墙前必须强制流经本地 Presidio Image Redactor 和 Analyzer 节点21。任何含有患者姓名、电话、医院序列号等 18 类 HIPAA 定义的直接标识符将被对称置换为加密 Surrogate Token，确保不将敏感健康数据（PHI）直接上传至公网模型，在确保信息机密性的前提下让智能体集群辅助进行医学研究和数据分类20。

### **零售电商：Kai CMO 事实溯源与 Web 走查配置**

在面向高流量电商的增长营销中，系统绑定 Kai CMO Harness 模块，通过其内置的 54 套营销 Playbooks 和 36 类验证清单对所有社交推文、GEO 搜索引擎优化描述以及邮件营销（Email Ads）内容进行全面管控19。所有文案生成必须通过 claim-to-evidence 事实溯源链，确保生成的促销比例、产品功能描述完全在底层代码库（Repository）中具备可支撑的事实凭证，严禁生成超越产品底座能力的虚假营销内容19。对于前台着陆页（Landing Pages）的修改，系统自动调度演示驱动 WebAgent 进行 3 阶段元素走查，从而在动态的前端界面中确保高达 ![][image22] 的任务完成率和 ![][image23] 的执行一致性，防止由于界面改动导致下单链路受阻11。

## **结论与系统级演进展望**

本产品需求文档勾勒了一套具备高度工程化约束、自适应演进和高容错度的多智能体协同研运系统（Micro-Pod）1。通过将 12 大工种的日常 PC 终端办公流程转化为标准协议约束的 Agent-S 状态机，系统打破了传统基于非结构化对话协同模式的低效与不可控性1。在未来演进中，Micro-Pod 将结合 AIDE ML 树搜索决策以及 K8sGPT 等实时 Telemetry 探针，推动系统的自愈能力向全链路自适应重构的方向发展12。在追求生成式人工智能所带来的十倍研发效能飞跃的同时，本系统为企业级软件的可信构建、安全合规以及高质量发布，提供了一套坚固而富有弹性的运行时防御防线1。

#### **引用的著作**

1. [https://drive.google.com/open?id=1Z44LMi65jtb0r5OrlLRVORLQNq8AKhy8gwHqX3gWgi8](https://drive.google.com/open?id=1Z44LMi65jtb0r5OrlLRVORLQNq8AKhy8gwHqX3gWgi8)
2. Building & Debugging a Multi-Agent System | Airline Turnaround Tutorial \- Cognizant, [https://www.cognizant.com/us/en/ai-lab/blog/building-debugging-multi-agent-system](https://www.cognizant.com/us/en/ai-lab/blog/building-debugging-multi-agent-system)
3. SOP-Agent Framework Overview \- Emergent Mind, [https://www.emergentmind.com/topics/sop-agent-framework](https://www.emergentmind.com/topics/sop-agent-framework)
4. The design token pipeline: from design tool to codebase \- Zeroheight, [https://zeroheight.com/learn/the-design-token-pipeline-from-design-tool-to-codebase/](https://zeroheight.com/learn/the-design-token-pipeline-from-design-tool-to-codebase/)
5. Introducing Qt's Figma Design System Extraction Skills for Developers, [https://www.qt.io/blog/introducing-the-agentic-figma-design-extraction-skills](https://www.qt.io/blog/introducing-the-agentic-figma-design-extraction-skills)
6. Turn Figma designs into code | Codex use cases \- OpenAI Developers, [https://developers.openai.com/codex/use-cases/figma-designs-to-code](https://developers.openai.com/codex/use-cases/figma-designs-to-code)
7. Designing for the Age of AI: An End-to-End Guide to Figma-to-Code Workflows for Enterprise Teams \- Kajoo.ai, [https://kajoo.ai/blog/designing-for-the-age-of-ai-an-end-to-end-guide-to-figma-to-code-workflows-for-enterprise-teams](https://kajoo.ai/blog/designing-for-the-age-of-ai-an-end-to-end-guide-to-figma-to-code-workflows-for-enterprise-teams)
8. URSA: The Universal Research and Scientific Agent \- arXiv, [https://arxiv.org/html/2506.22653v2](https://arxiv.org/html/2506.22653v2)
9. Build an AI Workflow to Convert Figma Designs to Code with a Self-Correction Loop, [https://www.chatprd.ai/how-i-ai/workflows/build-an-ai-workflow-to-convert-figma-designs-to-code-with-a-self-correction-loop](https://www.chatprd.ai/how-i-ai/workflows/build-an-ai-workflow-to-convert-figma-designs-to-code-with-a-self-correction-loop)
10. FrontendX: The AI Agent That Converts Your Figma Design Into a Verified React App, [https://xccelera.ai/blogs/frontendx-the-ai-agent-that-converts-your-figma-design-into-a-verified-react-app/](https://xccelera.ai/blogs/frontendx-the-ai-agent-that-converts-your-figma-design-into-a-verified-react-app/)
11. Agent-Ops: A Multi-Agent Orchestration Framework for End-to-End SOP Automation in E-Commerce Operations \- ACL Anthology, [https://aclanthology.org/2026.acl-industry.29.pdf](https://aclanthology.org/2026.acl-industry.29.pdf)
12. K8sGPT: The Basics And A Quick Tutorial | Octopus Deploy, [https://octopus.com/devops/kubernetes-management/k8sgpt/](https://octopus.com/devops/kubernetes-management/k8sgpt/)
13. K8sGPT: AI-Powered Kubernetes Troubleshooting Explained \- SQUER, [https://www.squer.io/blog/k8sgpt-essentials-unlocking-kubernetes-insights-with-ai](https://www.squer.io/blog/k8sgpt-essentials-unlocking-kubernetes-insights-with-ai)
14. Kubernetes Troubleshooting with K8sGPT: AI-Assisted SRE Guide | by Vishnu Priya VR, [https://generativeai.pub/kubernetes-troubleshooting-with-k8sgpt-ai-assisted-sre-guide-28752c72acf9](https://generativeai.pub/kubernetes-troubleshooting-with-k8sgpt-ai-assisted-sre-guide-28752c72acf9)
15. K8sGPT: Bringing AI-Powered Troubleshooting to Kubernetes | by Yaswanth Reddy Arumulla | Medium, [https://medium.com/@yaswanth.arumulla/k8sgpt-bringing-ai-powered-troubleshooting-to-kubernetes-2b1c96e17115](https://medium.com/@yaswanth.arumulla/k8sgpt-bringing-ai-powered-troubleshooting-to-kubernetes-2b1c96e17115)
16. AIDE ML — The Machine Learning Engineering Agent \- TheDocumentation, [https://thedocumentation.org/aideml/](https://thedocumentation.org/aideml/)
17. Designing HITL gates for agentic workflows: placement, thresholds, and safe autonomy, [https://gist.github.com/prasad-kumkar/36c847ffc99681a657ee4a1d7f1a5d46](https://gist.github.com/prasad-kumkar/36c847ffc99681a657ee4a1d7f1a5d46)
18. Open-source AutoML projects in 2026 \- MLJAR Studio, [https://mljar.com/blog/open-source-automl-projects-in-2026/](https://mljar.com/blog/open-source-automl-projects-in-2026/)
19. GitHub \- cgallic/kai-cmo-harness: Open-source AI CMO for Claude Code: marketing agent skills for SEO, content, email, ads, launches, CRO, AEO/GEO, and AI-search visibility., [https://github.com/cgallic/kai-cmo-harness](https://github.com/cgallic/kai-cmo-harness)
20. Presidio as an LLM Guardrail \- DEV Community, [https://dev.to/bspann/presidio-as-an-llm-guardrail-gcf](https://dev.to/bspann/presidio-as-an-llm-guardrail-gcf)
21. Microsoft Presidio: PII Detection Guide 2026 | explainx.ai Blog, [https://explainx.ai/blog/microsoft-presidio-pii-detection-anonymization-guide-2026](https://explainx.ai/blog/microsoft-presidio-pii-detection-anonymization-guide-2026)
22. (PDF) Enterprise-Scale PII De-Identification with Microsoft Presidio Anonymizer: Architecture, Use Cases, and Best Practices \- ResearchGate, [https://www.researchgate.net/publication/399570056\_Enterprise-Scale\_PII\_De-Identification\_with\_Microsoft\_Presidio\_Anonymizer\_Architecture\_Use\_Cases\_and\_Best\_Practices](https://www.researchgate.net/publication/399570056_Enterprise-Scale_PII_De-Identification_with_Microsoft_Presidio_Anonymizer_Architecture_Use_Cases_and_Best_Practices)
23. Evaluating PyRIT for Agentic AI Red Teaming \- Cloud Security Alliance (CSA), [https://cloudsecurityalliance.org/artifacts/evaluating-pyrit-for-agentic-ai-red-teaming](https://cloudsecurityalliance.org/artifacts/evaluating-pyrit-for-agentic-ai-red-teaming)
24. Agent Format: A Declarative Standard for AI Agents \- Snap Engineering, [https://eng.snap.com/agent-format](https://eng.snap.com/agent-format)
25. Multi-Agent Systems: Orchestrating AI Agents with A2A Protocol | by Yusuf Baykaloğlu | Medium, [https://medium.com/@yusufbaykaloglu/multi-agent-systems-orchestrating-ai-agents-with-a2a-protocol-19a27077aed8](https://medium.com/@yusufbaykaloglu/multi-agent-systems-orchestrating-ai-agents-with-a2a-protocol-19a27077aed8)
26. Multi-Agent Systems: Coordinating AI Agents for Complex Tasks \- Medium, [https://tutorialq.medium.com/multi-agent-systems-coordinating-ai-agents-for-complex-tasks-1743fe7855ba](https://tutorialq.medium.com/multi-agent-systems-coordinating-ai-agents-for-complex-tasks-1743fe7855ba)
27. Quality Gates for Coding Agents: How Stop Hooks Add Validation Checkpoints | fbakkensen, [https://fbakkensen.github.io/ai/devtools/development/2026/03/27/quality-gates-for-coding-agents-how-stop-hooks-make-validation-mandatory.html](https://fbakkensen.github.io/ai/devtools/development/2026/03/27/quality-gates-for-coding-agents-how-stop-hooks-make-validation-mandatory.html)
28. Securing Your AI Agents Before They Ship: Red Teaming with Microsoft PyRIT, [https://techcommunity.microsoft.com/blog/appsonazureblog/securing-your-ai-agents-before-they-ship-red-teaming-with-microsoft-pyrit/4515514](https://techcommunity.microsoft.com/blog/appsonazureblog/securing-your-ai-agents-before-they-ship-red-teaming-with-microsoft-pyrit/4515514)
29. Meet Rampart and Clarity, Microsoft's new red team combo AI agents | CyberScoop, [https://cyberscoop.com/microsoft-rampart-clarity-agentic-ai-security-red-teaming-tools/](https://cyberscoop.com/microsoft-rampart-clarity-agentic-ai-security-red-teaming-tools/)
30. AI Red Teaming Agent \- Microsoft Foundry, [https://learn.microsoft.com/en-us/azure/foundry/concepts/ai-red-teaming-agent](https://learn.microsoft.com/en-us/azure/foundry/concepts/ai-red-teaming-agent)
31. Automating AI Red Teaming with Microsoft PyRIT: A Deep Dive | by Sankalp Salve \- Medium, [https://medium.com/@xsankalp13/automating-ai-red-teaming-with-microsoft-pyrit-a-deep-dive-ce18d0bd8d44](https://medium.com/@xsankalp13/automating-ai-red-teaming-with-microsoft-pyrit-a-deep-dive-ce18d0bd8d44)
32. GitHub \- WecoAI/aideml: AIDE: AI-Driven Exploration in the Space of Code. The machine Learning engineering agent that automates AI R\&D., [https://github.com/wecoai/aideml](https://github.com/wecoai/aideml)
33. Agentic Tree Search \- Core Concepts \- aideml documentation \- TheDocumentation, [https://thedocumentation.org/aideml/concepts/agentic\_tree\_search/](https://thedocumentation.org/aideml/concepts/agentic_tree_search/)
34. Balancing Innovation With Safety & Privacy in the Era of Large Language Models (LLM), [https://medium.com/data-science/balancing-innovation-with-safety-privacy-in-the-era-of-large-language-models-llm-a63570e4a24a](https://medium.com/data-science/balancing-innovation-with-safety-privacy-in-the-era-of-large-language-models-llm-a63570e4a24a)
35. How to de-identify PHI before it reaches your LLM \- Aptible | Secure Cloud Infrastructure for Digital Health Teams, [https://www.aptible.com/hipaa-ai-security/phi-deidentification](https://www.aptible.com/hipaa-ai-security/phi-deidentification)
36. Agentic Workflow Approval Gates: Governance Framework \- Digital Applied, [https://www.digitalapplied.com/blog/agentic-workflow-approval-gate-framework-governance](https://www.digitalapplied.com/blog/agentic-workflow-approval-gate-framework-governance)
37. Video: AI Governor: Quality gates for agentic workflows \- Neo4j, [https://neo4j.com/videos/ai-governor-quality-gates-for-agentic-workflows/](https://neo4j.com/videos/ai-governor-quality-gates-for-agentic-workflows/)
38. The Multimodal Anonymizer: a fully local multi-agent AI system for medical data deidentification | medRxiv, [https://www.medrxiv.org/content/10.64898/2026.05.28.26353952v1.full-text](https://www.medrxiv.org/content/10.64898/2026.05.28.26353952v1.full-text)

[image1]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGYAAAAaCAYAAABFPynYAAADtUlEQVR4Xu2ZeahNURTGl3kmQoZEpkL4Q+IPcxGRoSQkU0QIISJzCpEySxERiYjM06NkTJQkwitThj8MhZBYX2sf77zPvefe++5x73U7v/p6731rn+Huu89aa58nEhERkf+UUx1SNeJADjJXNYrNfGWzajCbOUppVYGqJwfyjZGqw2zmOM1Ur1TVOJAqjVWLxb7pp6prqnuq8S6+VtXd/Z5JsPpeqvqSP1R1V/XL6Ztqa7ERIh1V78Ti31UXioeToqrYnHwSO88L1TnVebH5eet8aIc7xuOYag55KbFI9UV1R2wCKji/jGq56paLV3R+JhmoeqwqxQHHTbFJaUK+xwjVCVUNDqQIFi2uM4YDSgPVVbExfrCosajKk58UO8UuuFRsdTJlVc9VJzmQIfaoNrLpAw0B7r8LB5RKqtuq+hwoAXhKcJ06HHDMUw0nr7nYMb3IT8h0KfpSgjitmsVmhniomsamjzVinyFWF7RSLOWlC+oEUuUV8leIpTqwTCx1MoWq2WwGUVf1UfVEilJXPFapWrJJrJeiXJuMLtthgSD9YOwgDviYIjZmPvmtVbvIKyn9xa6xxOd1EEvxiTij2sRmEOvELpatJyEZ2ovdYzcO+PAmzZ/uUBvRxaVbVzxWy98Li68ZjwOq/WwG8UDs5O04kEMgNeAe23LARxuxMUd9HlJHynk9gOtiqQw1ywMNxRDf3/HYLlafkgIFHR/mMwccaJd5daA7yzTeE4Of8agsNgZFHmD/gBUeFrXFzs+tNr6Y6u73hmJNSiy2qS6yGQR68B8SuxPzeCbW/7fiQAxSrTEFdlggeP2CsUGpDGBvgXoJMBFhtvXDxO5hIQd8YI/Xh00H0tgRNoPAhXDBHuR7dBaLp3TSkKkidg8DOECgkcC4iRK7M4pFTdU4sXoUxBaxc3flgKOp2F4q3j7rlGoDm0EgnaFjeC/WaiIF4EUhbrSfWF79qhrtHZAlClUz2CSw48bkpdLI7BU7ZiYHCDyNH8Tmi2khlkIncMDHI9VkNhOBNDZJrD9/I3aj+IluA7kVxa3Wn9HZARtgTGIQC8SemqC0zGAP8lO1jwNinxkF+5LYnCDl42+/brgYXsmgzsWintiYThzIB5Bu8OHxNIcNFt9uNkME+6/7bOYL6HxeixXhsMHEBaWhdMGTnihV/tdMVR1nM01QrM+KvQH5F6D+oPMNs0PMOVA7sJPvzYE0wAaU/5UQFrhfdGN4LZT3YNd9UOwVe66D93Zj2YyIiIiIiMgWvwEBP9W8uZ/FkgAAAABJRU5ErkJggg==>

[image2]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACsAAAAZCAYAAACo79dmAAACa0lEQVR4Xu2WS0hVURSGV4UUJvYQjLIHEUEPRHQQRQ96DRqENpAiJ0FJSIKDIHSgZhTUQJxU9IBoEEWD0GokmnKhgmqg1CSIGuXEkQPJIBD7f9be19Xu3nPbTi7B+eCDs9bZ57Lu3vusfURS/n/WwjvwJtwR3LN0wm1hMh+L4OYwmcBxWA+XuJjPn4Mt2REiZfALPAq3wAl4yeUJnz0Mn8F+l0tkHTwBh+FAcC+JHjgX+AFWmTHNcNzEl+ENeB8+hu/hU9E/sd6My0kb/ARvwV8SV+wV+BlOwbfwuszPmOee6CR4uBKcWUsrvBDkCvJD4orlLJ0JkwGchFcmboAXTbwVvhHdQlHEFtslhYs9D8dM3AOPuWsWOAqrs3cjWEix3fARzMDv8KwdAFbCr3AfrBTdLv6F5H6+6q6jiS22HQ7BZS4+CWfh3uwIpVZ0HF+kTS5XIVq4fzaa2GI3wBUm5rJydllEIW7DgyZmu3sBG00uERb7PExGwkLZwngQ5GOXaOvyXIN34Wr4EB4y9/ISUywPD/bG3iDP5WaxNUHeUwIH4SoXc2Wm4R4Xb4RP3HUiLJZL8S8cES3KtiXCQ4H58iDv6YCnTHxAdPx2k2MrKwiLfRkmHfvhaROvgR9F33APZ42zZA8BC1cjPFJ3ixZrvxnYzhJZCn/CEfm7QTNmEfzROpPnFmCrWuxiztqM5N8CLJQvpaVU/uwg7BbsGjnhR8Q70UL9+f5NdHbs0fkaToq+BB7+QX4pZUSXn/t1p7lvYVvj0Z6LPtFezUl5IFpT0Vgu+i74wyCE24fHMiepKbhXFGw/TklJSVkgvwFD0HaJqJjtNQAAAABJRU5ErkJggg==>

[image3]: <data:image/png;base64,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>

[image4]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAC8AAAAXCAYAAACbDhZsAAACPklEQVR4Xu2WT0iVQRTFT0GIFYGtlBSUSkpIaGPk6pmBEe3KXLSKKA1aJLWIINPSIpJaBS4MVKigLIgWRREt+udCzIUIJa6DbCNCUSF1Dvd+vHlTL4QI3wfvwI83c++8N+fN3PnmA4oqqqjUai+ZJIvkp3+OkwPhoELXU5j5bXGi0FVKvpCZOJEG7Yat+vU4kQZdgpnfFyfSoNfkO1kTJwpdZbBVfx7FR0lXFFsOVZC6OJhoP8z8uSh+kOyKYsuhNpjHP+oGzHxTnCgAVcPuoLzmZ8k3UhLE6skj2B+TDpPP5Dy5SB6STnKIXCDDZL2PVVuLcYWchJ2nI57bTG6TM+Qa2eRxqRp211wlI7By0bwfyC1YZaxOBks1sImehUHXCTIU9O/DflTaCPteg/f7yWlvr4xylWSBVJEdZMDjKsm33l5FJkjG+1oA3fySvOWs/B4yRr7CJvrog1qDMe3INX+XHPe2DP0Icn1OIr1ilAf9d+SotxvJKdidonmTmHZffzzWb+aXomPINX/HY5LM69GaSMYvB33lQvNTpAO2OzKjR/IW8snzGdhCrvB+qMS85qyNcnmlyYaC/j3kN69LTjWeSLnt3t5K5mFl8wLZ+t9J5mA7vIFMI/vQWIfsi+ED2NnSW0DGY3+V6vUJ7KQ3w8rpPXnsfW25yq3H+zqUqt8WfRlmXnWr3XgJK1NJj71XsMOnA6/S7facztEb2EE+C3vfklRSN8kg7Gz8d8VlkyppV1JpvhfZN9S1Ue6f9QuZq3Zb5GyhAwAAAABJRU5ErkJggg==>

[image5]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEEAAAAWCAYAAACffPEKAAADKElEQVR4Xu2YWahOURiGP/OQG0NmTpIxXBgylBRRlHDhznChE7kwXJCEJEkZExdECBnKrMiYQihDXAiJDKGUKZQS7+tbW9/+zv7Xv/9zcX5xnnov1rv3v9fa7157r2/9IrXU4rkI/YRu+gP/KBtF75f6wznbCNSHVogGdAtaCzVJnVGYttAO6BJ0A6pMHy6ZOlAXbxZhKnQaugYdgirSh3+Tuu+sEPZDe0XDaAydEA2kGK2ge9Ds0O4EPYaWJyeUQHtoouj4jrpjMdj3Xah1aC+D3ph2QjSECaJTxf6od/AGGy+LdaIhWGZB76AGzo8xR/Q6m6Hvkj+ENtA3aLLx6kIvoAXGI9EQdkNvnccZ8QNa7HzPM+ig80aKBjjc+Xn5IvlDmCHaVz/nn4fOOC8aAp/AA+eR99BZbxr4LeAAtjp/QPCXOD8vpYTAmcO++BpajkCfRV/thGgIH6TqlCZ8r5540zBQdAAciKVv8Hc6Py+lhMDz2BcfiOVA8LsaLxoCT84K4RX00puGEZIdQvI94Ye2OpQSAmdqVgj7gt/LeNEQvkp2CAzgqTcNQyU7BHZMn9+a6lBKCKckOwQ+APrdjBcN4Tl033nktWjNUIgeoh1tcX6f4G9wfl4YwjFvFmCPaF/tnM8ln35L40VDuC26tns+StVzLawR2BELJcug4C91fl5KCSGpBn1xxd/T53KZEA1hu+hKYGkqepHVzvc8gg47b6zob8c5Py8M4bg3CzBdtK/+zr8CXXVeNITRoheqMB6LJH/xztB8qJHxVkIPRUvdBBYpfJVssdQTGm/aMRgCK9YspkDDTLs59AmaZryGosXaXOORaAiEe4X1ps13za//J0WDmWc8rsNMnOUu4X6Ds4ODtXCl8aFmwYBZAV6QdLBkiOg1/Kxl39wz1Att7l3uSLpGIEVD4LszU/RLz9djYfAsq0SryFHObwEtgnZB26BJqaPKZdFyONljeFhlXhcNgDdKsUbhWJuFc1gi8wlnjX8MtEb04W0SHZOnaAg1Aet7lrnl4q8IgZut7t6sQcoeQgfRwqaclD0EbpU7erOGSd33f/v32i9rcs+TPIO43AAAAABJRU5ErkJggg==>

[image6]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEsAAAAXCAYAAABDArJmAAABMElEQVR4Xu2Vv0sCQBTHX2RrQTYkhFiTe20NLdnQJM5O4uDWoAgOQo39AU0t/aChzXBoUNDBwS1aXAoaG9uCaqjv8856PhxUEKR7H/jAve/dLQ/uHZFhGIZhGIYxS1ZgV4eCPfgA43ojRCowr0NBCX7DrN4Yk3Vy9yfxoH9zzliC93BBbwj4zDNM643QSMGyyu7gkcpqcFPUWzAj6iA4hbui3iD3DHIiW4Rtv+YndebrC58Fwy3cFvUOfIdrIjuEJ6JmqjR+s6aZWfv9m3PGDSz6Nc+tc/gGkz6LkfsJV309YJJm/Rv4J/yEDXJD/BG+wA/Ygq/weHBYEGSzorAOv2CT3MziZ/fkLcDI7+k/uFmXOjRGw8260qExGm7WtQ6NYZbJNaoDe36dkAcMwzBmxA8IaURvQ8Xa2QAAAABJRU5ErkJggg==>

[image7]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEMAAAAXCAYAAABQ1fKSAAAC70lEQVR4Xu2XWahOURTH/2QMRcYUEcoUIRnLpRQK5UUpHqRuCaVknomMZYziwTwlQglJMoQ8eCBFIUN4wQuFxP9/1zqd/W3nfrmXh6/P+devzllrf2ftvfbea+8PyJUrV65c/0T9yBXygfwkj/39Efni7ytI/eQH/4OOwpLRMbA1Jivdvj2wl71ekZuxkeoCS8br2FGu6gsb8KLYQc2G+U7EjnLVPNiA+wS2ZmQKeQerIS0CX1nrEvkEqw9ryAVYcpSEsWmzklRDMoh0jR2unmRIbKxOTchXciiybyS3SevIXgoaSp6RlmQErNZtKWhhUt/3wdr+kcbBVkFlZB/jdm2hUlNbspg08PdlyE6G1Bs1SIY+okH3iuxJHVke2UtRxZLRAzVIxj3yntSJ7Jfx+4oZTZ6Qc+Qg2e/2duQ4WUd2wWZuDqwOXSVNySbyloz338wkx8gqMs1t+qZizid3yWBSQbaS1eQaaQ6boAdI64RWyQ2ywNudQlrwu6MwGVlxq9QBFvxMaHSpeMo3w98Pw/bgUnIL1pFZ7jsL21bSdNg+ldaTPf48nEz25wGwzid6TjqTuuQ77Fv6jk638+6TlASdcpImMEmGrgRhzVtIdvhzmIysuFX3ijvkG9ILlQY/Mm2HbuQieQjr0Ci3K/C2pBGsc/qGZk/LdTNsdUiKo07Xc19ypd9A7rtNnERa8dWnsGjruy9hg50U2NXnMBk7A59Wny6RUpiMrLh/JQUO96c6rmToCMuSgk8kSwKbrvZHgvdQSoa2QqJOsNWpZf2RDHS7BltdMiaQN/4cJqNY3FpJg4qLle4puqlKqj3hwOeSF0gHIek4VAd1rEtadcP8+QcKk6EtmLTTzCYrVIMNk3HAnyWtJtUoKTxNsuLWWhXkOnmKdPBSK1jR2g0rZv0DX3vYP99YU2FFWu2VMNWLtbBVpi2hGZVOw5KgBMuvdiqwuhtpprUFlQydfqozsikZjUgbspd8hsWQ4ri5cuUqrl/pbKvopTymYQAAAABJRU5ErkJggg==>

[image8]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABcAAAAWCAYAAAArdgcFAAABOUlEQVR4Xu2Ur0tDURiGX5PFZDS5IMqKYBAXXBD/AMEwBcOKOOYYmwsrAzHZRTCYZUXmjzoEZUVYsxsNFoMigkXfb9+5cPedO7dTZQ884b7nnPfccj5gzIhM0JQNh5ChLfpA72m2b5XM0A3apldm7S9W6Atddt/r9IuuRRvK9Ime0m+ElXfpicku6K3Jenxi9PI5+kNLJj+k7ybrEVKeg5bvmLzqco+Q8gNoiVwSZ9/lHiHlDSSXF1zuEVJeR3L5nss9pPzahgPYhZZsmbzoco+Q8k1oSd7kNZd7SPmNDQcwCy2pmPwY+pA8pDzxAZBVum0yefLnJpPzlybDJPTGO+iMiSPfH9A/XYrlMoeeoeNDSNM3Oh9tkDnwCC2Ww6IckDkzFW0iHfpKp2OZsECPaJOe0cX+5TH/gl+wg0h/ZQcnSwAAAABJRU5ErkJggg==>

[image9]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABcAAAAWCAYAAAArdgcFAAABj0lEQVR4Xu2TvytGYRTHj0GxyiClGORHpPyKASULExlQBosIgx+JgVDKJCUSEoqkMPgHkAyy2ZCySEoGBiPfc8+5r3NPb69d77c+9Tyfczr3ve99HqJk/kgW2AJn4Br0RssJUwtOwAU4B/W2mAluwYDuc8ADmA0bEqQGPINq3TeBL9AYNiySDLfpB28g1XmfG7Ds3D44DTdP4DBWkvCTv0Gd8zb5JD1Dzs+AD17wf80N65EyUYX6KedtOkh6up0fUU+VuliJlIlK1W87bzNK0sMPsRlUTw268MOL1e85b8NvFW84f69gOB+jeMOL1O86bzNB8Yf3qacCXaxGykQl6pect+G7wD2dzvORDobzGecFXyCbKvXTztu0k/T0OD+mPsg9OP6tBWkmaWhx3iaXpGfY+QWSixRkHtyBlFiZaBy8UPQS8ZnvMnsOX/lN5/gCHYWbNHAFWnWfTvI29vzygz9Jfmm58XngEWTrnk/ZO8m3jCUDTIIdsAHabFFzCV5Jem0KwRw4AGugLFpO5l/kB5+4V076YD+QAAAAAElFTkSuQmCC>

[image10]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEsAAAAXCAYAAABDArJmAAABS0lEQVR4Xu2WvytFURzAv0JKpDBQUjYDE4skBgwy2CySZFAGAymRGP0HyqYMNjIYPLFhksGCMhpNFAY+553zvK+T5Klbt/e+n/rU99dZbvd87xUxDMMwDMMwkqQOL+Kioh+vsDVulCLLOBMXFYv4gRNx4480iT9fiMPZkymjEo+wLG4o3Mw9jsWNUmMIl6LaAc5HtX1sC/EaHuOlpPQNSIpN7FV5i/hrMK1q5XgW4klcCXEPvmJHyIuePexSeTe+YKOqjeBGiN1+O1e9W1xV+U/8Z2cNZk+mjF1cCLHbW9v4hO2h1iz+S1gfck0VPuNUVC9a3JvyJn4HuSV+jQ/ir9cpPuJ6bjhiDm+wOm4UKw14iO+YEb+z3LW7C85ixdd0nk48ET9v/EIN7mBtyAfyLUPj9toWjop/SONSQjurUHJ/89q+bxOGYRjJ8Al/3Uq9f46A0gAAAABJRU5ErkJggg==>

[image11]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACoAAAAXCAYAAAB9J90oAAACOElEQVR4Xu2WTYjNURjGH/kcCzWZUSxnkJFShEzJbRZqFjNLWVgpiQ2ifC8GC9LMYrBQJpmJaSKxsMFGNA1J2VAS5bNMYYNiwfP0nNMcZ/5NuMxdzH3q1/2f9z339pxz3vP+L1BVVVX9F60kN8lb8oM8DuPIy/DZHL9QafXBRudm8UbylXwgs7NcRfSC3M+DQffgRazIE+OtJbCRE3mCWg7nnpDJWW7ctQM205LEppHN5D25TRYmuYrpOmz0Cukih8g58pF0JPOmk1VkfhJLtZiszoP/SjPhy3I1T1Al8p30hvFacpd0xgmJ6slZ8jxP/IHSEx2ldfBu6viLNATnF4WxdrvIqKRaL8foQB5IdRw2sjRPBL2D8/G4xzLahL8zOonsIg/zRKpB2EyRNsIm1fCj9pM7ZA85TC6R2pDTrkejM+DevJccg08uahs5Atf/NdIAl80beCNaR6Za82AjF7L4VLKdfIF7qOZF7YMNRMnIyfCcGp1FLpM6UkOGw7N+W/16SpgXW2IJBTu6DK69b7DR1/j1tfmU3CBbMbp3yuipZNxGXoXn1KikctHuHSSf4BrWMT8gj+AFqk9LJRQYLUe50Xb4yKTU6BryjCwIYy1G90ALVxuLJ6Gy046XMGJ0zNv/u5LR88lYfTceX3rrVb9xno5bO7oBfon0h7ikl4mMamf1h0hS/ZYtGd1NNpFu2KguzhxyhnwmO2HTKq+jsOkechF+w90K8QNkCyyVxGl40etDrKqJqZ9pHnm7GGHcVQAAAABJRU5ErkJggg==>

[image12]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEsAAAAXCAYAAABDArJmAAABU0lEQVR4Xu2WMShGURSAj1AMUiiUlIGMiqIkC/+glFkmKRZRpBTFaKQszAaLiDJQjAYlM6UsRpvCwHf/e/2Om4So13vnq6/uPefc5fbOuU/EMAzDMAzD+E8q8SwOKnrxAhvjRBaZx7E4qJjFFxyJE9+kTvz5n5jLn0wYpXiIRXFC4WqucShOZI1+nItiezgVxXaxKayncR13cKFQkQFWsFvtG8S3waiKFeNpWPfgOZZjm/jalpBLPdvYrvYd+IA1KjaAy2HdifdYhs3iL0uf/4zfzKy+/MmEsYUzYe3m1qb4y2gNsXrxL2FV2GtcOx7HwTTjXsInPBI/xC/xBh/xBO9w6a04UCH+S3Pt2BXlUk017uOz+K/EzSzXdlfBCSwpVH+kVvylJvKZTwKDOK72t7im9obCzbSDsHZzzLXw8Hva0Lg2XcVF3MBJ+fqH1jAM4694BZ2NSra8hZlaAAAAAElFTkSuQmCC>

[image13]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADUAAAAXCAYAAACrggdNAAACo0lEQVR4Xu2XWaiNYRSGX2UsyYkSF2YZi0hJyUxulAyJFC4oboxF5qFMucKFoo6xlBQRoYgSF2Qoc25kinJKlFzwvtb62+v/SPs4e5/Orv3W0/7W+v6z9//+6/vW9x+gqqqqqqqeGknukB/kJ3lErpBr5Cmp87yYb39SOZIR3Xj3JC8NI5/I2HSiKasN+UbuphNB50nnNNmUNRlWpR0h14zsDfHFMK4I7YKZGhdyS8n+EFecbqHQDCKz4kVlUHMynPRPJxqqGljnU7fL1ArWGDqGXDkkQ2pQtR63JS/IxOwC5FdP0ZoGq8rmkGsJ+7FMM8iSEJdS+t7aEK8mvUJ8KoyL1j6YqdHpRNB10j5NlkiLkTeVSY1qJbmXThSjx+QraZFOuObCjGeaTs7Bmoue8knP34Q9nH5kAnmOQsdsTY6RNWQnmeR5aREKprQibsAO+Z7kEHlDNpApsDP0LPlOZnv8gZxB0ADYjVyISZee1HjymfT1nN4+dJ718Fg39MrHkq6VKWkeCqbakdOwPaoz8aOPpWhK0nJb6OMx+LNS2ndfSB+PD8Lu9ffm0565DzP13uOInnRqeAu5GmIZiKbeek5ShePZ1htW2fWwV69Bnk9NHce/TUknyDpYpVblp+qvTeRSiFNTrz0nRVOjyEsUnq6uG+zj1JSW6d9MxS44lTwka0mnkP8vjYAtv24ez0HelKo70McbyWUfbyVHfKy9q0ppT4i0+6kKmSm9c2rPS9v8U9J3vCOHQ65BUgWOkmVkD/KmVsBuXktDn1r7u2FL7TbZDjOom1GD0Xmkyus/Ax0tM8kTWDPQctVeOQD7nfRFQK9wC5JcSTQEeVONKS09NY2Sayga15Sq9wDWTbUaSq4usGWkM255MlcudSDPYHuwa5z4BdMOk3n8ZrkTAAAAAElFTkSuQmCC>

[image14]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEsAAAAXCAYAAABDArJmAAABPUlEQVR4Xu2WvSvFURjHH2EwKQyUFJMyshkMXgaTP8CEwWbwUgbF6GUzGtzFYCODgWJjUDIZKDajTWHg89xz6PRQ7lW3bvc8n/rU7/mec5an8/ITcRzHcRzHcSpJM17aMGEIr7HLDuTIMs7YMGEBP3DSDpRIu4T15ThWXFllNOIx1tmBBJ1zjxN2IDdGcclkhzhnsgPsNtkwFkxW06zjYFJ3SjgGU0lWj+dJrTThrWTWrH3sT+oBfMG2JBvHtaRWFnETd03+G/+5s0aKK6uMPZyP33pv7eAz9sasQ8JL2BJrpUfCg6DHt5DkNY++hG94IuESv8EHfMUzfMLVr8mRLQmNza5ZrXiE73gq4c7SY3cXncWG79ki09gXv7NrVrls40pUd+OVhIY6f7AhvrNKQi/4C3yUn/9kjuM4leAT8gpIfUxBlSgAAAAASUVORK5CYII=>

[image15]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAC0AAAAXCAYAAACf+8ZRAAACZElEQVR4Xu2WS6hNYRiGPzruEUknJnZRB2XkMpCcTQZSilKkSHKJgYkiQsdl5hqFRLlkIiVFRIiO+50yUEw4uUzIREY8r+9f7d/fGpy1naM12E89tf/L2utda33r29usQYMGpaUV2/ER3sOzOATP4KBoX2nYgM9wQjQ3Ht/i/WiuNMzAXzg2XYBjuCedLANHzEP3ThdgP85MJ8vAPvPQCj8Oe/69XE7G4Bfz4PIrXsZZ8aY6aMJJll92XYK6w1zcjk/Mw3/HkfGmgijwNTwRxlPwHQ7NNtRLXiiVx0Hz4MuStaKssVroZtxk+e9OpxmMl9LJwFTz0AvShYKsslroLmE+PkwnA4fwNfbFCt40f7Q7cDM+xolhbw/chcfxAG4M82Kl1UJvxec4OowreNX82FM43Hz/J7xlXrJa+4hz/BCzw/gNl2cT0Ae3mR+YfblQL/+AA8N4Ib4wD7waj4Z5cc785CIOLT6bf28vfIrVMH8SZ4fPbWEsdN5F4fMfruMIXI+n8SLexr3mHSVmGr6MxsPMy6cF7+DSaG2d1couDa0LV2i9lD8tv72q26gJ9MPd5k+7LlTjcWhdrEKrr+u/yopoTSV0I3xOQ783D13FH+ZPKo8HuBh3pgtFUGjdJV29UEnp8Yo2819OoceuE6pkRNw9RId5aN1hvTPTw7zqV+9YxlrzvZOjucIotO6Sak13UmWU1Xx/PG8ert28Ywid8Aq+wnnmZaiS0MvahKPwrnk5qhVmN0So/N5E47pIy6O7GWDepf6Jqv2f0Gq1S8zLK++Hr9NUzLuL2qNqtDvZghcs5y7/BnLYdfYdiDlYAAAAAElFTkSuQmCC>

[image16]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEsAAAAXCAYAAABDArJmAAABUklEQVR4Xu2WsSuFURTAjzCInsJASRle7CyiLBhM/gCTDBZRJDZGf4OVQRlIUihGgxLre2W0KJtC4nfevV/fffelPEWv951f/erec+5dznfvPZ+IYRiGYRiG8Ze043UcDBjHW+yLE1lkA+fjYMAqfuJsnPgh3eL2V+NUaWeN0Yyn2BAnAnRNEWewERdxoGxFRpjEtSh2hEtR7BD7xV3Z5Ot/4HK4qN7ZxtFg3iuuEHNBTE/TlR9rsXZxBHPJgqywj0PBfBhfsCuITeOWH7eJK3A1/ObNmijtrDH2cMWP9d3awWcc9LEecZ2ww89b8QTX8QI3fTwTaCd8w3Nxj/gdPuArXuKjlBekSdJ3qkVcYcfSdH3Ticf4Lu6k6Jul167gXRBXoO+4kcoGYXj0VB0E83up7JyGRwuTnCT913rCfJo2QrQbakPQv/ozcd3TMAzjP/gCKZpJ0QV5PA8AAAAASUVORK5CYII=>

[image17]: <data:image/png;base64,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>

[image18]: <data:image/png;base64,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>

[image19]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACYAAAAZCAYAAABdEVzWAAACo0lEQVR4Xu2WWciNURSGX/M8K9wYSomQKXO5QJQUkhS/QpmTJMoYkYQicqOUIRlKijLrjwylEOFGUbjAhQu5cMX7Wnufb337nM/5b/6izltP51trr3P2+vZee+0D1PRvaBS5QLaS7slYVHtyjDRLB1INIY/IU/KeLMiNmpaREc7Wj+8jY5xvJHlNepNZ5AOZgywBfWcubJ51wVeoQeQrmRns4eQTmVqKMN0hvxJOkZYuRvZhZ98mq8hpcok8JufJQ1RZrSbkFfmY+PfC3tzrLnlGvpEbZG1++I/ekG3OPoD8ikpnydDEV6b+sDd/kPiXB79WM0pv39fZlfSC7HD2QVjNRS2FvXRVDYMlcC/xLw7+hc53C9UT05YdcvZN0ik89yRPSJtsuFj9YAncT/wqTPk3OJ8SU8KXyXNYAY9z45K27R3pRiaT425MSU9xdlWpxt4mPh13JaatiLpKdjv7COwEd3U+aT6pJ0dJ6+CbRE7GgIZqLPlCpgV7PKzmlNiuGITygh0Ii9mT+FM1hx2c2NM6kP3kHKwD/FUDyEXYdqkxroBNqs8itYPFvEwHEq0ndeFZXaCeLCE9YCXUJYw1SJthk+pwSGqSn8m8UoRNohitdpFUw+pfUaqx76RpsJXwymw4rxmwxtjW+bR6KvConbAkfCvoHHy6MYp0hfRx9hbke+ZgWK1W1BnYBBOCreP9k6wpRQCzYXEtnG8i7Hvbnc9L15q20Wsj7FaJUmI6JBW1CbY6OkEdyQlYYWqrovR8HVkX11bolKrTV+pLWs1rKL92ppMfzr+IrM6G89Iq6GSpRagB6qqJNeDVC9aXdGcqTttfVLjaHl3oqTSX7kndLCodFX/abhpNo2H/Ooqkfx6qPd27lZJvNKkkWqXOmmqq6X/Wb+wSgj7FU31pAAAAAElFTkSuQmCC>

[image20]: <data:image/png;base64,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>

[image21]: <data:image/png;base64,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>

[image22]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADYAAAAZCAYAAAB6v90+AAADHklEQVR4Xu2WWaiNURTHl3nImLFMKfMUGePNEBLx5IESypQkyZThpgwvvMirrllkiCJDZArJUIYHebiFMuVRIfH/37XXPevb53xnuDzch+9X/+5Za++7z157r7X2EcnI+BeaQVug49D0aMwzB5ofO9MYDj2AnkI10ILEaD69oSaxswj9oBvQQ+gqtAfqkJihAW2FOkHXocNQTzc+AtoLvYXaOn8qQ6Av0Oxgj4I+QNPqZijNw1gV9BUakxhNpzX0EhoQ7M6i//8MahR8HPsDdQn2ZOic6AFUQ/egy6Lr2D6LwoVfQe8jPxd8HfneiS7O0+Qmyg2MacP5B53vYvBNDfbCYBvtoUvOJqNFb7EsmCJc8H7kXx78vM2YDVJZYDOgX9B+5+MBcY1ZwbbgGwe7DXQ+fCbMlidQN+crykjRBe9E/sXBz5OMqTQw0st9Zm1+hD5LLvUGia7JNCVMxd3hM9kFLXN2SfqKLng38q8N/vWRn9QnMIOdrwr6BI1LDslZaDPUFLoC9Q/+oaKNx+qxbFhj7DSe06Kb3xf5SX0DmwfdhH6KHpilncEueUK0a/LGDAY52NllM0E0LeztmChac9z8TpvkqG9gxjDom2h7L3ULrL1tzmbAF0RvttT/1jIQOiPa8fiWrBDdPP/GWGBj44EKYCPhGkviAQffqmtQi2DPFH1ru0KroO3BXxH8BcAvZnOJqTQwdjjWiceaU1zbngPQJGffgjY6O+7kebDlHhF9SA3e3nNneyywuPjT4K8ZzvcP69Lge+x8nvGSfPfYSVmbfIaMk1Ki/R8T/RI7HT6OP6DVdTOSWGD88phW0Dqoh/O9EZ3P98xg+6avUHNiV2RJ8KYNNprvkiwNBtbd2Xnwenk7LaF20CHolKQXJ3Obm5oSD0guaLZug/XwSHJvFlOYzYOd2N4tzyZobuwUTVs2DYOpmLbHWvi28ATZ4pkaayS/FZNq0R/I3DjF1LgtunGDBf5b8gubc2pEA2Rqstt29BMCfUQPtRAM9oXos7AI2pEcbtgclWQax6wUvWn+li10+A0W1ndGRkZGxn/lL/Y6pc+upAKfAAAAAElFTkSuQmCC>

[image23]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADYAAAAZCAYAAAB6v90+AAADY0lEQVR4Xu2WWahNURjH/+Y580wXITKUoTx4UF5kVpQXuXgwFmWehQwJD6byZMo8zxkiswfKFJkfDClKFEqJ//9+a92zzjr7OPfiRZ1f/bp3f/s7a++117cGIE+ev6ECnUt30j7RvZBBdHgczEYXupeeoPvoZFouLcOoRGfSC/QcXYXkvJgFtFlwXQB7Tog6NJ/WhbW9Dem/6UxX0me0RhDPSmN6ibZy12XoMbquOMNQY+rQdlhnGtCndHyYlIByf0b+oJOCnLYuXt9d96aH6Aq6lV6lp+gDOtDl5GQJnRHF2tDvtHoQ0+h8gI2aGAB7mc3FGcmUp1/oPfoWNlJxqY2AteWpSY8H16IbbBRLjJL3RDGVgx6kv6IO/UY3FWcA1egG2jGIJVGWPomDEZozep5yhT7o4dRtVKS3acMglpPFsEb308ouNo0eKc4ACmE5mnt/Qq6OtYO1X89dqxSXp25jGR0bXJcIlZ1KRQ3fhS0O12mjIGeNu6/Gj9LL9ADtHuT8Ds1FzamT9BWsDc3RkIN0Dqx0T8PeS3Sg52Fzv9ToC31CanKvhj3As8XFH9P2LjaSfkbuUhTK6+/+r0JvwDoZUovuomdg7+NRJ/0zS40WBpWk5pvvnDrj2e1ia4OYvuB7WAnnIu78OFh78SISo7mnrcKjDmuKaGRzjuA82JLq6QnbK/Rgv7Rq0dD1GJ/keIjM1bMk9IO1tzG+EaDt5SxSq3Bf2EirhCfShS6eSG1YmXSN4i1dXJNWLEV6Rz1awhXXXpgNbapvaOsg1gv2u3iTDlkP+8iei3RWcH0t+D8DlYgeoKU7ZgfspcRQWN6w1O0iHrl40u892tSVE86bwS6mKZBED6SPpjZ5VYZK2KPpkXX513Brf9Iwx+iFVDKiKv1IZ6duF9W4NmzlebQwTKVNg5jm5ZTgWmiOqGMauRgtWjpSheWt/e0r0k856li4cmcwgb6DrXJqQA1Oh41YyGj6kjZ316Poa9rJJ8C2Cr2wlm6PylQv2sRda696ATuaJaGPNyQOkiuwD+JRKeZcQDR3tNrchB1lsp2etRc9p3dgL9si7a6NvM6B8cTWfqfzp0b3Fl2E5MNzATJPQR519j5sWyiEtfHfoCoJyzhG1aUVW4djf/z6L9DhN0+ePHny/FN+ASkxsYvvVCQRAAAAAElFTkSuQmCC>
