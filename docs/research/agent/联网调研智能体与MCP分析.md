# **国内外联网搜索与深度调研智能体及 MCP 生态产品全景研究报告**

生成式人工智能与大语言模型技术的演进正在经历从“对话交互”向“自主智能体（Autonomous Agents）”的深刻范式转移1。在信息获取与知识合成领域，传统搜索引擎依赖用户人工输入关键词并逐个筛选网页链接，这种方式在面对复杂、跨学科或长时序的知识探究时效率较为低下3。为了解决这一瓶颈，结合长程推理（Long-horizon Reasoning）、自主工具编排（Tool Orchestration）与动态上下文管理的联网搜索及深度调研智能体（Deep Research Agents）应运而生2。  
这类智能体系统超越了传统检索增强生成（RAG）的单次“检索-生成”模式，能够像人类专家分析师一样，自主将高层级的复杂课题拆解为多维度的子研究目标，通过多跳网络搜索、网页动态抓取、数据交叉验证以及代码计算，最终合成包含精准事实归因与引用来源的高质量结构化报告2。本报告对国内外闭源商业级产品、开源智能体框架，以及基于模型上下文协议（Model Context Protocol, MCP）的联网 Skill 生态进行系统性梳理与深入剖析2。

## **闭源商业级联网调研与 AI 搜索产品**

闭源商业级产品代表了当前大模型长程推理能力与工程化网络检索结合的技术前沿2。此类产品通常基于经过大规模强化学习（RL）微调的专用推理模型，集成了浏览器自动化、沙箱代码执行以及多源数据交叉校验机制，能够在极低的人类干预下完成长达数十分钟的自主调研任务2。

### **国际商业化产品演进与特性**

国际市场上，OpenAI Deep Research 的发布标志着 AI 调研工具从“答疑引擎”向“自主分析师”的跃迁3。该系统以深度强化学习微调的 o3 系列模型为推理核心，专门针对长链条推理与网页浏览行为进行了优化3。在运行机制上，系统首先通过交互式提问明确用户的潜在意图与约束条件，随后将复杂课题拆解为多个子问题大纲3。在执行阶段，智能体会发起数十次迭代检索，自动解析 HTML、PDF 甚至图像数据，并能够调用 Python 代码沙箱对演算数据进行分析，最终生成带有可点击内嵌引用的学术级报告3。  
Perplexity AI 则展示了从搜索引擎向综合解答与调研平台的演进路径1。Perplexity 支持通过 Pro Search 和 Deep Research 模式进行多模型动态路由，将用户查询实时分配给最适合的底层模型（如 Claude 或 GPT 系列）处理11。为了提升研报的事实准确度与推理深度，Perplexity 将 Deep Research 引擎深度整合进独立的计算机运行环境（Computer Environment）中，经由多个通用 AI 评估基准测试证实，其在归因质量与数据提炼深度上具备显著优势11。  
Genspark 提出了基于“智能体混合体系（Mixture-of-Agents, MoA）”的自主调研架构13。系统在接收到用户指令后，可并行调度超过 70 个不同的 AI 模型与 80 余种专用工具链13。其创新的 Autopilot Agent 支持异步运行机制，允许智能体在后台自主完成目的地规划、商业分析或数据抓取，并通过 Cross-Check 功能对生成的语句进行多源实时查证，最终生成动态可编辑的 Sparkpages 数据页面13。

### **国内商业化产品演进与特性**

国内市场在大模型深度推理与本地化生态整合方面展现出独特的演进路线19。DeepSeek-R1 开源推理模型的突破，为国内联网调研产品提供了极具性价比的推理底座10。DeepSeek 官方构建了“深度思考（R1）”与“联网搜索”的联动机制，模型能够在“思考-搜索-再反思”的显式思维链循环中，自主判断已搜集资料的完整性并动态发起补充检索21。在商业云服务层面，诸如火山引擎 Arkitect 等平台将 R1 模型与搜索引擎 API 深度整合，向上封装为标准的 Chat Completion 深度调研服务22。  
月之暗面（Moonshot AI）推出的 Kimi 探索版依托其自主研发的 Attention Residuals（AttnRes）架构，突破了传统 Transformer 结构在极长上下文处理中的信息模糊瓶颈20。Kimi 探索版将长文本处理能力与实时联网搜索结合，使智能体能够在调取和分析数百个全网网页的同时，保持对深层关键细节的注意力加权，擅长处理复杂的长篇综述与深度资料比对任务20。  
腾讯则将大模型能力与国民级应用生态进行了深度融合19。微信搜一搜的 AI 搜索功能以及腾讯元宝同时接入了腾讯混元大模型与 DeepSeek-R1 满血版19。该体系不仅能检索公网信息，还能深度整合微信公众号平台的高质量独家内容生态，在旅游攻略、商业洞察以及知识解答等场景下表现出极高的数据独特性与权威归因能力19。

| 产品名称 | 核心推理引擎与架构 | 数据源与检索范围 | 核心功能与差异化优势 |
| :---- | :---- | :---- | :---- |
| **OpenAI Deep Research** | o3 系列推理大模型，基于强化学习微调3 | 开放互联网、PDF 文档、图像、内置 Python 运行沙箱3 | 支持交互式需求澄清，具备长时序自主规划与动态多跳检索能力，输出带精准引用的结构化报告3 |
| **Perplexity AI** | 动态模型路由（支持 Claude、GPT 等模型组合）11 | 自建网络索引、第三方搜索 API、集成计算机执行环境11 | 提供即时问答与深度调研双模式，通过集成计算机环境强化事实核查与引用质量11 |
| **Genspark** | Mixture-of-Agents (MoA) 体系，协同 70+ 模型13 | 全网公网数据、10+ 独家数据集、80+ 工具链14 | 自动生成动态 Sparkpages，支持异步后台调研与一键式事实交叉比对（Cross-Check）13 |
| **DeepSeek R1 / 扩展架构** | DeepSeek-R1 深度推理模型（结合开源生态）21 | 第三方搜索引擎 API（如 Tavily、火山方舟等）22 | 展现显式思维链，构建“思考-检索-再思考”自适应循环，具备极高的推理性价比21 |
| **Kimi 探索版** | Moonshot Kimi 大模型（基于 AttnRes 架构）20 | 全网实时互联网检索20 | 结合超长上下文与深层注意力加权机制，专长于海量网页数据的提取与长篇研报生成20 |
| **微信 AI 搜索 / 腾讯元宝** | 腾讯混元大模型 \+ DeepSeek-R1 双引擎19 | 全网搜索数据 \+ 微信公众号独家内容生态19 | 依靠超级流量入口，融合公网数据与高价值私域内容生态，提供全面的信息合成19 |

## **开源深度调研智能体项目与技术路线**

开源社区在探索深度调研智能体（Open-source Deep Research Agents）的架构实现方面展现出了极高灵活性1。开源方案消除了商业产品的黑盒机制，允许开发者根据特定业务需求定制抓取逻辑、更换底层 LLM 后端，并在私有云环境中实现高安全性部署1。

### **经典与新兴开源智能体剖析**

GPT-Researcher 是开源领域最早且最成熟的自主科研智能体之一1。该项目旨在解决传统大语言模型提供虚假信息与时效性滞后的问题1。系统采用了“主协调器与并行研究员（Master-Sub Agent）”的分布式架构27。当用户提交课题后，主智能体负责规划研究大纲并生成子问题，并行派发多个子智能体调用定制化的网页爬虫（Scrapers）与搜索引擎进行抓取、筛选与文本归纳，最后由总结智能体合成为符合学术规格的详细研报1。GPT-Researcher 具备极高的扩展性，支持无缝切换 OpenAI、Claude 或 Ollama 本地模型，并允许嵌入自定义检索工具1。  
由斯坦福大学团队主导开发的 STORM（Synthesis of Topic Outlines through Research & Modelling）则代表了另一种知识生成范式1。STORM 将重点放在研报撰写前的“知识整理与结构构建”阶段29。该系统模拟了人类学术访谈过程：通过创建代表不同立场的智能体角色与领域专家角色，进行多轮对话式的互动质询，自底向上地收集互联网证据并构建分层结构的大纲，最终撰写出深度类似维基百科条目的长篇综合综述7。  
Perplexica 与 Vane 是Perplexity 的开源替代品1。Perplexica 底层对接开源搜索引擎 SearXNG，结合 LangChain 与本地或云端 LLM，实现了完全本地化、隐私安全的 AI 搜索引擎1。Vane 则在隐私保护的基础上进一步优化了交互模式，提供极速模式（Speed）、平衡模式（Balanced）与深度调研模式（Quality），并允许用户精准挑选学术论文、论坛讨论或全网内容作为检索源26。  
在 OpenAI Deep Research 推出后，开源社区涌现出了一批旨在高精度复刻其工作流的项目22。其中，dzhng/deep-research 以极简的 TypeScript 架构展示了基于递归推理与 Firecrawl 数据采集的深度搜索闭环25。sugarforever/deepseek-deep-research 专门针对 DeepSeek-R1 进行优化，利用 R1 模型的思考过程控制搜索 API，构建了符合标准 Chat Completion 规范的后端服务22。而 Zilliz 推出的 Deep-Searcher 则将公网搜索与企业内部向量数据库（Milvus）相结合，提供了兼顾企业私域知识与公网信息的深度检索解决方案30。

| 项目名称 | 核心架构与设计范式 | 技术栈与工具依赖 | 适用场景与产出物特性 |
| :---- | :---- | :---- | :---- |
| **GPT-Researcher** | 主从式并行 Agent 编排，支持 Plan-and-Solve 拓扑27 | Python, LangChain, 多源 Web Scrapers1 | 自动化生成包含完整参考文献引用的万字学术/商业研报1 |
| **STORM** | 基于角色扮演的对话质询，自底向上生成分层大纲7 | Python, DSPy 框架, 多 Agent 对话系统7 | 生成结构严密、多视角覆盖的类维基百科综合知识综述1 |
| **Perplexica / Vane** | 独立检索模块 \+ 交互式 UI，支持多搜索模式1 | TypeScript, SearXNG, Ollama / 商业 API1 | 私有化部署的 AI 搜索引擎，快速提供附带来源的对话式解答1 |
| **deep-research (dzhng)** | 极简迭代递归搜索，基于上下文大纲扩展25 | TypeScript, Node.js, Firecrawl API25 | 轻量级深度搜索逻辑实现，适合二次开发与集成25 |
| **Deep-Searcher (Zilliz)** | 混合 RAG 范式（企业向量数据库 \+ 公网搜索引擎）30 | Python, Milvus / Zilliz Cloud, Multi-LLM30 | 跨企业内部私有知识库与互联网外部数据的综合深度调研30 |

## **模型上下文协议 (MCP) 与 Agent Skill 生态**

模型上下文协议（Model Context Protocol, MCP）是由 Anthropic 提出的开放标准，旨在为大语言模型应用与外部数据源及工具之间建立统一、标准化的双向连接7。MCP 的出现消除了开发者为每个模型或 Agent 框架重复编写定制接口（Glue Code）的繁琐工作32。在联网搜索与深度调研领域，MCP 已经成为 Cursor、Claude Desktop、Windsurf 等客户端无缝扩展网络检索与数据抽取能力的标准协议8。

### **核心联网搜索与网页数据处理 MCP 服务**

Firecrawl MCP Server 是网络数据抓取与解析领域的代表性工具9。传统的搜索引擎通常仅返回包含标题和摘要的 SERP 页面，而 Firecrawl MCP 向智能体暴露了 scrape（单页深度解析）、crawl（全站递归爬取）、search（搜索并直接返回提炼内容）以及 structured extract（基于模式的结构化提取）等核心 Skill8。它能够将复杂的网页动态 HTML 转换为无噪声的 Markdown 格式或 JSON 数据，大幅降低了智能体处理不相关 DOM 节点时的 Token 消耗9。  
Exa MCP Server（原 Metaphor）专注于“神经网络语义搜索”8。传统基于关键字（BM25）的搜索引擎在处理智能体发出的复杂抽象概念时容易失效8。Exa 通过向量化网络索引，支持概念级检索与相似内容发现8。智能体可以通过 Exa MCP 查找“在论证逻辑上与某篇特定论文相似的行业报告”或“具有特定技术路线的初创公司”，有效提升了非结构化研究任务中的信息召回率8。  
Tavily MCP Server 专为 AI Agent 的事实检索与归因打造8。其暴露的服务接口集成了实时搜索与关键内容提炼功能，能够自动过滤垃圾信息与 SEO 导向的重复内容，向智能体返回包含严格出处元数据的事实片段，高度适配事实查证与新闻追踪任务8。  
针对隐私敏感或希望获取非垄断性检索结果的场景，Brave Search MCP 和 Kagi MCP 提供了独立索引库的接入能力8。Brave Search MCP 原生支持完整的高级搜索语法（如 site:、filetype:pdf、intitle:、时间范围限定等），允许智能体生成精准的组合逻辑查询指令8。  
为了解决多源工具调用的繁琐配置问题，社区推出了聚合类 MCP 服务，如 mcp-omnisearch8。该服务在一个 MCP 端口内集成了 Tavily、Perplexity、Kagi、Jina AI、Brave、Exa 及 Firecrawl 的能力，使智能体能够根据当前的具体调研子目标，在语义搜索、事实核查或代码库检索之间实现动态路由8。对于需要突破登录墙或强 JS 动态渲染的复杂网页，结合无头浏览器的 Playwright MCP 或 Browserbase MCP 则为智能体补充了可视化交互与 UI 操作能力33。

| MCP 服务名称 | 暴露的核心 Tool / Skill 接口 | 数据输出格式与特性 | 典型应用场景与能力适配 |
| :---- | :---- | :---- | :---- |
| **Firecrawl MCP** | scrape, crawl, search, map, batch\_scrape \[cite: 8, 9\] | 清洁 Markdown, 结构化 JSON, 网页截图9 | 深度全站分析、复杂文档清洗、绕过防爬阻碍获取正文9 |
| **Exa MCP** | neural\_search, find\_similar, get\_contents \[cite: 8, 33\] | 向量化语义文档链接、干净提炼文本8 | 概念驱动的探究性搜索、寻找深层隐藏资源、同类竞品洞察8 |
| **Tavily MCP** | tavily\_search, tavily\_extract \[cite: 8, 35\] | 高相关性事实文本块、完整引用元数据8 | 快速事实核查、即时事件追踪、需要高度可靠归因的回答8 |
| **Brave Search MCP** | brave\_web\_search, brave\_local\_search \[cite: 8, 36\] | 包含丰富元数据的 SERP JSON8 | 隐私安全检索、精准限定域名或文件类型的高级搜索8 |
| **mcp-omnisearch** | 统一搜索网关（整合 7+ 主流搜索引擎与数据提取工具）8 | 标准化聚合 JSON 数据8 | 复合型长程调研智能体，需根据任务灵活切换搜索引擎8 |
| **Playwright MCP** | navigate, click, type, screenshot, evaluate \[cite: 36\] | DOM 快照、渲染后页面文本、交互图像36 | 处理动态单页应用（SPA）、表单交互、突破复杂界面阻碍33 |

## **深度调研智能体的核心架构设计与工程机制**

深度调研智能体能够执行高质量研究的本质，在于其系统架构成功将大语言模型的自回归推理能力与外部工具链形成了长时序的闭环控制2。通过对主流开源与闭源系统的技术实现进行解构，一个成熟的深度调研智能体通常包含四个关键工程模块2。  
任务拆解与动态自适应规划是智能体的神经中枢2。由于用户的初始提问通常较为宽泛，智能体首先利用大模型的逻辑推理能力，将总体目标分解为包含多个子课题的树状大纲2。在执行过程中，系统并非硬性遵循静态计划，而是采用“规划-执行-评估-重规划（Plan-Act-Evaluate-Replan）”的动态循环2。每当从网络中获取到新的信息，重规划模块都会重新评估当前知识图谱的完备度，若发现新的关键线索或矛盾证据，系统会自发调整后续的搜索路线2。  
多跳渐进式检索与跨工具编排构成了智能体的数据收集引擎2。研究性任务很少能通过单次搜索完成，第一轮检索获得的数据往往包含未知的专业术语或新实体，这会触发智能体发起第二轮乃至第三轮的针对性深挖（即多跳推理）2。在此期间，智能体通过标准化协议（如 MCP 或 Function Calling）灵活调度不同工具：利用语义搜索引擎寻找关联概念，调用深层抓取工具提取完整文档，并在面对数值分析任务时，自动编写并运行 Python 脚本对数据进行演算3。  
事实核查与多源交叉验证机制是确保调研报告严谨性的核心保障5。为了消除幻觉与网络噪声，先进的智能体会设立专门的拆解与验证模块5。系统从抓取到的网页文本中提取出事实元组（即包含时间、地点、核心数据及逻辑因果的 Verification Points），并使用独立的检索路径在多个互不关联的源头之间进行交叉比对5。若出现数据不一致的情况，智能体会明确发起冲突排查指令，或在最终输出中显式标注不同来源的争议点2。  
长上下文管理与具备可追溯性的研报合成决定了最终产出的质量3。在长达数十分钟的调研过程中，抓取的原始网页数据可能积攒至数百万 Token，极易超出模型的有效处理范围或造成注意力分散3。优秀的智能体采用了基于子目标分割的上下文压缩策略：将已完成子任务的执行轨迹收敛为高维度的语义摘要，仅在当前正在执行的子任务中保留细粒度的动作日志6。最后，报告生成模块将经过验证的证据链按照预设的专业结构进行合成，为每一个事实声明附带精确可点击的来源引用，实现研究过程的全程可追溯3。

## **产业影响与未来演进趋势**

联网搜索与深度调研智能体的普及正在对整个数字信息生态产生深远影响4。在信息供给端，智能体彻底改变了人类获取网络知识的方式，使得互联网流量入口从传统的“搜索引擎结果页（SERP）”转向由 AI 归纳合成的“智能体交互界面”4。这种转变促使传统的内容网站与搜索引擎优化（SEO）行业向“智能体引擎优化（Agent Engine Optimization, AEO）”与“生成式引擎优化（GEO）”转型1。内容生产者开始积极拥抱结构化数据与适配 AI 阅读的 llms.txt 标准，以确保其高质量内容能够被深度调研智能体准确识别与引用9。  
在技术研发路线方面，未来的智能体将更加依赖模型训练阶段与 Agent 行为的深度融合3。早期的智能体主要基于外挂式的 Prompt 提示工程与简单的 ReAct 框架6。而随着 DeepSeek-R1 以及 OpenAI o3 的验证，将长程推理、自主搜索与自我反思能力通过强化学习（RL）及中训（Mid-training）直接注入模型底座，成为下一代前沿大模型的核心竞争壁垒3。开源社区也将以此为契机，加速构建“原生推理模型 \+ 模块化 MCP 工具 \+ 领域私有知识”的解耦架构1。  
在商业应用层面，深度调研智能体正加速从通用消费级搜索向高价值垂直行业渗透2。金融机构利用其进行自动化的尽职调查与市场研报撰写，医疗与生物科技领域通过智能体实现跨数据库的文献综述，法务团队则依靠其进行判例比对与合规审查2。随着以 MCP 为代表的标准化连接协议的成熟，闭源 SaaS 服务与开源本地部署方案将分别满足企业对极至性能与绝对数据隐私的差异化需求，共同推动知识工作自动化走向新的高度1。

#### **引用的著作**

> 1. JMcrafter26/awesome-ai-tools \- GitHub, [https://github.com/JMcrafter26/awesome-ai-tools](https://github.com/JMcrafter26/awesome-ai-tools)  
> 2. OpenAI Deep Research \- Emergent Mind, [https://www.emergentmind.com/topics/openai-deep-research](https://www.emergentmind.com/topics/openai-deep-research)  
> 3. Understanding OpenAI's Deep Research Methodology \- PromptLayer Blog, [https://blog.promptlayer.com/how-deep-research-works/](https://blog.promptlayer.com/how-deep-research-works/)  
> 4. OpenAI紧急加播：ChatGPT上新深度搜索，持续思考30分钟输出1万字，刷榜“人类最后的考试, [https://hub.baai.ac.cn/view/43085](https://hub.baai.ac.cn/view/43085)  
> 5. Step-DeepResearch Technical Report \- arXiv, [https://arxiv.org/html/2512.20491v1](https://arxiv.org/html/2512.20491v1)  
> 6. Yunque DeepResearch Technical Report \- arXiv, [https://arxiv.org/html/2601.19578v1](https://arxiv.org/html/2601.19578v1)  
> 7. ai-for-developers/awesome-claude: A curated list of awesome cloud computing resources, services, frameworks, and tools. \- GitHub, [https://github.com/ai-for-developers/awesome-claude](https://github.com/ai-for-developers/awesome-claude)  
> 8. mcp-omnisearch \- MCP Server Finder, [https://www.mcpserverfinder.com/servers/spences10/mcp-omnisearch](https://www.mcpserverfinder.com/servers/spences10/mcp-omnisearch)  
> 9. 16 Best MCP Servers You Can Add to Cursor For 10x Productivity \- Firecrawl, [https://www.firecrawl.dev/blog/best-mcp-servers-for-cursor](https://www.firecrawl.dev/blog/best-mcp-servers-for-cursor)  
> 10. OpenAI's deep research aims to outthink analysts \- IBM, [https://www.ibm.com/think/news/openai-releases-deep-research](https://www.ibm.com/think/news/openai-releases-deep-research)  
> 11. The ultimate guide to Perplexity AI, [https://datanorth.ai/blog/perplexity-ai-what-is-it-and-why-is-it-important](https://datanorth.ai/blog/perplexity-ai-what-is-it-and-why-is-it-important)  
> 12. Deep Research, now in Computer \- Perplexity, [https://www.perplexity.ai/hub/blog/deep-research-now-in-computer](https://www.perplexity.ai/hub/blog/deep-research-now-in-computer)  
> 13. Genspark Wikipedia: Official Access, Features & Quick Guide, Click to Use\! \- Skywork, [https://skywork.ai/blog/models/genspark-wikipedia-official-access-features-quick-guide/](https://skywork.ai/blog/models/genspark-wikipedia-official-access-features-quick-guide/)  
> 14. Record-Breaking Launch: Genspark Super Agent Reaches $10 Million ARR Faster Than Any AI Product \- AI Secret, [https://aisecret.us/record-breaking-launch-genspark-super-agent-reaches-10-million-arr-faster-than-any-ai-product/](https://aisecret.us/record-breaking-launch-genspark-super-agent-reaches-10-million-arr-faster-than-any-ai-product/)  
> 15. Blog \- Genspark.ai, [https://www.genspark.ai/blog](https://www.genspark.ai/blog)  
> 16. Genspark vs remio: AI Search vs Personal Knowledge Base, [https://www.remio.ai/post/genspark-vs-remio-ai-search-vs-personal-knowledge-base](https://www.remio.ai/post/genspark-vs-remio-ai-search-vs-personal-knowledge-base)  
> 17. World''s First Search and Autopilot Agent Integration, Plus More\! \- Genspark AI, [https://www.genspark.ai/blog/genspark-new-features-20240925](https://www.genspark.ai/blog/genspark-new-features-20240925)  
> 18. Make complex analysis and fact-checking surprisingly easy with Genspark's "Autopilot Agent"\!｜AI-Bridge Lab \- note, [https://note.com/doerstokyo\_kb/n/n2552a3e50bc0?hl=en](https://note.com/doerstokyo_kb/n/n2552a3e50bc0?hl=en)  
> 19. “国民应用”牵手DeepSeek：微信的AI搜索野心与腾讯的“双模型”押注 \- DoNews, [https://www.donews.com/article/detail/5093/81504.html](https://www.donews.com/article/detail/5093/81504.html)  
> 20. 月之暗面 \- 品玩, [https://www.pingwest.com/tag/21975](https://www.pingwest.com/tag/21975)  
> 21. 教师必看！DeepSeek超全使用指南, [https://www.scge.gov.cn/html/website/outsite/xinxihuagongzuo/wenjianziliao/1899645340236296193.html](https://www.scge.gov.cn/html/website/outsite/xinxihuagongzuo/wenjianziliao/1899645340236296193.html)  
> 22. sugarforever/deepseek-deep-research \- GitHub, [https://github.com/sugarforever/deepseek-deep-research](https://github.com/sugarforever/deepseek-deep-research)  
> 23. 中国蓝观察丨超200家企业接入DeepSeek AI正在改变世界 \- 新蓝网, [https://www.cztv.com/newsDetail/767744](https://www.cztv.com/newsDetail/767744)  
> 24. AI助手巅峰对决：DeepSeek、元宝、豆包、Kim，谁是“智能之王”？谁又最糟糕？ \- OFweek人工智能网, [https://m.ofweek.com/ai/2025-03/ART-201700-8110-30659336.html](https://m.ofweek.com/ai/2025-03/ART-201700-8110-30659336.html)  
> 25. awesome-ml/llm-tools.md at master \- GitHub, [https://github.com/underlines/awesome-ml/blob/master/llm-tools.md](https://github.com/underlines/awesome-ml/blob/master/llm-tools.md)  
> 26. ItzCrazyKns/Vane: Vane is an AI-powered answering engine. \- GitHub, [https://github.com/ItzCrazyKns/Vane](https://github.com/ItzCrazyKns/Vane)  
> 27. Open-Source Deep Research Agents with Multi-Tool Integration｜Hafnium \- note, [https://note.com/hafnium/n/nf114386ea856?hl=en](https://note.com/hafnium/n/nf114386ea856?hl=en)  
> 28. AI Agents for ABM: Automating Account-Based Workflows \- LinkedIn, [https://zenabm.com/blog/ai-agents-for-abm](https://zenabm.com/blog/ai-agents-for-abm)  
> 29. ChatGPT: how to use it and the pitfalls/cautions in academia \- PMC, [https://pmc.ncbi.nlm.nih.gov/articles/PMC12597148/](https://pmc.ncbi.nlm.nih.gov/articles/PMC12597148/)  
> 30. swiftsimplify/awesome-open-source-ai-tools \- GitHub, [https://github.com/swiftsimplify/awesome-open-source-ai-tools](https://github.com/swiftsimplify/awesome-open-source-ai-tools)  
> 31. Deep Research alternatives · ItzCrazyKns Vane · Discussion \#608 \- GitHub, [https://github.com/ItzCrazyKns/Vane/discussions/608](https://github.com/ItzCrazyKns/Vane/discussions/608)  
> 32. Best Web Search APIs & MCPs for AI Agents 2026 \- Vellum, [https://www.vellum.ai/blog/best-web-search-apis-and-mcps-for-ai-agents](https://www.vellum.ai/blog/best-web-search-apis-and-mcps-for-ai-agents)  
> 33. Top 15 Web Search MCPs to Connect Your AI To \- Nimble, [https://www.nimbleway.com/blog/top-web-search-mcps](https://www.nimbleway.com/blog/top-web-search-mcps)  
> 34. Best Web Search APIs for AI Applications in 2026 \- Firecrawl, [https://www.firecrawl.dev/blog/best-web-search-apis](https://www.firecrawl.dev/blog/best-web-search-apis)  
> 35. Top Web Search MCP Servers for Claude, Cursor, Codex and More \- Firecrawl, [https://www.firecrawl.dev/blog/best-web-search-mcp](https://www.firecrawl.dev/blog/best-web-search-mcp)  
> 36. GitHub \- TrelisResearch/mcp: Model Context Protocol Servers, [https://github.com/TrelisResearch/mcp](https://github.com/TrelisResearch/mcp)  
> 37. Tongyi DeepResearch Technical Report \- GitHub, [https://raw.githubusercontent.com/Alibaba-NLP/DeepResearch/main/Tech\_Report.pdf](https://raw.githubusercontent.com/Alibaba-NLP/DeepResearch/main/Tech_Report.pdf)  
> 38. OpenAI's Deep Research Tool: A Comprehensive Overview | by ByteBridge \- Medium, [https://bytebridge.medium.com/openais-deep-research-tool-a-comprehensive-overview-12ddab43feff](https://bytebridge.medium.com/openais-deep-research-tool-a-comprehensive-overview-12ddab43feff)