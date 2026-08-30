export * as WorkPresetRegistry from "./work-preset"

import { WorkPreset } from "@aigcfroge/schema/work-preset"

const PRESETS: ReadonlyArray<WorkPreset.Preset> = [
  {
    id: "storyboard-video",
    title: "视频分镜脚本",
    category: "video-creation",
    description: "把视频创意拆解为可拍摄的分镜脚本",
    guided: true,
    guidance:
      "你是资深视频分镜师。请基于用户的回答，产出一份 Markdown 双栏分镜脚本：左栏镜头号与画面描述，右栏台词/字幕、时长与备注。开头包含视频标题、风格、目标平台与总时长。镜头衔接自然，节奏符合平台特点。",
    questions: [
      { key: "topic", prompt: "视频主题是什么？", required: true },
      {
        key: "duration",
        prompt: "目标时长大约多久？",
        required: true,
        options: ["60秒以内", "1-3分钟", "3-10分钟", "10分钟以上"],
      },
      {
        key: "platform",
        prompt: "发布在哪个平台？",
        required: true,
        options: ["抖音/快手", "B站", "小红书", "YouTube"],
      },
      { key: "style", prompt: "期望什么视觉风格？", required: true, options: ["写实", "动画", "纪录片", "剧情"] },
      { key: "audience", prompt: "目标受众是谁？", required: false },
    ],
    outputType: "mixed",
    artifact: { title: "视频分镜脚本", filename: "视频分镜脚本.md" },
  },
  {
    id: "write-prd",
    title: "撰写 PRD",
    category: "it-development",
    description: "从零起草一份结构完整的产品需求文档",
    guided: false,
    guidance:
      "你是资深产品经理。请基于用户的回答，产出一份 Markdown PRD：背景与目标、目标用户与场景、功能需求（含优先级）、非功能需求、验收标准。用表格呈现功能清单。语言专业、结构清晰、可直接评审。涉及业务流程时用 ```mermaid flowchart TD 绘制；涉及需求依赖时用 graph 绘制拓扑；涉及排期时用 gantt。仅在文字表达不清时使用，不强制。",
    questions: [
      { key: "background", prompt: "产品背景与要解决的问题是什么？", required: true },
      { key: "targetUsers", prompt: "目标用户是谁？", required: true },
      { key: "coreFeatures", prompt: "核心功能有哪些？", required: true },
      { key: "acceptanceCriteria", prompt: "验收标准有哪些？", required: false },
    ],
    outputType: "markdown",
    artifact: { title: "产品需求文档 (PRD)", filename: "PRD.md" },
  },
  {
    id: "literature-review",
    title: "文献对比综述",
    category: "academic",
    description: "对比多篇文献，生成结构化综述与比较矩阵",
    guided: false,
    guidance:
      "你是科研综述写作者。请基于用户的回答，产出一份 Markdown 文献综述：研究主题界定、各文献核心观点、按指定维度对比、异同与空白、结论。正文含文献比较矩阵表格。引述客观，标注来源，不做主观评价。涉及文献结构时用 ```mermaid mindmap 绘制；文献对比用原生 Markdown 表格（不用 mermaid）。仅在文字表达不清时使用，不强制。",
    questions: [
      { key: "topic", prompt: "研究主题是什么？", required: true },
      { key: "count", prompt: "计划对比多少篇文献？", required: true, options: ["3-5篇", "6-10篇", "10篇以上"] },
      { key: "dimensions", prompt: "希望按哪些维度对比？", required: true },
      { key: "format", prompt: "格式有什么要求？", required: false },
    ],
    outputType: "mixed",
    artifact: { title: "文献对比综述", filename: "文献对比综述.md" },
  },
  {
    id: "official-document",
    title: "撰写行政公文",
    category: "general-office",
    description: "按规范格式生成行政公文草稿",
    guided: true,
    guidance:
      "你是行政公文写作助手。请基于用户的回答，产出一份规范 Markdown 行政公文草稿：文种、主送机关、正文（事由、依据、事项、要求）、落款与日期。语言正式、措辞准确、符合公文格式规范。",
    questions: [
      { key: "docType", prompt: "需要哪种文种？", required: true, options: ["通知", "函", "请示", "报告", "批复"] },
      { key: "subject", prompt: "事由是什么？", required: true },
      { key: "recipient", prompt: "主送机关/对象是谁？", required: true },
      { key: "format", prompt: "格式有什么要求？", required: false },
    ],
    outputType: "markdown",
    artifact: { title: "行政公文", filename: "行政公文.md" },
  },
]

export const list = () => PRESETS

export const byId = (id: string): WorkPreset.Preset | undefined => PRESETS.find((p) => p.id === id)
