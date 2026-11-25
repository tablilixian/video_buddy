/**
 * REQ-041 P0-b + P1 · **整片路径的段预览编排**（可注入 IO，便于行为断言）。
 *
 * 一条调用把三件事收齐，全部失败都不抛、不阻断成片：
 * ① 从 shot-cache 按帧窗发布无声段两份（`deliver/` + `assets/`）—— 解决「带 audio
 *    的片子一段都不发」；
 * ② 段 ↔ 旁白按 `startFrame` 落窗配对（不做序号配）；
 * ③ ffmpeg 把无声段 + 对应旁白合成 `assets/seg-<id>-voice.mp4`（画面 `-c:v copy`
 *    零重编码，`-t` 严格按段长），清单 stat 到就改指带声版；失败回退无声版。
 *
 * 成片路径零改动：本函数只在整片渲染**成功后**被调用，只读缓存、只写段副本。
 */
import type { CompositionManifest } from './remotion/manifest.js'
import { matchSegmentVoices } from './segment-audio.js'
import { publishSegmentsFromCache } from './segment-publish.js'
import { mergeSegmentVoice, type FfmpegRun } from './segment-voice-merge.js'
import type { SegmentPointer } from './segment-artifacts.js'

export interface PublishSegmentPreviewInput {
  projectDir: string
  assetsDir: string
  manifest: CompositionManifest
  spec: unknown
  signal?: AbortSignal
  /** 测试注入；生产走默认 ffmpeg。 */
  runFfmpeg?: FfmpegRun
}

export interface PublishSegmentPreviewResult {
  pointers: SegmentPointer[]
  note?: string
}

/**
 * 旁路发布 + 合声。返回指针（仅供清单/回执参考，清单本身独立读盘）；
 * 任何一步失败都退化为「少几段 / 没声音」，绝不让成片陪葬。
 */
export async function publishSegmentPreview(input: PublishSegmentPreviewInput): Promise<PublishSegmentPreviewResult> {
  // 整片路径不渲段 ⇒ 缓存可能为空（第一次渲）；此时诚实返回空，不发半成品。
  let published: ReturnType<typeof publishSegmentsFromCache>
  try {
    published = publishSegmentsFromCache({
      projectDir: input.projectDir,
      assetsDir: input.assetsDir,
      manifest: input.manifest,
      spec: input.spec,
    })
  } catch (cause) {
    return { pointers: [], note: `段旁路发布异常：${cause instanceof Error ? cause.message : String(cause)}` }
  }
  if (published.pointers.length === 0) {
    return { pointers: [], ...(published.note === undefined ? {} : { note: published.note }) }
  }

  const matches = matchSegmentVoices({ manifest: input.manifest, artifacts: published.artifacts })
  const notes: string[] = published.note === undefined ? [] : [published.note]
  // 合声串行（每段 ffmpeg 独立，串行避免 N 路并发打爆本机；段数 ≤ 12，可接受）。
  for (const pointer of published.pointers) {
    const match = matches.get(pointer.id)
    if (match === undefined) continue
    const result = await mergeSegmentVoice({
      projectDir: input.projectDir,
      assetsDir: input.assetsDir,
      id: pointer.id,
      silentFile: pointer.assetFile ?? `seg-${pointer.id}.mp4`,
      durationSec: pointer.durationSec,
      match,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      ...(input.runFfmpeg === undefined ? {} : { run: input.runFfmpeg }),
    })
    if (result.note !== undefined) notes.push(result.note)
  }
  return {
    pointers: published.pointers,
    ...(notes.length === 0 ? {} : { note: notes.join('；') }),
  }
}
