/**
 * S1（2026-10-28 · audio-timeline-plan-20261028.md）：统一音频时间轴模型。
 *
 * 根因（CV-040）：音频在系统里不是一个「时间轴」，是三个布尔 —— `audioCompositionFrom`
 * 的 `(hasNative, hasBgm, hasVoiceOver)` 三元组表达不了「第 3 秒到第 8 秒有一句旁白」
 * 「第 2 段视频没有音轨」「BGM 比成片短 2.3 秒」。本文件把时间轴变成唯一事实源：
 *
 * - **纯函数层**：零 IO、零 ffmpeg 调用 —— 校验/归一化（`resolveAudioTimeline`）、
 *   枚举派生（`compositionFromTimeline`）、ffmpeg filter_complex 生成（`buildAudioGraph`）、
 *   中文摘要（`describeTimeline`）全部可单测，compose 与 render 两条路径共用同一实现。
 * - **唯一生成点**：`buildAudioGraph` 是新装配路径里 filter_complex 音频参数的唯一拼接处；
 *   旧 concat 混音路径的 `buildAmixArgs` 保留为兼容包装（老单测逐字符仍成立），见 compose.ts。
 * - **老数据只读派生**（D-03）：`timelineFromComposition` 把老 `canvas.json` 的八枚举
 *   反推成等价时间轴 —— 只读、不写回、不迁移历史数据。
 */

/** 音频段来源角色。native = 分镜视频的原生环境声（来自原始片段文件的音轨）。 */
export type AudioSegmentRole = 'native' | 'bgm' | 'voiceOver' | 'sfx'

/** 素材缺失/过短时的处置（缺省 pad）。 */
export type AudioOnShort = 'pad' | 'loop' | 'error'

/** 时间轴上的一段声音。所有时间字段单位都是秒（绝对时间坐标，帧换算交给调用方）。 */
export interface AudioSegment {
  /** 来源：画布节点 id（可回溯源）。派生时间轴（timelineFromComposition）没有。 */
  sourceNodeId?: string
  /** 素材 URL（同源资产 URL 或本地路径）；派生时间轴可能为空串（来源未知）。 */
  url: string
  /** 绝对起点（秒，成片时间坐标）。旁白/音效必须有；BGM/原生段缺省 0。 */
  startSec: number
  /** 期望占用时长（秒）。0/缺省 = 用素材真实时长（装配期探测后回填）。 */
  durationSec?: number
  /** 线性增益（0–1，1 = 原音量）。全系统只用这一套口径，不引入 dB 双轨。 */
  gain?: number
  fadeInSec?: number
  fadeOutSec?: number
  /** 旁白段压 BGM 的深度（0 = 不压；0–1，装配成 sidechaincompress 的 ratio）。 */
  duckAmount?: number
  /** 素材缺失/过短时的处置：'pad'（补静音，缺省）| 'loop' | 'error'。 */
  onShort?: AudioOnShort
  role: AudioSegmentRole
}

/** 统一音频时间轴：两条合成路径（compose_video / render_composition）的唯一声音事实源。 */
export interface AudioTimeline {
  /** 成片帧率（帧换算用；派生时间轴可能为 0 = 未知）。 */
  fps: number
  /** 成片总时长（秒；0 = 未知，装配期以视频真值兜底）。 */
  durationSec: number
  segments: AudioSegment[]
}

/** 校验问题（resolveAudioTimeline 的产出之一；error 级存在时调用方应拒绝合成）。 */
export interface AudioTimelineIssue {
  severity: 'error' | 'warning'
  /** 机器可判定的类别（前端预检按类分流文案）。 */
  code:
    | 'empty-source'
    | 'negative-start'
    | 'negative-duration'
    | 'non-finite'
    | 'invalid-gain'
    | 'invalid-fade'
    | 'invalid-role'
    | 'invalid-onShort'
    | 'role-overlap'
    | 'duck-without-voiceOver'
    | 'segment-beyond-duration'
    | 'no-source'
    | 'loop-unsupported'
  /** 中文说明，可直接给模型/用户读。 */
  message: string
  segmentIndex?: number
}

/** resolveAudioTimeline 的产出：归一化后的时间轴 + 问题清单。 */
export interface ResolvedAudioTimeline {
  /** 归一化后的时间轴（深拷贝；不回写入参）。 */
  timeline: AudioTimeline
  issues: AudioTimelineIssue[]
  /** 无 error 级问题时为 true（warning 不拦合成）。 */
  ok: boolean
}

const ROLES: ReadonlySet<string> = new Set(['native', 'bgm', 'voiceOver', 'sfx'])
const ON_SHORT: ReadonlySet<string> = new Set(['pad', 'loop', 'error'])

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

/**
 * 校验 + 归一化（纯函数）：把任意来源（agent 手填 / 老数据派生 / manifest 适配）的
 * 时间轴洗成可装配形态。校验只写一次，两条路径共用 —— 否则又是一份放水白名单。
 *
 * 处置分级：**结构性非法**（负时长 / 负起点 / 非有限数 / 非法 onShort / 空 url）=
 * error，调用方应拒绝；**语义可疑但可自动兜住**（同 role 重叠、duck 无旁白、
 * gain 越界、段起点越过片尾）= warning + 归一化，装配继续但结果文本必须回显。
 */
export function resolveAudioTimeline(input: AudioTimeline): ResolvedAudioTimeline {
  const issues: AudioTimelineIssue[] = []
  const segments: AudioSegment[] = []

  input.segments.forEach((raw, index) => {
    const where = `第 ${index + 1} 段（${raw.role ?? '未知角色'}）`
    if (typeof raw.role !== 'string' || !ROLES.has(raw.role)) {
      issues.push({ severity: 'error', code: 'invalid-role', message: `${where}角色非法：${String(raw.role)}`, segmentIndex: index })
      return
    }
    if (typeof raw.url !== 'string' || raw.url.length === 0) {
      issues.push({ severity: 'error', code: 'empty-source', message: `${where}缺少素材 URL`, segmentIndex: index })
      return
    }
    if (!isFiniteNumber(raw.startSec)) {
      issues.push({ severity: 'error', code: 'non-finite', message: `${where}起点不是有限数字`, segmentIndex: index })
      return
    }
    if (raw.durationSec !== undefined && !isFiniteNumber(raw.durationSec)) {
      issues.push({ severity: 'error', code: 'non-finite', message: `${where}时长不是有限数字`, segmentIndex: index })
      return
    }
    if (raw.startSec < 0) {
      issues.push({ severity: 'error', code: 'negative-start', message: `${where}起点 ${raw.startSec}s 为负数（越界起点）`, segmentIndex: index })
      return
    }
    if (raw.durationSec !== undefined && raw.durationSec < 0) {
      issues.push({ severity: 'error', code: 'negative-duration', message: `${where}时长 ${raw.durationSec}s 为负数`, segmentIndex: index })
      return
    }
    let gain: number | undefined
    if (raw.gain !== undefined) {
      if (!isFiniteNumber(raw.gain)) {
        issues.push({ severity: 'error', code: 'non-finite', message: `${where}音量不是有限数字`, segmentIndex: index })
        return
      }
      if (raw.gain < 0 || raw.gain > 1) {
        gain = clamp01(raw.gain)
        issues.push({ severity: 'warning', code: 'invalid-gain', message: `${where}音量 ${raw.gain} 越界（0–1），已收拢到 ${gain}`, segmentIndex: index })
      } else {
        gain = raw.gain
      }
    }
    for (const [key, value] of [['fadeInSec', raw.fadeInSec], ['fadeOutSec', raw.fadeOutSec]] as const) {
      if (value !== undefined && (!isFiniteNumber(value) || value < 0)) {
        issues.push({ severity: 'error', code: 'invalid-fade', message: `${where}${key}=${String(value)} 非法（需 ≥0 的有限数）`, segmentIndex: index })
        return
      }
    }
    let onShort = raw.onShort
    if (onShort !== undefined && !ON_SHORT.has(onShort)) {
      issues.push({ severity: 'error', code: 'invalid-onShort', message: `${where}onShort=${String(onShort)} 非法（pad/loop/error）`, segmentIndex: index })
      return
    }
    if (onShort === 'loop') {
      // v1 装配只实现了 pad（补静音）；loop 先按 pad 降级并显式告知，不静默。
      onShort = 'pad'
      issues.push({ severity: 'warning', code: 'loop-unsupported', message: `${where}onShort=loop 暂未支持，已按补静音（pad）处理`, segmentIndex: index })
    }
    let duckAmount: number | undefined
    if (raw.duckAmount !== undefined) {
      if (!isFiniteNumber(raw.duckAmount)) {
        issues.push({ severity: 'error', code: 'non-finite', message: `${where}duckAmount 不是有限数字`, segmentIndex: index })
        return
      }
      if (raw.duckAmount > 0 && raw.role !== 'voiceOver') {
        issues.push({ severity: 'warning', code: 'duck-without-voiceOver', message: `${where}只有旁白（voiceOver）能压 BGM，${raw.role} 段的 duckAmount=${raw.duckAmount} 已忽略`, segmentIndex: index })
      } else {
        duckAmount = raw.duckAmount < 0 || raw.duckAmount > 1 ? clamp01(raw.duckAmount) : raw.duckAmount
        if (raw.duckAmount < 0 || raw.duckAmount > 1) {
          issues.push({ severity: 'warning', code: 'invalid-gain', message: `${where}duckAmount ${raw.duckAmount} 越界（0–1），已收拢到 ${duckAmount}`, segmentIndex: index })
        }
      }
    }
    if (raw.durationSec === undefined || raw.durationSec === 0) {
      // 0/缺省 = 用素材真实时长（装配期探测）；归一化掉 0，统一表达为缺省。
      segments.push({
        ...(raw.sourceNodeId !== undefined ? { sourceNodeId: raw.sourceNodeId } : {}),
        url: raw.url,
        startSec: raw.startSec,
        ...(gain !== undefined ? { gain } : {}),
        ...(raw.fadeInSec !== undefined ? { fadeInSec: raw.fadeInSec } : {}),
        ...(raw.fadeOutSec !== undefined ? { fadeOutSec: raw.fadeOutSec } : {}),
        ...(duckAmount !== undefined ? { duckAmount } : {}),
        ...(onShort !== undefined ? { onShort } : {}),
        role: raw.role,
      })
    } else {
      segments.push({
        ...(raw.sourceNodeId !== undefined ? { sourceNodeId: raw.sourceNodeId } : {}),
        url: raw.url,
        startSec: raw.startSec,
        durationSec: raw.durationSec,
        ...(gain !== undefined ? { gain } : {}),
        ...(raw.fadeInSec !== undefined ? { fadeInSec: raw.fadeInSec } : {}),
        ...(raw.fadeOutSec !== undefined ? { fadeOutSec: raw.fadeOutSec } : {}),
        ...(duckAmount !== undefined ? { duckAmount } : {}),
        ...(onShort !== undefined ? { onShort } : {}),
        role: raw.role,
      })
    }
    if (input.durationSec > 0 && raw.startSec >= input.durationSec) {
      issues.push({ severity: 'warning', code: 'segment-beyond-duration', message: `${where}起点 ${raw.startSec}s 已越过成片总时长 ${input.durationSec}s，实际不会出声`, segmentIndex: index })
    }
  })

  // 同 role 重叠：amix 线性求和不会炸，但重叠的旁白互相打架是 agent 的规划错误 ——
  // 必须显形（「多轨重叠不静默」），由调用方决定拦不拦。
  const byStart = [...segments].sort((a, b) => a.startSec - b.startSec)
  for (let i = 0; i < byStart.length; i += 1) {
    const a = byStart[i]!
    if (a.durationSec === undefined) continue // 素材真实时长未知，装配期再判
    for (let j = i + 1; j < byStart.length; j += 1) {
      const b = byStart[j]!
      if (b.role !== a.role) continue
      if (b.startSec < a.startSec + a.durationSec) {
        issues.push({ severity: 'warning', code: 'role-overlap', message: `两段${roleLabel(a.role)}时间重叠（${a.startSec}s 与 ${b.startSec}s 起），将线性叠加，请确认是有意叠混` })
      }
    }
  }

  if (segments.length === 0) {
    issues.push({ severity: 'warning', code: 'no-source', message: '时间轴上没有任何音频段，成片将无声' })
  }

  return {
    timeline: { fps: isFiniteNumber(input.fps) && input.fps > 0 ? input.fps : 0, durationSec: isFiniteNumber(input.durationSec) && input.durationSec > 0 ? input.durationSec : 0, segments },
    issues,
    ok: !issues.some((issue) => issue.severity === 'error'),
  }
}

/** 角色中文名（结果文案/时间轴共用）。 */
export function roleLabel(role: AudioSegmentRole): string {
  return role === 'native' ? '原生环境声' : role === 'bgm' ? '配乐（BGM）' : role === 'voiceOver' ? '旁白' : '音效'
}

/**
 * 三布尔 → 8 值音轨构成的唯一分类实现（从 manifest.ts 迁入，manifest.audioCompositionFrom
 * 保留为兼容包装转调本函数）。`compositionFromTimeline` 也落到这里 —— 枚举从时间轴
 * 的段角色集合推出，不再手工传三个布尔。
 */
export function compositionFromPresence(input: { hasNative: boolean; hasBgm: boolean; hasVoiceOver: boolean }): StudioAudioComposition {
  const { hasNative, hasBgm, hasVoiceOver } = input
  if (hasNative) {
    if (hasBgm && hasVoiceOver) return 'native+bgm+voiceOver'
    if (hasBgm) return 'native+bgm'
    if (hasVoiceOver) return 'native+voiceOver'
    return 'native'
  }
  if (hasBgm && hasVoiceOver) return 'bgm+voiceOver'
  if (hasBgm) return 'bgm'
  if (hasVoiceOver) return 'voiceOver'
  return 'none'
}

/** 从时间轴派生 8 枚举（唯一事实源的读出口；取代手工三布尔入参）。 */
export function compositionFromTimeline(timeline: Pick<AudioTimeline, 'segments'>): StudioAudioComposition {
  const roles = new Set(timeline.segments.map((segment) => segment.role))
  return compositionFromPresence({
    hasNative: roles.has('native'),
    hasBgm: roles.has('bgm'),
    hasVoiceOver: roles.has('voiceOver'),
  })
}

/** StudioAudioComposition（contracts/canvas.ts 的 8 值枚举）—— 此处仅 type 引用，避免运行时依赖。 */
import type { StudioAudioComposition } from './contracts/canvas.js'
export type { StudioAudioComposition }

/**
 * D-03：老 `canvas.json` 没有 `audioTimeline` 时，把落盘的八枚举**只读反推**成等价
 * 时间轴。反推只能恢复「有哪些角色」，恢复不了时间信息 —— 所以段没有起点/时长/url
 * （url 空串 = 来源未知），消费方不得把本函数的产出写回画布（不迁移历史数据）。
 */
export function timelineFromComposition(composition: StudioAudioComposition, durationSec = 0): AudioTimeline {
  const parts = new Set(composition.split('+'))
  const segments: AudioSegment[] = []
  if (parts.has('native')) segments.push({ url: '', startSec: 0, role: 'native' })
  if (parts.has('bgm')) segments.push({ url: '', startSec: 0, role: 'bgm' })
  if (parts.has('voiceOver')) segments.push({ url: '', startSec: 0, role: 'voiceOver' })
  return { fps: 0, durationSec, segments }
}

/** buildAudioGraph 的产出：一段完整的 `-filter_complex` 文本 + 输出标签。 */
export interface AudioGraph {
  /** filter_complex 全文（不含 `-filter_complex` 键本身）。 */
  filterComplex: string
  /** 最终混音总线标签（恒为 `[out]`），调用方 `-map` 它。 */
  outputLabel: string
  /** 图里消费的输入个数（调用方按序给每个 segment 追加一个 `-i <url>`）。 */
  inputCount: number
  /** 装配期需要让结果文本回显的事项（如 loop 降级）。 */
  notes: string[]
}

/** duckAmount（0–1）→ sidechaincompress ratio（1:1 不压 → 约 9:1 满压）。 */
export function duckRatioOf(duckAmount: number): number {
  return Math.round((1 + duckAmount * 8) * 100) / 100
}

/** 秒 → 毫秒取整（adelay 用）。 */
function delayMs(sec: number): number {
  return Math.max(0, Math.round(sec * 1000))
}

/**
 * 生成音频装配的 filter_complex（**唯一生成点**，禁第二处拼音频参数）。
 *
 * 调用方约定：按 `timeline.segments` 顺序为每段追加一个 `-i <url>` 输入，图内用
 * `[<i>:a]` 消费；产物为一条与成片等长的完整音轨（`[out]`），再与无声视频母版
 * `-c:v copy` 合流（S2b 结构）。
 *
 * 每段链路：`aresample→aformat`（统一 48k 立体声，实验 C 的对策）→ `atrim`（段长）
 * → `asetpts` → `volume`（增益）→ `afade`（淡入淡出）→ `adelay`（挪到绝对起点）。
 * **淡入淡出必须在 adelay 之前**：adelay 前插静音后，afade 的 st 是相对整条流
 * （含前插静音）的，淡变会落在静音上而不是内容上 —— 这是实现期修正（计划 §S1
 * 表格的箭头顺序未考虑 delay 前插）。
 *
 * 混音：`amix=normalize=0` 线性求和（CV-141 口径）；尾接 `apad=whole_dur + atrim`
 * 把总线钉到成片时长 —— 短 BGM 自动补静音（D-02）与超长裁切在同一个收口处。
 * 旁白压 BGM（duck）：全部旁白先 amix 成 key 总线，BGM 过 sidechaincompress；
 * 无旁白段完全不动（计划 S2b 行）。段数 ≤1 时跳过 amix 直接输出。
 */
export function buildAudioGraph(timeline: AudioTimeline): AudioGraph {
  const notes: string[] = []
  const segments = timeline.segments
  const chains: string[] = []
  const labels: string[] = []

  segments.forEach((segment, index) => {
    const input = `[${index}:a]`
    const steps: string[] = ['aformat=sample_rates=48000:channel_layouts=stereo']
    if (segment.durationSec !== undefined && segment.durationSec > 0) {
      steps.push(`atrim=duration=${segment.durationSec.toFixed(3)}`, 'asetpts=PTS-STARTPTS')
    }
    if (segment.gain !== undefined && segment.gain !== 1) {
      steps.push(`volume=${segment.gain}`)
    }
    const segDur = segment.durationSec ?? 0
    if (segment.fadeInSec !== undefined && segment.fadeInSec > 0 && (segment.durationSec === undefined || segDur > segment.fadeInSec)) {
      steps.push(`afade=t=in:st=0:d=${segment.fadeInSec}`)
    }
    if (segment.fadeOutSec !== undefined && segment.fadeOutSec > 0 && segDur > segment.fadeOutSec) {
      steps.push(`afade=t=out:st=${(segDur - segment.fadeOutSec).toFixed(3)}:d=${segment.fadeOutSec}`)
    }
    if (segment.startSec > 0.001) {
      steps.push(`adelay=delays=${delayMs(segment.startSec)}:all=1`)
    }
    const label = `[a${index}]`
    chains.push(`${input}${steps.join(',')}${label}`)
    labels.push(label)
  })

  // duck：取所有旁白段的最大深度；key 总线 = 全部旁白线性求和。
  const voiceOverIndexes = segments
    .map((segment, index) => ({ segment, index }))
    .filter(({ segment }) => segment.role === 'voiceOver' && (segment.duckAmount ?? 0) > 0)
    .map(({ index }) => index)
  const bgmIndex = segments.findIndex((segment) => segment.role === 'bgm')
  let duckedBgmLabel: string | undefined
  if (bgmIndex >= 0 && voiceOverIndexes.length > 0) {
    const duck = Math.max(...voiceOverIndexes.map((index) => segments[index]?.duckAmount ?? 0))
    if (voiceOverIndexes.length === 1) {
      const keyLabel = `[a${voiceOverIndexes[0]}]`
      const outLabel = `[bgmDucked]`
      chains.push(`[a${bgmIndex}]${keyLabel}sidechaincompress=threshold=0.03:ratio=${duckRatioOf(duck)}:attack=50:release=400${outLabel}`)
      duckedBgmLabel = outLabel
    } else {
      const keyInputs = voiceOverIndexes.map((index) => `[a${index}]`).join('')
      chains.push(`${keyInputs}amix=inputs=${voiceOverIndexes.length}:duration=longest:normalize=0[voKey]`)
      chains.push(`[a${bgmIndex}][voKey]sidechaincompress=threshold=0.03:ratio=${duckRatioOf(duck)}:attack=50:release=400[bgmDucked]`)
      duckedBgmLabel = '[bgmDucked]'
    }
  }

  const mixLabels = labels.map((label, index) => (index === bgmIndex && duckedBgmLabel !== undefined ? duckedBgmLabel : label))
  // 短轨自动补静音（D-02）+ 超长裁切，钉到成片时长；apad=whole_dur 等长时是 no-op。
  const tailFilters = timeline.durationSec > 0
    ? `apad=whole_dur=${timeline.durationSec.toFixed(3)},atrim=duration=${timeline.durationSec.toFixed(3)}`
    : null
  let busExpr: string
  if (mixLabels.length === 0) {
    // 无任何段：数字静音总线（正常流程会在 resolve 阶段警告 no-source，装配方应先拦）。
    busExpr = tailFilters !== null ? `anullsrc=r=48000:cl=stereo,${tailFilters}` : 'anullsrc=r=48000:cl=stereo'
  } else if (mixLabels.length === 1) {
    busExpr = tailFilters !== null ? `${mixLabels[0]}${tailFilters}` : `${mixLabels[0]}anull`
  } else {
    chains.push(`${mixLabels.join('')}amix=inputs=${mixLabels.length}:duration=longest:normalize=0[mix]`)
    busExpr = tailFilters !== null ? `[mix]${tailFilters}` : '[mix]anull'
  }
  const filterComplex = chains.length > 0
    ? `${chains.join(';')};${busExpr}[out]`
    : `${busExpr}[out]`
  return { filterComplex, outputLabel: '[out]', inputCount: segments.length, notes }
}

/**
 * 生成给模型/用户看的中文摘要（模型自查的唯一通道）：每段起止、角色、音量、
 * 是否补了静音一目了然。装配完成后调用方把「实际探测时长」并进来即可对账。
 */
export function describeTimeline(timeline: AudioTimeline): string {
  if (timeline.segments.length === 0) return '音频时间轴：无任何音频段（成片将无声）。'
  const lines: string[] = [`音频时间轴（${timeline.segments.length} 段，成片 ${timeline.durationSec > 0 ? `${timeline.durationSec.toFixed(2)}s` : '时长未知'}）：`]
  const sorted = [...timeline.segments].sort((a, b) => a.startSec - b.startSec)
  for (const segment of sorted) {
    const end = segment.durationSec !== undefined ? `${(segment.startSec + segment.durationSec).toFixed(2)}s` : '素材结束'
    const bits: string[] = []
    if (segment.gain !== undefined && segment.gain !== 1) bits.push(`音量 ${segment.gain}`)
    if (segment.fadeInSec !== undefined) bits.push(`淡入 ${segment.fadeInSec}s`)
    if (segment.fadeOutSec !== undefined) bits.push(`淡出 ${segment.fadeOutSec}s`)
    if ((segment.duckAmount ?? 0) > 0) bits.push(`压 BGM 深度 ${segment.duckAmount}`)
    if (segment.onShort === 'error') bits.push('素材过短即报错')
    lines.push(
      `- ${roleLabel(segment.role)}：${segment.startSec.toFixed(2)}s–${end}（${segment.durationSec !== undefined ? `${segment.durationSec.toFixed(2)}s` : '随素材'}）${bits.length > 0 ? `（${bits.join('，')}）` : ''}`
        + `${segment.url === '' ? '【来源未知：老数据反推】' : `，素材 ${segment.url.split('/').at(-1)}`}`,
    )
  }
  return lines.join('\n')
}
