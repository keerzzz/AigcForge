import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { WorkPreset } from "../src/work-preset"

const validPreset = {
  id: "storyboard-video",
  title: "视频分镜脚本",
  category: "video-creation",
  description: "把视频创意拆解为可拍摄的分镜脚本",
  guided: true,
  guidance: "你是资深分镜师，请帮用户把视频创意拆解为可拍摄的分镜脚本。",
  questions: [
    { key: "topic", prompt: "视频主题是什么？", required: true },
    { key: "style", prompt: "希望什么风格？", required: false, options: ["写实", "动画", "纪录片"] },
  ],
  outputType: "mixed",
  artifact: { title: "分镜脚本", filename: "storyboard.md" },
}

describe("WorkPreset.Preset", () => {
  test("validates a valid preset", () => {
    const s = Schema.decodeUnknownSync(WorkPreset.Preset)(validPreset)
    expect(s.id).toBe("storyboard-video")
    expect(s.category).toBe("video-creation")
    expect(s.questions.length).toBe(2)
    expect(s.artifact.filename).toBe("storyboard.md")
  })

  test("rejects unknown category", () => {
    expect(() => Schema.decodeUnknownSync(WorkPreset.Preset)({ ...validPreset, category: "bogus" })).toThrow()
  })

  test("rejects unknown outputType", () => {
    expect(() => Schema.decodeUnknownSync(WorkPreset.Preset)({ ...validPreset, outputType: "exe" })).toThrow()
  })

  test("rejects missing required field", () => {
    const { id: _id, ...rest } = validPreset
    expect(() => Schema.decodeUnknownSync(WorkPreset.Preset)(rest)).toThrow()
  })

  test("rejects non-boolean guided", () => {
    expect(() => Schema.decodeUnknownSync(WorkPreset.Preset)({ ...validPreset, guided: "yes" })).toThrow()
  })

  test("rejects question with non-string prompt", () => {
    expect(() =>
      Schema.decodeUnknownSync(WorkPreset.Preset)({
        ...validPreset,
        questions: [{ key: "topic", prompt: 42, required: true }],
      }),
    ).toThrow()
  })

  test("rejects artifact without filename", () => {
    const { filename: _filename, ...artifact } = validPreset.artifact
    expect(() => Schema.decodeUnknownSync(WorkPreset.Preset)({ ...validPreset, artifact })).toThrow()
  })
})
