/**
 * S5（2026-10-28 · CV-040 收口）：节拍分析 / 卡点吸附两件 Host 工具。
 *
 * 为什么独立成文件：host-tools.ts 在文件行数与 createStudioTools 函数跨度双棘轮上
 * （超大文件拆分执行计划阶段 1 待拆），新工具落这里以工厂注入（registry 与两个
 * Host 侧解析/门禁 helper 由 host-tools.ts 传入）。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ProjectRegistry } from './projects.js'
import { throwError } from './error-system.js'
import { urlToAssetPath } from './compose.js'
import { loadStoryboard, updateStoryboard } from './storyboard-store.js'
import { mergeStoryboardWrite, normalizeStoryboard } from './contracts/storyboard.js'
import { resolveFfmpegPath } from './ffmpeg-run.js'
import { analyzeBeatsFromFile, snapCutsToBeats, heuristicLyrics, type BeatAnalysis } from './beat-analyze.js'
import type { MusicResult } from './generate.js'
type MusicResultLike = MusicResult
import type { MusicParams } from './generate.js'
type GenerateMusicFn = (registry: ProjectRegistry, projectId: string, params: MusicParams, signal?: AbortSignal) => Promise<MusicResult>

export interface AudioToolsDeps {
  registry: ProjectRegistry
  resolveProjectId(registry: ProjectRegistry, cwd: string | undefined): Promise<string>
  assertApprovalAllowed(registry: ProjectRegistry, projectId: string, tool: string, shotBound: boolean): Promise<void>
}

/**
 * D-06：多版抽卡的 caption 微扰（纯函数）。
 * 微扰原则：确定性、幅度小 —— prompt 里带「N BPM」时 BPM ±3（节拍维度微变），
 * 否则追加编曲变体词（编曲维度微变）。第 1 版永远用原 prompt（主选）。
 */
export function perturbMusicCaption(prompt: string, variant: number): string {
  const bpmShift = variant === 2 ? 3 : -3
  const withBpm = prompt.replace(/(\b)(\d{2,3})(\s*BPM\b)/iu, (_all, head: string, num: string, tail: string) => `${head}${Math.max(40, Number(num) + bpmShift)}${tail}`)
  if (withBpm !== prompt) return withBpm
  return `${prompt}, ${variant === 2 ? 'alternate arrangement' : 'second alternate arrangement'}`
}


/** D-06：多版抽卡循环（host-tools.ts 的 music_generation execute 调入；span 棘轮外置）。 */
export async function generateMusicWithVariants(
  deps: { registry: ProjectRegistry; signal?: AbortSignal; generate: GenerateMusicFn },
  projectId: string,
  params: MusicParams,
  variants: number,
  originalPrompt: string,
): Promise<MusicResultLike> {
  const { registry, signal, generate } = deps
  if (variants <= 1) return generate(registry, projectId, params, signal)
  const primary = await generate(registry, projectId, params, signal)
  const variantSummaries: MusicResultLike['variants'] = []
  for (let index = 0; index < variants - 1; index += 1) {
    const perturbed = perturbMusicCaption(originalPrompt, index + 2)
    const variant = await generate(registry, projectId, { ...params, captionPrompt: perturbed }, signal)
    variantSummaries.push({ nodeId: variant.nodeId, url: variant.url, duration: variant.duration, caption: perturbed })
  }
  return { ...primary, variants: variantSummaries }
}

/** 两件工具的工厂（host-tools.ts 的 tools 数组展开本调用）。 */
export function defineAudioTools(deps: AudioToolsDeps): ReturnType<typeof defineTool>[] {
  const { registry, resolveProjectId, assertApprovalAllowed } = deps
  return [
  defineTool({
    name: 'analyze_beats',
    description:
      '本地节拍分析（S5）：对音频节点跑 ffmpeg astats/ebur128，产出 BPM、拍点（秒）、confidence、实测响度 LUFS，写回节点 beats 字段并**回填故事板 06_sound.bgm 的 bpm/lufs**（既有契约字段，唯一写入点 mergeStoryboardWrite；缺故事板则跳过）。可选 lyricsLines 给歌词行数组 → 按静音区间+字数比例启发式对齐成歌词时间轴（lyricsTimeline，标 estimated、UI 弱化显示；人工指定才用 source=specified 的精度）。⚠️ confidence<0.5 = 低置信：**禁用卡点吸附**（D-05），beats 仅作参考。卡点吸附用 snap_cuts_to_beats。',
    parameters: {
      nodeId: { type: 'string' as const, required: true, description: '音频节点 id（music_generation / tts_voiceover / cut_audio 产物）' },
      lyricsLines: { type: 'array' as const, items: { type: 'string' as const }, description: '可选：歌词行数组（按顺序）——给了对齐出 lyricsTimeline（启发式，estimated）；不给只做节拍分析' },
    },
    output: { schema: { type: 'object' as const, additionalProperties: true, properties: { nodeId: { type: 'string' as const }, bpm: { type: 'number' as const }, lufs: { type: 'number' as const }, confidence: { type: 'number' as const }, beatCount: { type: 'integer' as const }, lyricCount: { type: 'integer' as const }, storyboardFilled: { type: 'boolean' as const }, notes: { type: 'array' as const, items: { type: 'string' as const } } } }, render: (_args, value) => {
      const v = value as { nodeId?: string; bpm?: number; lufs?: number; confidence?: number; beatCount?: number; lyricCount?: number; storyboardFilled?: boolean; notes?: string[] }
      const lines = [
        `节拍分析（节点 ${v.nodeId ?? '?'}）：BPM≈${v.bpm ?? '?'}（confidence ${v.confidence ?? '?'}，${(v.confidence ?? 0) >= 0.5 ? '可用于卡点' : '**低置信——禁用卡点（D-05）**'}），拍点 ${v.beatCount ?? 0} 个，实测响度 ${v.lufs !== undefined ? `${v.lufs} LUFS` : '未测到'}。`,
        v.lyricCount !== undefined ? `歌词时间轴 ${v.lyricCount} 行（启发式对齐，source=estimated，展示请弱化）。` : '',
        v.storyboardFilled === true ? '已回填故事板 06_sound.bgm 的 bpm / lufs（既有字段，未新造事实源）。' : '故事板不存在或无 06_sound，未回填。',
        ...((v.confidence ?? 0) < 0.5 ? ['⚠️ 低置信：不要对这首曲子做卡点剪辑；beats 仅作参考信息。'] : ['做卡点：调 snap_cuts_to_beats 传本节点 id 与有序 clipIds。']),
        ...(v.notes ?? []).map((note) => `⚠️ ${note}`),
      ].filter(Boolean)
      return [{ type: 'text', text: lines.join('\n') }]
    } },
    async execute(args, exec) {
      const a = args as { nodeId: string; lyricsLines?: string[] }
      const projectId = await resolveProjectId(registry, exec.agent?.session.header.cwd)
      await assertApprovalAllowed(registry, projectId, 'analyze_beats', false)
      const document = await registry.readCanvas(projectId)
      const node = document.nodes.find((item) => item.id === a.nodeId)
      if (node === undefined || node.url === undefined) {
        throwError('CS-USER-ERR', { message: `音频节点不存在：${a.nodeId}` })
      }
      const assetsDir = registry.assetsDir(projectId)
      const inputPath = urlToAssetPath(assetsDir, node.url)
      const analysis = await analyzeBeatsFromFile(resolveFfmpegPath(), inputPath, { signal: exec.signal })
      // 节点写回（beats / lyricsTimeline）—— 与其它 Host 写回同一条 writeCanvas 通路。
      const updated = document.nodes.map((item) => (item.id === a.nodeId
        ? { ...item, beats: { bpm: analysis.bpm, beats: analysis.beats, confidence: analysis.confidence, ...(analysis.lufs !== undefined ? { lufs: analysis.lufs } : {}), method: analysis.method, notes: analysis.notes } as BeatAnalysis, ...(Array.isArray(a.lyricsLines) && a.lyricsLines.length > 0 ? { lyricsTimeline: heuristicLyrics(a.lyricsLines, analysis.silences, analysis.durationSec) } : {}) }
        : item))
      await registry.writeCanvas(projectId, updated)
      // 回填 06_sound.bgm.bpm / lufs（唯一写入点 mergeStoryboardWrite；字段级合并，不动 sfx/brief）。
      let storyboardFilled = false
      const loaded = await loadStoryboard(registry, projectId)
      if (loaded.status === 'ok') {
        const current = loaded.document
        const sound = current.sections['06_sound'] as { bgm?: { bpm?: number; lufs?: number; sidechain?: string }; sfx?: string[]; brief?: string } | undefined
        const merged = mergeStoryboardWrite(current, {
          title: current.title,
          meta: current.meta,
          // 节级输入平铺（mergeStoryboardWrite 的入参形态）；06_sound 字段级合并，不动 sfx/brief。
          '06_sound': {
            ...sound,
            bgm: { ...(sound?.bgm ?? { bpm: 0, lufs: 0, sidechain: '' }), ...(analysis.bpm > 0 ? { bpm: analysis.bpm } : {}), ...(analysis.lufs !== undefined ? { lufs: analysis.lufs } : {}) },
          },
        })
        const normalized = normalizeStoryboard({ projectId, title: merged.title, meta: merged.meta, sections: merged.sections })
        if (normalized !== undefined) {
          await updateStoryboard(registry, projectId, () => normalized)
          storyboardFilled = true
        }
      }
      return {
        nodeId: a.nodeId,
        ...(analysis.bpm > 0 ? { bpm: analysis.bpm } : {}),
        ...(analysis.lufs !== undefined ? { lufs: analysis.lufs } : {}),
        confidence: analysis.confidence,
        beatCount: analysis.beats.length,
        ...(Array.isArray(a.lyricsLines) && a.lyricsLines.length > 0 ? { lyricCount: heuristicLyrics(a.lyricsLines, analysis.silences, analysis.durationSec).length } : {}),
        storyboardFilled,
        notes: analysis.notes,
      }
    },
  }),
  defineTool({
    name: 'snap_cuts_to_beats',
    description:
      '卡点吸附（S5）：读音频节点的节拍数据（先跑 analyze_beats），把有序片段的**内部切点**（前缀和）吸附到最近拍点（容差 ±0.5 拍，超差不吸附并告警）。返回每个切点的吸附结果与偏移 —— 你据它用 write_storyboard 改各镜时长（frames = round(sec × fps)），**必须重算 durationInFrames 并过尾部完整性校验**（吸附会让总时长漂移）。confidence<0.5 的节点会被直接拒绝（D-05）。',
    parameters: {
      audioNodeId: { type: 'string' as const, required: true, description: '音频节点 id（必须已跑过 analyze_beats 且 confidence ≥0.5）' },
      clipIds: { type: 'array' as const, items: { type: 'string' as const }, required: true, description: '有序视频片段节点 id（切点 = 相邻片段真实时长前缀和）' },
      toleranceBeats: { type: 'number' as const, description: '可选：吸附容差（拍，默认 0.5）' },
    },
    output: { schema: { type: 'object' as const, additionalProperties: true, properties: { cuts: { type: 'array' as const, items: { type: 'object' as const, additionalProperties: true } }, snappedCount: { type: 'integer' as const }, totalDriftSec: { type: 'number' as const }, warnings: { type: 'array' as const, items: { type: 'string' as const } } } }, render: (_args, value) => {
      const v = value as { cuts?: Array<{ original: number; snapped?: number; deltaSec?: number }>; snappedCount?: number; totalDriftSec?: number; warnings?: string[] }
      const lines = [`卡点吸附：${v.snappedCount ?? 0}/${(v.cuts ?? []).length} 个切点落拍（总漂移 ${v.totalDriftSec ?? 0}s）。`]
      for (const cut of v.cuts ?? []) {
        lines.push(cut.snapped !== undefined
          ? `- 切点 ${cut.original.toFixed(3)}s → ${cut.snapped.toFixed(3)}s（偏移 ${(cut.deltaSec ?? 0) >= 0 ? '+' : ''}${(cut.deltaSec ?? 0).toFixed(3)}s）`
          : `- 切点 ${cut.original.toFixed(3)}s 保持原值（超容差）`)
      }
      for (const warning of v.warnings ?? []) lines.push(`⚠️ ${warning}`)
      lines.push('下一步：按吸附后的切点用 write_storyboard 重写受影响镜的 duration（frames = round(sec × fps)），重算总时长后过尾部完整性校验。')
      return [{ type: 'text', text: lines.join('\n') }]
    } },
    async execute(args, exec) {
      const a = args as { audioNodeId: string; clipIds: string[]; toleranceBeats?: number }
      const projectId = await resolveProjectId(registry, exec.agent?.session.header.cwd)
      await assertApprovalAllowed(registry, projectId, 'snap_cuts_to_beats', false)
      const document = await registry.readCanvas(projectId)
      const audioNode = document.nodes.find((item) => item.id === a.audioNodeId)
      if (audioNode === undefined || audioNode.beats === undefined) {
        throwError('CS-USER-ERR', { message: `节点 ${a.audioNodeId} 没有节拍数据 —— 先调 analyze_beats` })
      }
      if (audioNode.beats.confidence < 0.5) {
        throwError('CS-USER-ERR', { message: `该曲节拍置信度 ${audioNode.beats.confidence}（<0.5，低置信）—— 按拍板 D-05 禁用卡点吸附，beats 仅作参考信息` })
      }
      const clips = a.clipIds.map((id) => document.nodes.find((item) => item.id === id))
      if (clips.some((clip) => clip === undefined)) {
        throwError('CS-USER-ERR', { message: 'clipIds 里有不存在的节点' })
      }
      // 切点 = 相邻片段真实时长前缀和（duration 真值；未探测按 0 并回显）。
      const cuts: number[] = []
      let cursor = 0
      let unmeasured = 0
      for (const clip of clips.slice(0, -1)) {
        const duration = typeof clip!.duration === 'number' && clip!.duration > 0 ? clip!.duration : 0
        if (duration <= 0) unmeasured += 1
        cursor += duration
        cuts.push(cursor)
      }
      const result = snapCutsToBeats(cuts, audioNode.beats.beats, audioNode.beats.bpm, a.toleranceBeats ?? 0.5)
      const warnings = [...result.warnings, ...(unmeasured > 0 ? [`${unmeasured} 个片段未探测到真实时长，其切点按 0 计（不伪造）——请先生成/重探这些片段`] : [])]
      return {
        cuts: result.cuts.map((cut) => {
          const plain: Record<string, number> = { original: cut.original }
          if (cut.snapped !== undefined) {
            plain.snapped = cut.snapped
            plain.deltaSec = cut.deltaSec ?? 0
            plain.beatIndex = cut.beatIndex ?? -1
          }
          return plain
        }),
        snappedCount: result.snappedCount,
        totalDriftSec: result.totalDriftSec,
        warnings,
      }
    },
  }),
  ]
}
