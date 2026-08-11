# **全球个人助手智能体产品功能演进与技术生态调研报告**

## **一、 引言与市场格局分析**

人工智能技术正经历从被动对话生成（Chat-to-Text）向自律型任务执行（Chat-to-Act）的重大范式转移。个人助手智能体（Personal AI Agent）作为这一转移的核心载体，不再局限于单轮信息检索或简单的文本摘要，而是具备了长程规划、多模态环境感知、工具动态调用、端侧设备操控以及自我修正的综合能力。  
从市场规模与增长轨迹来看，全球智能体市场正处于极高速爆发期。市场研究表明，全球智能体市场规模已在2025年达到78.4亿美元，预计到2030年将攀升至526.2亿美元，复合年增长率（CAGR）高达46.3%1。在更广义的估算中，包含编排与基础设施的整体智能体生态市场预计可在2032年达到932.0亿美元2，而长期市场估值更展望在2034年突破2,360.3亿美元3。其中，面向企业级的自主智能体（Enterprise Agentic AI）市场规模预计将从2024年的25.8亿至26.0亿美元增长至2030年的245.0亿美元，复合年增长率达46.2%2。  
权威咨询机构Gartner预测，到2026年底，全球将有40%的企业级与个人应用深度嵌入任务特化型AI智能体，而这一比例在2025年初尚不足5%2。至2027年，在采用生成式AI的企业中，将有50%部署自主AI智能体2。从长远影响来看，到2028年，全球至少15%的日常业务决策将由自主智能体独立完成2，且智能体将中介超过15万亿美元的B2B采购与商业支出2。到2035年，智能体驱动的软件将占据企业应用软件收入的30%，创造超过4,500亿美元的市场价值2。  
在细分领域中，代码生成与软件开发智能体是增长最快的应用方向，预计2025至2030年间的复合年增长率将达52.4%1。同时，垂直行业特化型智能体（如医疗、金融合规等）也展现出强劲的增长势头，其复合年增长率预计可达62.7%1。

| 市场指标类别 | 基准年份数据 | 预测年份数据 | 复合年增长率 (CAGR) | 数据来源/权威预测 |
| :---- | :---- | :---- | :---- | :---- |
| **全球 AI 智能体总体市场** | $7.84 Billion (2025年)1 | $52.62 Billion (2030年)1 | 46.3%1 | MarketsandMarkets1 |
| **企业级自主 AI 智能体** | $2.58 Billion (2024年)2 | $24.50 Billion (2030年)4 | 46.2%2 | Grand View Research4 |
| **广义智能体编排与基础设施** | $7.06 Billion (2025年)2 | $93.20 Billion (2032年)2 | 44.6%2 | Industry Insights2 |
| **代码与软件开发智能体角色** | \-- | \-- | 52.4% (最快增长角色)1 | MarketsandMarkets1 |
| **垂直特化型 AI 智能体** | \-- | \-- | 62.7% (最快增长类别)1 | MarketsandMarkets1 |
| **应用嵌入率 (Gartner预测)** | \< 5% (2025年初)2 | 40% (2026年底)2 | \-- | Gartner Research2 |
| **企业部署率 (Gartner预测)** | \~25% (2025年)2 | 50% (2027年)2 | \-- | Gartner Research2 |

在这一浪潮下，国内外闭源商业巨头与开源社区沿着不同的技术路径快速迭代，形成了功能高度丰富且互相渗透的产品生态。

## **二、 闭源商业个人助手智能体功能矩阵**

闭源商业智能体主要由全球头部科技公司及前沿大模型独角兽打造，依托强劲的底层基座模型，向用户提供开箱即用、高度集成的端到端个人助手体验。

### **1\. 国际头部产品功能解溯**

OpenAI 与 Anthropic 代表了国际闭源个人助手智能体的最高技术水平，其产品功能围绕深度研究、系统级操控、交互式工作区以及多模态实时交互展开。  
OpenAI 围绕 ChatGPT 构建了多维度的智能体执行矩阵。其深度研究（Deep Research）功能依托专门针对网页浏览与数据分析进行强化的 o3 系列高级推理模型5，能够将用户的复杂课题自动拆解为数十个子任务，执行跨全网及专业数据库的并行检索与深度阅读，交叉验证不同信息源，最终输出带完整引用来源的学术级与投研级报告5。在网页与图形界面操控方面，Operator 支持自动化网页浏览、表格填写、数据采集及跨平台事务性操作，帮助用户完成从需求表达到终态履约的自动化流程。针对长文创作与复杂协作，Canvas 引入了对话面板与实时可编辑文档相结合的双栏界面，支持行内重写、文本密度调节、代码调试及实时渲染。高级实时语音（Advanced Voice Mode）依托原生多模态音频模型（GPT-Live），实现低延迟自然中断与情感语调感知，并配合桌面端屏幕上下文（Appshots）实时感知桌面内容。此外，主动规划与长期记忆（Scheduled Tasks & Memory）支持跨会话的用户偏好长期记忆管理，并允许用户预设定时任务，使智能体能够在未来时间节点主动执行信息抓取或分析推送。  
Anthropic 则重点深耕代码工程、系统级控制与标准化扩展。其电脑操作（Computer Use）功能赋予智能体直接感知桌面屏幕内容的能力，通过精准坐标定位模拟鼠标移动、点击、键盘输入与窗口切换，实现对现成桌面软件的无人值守操控6。在交互渲染方面，Artifacts 允许智能体在独立沙盒中实时渲染输出代码、SVG 图表、React 前端组件或 UI 原型。为了打破数据孤岛，Anthropic 开放了模型上下文协议（Model Context Protocol, MCP），允许智能体无缝接入本地文件系统、GitHub 仓库、数据库及企业级第三方 API6。同时，模块化技能包（Skills）允许用户与团队封装可复用的特定工作流技能包，提升智能体在特定专业任务中的执行精度。

### **2\. 国内头部产品功能解溯**

国内闭源智能体产品在移动端场景落地、多模态执行以及深度研究方面展现出本土化优势。  
智谱 AI 在移动端智能体（Phone Agent）领域取得了突破性进展。其手机端自动化操控（Phone Use / AutoGLM-Phone）由 GLM-4.5 与 GLM-4.5V 多模态模型驱动，通过视觉感知理解手机屏幕，借助 ADB 驱动模拟真人进行点击、滑动和文本输入，目前已覆盖微信、美团、淘宝、高德地图、抖音等50余款主流中文 App 的跨应用复杂链条操作。为了解决端侧资源占用与安全隐患，智谱推出了云端虚拟手机（Cloud Phone），使敏感任务可以在隔离环境中后台执行。在安全性方面，智谱建立了敏感操作拦截与接管机制，针对支付、密码输入等敏感环节自动挂起并提示用户接管，保障资金与隐私安全。  
月之暗面（Kimi）依托长上下文处理与推理能力，强化了研究级个人助手的体验。其深度研究智能体（Kimi Deep Research）结合 K2 Thinking 模型的交错式思考能力，支持高达 300 步的复杂工具调用，能够跨开放网络与专业数据库进行数十次精准检索，深度整合学术论文、财经数据与企业报告。在交付形态上，Kimi 打破了单纯文本回复的限制，能够直接生成交互式 HTML 报告、Word 文档、PPT 演示文稿、Excel 电子表格及 PDF，精准适配金融投研与市场竞对分析等复杂场景。

| 产品名称 | 厂商/组织 | 开闭源属性 | 底层推理/多模态引擎 | 核心特色功能 | 适用设备/平台 |
| :---- | :---- | :---- | :---- | :---- | :---- |
| **ChatGPT** | OpenAI | 闭源 | o3 / GPT-4o / GPT-Live5 | Deep Research, Canvas, Operator, 高级语音, 定时任务5 | Web, macOS, Windows, iOS, Android |
| **Claude** | Anthropic | 闭源 | Claude 3.5 Sonnet | Computer Use, Artifacts, MCP 协议接入, Skills6 | Web, Desktop Apps |
| **AutoGLM** | 智谱 AI | 闭源/核心模型开源 | GLM-4.5 / GLM-4.5V | Phone Use (支持50+中文App), 云机版执行, 敏感接管 | Android, 云端设备, 智谱清言 App |
| **Kimi** | 月之暗面 | 闭源 | K2 Thinking Model | 300步工具调用深度研究, 多格式文档导出 (PPT/Excel/HTML) | Web, iOS, Android, API |

## **三、 开源 AI 智能体框架与低代码平台功能矩阵**

开源生态构成了智能体应用繁荣的基础设施，主要分为代码优先型框架（Code-First Frameworks）、低代码构建器（Visual Builders）以及专注于运行控制与协同的智能体工作区。

### **1\. 代码优先型多智能体框架**

代码优先框架主要面向开发者，提供粒度极细的控制流定义、状态管理与多智能体编排能力。  
LangGraph（LangChain 生态）采用状态图（Directed Stateful Graph）作为核心控制流，允许开发者精准定义分支、循环、重试与状态持久化（Checkpointing）。其具备的“时间旅行（Time-Travel Debugging）”调试功能，能够暂停、审查、修改并恢复任意状态节点的智能体决策链路，原生支持 Human-in-the-loop 人工审批流程，在金融与医疗等高严谨度领域被广泛采用。  
CrewAI 基于角色扮演（Role-Playing）的概念模型，将复杂任务分解为不同角色的 Crew 协作。其引入的 Flows 机制将事件驱动的确定性业务逻辑与自主 Agent 结合，既保留了角色化协同的开发敏捷性，又弥补了高并发场景下确定性控制力的不足。  
AutoGen（微软开源，衍生出 AG2 分支与 Microsoft Agent Framework）强调通过 Agent 之间的自律辩论、多方对话与交互验证来解决复杂的数学或编程难题。  
OpenAI Agents SDK 与 Google ADK 分别代表了主流大厂对开源框架的原生支持。OpenAI Agents SDK 提供了 Agent、Handoffs（跨智能体交接）、Guardrails（输入输出护栏）以及 Session 历史自动管理等基本原语。Google ADK 则主打 A2A（Agent-to-Agent）跨框架通信协议与多模态扩展，能够建立分层的 Agent 树状结构。

### **2\. 低代码构建器与开源智能体工作区**

低代码构建器与可视化工作区降低了智能体开发门槛，使非纯代码背景的团队能够快速构建并部署个人助手。  
Dify 作为 GitHub Stars 超过 14 万的代表性低代码平台，提供了可视化拖拽式流程图编辑器、内置企业级 RAG 知识库管理、数百种第三方 API 集成、ReAct 与 Function Calling 架构支持，以及完整的 MCP 协议集成。  
Sim 作为一个开源 AI 协作工作区，将可视化拖拽构建、多用户实时协同编辑、内置知识库管理以及一键部署基础设施整合至单一环境，有效解决了不同框架间“胶水代码（Glue Code）”冗余的问题。  
Open-AutoGLM 是智谱开源的 GUI 手机智能体应用框架（基于 AutoGLM-Phone-9B 模型），完整开放了“屏幕视觉理解-意图解析-路径规划-ADB点击/滑动”的技术链条。该框架允许开发者在本土设备或私有云上复现具备移动端自动化操控能力的 AI 个人助手。

| 框架/平台名称 | 类型定位 | 开源协议 | 主要开发语言 | 状态持久化与控制流 | 核心竞争优势 |
| :---- | :---- | :---- | :---- | :---- | :---- |
| **LangGraph** | 代码优先框架 | MIT / 开放核心 | Python, JS/TS | 状态图控制，支持 Checkpointing 与时间旅行调试 | 复杂确定性工作流、高严谨度生产环境首选 |
| **CrewAI** | 代码优先框架 | MIT | Python | 任务输出顺序传递 \+ Flows 事件驱动编排 | 角色化抽象极其自然，多智能体原型构建极快 |
| **Dify** | 低代码平台 | Open-Core | Python, TypeScript | 可视化节点图，工作流状态机 | 开箱即用，GUI 极其友好，RAG 与工具生态完备 |
| **Open-AutoGLM** | 端侧 GUI 控制框架 | Apache 2.0 / 开放权重 | Python, Android ADB | 视觉多模态反馈闭环，支持敏感动作暂停拦截 | 实现“Phone Use”移动 App 自动化操控的开源方案 |
| **Sim** | AI Workspace | 开源 | JS/TS, Python | 可视化协作工作区状态 | 融合构建、实时团队协作、知识管理与部署部署 |

## **四、 个人助手智能体的核心功能架构解构**

将国内外闭源产品与开源框架横向打通，可以归纳出当前个人助手智能体所具备的五大核心功能模块：

### **1\. 深度研究与长程任务规划**

传统问答系统往往停留在单轮检索与浅层汇总。而具备深度研究能力的个人助手智能体（如 ChatGPT Deep Research、Kimi Deep Research）引入了 ReAct 架构与交错思考链（Interleaved Thinking）机制5。智能体接收到复杂指令后，首先与用户进行交互式问答以澄清模糊需求，随后自发绘制结构化的研究路线图。在执行阶段，智能体跨越互联网与专业数据库进行数十次迭代检索，剔除噪声并提取关键事实。在交付阶段，智能体能够调用多种后端渲染引擎，直接输出包含结构化引用、图表与富文本的交互式 HTML、PDF、PPT 或 Excel 文件。

### **2\. 跨系统设备操控能力**

个人助手智能体正从“通过 API 操控软件”演进为“直接通过图形用户界面（GUI）操控软件”。以 Anthropic Computer Use 和智谱 AutoGLM 为代表，智能体通过视觉语言模型（VLM）实时获取设备屏幕截图，精准识别按钮、文本框及图像元素的坐标位置6。随后，智能体将模型输出的语义指令转化为操作系统的底层输入事件（如 macOS/Windows 的鼠标移动点击、Android 的 ADB 触控指令）。为了保障安全性，智能体内置了敏感操作拦截机制，当涉及支付、鉴权或私密信息时自动挂起并提示用户接管。

### **3\. 模块化环境扩展与标准化协议**

为解决智能体与异构数据源、外部工具连接时的接口碎片化问题，模型上下文协议（Model Context Protocol, MCP）正迅速成为行业标准6。MCP 由 Anthropic 于2024年11月首次推出6，并于2025年12月正式捐赠给 Linux 基金会旗下的自主 AI 基金会（Agentic AI Foundation, AAIF）进行独立社区治理6。  
MCP 的核心价值在于解决传统 AI 集成中著名的 ![][image1] 复杂性难题6。在传统模式下，当 ![][image2] 个数据源（如 Slack、GitHub、数据库）需要与 ![][image3] 个大模型客户端（如 ChatGPT、Claude、IDE）对接时，开发者必须编写并维护 ![][image1] 个特定的胶水代码适配器6。MCP 通过解耦数据源与客户端，将架构重构为 ![][image4] 模式，只要数据源实现 MCP Server 接口，即可被任意支持 MCP Client 的智能体无缝调用6。

| 架构对比维度 | 传统定制化 API 集成模式 (N×M) | MCP 标准协议集成模式 (N+M) |
| :---- | :---- | :---- |
| **连接复杂度** | 随工具与模型增加呈二次方级数增长 (![][image1])6 | 随工具与模型增加呈线性增长 (![][image4])6 |
| **代码维护成本** | 极高，需要针对每个模型客户端单独开发适配胶水代码8 | 极低，工具方一次开发即可通用，协议标准统一6 |
| **传输层协议** | 碎片化的 REST API、GraphQL 或定制 WebSockets8 | 基于 JSON-RPC 2.0 标准，支持 STDIO 与 SSE/HTTP8 |
| **数据抽象原语** | 各 API 格式无统一范式，需手动解析 JSON Schema | 统一抽象为 Resources (只读资源)、Tools (可执行函数)、Prompts (模板)9 |
| **UI/交互呈现** | 仅限纯文本或简单 Markdown 输出 | 支持 MCP Apps (mcp-ui)，动态交付交互式表单与仪表盘6 |

从通信机制来看，MCP 基于 JSON-RPC 2.0 协议进行双向状态化通信6。在传输层，本地通信采用 STDIO 标准输入输出通道，跨网络通信则采用 Streamable HTTP 与 SSE（Server-Sent Events）连接10，并在网络层配合 TLS 1.3 和 mTLS 身份认证10。MCP 定义了三大核心原语9：只读型上下文资源（Resources）用于安全检索数据库或文件9；可执行工具（Tools）用于触发计算或发起 API 写操作9；提示词模板（Prompts）用于标准化人机交互工作流9。结合最新的 MCP Apps 扩展，Server 还能直接向 Host 渲染交互式 UI 组件6。与 MCP 形成互补的是 Agent-to-Agent（A2A）协议，其定义了异构智能体之间互相发现、传递任务与共享上下文的标准，使运行在不同框架上的智能体能够协同作业。

### **4\. 人机协作工作区与实时渲染**

针对长文创作与代码开发场景，双栏分屏工作区（如 ChatGPT Canvas、Claude Artifacts）替代了传统的单栏对话流。工作区将对话面板放置于左侧，右侧提供实时可编辑的文档或沙盒环境。用户不仅可以通过高亮选中的方式发起行内精准重写，还能在独立沙盒中实时编译运行 Python、JavaScript，或渲染 React 前端组件与 SVG 图表。

### **5\. 状态记忆、主动调度与可观测性**

个人助手智能体正从“短期会话”走向“长期驻留”。智能体能够自动提取并跨会话存储用户的个性化偏好与背景知识，建立长期用户画像。同时，智能体具备时间感知与主动规划能力，可在预设定时节点自发启动后台任务。在生产运营侧，开发者可通过 Langfuse、Coze Loop 等监控塔，实现对智能体决策链路的全流程追踪、Prompt 传参分析与失败节点调试。

## **五、 生态演进趋势与深层行业洞察**

通过对国内外闭源产品与开源生态的横向对比，可以得出以下四项深层次行业洞察：

> 1. **闭源商业巨头正在吞噬中间件生态**：在智能体发展早期，开发者需要使用 LangChain 或 AutoGen 等框架手动组装搜索、代码解释器与记忆模块。然而，当前以 ChatGPT 和 Claude 为代表的闭源助手正快速将原本属于开发框架的原语（如跨 Agent 交接、事件驱动流、沙盒渲染、GUI 控制）直接内嵌为面向终端用户的统一交互界面（如 Canvas \+ Deep Research \+ Operator）5。这一趋势极大地提升了普通用户的使用体验，导致单点突破的轻量级“套壳应用”生存空间被严重挤压。  
> 2. **开源与闭源路线的分化与战略互补**：闭源厂商的战略重心在于依靠底层大模型推理能力的突破，提供极致平滑的端到端体验（例如 Kimi 的 300 步工具调用或智谱的云机隔离运行）。相反，开源生态的战略重心集中于提供绝对的状态控制力（如 LangGraph 的状态图与时间旅行调试）、企业私有数据的安全隔离，以及无许可的系统扩展（如 Open-AutoGLM 的本土设备 ADB 驱动）。对于金融、医疗等高度合规敏感的领域，具有完整审计轨迹（Audit Trail）的开源框架依然是无法替代的底层选型。  
> 3. **智能体竞争的终局是“上下文获取权”与“GUI 操控权”的夺取**：当各家大模型的纯文本推理能力趋向同质化后，智能体的核心壁垒在于其获取有效上下文的深度以及对现实/数字世界的执行力。在上下文层面，以 MCP 为代表的标准协议使得智能体能够无缝深入个人用户的私有数据域6；在执行层面，由于大量传统软件与移动 App 并不开放标准 API，“Phone Use / Computer Use”这种通过视觉感知直接模拟人类操作 GUI 的范式6，成为了打通 SaaS 孤岛与移动生态壁垒的终极手段。智能体正在从“请求 API 的外围组件”演变为“直接使用人类软件的独立主体”。  
> 4. **治理与安全控制平面的崛起**：随着自主智能体开始接管日常业务决策并中介巨额资金2，安全风险已从简单的文本安全演变为不可逆的物理与金融破坏。Gartner 预测，到2028年将有40%的 CIO 强制部署“守护者智能体”（Guardian Agents），用于在运行态实时审查、监控与拦截自主智能体的异常行为2，这标志着智能体生态正快速向“执行与治理解耦”的双重架构演进。

## **六、 结论与技术选型建议**

针对个人生产力重构及企业智能体系统开发，建议根据团队的技术背景、数据安全要求及落地场景，采取差异化的选型策略：

* **个人极致生产力与学术研究场景**：优先推荐使用集成了 Deep Research 与 Canvas/Artifacts 工作区能力的闭源商业助手（如 ChatGPT Pro、Kimi 或 Claude）5。这类产品在处理多源文献研读、长文撰写及复杂数据分析时拥有极低的协同摩擦。  
* **移动端 App 跨应用自动化场景**：对于涉及移动端 App 跨应用自动化执行的场景（如自动化订票、社交媒体管理、跨平台购物），智谱 AutoGLM / Open-AutoGLM 是目前少数具备成熟“Phone Use”视觉操控与安全挂起接管能力的方案。  
* **企业混合团队及非纯代码开发场景**：建议采用 Dify 或 Sim 等低代码工作区。通过可视化拖拽与内置 RAG 管理，能够快速搭建并接入 MCP 协议6，实现企业级知识库与业务流程的快速智能化。  
* **高严谨度与强合规要求的复杂业务系统开发**：建议使用 LangGraph 或 CrewAI Flows 这类代码优先的状态图框架。通过明确定义状态转移节点、开启 Checkpointing 日志持久化，并引入 Human-in-the-loop 人工审批以及 Guardian Agents 实时治理2，确保智能体在生产环境下的绝对可控与安全可审计。

#### **引用的著作**

> 1. AI Agents Market Report 2025-2030, by Application, Geo, Tech \- MarketsandMarkets, [https://www.marketsandmarkets.com/Market-Reports/ai-agents-market-15761548.html](https://www.marketsandmarkets.com/Market-Reports/ai-agents-market-15761548.html)  
> 2. 60+ AI Agent Statistics for 2026: Adoption, ROI & Market Growth \- Azumo, [https://azumo.com/artificial-intelligence/ai-insights/ai-agent-statistics](https://azumo.com/artificial-intelligence/ai-insights/ai-agent-statistics)  
> 3. 55 AI Agent Market Size Statistics | Nevermined, [https://nevermined.ai/blog/ai-agent-market-size-statistics](https://nevermined.ai/blog/ai-agent-market-size-statistics)  
> 4. Enterprise Agentic AI Market Size & Share Report, 2025-2030 \- Grand View Research, [https://www.grandviewresearch.com/industry-analysis/enterprise-agentic-ai-market-report](https://www.grandviewresearch.com/industry-analysis/enterprise-agentic-ai-market-report)  
> 5. Introducing deep research \- OpenAI, [https://openai.com/index/introducing-deep-research/](https://openai.com/index/introducing-deep-research/)  
> 6. Model Context Protocol \- Wikipedia, [https://en.wikipedia.org/wiki/Model\_Context\_Protocol](https://en.wikipedia.org/wiki/Model_Context_Protocol)  
> 7. Introducing the Model Context Protocol \- Anthropic, [https://www.anthropic.com/news/model-context-protocol](https://www.anthropic.com/news/model-context-protocol)  
> 8. Model Context Protocol (MCP) explained: A practical technical overview for developers and architects \- CodiLime, [https://codilime.com/blog/model-context-protocol-explained/](https://codilime.com/blog/model-context-protocol-explained/)  
> 9. Specification \- Model Context Protocol, [https://modelcontextprotocol.io/specification/2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25)  
> 10. Using the Model Context Protocol (MCP) for Intent-Based Network Troubleshooting Automation \- IETF, [https://www.ietf.org/archive/id/draft-zeng-mcp-troubleshooting-00.html](https://www.ietf.org/archive/id/draft-zeng-mcp-troubleshooting-00.html)  
> 11. Architecture overview \- Model Context Protocol, [https://modelcontextprotocol.io/docs/2026-07-28/learn/architecture](https://modelcontextprotocol.io/docs/2026-07-28/learn/architecture)  
> 12. What is Model Context Protocol (MCP)? \- IBM, [https://www.ibm.com/think/topics/model-context-protocol](https://www.ibm.com/think/topics/model-context-protocol)

[image1]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADoAAAAXCAYAAABaiVzAAAABkElEQVR4Xu2WPShFYRjHH8LiM+UrxciiMAhhkAxKGcXCwsAgNlksFouEKKJMMsigSBGTpJQBm7swmQwWA//nPud23/epm3OU97p6f/Wrc5//27n3Oe/HuUQej8fzB2mHp/AJfsIrO45zDD9I8hc4b8eZxQmMkTTTYkdxpuG2LmYa+fABjpA0emClwgrs1sUU9MBCXTRogjW66IJeuAzzKDmrdeYAcE2Sh6EVHsJcHYBOeAGLdeCCRTgQXM+QNMqNJ6iFR8bnMPD9eKlnGbVKkjOgyqg55QYWBdcF8BW+wZKgNkayR6MyCddImi2DZ7DBGuGQCnipagsks8qzy+zBxmQciSm4Ac9J9mbaGIJzqsZL7B0+kxwqj3YcCV6m93AfZqvMKZsk71LNOsms7gb+BH5gvC2a4TjcIXvPOoWfdo4ugnqSRtlRlYWhHN7CfqM2AVcpDc32kfyYVF/My40brdbBN5SS3HdYB2CW7BP9V+kgWVKJGYvBLnNAQBu808UQLMFBXTTYIvlT4fF4PJ5/wxdPIENl3krOtgAAAABJRU5ErkJggg==>

[image2]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABMAAAAaCAYAAABVX2cEAAABBklEQVR4XmNgGAWDClgB8W4gvg/E/4H4BKo0GOwA4t8MEPlnQNyIKo0JdgLxAwaIBjNUKTAoAuL56ILYADcQXwfiBAaIYetRZCFgChA7oQtiA25APAmI2RgQrlNHVgAEpxgg8gRBNxAHQNnFDBDDQIbDgDwQb0Xi4wVngJgPyuYB4jdA/AmIBaBiaQyQMCMIxIH4EJpYGwPEdSBXgsBKIDZASOMGUUBcgyYmAcTfgPgpEPMC8Q1UadxgDgMkraGDGQwQ1y2GYqLANSBmQRcEAg0GiGEgnIgmhxV4AfF5IGZEl4CC1QwQw6TRJZCBDQMkBmE2PwBiO2QFUGAJxJfQBUfBKBjSAAAANDDneVsDZAAAAABJRU5ErkJggg==>

[image3]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABYAAAAaCAYAAACzdqxAAAABPElEQVR4Xu2TPywEQRjFX/wrCKKlpnQFFYWSoBKJXCMKxRV3hZKg0QgSiULrWoVGK1FIEBqtUki0VAoivM+bkZm5XdSyv+SX3Zn3zWRn91ug4N9Qohf0jX7Q+zhuYBqqM2/pfhw3ckDPoQVtSebpoStQzXaS5XJDl6FF/UnmKdNVqGYiyTIZpHU6By0aj1IxQ/voKX2h7XGczRKdp0PQxpU4RieddddXehLH+RzTXtoNbbwZx1+vqJlOQvlaHGfTSi+D8SM9DMYL0EmMLWjj0e/0B8boTjA+o9fuvoNWg8we4Jm2BHO5bEC96anTJ3e/CJ3I6IJ6/ciNf+UKWuRZh45rHWLd4ply87VgLpdhegd9GI91R9YG9ofZ/EAyH2Eb2pO+Q8X2wfzrGIHaqcmNd+mDq/O1ey4rKCj4K59LKz9EydyGggAAAABJRU5ErkJggg==>

[image4]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADoAAAAXCAYAAABaiVzAAAABTUlEQVR4Xu2Vr0tDURzFjzAE2RSbgsGoIIhJVMRgMJhWLCYt/gGKzaKoxSYGg2AwicE02LCZRATBoDZXNJkMBg163r53vHe/IL73BrsXdj/wgbdz3sJ5dz+AQCAQ8JAZekVf6A+9sesGVfoN6d/otl3/yyYd16ErarQOGTNpVw3W6akOU7JDp3TogiJ9oiuQoZdWKxzReR2mZBeeDF2gh7Qb8amOJG8gt5A+D3vwZOgBLZvrDcjQaHiTYVpJvM6KN0PvaJ+5LtF3+kH7TbYG+Y7mxYuhA/RaZfuQU41ON+KcTsT1nyxB3pfWL8iDbQvLdEtlg/STvtJe+mzXmfHiRE8g/6WaY8hTPzO2ghdDH2lBh2QU8UdsVXVZcT50kd7TLl0YLiBDh3SREWdDZyG/tM0Tq9O55A2Gafqgwxw4G9puOmboGO3RYSAQ6Gx+ARmTRikG5DqcAAAAAElFTkSuQmCC>