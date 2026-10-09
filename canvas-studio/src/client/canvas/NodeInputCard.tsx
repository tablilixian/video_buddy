import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { StudioCanvasNode, StudioCanvasView } from '../../contracts/canvas.js'
import { INSTRUMENTAL_LYRICS } from '../../contracts/canvas.js'
import { libraryMediaUrl } from '../../contracts/asset-library.js'
import type { LibraryAsset } from '../../contracts/asset-library.js'
import type { ResolveRefItem } from '../../contracts/reference.js'
import { deleteEditorDraft, getEditorDraft, setEditorDraft } from '../../editor-drafts.js'
import { CHROME_CARD_WIDTH, CHROME_CARD_WIDTH_AUDIO } from '../../canvas-aspect.js'
import { CHROME_GAP, chromeScaleOf } from '../../canvas-view.js'
import { FILM_PACES, filmPaceAt, pacingPrefixOf, parseCameraMoves, type CameraMove } from '../../camera-moves.js'
import { AUDIO_FNS, DIMS, LAYER_ORDER, LAYERS, audioFnName, audioFnToolName, assetFileFromUrl, bodyCharCount, composeItems, composeSpeechInstruct, creditCostOf, dimOf, estSecondsOf, layerDims, stripWs, toLocalRef, type AudioCapItem, type AudioFn, type AudioLayer, type VoiceSel } from '../../voice-dims.js'
import { generationParamOf, isReplayable, promptFieldsOf, promptValueOf, referenceNamesOf, referenceSlotOf, resolveReferenceSummaries, withGenerationParam, withPromptField, withReferenceNames, type PromptField } from '../../node-params.js'
import { resolutionDisplay } from '../../resolution-display.js'
import { FilmSetupPanel, type FilmTab } from './FilmSetupPanel.js'
import { VoiceLayerPop } from './VoiceLayerPop.js'
import { PromptEditor, type PromptEditorHandle } from './PromptEditor.js'

/** 输入框卡形态（REQ-031 拍板「同组件两形态」；REQ-032 加 audio 第三形态）：image = CV-281 既有；video = REQ-031；audio = 本需求。 */
export type InputCardForm = 'image' | 'video' | 'audio'

/** Props for the node input card (REQ-029/031, the demo-styled editing surface). */
export interface NodeInputCardProps {
  node: StudioCanvasNode
  view: StudioCanvasView
  /** 画布可视区尺寸（屏幕 px）—— 锚定与夹取都要用它。 */
  viewport: { width: number; height: number }
  /** 底部被详情抽屉遮住的高度（屏幕 px）；夹取时避开。 */
  bottomInset: number
  /** 形态：按节点 kind 判定（CanvasSurface 传入）；缺省 image。 */
  form?: InputCardForm
  /** 当前项目全部节点：参考托盘的缩略图反查 + 「画布导入」来源候选池。 */
  allNodes: readonly StudioCanvasNode[]
  /** 「选择资产」来源（全局资产库）；缺省 = 只给画布导入。 */
  libraryAssets?: readonly LibraryAsset[]
  /** 解析句柄（Host 侧惰性提升 + 回写源节点）；缺省 = 托盘只读。 */
  onResolveRefs?(refs: readonly string[]): Promise<readonly ResolveRefItem[]>
  /** 悬停放大镜的落地：打开参考源节点的大图预览（CV-044 通道复用）。 */
  onOpenPreview?(node: StudioCanvasNode): void
  /** 提示词只写 `generationPrompt`（与就地浮层同一条写回路径）。 */
  onUpdateNode(id: string, updates: Partial<StudioCanvasNode>): void
  /** 「发送」的落点 = 既有重试链路（判据唯一走 node-params.isReplayable）；缺省按钮禁用。 */
  onRetry?(id: string): void
  /** REQ-032：frame 层非阻塞提示（fn 切换 / 清空 / 歌词保存）；缺省静默。 */
  onToast?(message: string): void
  /** REQ-032 Step 3：本地上传参考音色（host 落盘返 `{url, assetFile}`，**不建节点**）。缺省 = 本地上传置灰。 */
  onUploadMedia?(file: File): Promise<{ url: string; assetFile: string }>
  /** 关闭（× / Esc / 选中移走共用的出口）。 */
  onClose(): void
}

/**
 * 节点输入框卡（REQ-029 / CV-281 基座 + REQ-031 / CV-282 video 形态）——
 * 演示 1:1 还原（image：`canvas-imagenode-inputbox.html`；video：`canvas-videonode-inputbox.html`）。
 *
 * ## 形态（拍板「同组件两形态」）
 *
 * `form` 由节点 kind 判定。**image 形态** = CV-281 已验收面（本文件既有路径，零改动）。
 * **video 形态**（REQ-031）：
 * - 模式 Tab「首尾帧 / 全能参考」→ 写 `channel` 参数（'fl2va'/'ref2va'，Host
 *   `effectiveCapabilityOf` 显式通道优先）；两模式参数键**不互删**（切换保留各自
 *   参考数据，发送按当前模式取用）；
 * - 首尾帧 = `filename`（首帧）/ `filenameTail`（尾帧）双特殊单值槽（仅首/尾也可生成）；
 * - 全能参考 = 三分类托盘：图片 `filenames` ≤9 / 视频 `videoRefs` ≤3 / 音频
 *   `audioRefs` ≤3（H3 官方分路上限），合计 ≤12（`H3_MAX_TOTAL_FILES`）；
 * - 头部「音频」chip = **原生音频开关**（`generateAudio` 布尔参数，演示计费行
 *   「原生音频 8」）——注意它不是音频参考槽位的显隐（那是托盘里的音频分类）；
 *   Host 侧 generateAudio 目前为占坑参数（generate.ts「尚未接入」提示），UI 先行；
 * - 发送前校验（UI 层）：合计 >12 拦截 + **音频不能作为唯一参考**（官方硬规则，
 *   与 `audio-reference.ts` 同文案）；参考视频合计时长 ≤15s 由 Host
 *   `validateH3VideoReferences` 在生成链路强校验（UI 无实测时长，不做假校验）。
 *
 * 其余纪律与 image 形态一致（见下）。
 *
 * ## 与就地浮层关系（历史）：替换 + 迁移分批（拍板⑧，Step 5 已收口）
 *
 * 就地浮层已退役：本卡是唯一编辑面。提示词编辑复用 PromptEditor + 同一份内存
 * 草稿表；image 参考托盘走 ReferenceSlotEditor 同一套数据契约；写回同一条
 * `withPromptField` 通路 —— 两条语义红线（**编辑不触发** / **判据唯一**）原样继承。
 *
 * ## 放置
 *
 * 渲染在 `.csCanvasLayer` **之外**（屏幕坐标锚定，同工具条）。常态锚在节点正
 * 下方、水平居中，间隙 = 演示 `CHROME_GAP`(12) × 视觉比例 —— 面板/工具条按
 * 演示 `--chrome-scale` **随 z×比例补偿 k 缩放**（`chromeScaleOf`：演示节点恒
 * 620px 时 k≡1，自然像素节点下 k 把 chrome/节点比值拉回演示基准；CSS 独立
 * `scale` 属性，不进 transform 列表：入场动画与缩放共用 transform 会互相覆盖）。
 * 纵向**不做视口夹取**（演示
 * 注释：clamp 会把 UI「钉」在视口内、与图脱开），只保留横向夹取与「避开详情
 * 抽屉」顶夹（演示没有抽屉，产品独有偏差登记 §九）。演示的放大态（body.zoomed
 * / 展开钮）已按拍板移除 —— 本卡只有一种形态。
 *
 * ## 1:1 还原纪律
 *
 * 色值/圆角/阴影照抄演示（accent 固定 `#ffb066`，偏差登记见两方案 §九/§十）。
 */

/** 演示放大镜钮（悬停缩略图浮出的预览入口）。 */
const ZOOM_ICON = (
  <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
    <circle cx="6.5" cy="6.5" r="4.5" /><path d="m10 10 3.5 3.5" />
  </svg>
)

/** 演示播放钮（音频试听）。 */
const PLAY_ICON = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M8 5.5v13l11-6.5Z" />
  </svg>
)
const PAUSE_ICON = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M7 5h3.5v14H7Zm6.5 0H17v14h-3.5Z" />
  </svg>
)

/** 演示 fn 菜单钮的六边形图标（btnClear 族同款 stroke 风格）。 */
const CUBE_ICON = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 2.7 20.7 7.4v9.2L12 21.3 3.3 16.6V7.4Z" /><path d="M3.3 7.4 12 12.1l8.7-4.7M12 12.1v9.2" />
  </svg>
)

/** 演示清空钮的垃圾桶图标（btnClear 逐字）。 */
const TRASH_ICON = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4.5 6.5h15M9.5 6.5V4.8h5v1.7M7 6.5l.9 13.2h8.2L17 6.5M10.4 10v6.6M13.6 10v6.6" />
  </svg>
)

/** `generationPrompt` 不可解析/为空时的兜底字段（形状同 node-params 的 PROMPT_ONLY）。 */
const FALLBACK_PROMPT_FIELD: readonly PromptField[] = [{ key: 'prompt', label: '提示词' }]

/** 「添加参考图」菜单的三个来源（演示顺序）；local 置灰见偏差登记。 */
type RefSource = 'local' | 'library' | 'canvas'

/** 底栏弹出层：模型 / 画幅档位 / 风格 / 摄像机 / 影片设置 / 积分 / fn 菜单 / 歌词弹层
    （同一时刻只开一个）。audio 四层设置面板（REQ-032 Step 2）用 `layer:` 前缀记录
    打开的是哪一层 —— 单一 openPop 状态，天然满足「同一时刻只开一个」。 */
type ChipPop =
  | 'model' | 'spec' | 'style' | 'camera' | 'film' | 'credit' | 'fn' | 'lyr'
  | `layer:${AudioLayer}`
  | null

// ==================== audio 形态（REQ-032 / CV-287）：参数解析 / 序列化（模块级纯函数） ====================

/**
 * 音频卡内存态（七元组 + duration/ref 透传）。每次变更**整体从本态重建**参数串
 * （不 spread 旧键 —— CS-PARAM-001「fn 切换残留上一形态的键」的结构性防线）。
 */
interface AudioCardState {
  fn: AudioFn
  sel: VoiceSel
  free: string
  body: string
  lyrics: string
  lyricsOn: boolean
  ref: string | null
  duration: number | null
}

/** 生成参数里取字符串（snake/camel 兜底链按序找第一个字符串值；缺省 = 空串）。 */
function audioParamString(raw: string | undefined, keys: readonly string[]): string {
  for (const key of keys) {
    const value = generationParamOf(raw, key)
    if (typeof value === 'string') return value
  }
  return ''
}

/** 生成参数里取选中集（voice_sel 对象：dimKey → string[]；非法形状一律视同未设置）。 */
function audioParamSel(raw: string | undefined): VoiceSel {
  for (const key of ['voice_sel', 'voiceSel']) {
    const value = generationParamOf(raw, key)
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const out: Record<string, readonly string[]> = {}
      for (const [dim, words] of Object.entries(value as Record<string, unknown>)) {
        if (Array.isArray(words) && words.every(word => typeof word === 'string')) out[dim] = words as string[]
      }
      return out
    }
  }
  return {}
}

/**
 * 音频参数 → 内存态。读取优先级：蛇形（后端契约 / host 落卡）→ 驼峰（agent
 * pending 工具入参 text/instructPrompt/prompt/lyrics）；fn 缺失按 toolName 推断；
 * 歌词带 host 的 `[Instrumental]` 纯器乐哨兵时读作「无歌词」（CV-130）。
 */
function parseAudioState(raw: string | undefined, toolName: string | undefined): AudioCardState {
  const fnRaw = generationParamOf(raw, 'fn')
  const fn: AudioFn = fnRaw === 'voice' || fnRaw === 'design' || fnRaw === 'music'
    ? fnRaw
    : toolName === 'music_generation' ? 'music' : 'voice'
  const stateLyrics = audioParamString(raw, ['lyrics'])
  const hostLyrics = audioParamString(raw, ['lyrics_prompt'])
  const lyrics = stateLyrics !== '' ? stateLyrics : hostLyrics === INSTRUMENTAL_LYRICS ? '' : hostLyrics
  const lyricsOnRaw = generationParamOf(raw, 'lyrics_on') ?? generationParamOf(raw, 'lyricsOn')
  const durationRaw = generationParamOf(raw, 'duration')
  const ref = audioParamString(raw, ['refaudio'])
  return {
    fn,
    sel: audioParamSel(raw),
    free: fn === 'music'
      ? audioParamString(raw, ['caption_prompt', 'prompt'])
      : audioParamString(raw, ['voice_free', 'voiceFree', 'instruct_prompt', 'instructPrompt']),
    body: audioParamString(raw, ['txt_prompt', 'text']),
    lyrics,
    lyricsOn: typeof lyricsOnRaw === 'boolean' ? lyricsOnRaw : lyrics.trim() !== '',
    ref: ref === '' ? null : ref,
    duration: typeof durationRaw === 'number' && Number.isFinite(durationRaw) ? durationRaw : null,
  }
}

/**
 * 内存态 → `generationPrompt`（整体重建）。键形（方案 §四）：
 * tts = `{fn, voice_sel, txt_prompt, instruct_prompt, voice_free, refaudio?, lyrics_prompt?, lyrics_on}`；
 * music = `{fn, voice_sel, caption_prompt, lyrics_prompt?, duration?, lyrics_on}`。
 * 歌词内容双写：`lyrics`（卡态，关开关也保留）+ `lyrics_prompt`（host 契约，仅
 * 开关开且非空才写 —— 否则 host 重放会把关掉的歌词唱出来）。
 */
function buildAudioPrompt(state: AudioCardState): string {
  const params: Record<string, unknown> = {
    fn: state.fn,
    voice_sel: state.sel,
    txt_prompt: state.body,
    lyrics_on: state.lyricsOn,
  }
  if (state.lyrics.trim() !== '') params.lyrics = state.lyrics
  if (state.lyricsOn && state.lyrics.trim() !== '') params.lyrics_prompt = state.lyrics
  if (state.ref !== null && state.ref !== '') params.refaudio = state.ref
  if (state.fn === 'music') {
    params.caption_prompt = state.free
    // Step 1 透传既有 duration（host 落卡值；D-MusicDur 由 Step 3 接管为 est 值）
    if (state.duration !== null) params.duration = state.duration
  } else {
    params.voice_free = state.free
    const instruct = composeSpeechInstruct(state.sel, state.free)
    if (instruct !== '') params.instruct_prompt = instruct
  }
  return JSON.stringify(params)
}

/** video 托盘分类定义（拍板「同组件两形态」的槽位配置化）。 */
interface TrayCategory {
  /** 参数键：omni = filenames(图)/videoRefs(视频)/audioRefs(音频)；fl = filename(首帧)/filenameTail(尾帧)。 */
  readonly key: string
  readonly label: string
  readonly kind: 'image' | 'video' | 'audio'
  /** 数组键（多参考）vs 单字符串键（首帧/尾帧）。 */
  readonly multi: boolean
  readonly cap: number
}

/** 模型「高级」三选（拍板④：后端真实能力名；图生图/修复车道由链路自动决定）。 */
const MODEL_OPTIONS: readonly { value: string; label: string; hint: string }[] = [
  { value: '', label: '自动（推荐）', hint: '按提示词内容现算路由（含可显示文字 → Qwen）' },
  { value: 'textRender', label: '文字渲染 · Qwen', hint: '中文逐字正确（约 20s）' },
  { value: 'krea2', label: 'Krea 2', hint: '纯文生更快' },
]

/** 画幅三选（拍板⑤：后端 enum 只有这三种；清单数据驱动，扩 enum 时加行）。 */
const ASPECT_OPTIONS: readonly { value: string; label: string }[] = [
  { value: '16:9', label: '16:9 横幅' },
  { value: '9:16', label: '9:16 竖幅' },
  { value: '1:1', label: '1:1 方幅' },
]

/** 风格预设（前缀注入文本；通用 4 项——演示风格库为内容资产级功能，待扩充）。 */
const STYLE_OPTIONS: readonly { name: string; prefix: string }[] = [
  { name: '无风格', prefix: '' },
  { name: '电影感', prefix: '电影感构图，宽银幕质感' },
  { name: '写实摄影', prefix: '写实摄影风格，自然光影' },
  { name: '动漫插画', prefix: '动漫插画风格，清晰线条' },
]

/** 摄像机四列的可选值（逐字取自演示 HTML）。 */
const CAMERA_BODIES = ['潘那维申 DXL2', 'ARRI Alexa LF'] as const
const CAMERA_LENSES = ['阿莱大师定焦', '阿莱 Signature'] as const
const CAMERA_FOCALS = ['14mm', '24mm', '35mm', '50mm', '85mm', '135mm'] as const
const CAMERA_APERTURES = ['f/1.4', 'f/2', 'f/2.8', 'f/4', 'f/8', 'f/16'] as const
/** 演示默认：潘那维申 DXL2 · 阿莱大师定焦 · 标准 35mm · 中光圈。 */
const CAMERA_DEFAULT = { body: 0, lens: 0, focal: 2, aperture: 3 } as const

/** 积分预估占位表（拍板⑦：无结算后端，数值为前端占位常量，标「预估」）。 */
const CREDIT_ESTIMATE: Readonly<Record<string, number>> = { '480p': 15, '736p': 25, '2k': 40 }

/** H3 官方分路上限与合计（与 `video-reference.ts` 常量同源口径）。 */
const VIDEO_CAPS = { images: 9, videos: 3, audios: 3, total: 12 } as const

/** 生视频模型三选（逐字取自演示；拍板：三选保留、未上线置灰——H3 是唯一可选模型）。
 *  id 沿用 CV-280 首页先例（`h3`）；`minimax-h3` 小写连字符形是上游 submodule 名，全仓禁用。 */
const VIDEO_MODELS = [
  { id: 'h3', name: 'MiniMax H3', cost: 20, cap: '首尾帧 / 全能参考 · 支持音频 · 最长 15s', maxDur: 15, enabled: true },
  { id: 'seedance-20', name: 'SeedDance 2.0', cost: 16, cap: '稳定叙事 · 支持音频 · 最长 10s', maxDur: 10, enabled: false },
  { id: 'seedance-25', name: 'SeedDance 2.5', cost: 24, cap: '旗舰画质 · 支持音频 · 最长 15s', maxDur: 15, enabled: false },
] as const

/** video 画幅两选（演示 ARS 逐字：16:9 横屏 / 9:16 竖屏——与 Host CV-136 枚举一致，1:1 仅图片类工具可用）。 */
const VIDEO_RATIOS = [
  { value: '16:9', label: '16:9 横屏' },
  { value: '9:16', label: '9:16 竖屏' },
] as const

/** 时长预设六档（拍板④；全部 ≤ H3 maxDur 15s；写 duration 参数走 Host clampDuration）。 */
const VIDEO_DURATIONS = [4, 6, 8, 10, 12, 15] as const

/** 清晰度计价（演示 RES_COST 逐值：480P=0 / 720P=6 / 1080P=14，按内部键）。 */
const VIDEO_RES_COST: Readonly<Record<string, number>> = { '480p': 0, '736p': 6, '2k': 14 }

/** video 模式（演示 Tab）：fl = 首尾帧（fl2va）；omni = 全能参考（ref2va）。 */
type VideoMode = 'fl' | 'omni'

export function NodeInputCard(props: NodeInputCardProps) {
  const { node, view, viewport, bottomInset, allNodes, libraryAssets, onResolveRefs, onOpenPreview, onUpdateNode, onRetry, onToast, onUploadMedia, onClose } = props
  const form: InputCardForm = props.form ?? 'image'
  const isVideo = form === 'video'
  const isAudio = form === 'audio'
  const rootRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  // 入场动画：演示「未选中态停在锚点上，16px 下坠偏移 + 渐隐」——挂载次帧才挂
  // In 类，让过渡从偏移态走到落位（不写从视口外滑入，丢贴合感）。
  const [entered, setEntered] = useState(false)
  useEffect(() => { setEntered(true) }, [])

  const fieldRefs = useRef(new Map<string, PromptEditorHandle>())
  // 同一事件里连续提交多个字段时，后一个必须看到前一个写完的 JSON（浮层同款）。
  const rawRef = useRef(node.generationPrompt)
  rawRef.current = node.generationPrompt
  // 槽位表里没有的工具（generationPrompt 不可解析等）退到单一 prompt 字段；
  // 写回由 withPromptField 兜底（不可解析返回 null ⇒ 放弃写入，不留半截状态）。
  const parsedFields = promptFieldsOf(node)
  const promptFields: readonly PromptField[] = parsedFields.length > 0 ? parsedFields : FALLBACK_PROMPT_FIELD

  // ---- 草稿（与浮层同一份内存表：重开回填；显式取消才丢弃）----
  // 演示没有「未保存」读数胶囊 —— 草稿机制保留，只撤展示（CV-283 拍板）。
  const seed = useRef(getEditorDraft(node.id))
  const [fieldDrafts, setFieldDrafts] = useState<Record<string, string>>({})
  const reportField = useCallback((key: string, next: string): void => {
    setFieldDrafts(previous => (previous[key] === next ? previous : { ...previous, [key]: next }))
  }, [])

  // ---- F1/F3 同款字段提交：只写 generationPrompt，不发生成请求 ----
  const commitPrompt = (key: string, next: string): void => {
    const raw = withPromptField(rawRef.current, key, next)
    if (raw === null) return
    rawRef.current = raw
    onUpdateNode(node.id, { generationPrompt: raw })
  }
  /** 原始参数写回（video 形态：channel/generateAudio/参考数组键）；undefined = 删键。 */
  const commitRaw = (key: string, value: unknown): boolean => {
    const raw = withGenerationParam(rawRef.current, key, value)
    if (raw === null) return false
    rawRef.current = raw
    onUpdateNode(node.id, { generationPrompt: raw })
    return true
  }
  /** 把每个字段编辑器里的当前草稿落成字段（「发送」先落字段再重试，C4 同款）。 */
  const commitAll = (): void => {
    for (const field of promptFields) fieldRefs.current.get(field.key)?.commit()
  }

  /** Esc / × / 选中移走 —— 草稿保留（重开回填），与浮层同一纪律。
      audio 形态：文本域还没 blur 时 Esc 直接关卡（keyDown 先于 blur），把内存态
      落一次参数（commitAudio 串一致时自动跳过，不会产生重复撤销快照）。 */
  const closeKeepingDraft = (): void => {
    if (isAudio) commitAudio(audio)
    const dirty = promptFields.some(field => fieldDrafts[field.key] !== undefined && fieldDrafts[field.key] !== promptValueOf(node, field.key))
    if (dirty) setEditorDraft(node.id, { prompt: fieldDrafts })
    else deleteEditorDraft(node.id)
    onClose()
  }

  // ==================== video 形态：模式 Tab + 三分类托盘（CV-282 Step 1） ====================
  const initialChannel = generationParamOf(node.generationPrompt, 'channel')
  const [mode, setModeState] = useState<VideoMode>(initialChannel === 'fl2va' ? 'fl' : 'omni')
  const [audioOn, setAudioOn] = useState(() => generationParamOf(node.generationPrompt, 'generateAudio') === true)
  const [videoMenuFor, setVideoMenuFor] = useState<TrayCategory | null>(null)
  const [playingKey, setPlayingKey] = useState<string | null>(null)
  const playingAudioRef = useRef<HTMLAudioElement | null>(null)
  // 卸载时停掉试听（不留悬挂的 Audio 元素）。
  useEffect(() => () => { playingAudioRef.current?.pause() }, [])

  /** video 托盘分类（按当前模式）：fl = 首帧/尾帧双单值槽；omni = 图/视频/音频三分类。 */
  const videoCategories: readonly TrayCategory[] = mode === 'fl'
    ? [
        { key: 'filename', label: '首帧', kind: 'image', multi: false, cap: 1 },
        { key: 'filenameTail', label: '尾帧', kind: 'image', multi: false, cap: 1 },
      ]
    : [
        { key: 'filenames', label: '图片', kind: 'image', multi: true, cap: VIDEO_CAPS.images },
        { key: 'videoRefs', label: '视频', kind: 'video', multi: true, cap: VIDEO_CAPS.videos },
        { key: 'audioRefs', label: '音频', kind: 'audio', multi: true, cap: VIDEO_CAPS.audios },
      ]

  /** 分类当前句柄列表（单值键 = 空串视同未设置）。 */
  const categoryNames = (cat: TrayCategory): readonly string[] => {
    const value = generationParamOf(rawRef.current, cat.key)
    if (cat.multi) return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
    return typeof value === 'string' && value !== '' ? [value] : []
  }
  const videoTotal = videoCategories.reduce((sum, cat) => sum + categoryNames(cat).length, 0)

  /** 分类写回：multi 空数组 / single 空串都**删键**（空值不许「已定义」透传给生成链）。 */
  const commitCategory = (cat: TrayCategory, names: readonly string[]): boolean => {
    const value = cat.multi ? (names.length > 0 ? [...names] : undefined) : (names[0] ?? undefined)
    return commitRaw(cat.key, value)
  }

  const switchMode = (next: VideoMode): void => {
    if (next === mode) return
    setModeState(next)
    // 两模式参数键不互删（filenames/videoRefs/audioRefs 与 filename/filenameTail 各自保留）。
    commitRaw('channel', next === 'fl' ? 'fl2va' : 'ref2va')
  }
  const toggleAudio = (): void => {
    const next = !audioOn
    setAudioOn(next)
    // 缺省不发该字段（与 videoRequestOf 的透传纪律一致）：关 = 删键。
    commitRaw('generateAudio', next ? true : undefined)
  }

  // ---- video 候选池：按模态过滤（画布节点 kind / 资产库 media.kind）；已被任意
  //      video 分类占用的句柄不再出现（同一文件不作两种参考）。 ----
  const videoTaken = useMemo(
    () => new Set(videoCategories.flatMap(cat => [...categoryNames(cat)])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [node.generationPrompt, mode],
  )
  const videoCandidates = useMemo(() => {
    const build = (kind: 'image' | 'video' | 'audio') => {
      const fromCanvas = allNodes
        .filter(candidate => candidate.id !== node.id
          && candidate.url !== undefined
          && candidate.kind === kind
          && !(candidate.filename !== undefined && videoTaken.has(candidate.filename)))
        .map(candidate => ({
          ref: candidate.id,
          label: candidate.title ?? candidate.filename ?? '未命名',
          url: candidate.url as string,
        }))
      const fromLibrary = (libraryAssets ?? []).flatMap(asset => {
        const media = asset.media.find(entry => entry.kind === kind)
        if (media === undefined) return []
        const handle = `lib:${asset.id}`
        if (videoTaken.has(handle)) return []
        return [{ ref: handle, label: asset.name, url: libraryMediaUrl(asset.id, media.file) }]
      })
      return [...fromCanvas, ...fromLibrary]
    }
    return { image: build('image'), video: build('video'), audio: build('audio') }
  }, [allNodes, libraryAssets, node.id, videoTaken])

  /** 分类解析落位：句柄换好 → 上限/合计复核 → 写回（超限显式报错，不写半截）。 */
  const resolveIntoCategory = async (cat: TrayCategory, refs: readonly string[]): Promise<void> => {
    if (onResolveRefs === undefined || refs.length === 0) return
    setBusy(true)
    try {
      const items = await onResolveRefs(refs)
      const handles: string[] = []
      const failures: string[] = []
      for (const item of items) {
        if (item.handle !== undefined) handles.push(item.handle)
        else failures.push(`${item.ref}：${item.error?.message ?? '解析失败'}`)
      }
      const current = categoryNames(cat)
      const room = cat.cap - current.length
      if (handles.length > room) {
        setError(`「${cat.label}」最多 ${cat.cap} 个，本次已拦截。`)
        setBusy(false)
        return
      }
      if (videoTotal + handles.length > VIDEO_CAPS.total) {
        setError(`本次共 ${videoTotal + handles.length} 个参考文件，超过官方合计上限 ${VIDEO_CAPS.total} 个`)
        setBusy(false)
        return
      }
      if (handles.length > 0) commitCategory(cat, [...current, ...handles])
      setError(failures.length > 0 ? failures.join('；') : null)
      setVideoMenuFor(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '取参考句柄失败，请重试。')
    } finally {
      setBusy(false)
    }
  }
  const removeCategoryAt = (cat: TrayCategory, index: number): void => {
    commitCategory(cat, categoryNames(cat).filter((_, current) => current !== index))
  }
  /** 音频试听：一次只播一条；再点暂停。 */
  const togglePlay = (key: string, url: string): void => {
    if (playingKey === key) {
      playingAudioRef.current?.pause()
      setPlayingKey(null)
      return
    }
    playingAudioRef.current?.pause()
    const el = new Audio(url)
    el.addEventListener('ended', () => { setPlayingKey(previous => (previous === key ? null : previous)) })
    void el.play().catch(() => { setError('音频试听失败：素材无法播放。') })
    playingAudioRef.current = el
    setPlayingKey(key)
  }

  // ==================== audio 形态：七元组状态 + 整体重写写回（REQ-032 Step 1） ====================
  const [audio, setAudio] = useState<AudioCardState>(() => parseAudioState(node.generationPrompt, node.toolName))
  /** chips 渲染条目（层序遍历 sel，自由段垫底 —— 演示 renderCaption 同序）。 */
  const audioItems = useMemo(() => composeItems(audio.sel, audio.free), [audio.sel, audio.free])
  /** 文本域草稿：onChange 只进内存态（updateNode 每次调用都进撤销栈，逐键写回会把
      undo 拆成单字级）；blur / 离散动作（chips ×、确定、fn 切换、清空）才落参数。 */
  const [lyricsDraft, setLyricsDraft] = useState(() => audio.lyrics)
  /** 唯一写回口：整体重建参数串 + 同步 toolName（fn 决定工具；键形随 fn 原子重写）。
      串与当前一致则跳过写回 —— blur 无改动时不留空的撤销快照。 */
  const commitAudio = (next: AudioCardState, toastText?: string): void => {
    setAudio(next)
    const raw = buildAudioPrompt(next)
    if (rawRef.current !== raw) {
      rawRef.current = raw
      onUpdateNode(node.id, { toolName: audioFnToolName(next.fn), generationPrompt: raw })
    }
    if (toastText !== undefined) onToast?.(toastText)
  }
  /** 词条 ×（演示 caption click data-rm）：单删一个词，层空则删键。 */
  const removeAudioTok = (dim: string, word: string): void => {
    const words = (audio.sel[dim] ?? []).filter(item => item !== word)
    const sel: Record<string, readonly string[]> = { ...audio.sel }
    if (words.length > 0) sel[dim] = words
    else delete sel[dim]
    commitAudio({ ...audio, sel })
  }
  /**
   * 面板选词（演示 `chooseWord` :1267-1290）：语义全在这里，控件只报事件 ——
   * - 已选 → 取消（再点一次）；未选且 `many` 满额 → **拒绝 + toast**（不静默丢弃）；
   * - 未选且 `many` 未满 / `one` / `seg` → 追加；`one`/`seg` 是「替换」（先清再放一个）；
   * - `excl` 互斥组（lang ↔ dialect）：本次真选中时，清掉同组另一维。
   */
  const chooseAudioWord = (dimKey: string, word: string): void => {
    const dim = dimOf(dimKey)
    if (dim === null) return
    const cur = audio.sel[dimKey] ?? []
    const max = dim.mode === 'many' ? (dim.max ?? 3) : 1
    let next: readonly string[]
    if (cur.includes(word)) {
      next = cur.filter(item => item !== word)
    } else if (dim.mode === 'many') {
      if (cur.length >= max) {
        onToast?.(`「${dim.n}」最多选 ${max} 个 —— 再多关键词之间会互相干扰`)
        return
      }
      next = [...cur, word]
    } else {
      next = [word]
    }
    const sel: Record<string, readonly string[]> = { ...audio.sel }
    if (next.length > 0) sel[dimKey] = next
    else delete sel[dimKey]
    // 互斥组：本次真的选中了一个词时，同组其余维度一律清空（演示 :1285-1289）。
    if (next.length > 0 && dim.excl !== undefined) {
      for (const other of DIMS) {
        if (other.k !== dimKey && other.excl === dim.excl) delete sel[other.k]
      }
    }
    commitAudio({ ...audio, sel })
  }
  /** 滑杆取档（演示 `setSlide` :1292-1297）：写**档位词**永不写数字；回拖到空则删键。 */
  const setAudioSlide = (dimKey: string, stop: string | null): void => {
    const sel: Record<string, readonly string[]> = { ...audio.sel }
    if (stop === null) delete sel[dimKey]
    else sel[dimKey] = [stop]
    commitAudio({ ...audio, sel })
  }
  /** 清空本层（演示 `.pclr`）：只删本层各维的键，不动自由段/正文/其他层。 */
  const clearAudioLayer = (layer: AudioLayer): void => {
    const sel: Record<string, readonly string[]> = { ...audio.sel }
    let touched = false
    for (const d of layerDims(layer)) {
      if (sel[d.k] !== undefined) { delete sel[d.k]; touched = true }
    }
    if (!touched) return
    commitAudio({ ...audio, sel })
  }

  // ==================== 参考音色槽（REQ-032 Step 3，演示 .ref-slot :932）====================
  /** 仅 voice 模式渲染（design/music 隐藏槽，但状态保留、发送不带 —— §六）。 */
  const refSlotVisible = isAudio && audio.fn === 'voice'
  /** 三来源候选池：画布 kind==='audio' 有 url 节点 + 资产库「音色」分类音频媒体。 */
  const audioRefCandidates = useMemo(() => {
    const fromCanvas = allNodes
      .filter(candidate => candidate.id !== node.id
        && candidate.kind === 'audio'
        && candidate.url !== undefined)
      .map(candidate => ({
        ref: candidate.id,
        label: candidate.title ?? candidate.filename ?? '未命名',
        url: candidate.url as string,
        source: 'canvas' as const,
      }))
    const fromLibrary = (libraryAssets ?? []).flatMap(asset => {
      const media = asset.media.find(entry => entry.kind === 'audio')
      if (media === undefined) return []
      return [{
        ref: `lib:${asset.id}`,
        label: asset.name,
        url: libraryMediaUrl(asset.id, media.file),
        assetFile: media.file,
        source: 'library' as const,
      }]
    })
    return [...fromCanvas, ...fromLibrary]
  }, [allNodes, libraryAssets, node.id])

  /** 已选参考音色的显示名（local: 查不到时退回 basename）。 */
  const audioRefLabel = audio.ref === null
    ? null
    : (audioRefCandidates.find(candidate =>
        candidate.ref === audio.ref
        || (candidate.source === 'library' && audio.ref === toLocalRef(candidate.assetFile))
        || (candidate.source === 'canvas' && audio.ref === toLocalRef(assetFileFromUrl(candidate.url)))
      )?.label ?? assetFileFromUrl(audio.ref))

  /** 选一个参考音色（单选 0/1）：存 `local:<assetFile>`；再点已选 = 取消。 */
  const pickAudioRef = (candidate: { ref: string; label: string; url: string; source: 'canvas' | 'library'; assetFile?: string }): void => {
    const next = candidate.source === 'library'
      ? toLocalRef(candidate.assetFile ?? assetFileFromUrl(candidate.url))
      : toLocalRef(assetFileFromUrl(candidate.url))
    commitAudio({ ...audio, ref: audio.ref === next ? null : next })
  }
  /** 清除参考音色（演示 refX :2177）。 */
  const clearAudioRef = (): void => {
    if (audio.ref === null) return
    commitAudio({ ...audio, ref: null }, '已清除参考音色')
  }
  /** 本地上传（B1：**真通道**——accept audio/* → uploadStudioMedia 落盘返 assetFile，不建节点）。 */
  const uploadAudioRef = async (file: File): Promise<void> => {
    if (onUploadMedia === undefined) return
    try {
      const { assetFile } = await onUploadMedia(file)
      commitAudio({ ...audio, ref: toLocalRef(assetFile) })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '上传参考音色失败，请重试。')
    }
  }
  /** 参考音色选择器开关（本地上传 / 选择资产 / 画布导入 —— 三来源内联菜单）。 */
  const [audioRefMenu, setAudioRefMenu] = useState<'src' | 'library' | 'canvas' | null>(null)

  /** fn 切换（演示 setFn）：参数整体按新形态重建，不合并旧键；toast 报所切功能。 */
  const switchAudioFn = (next: AudioFn): void => {
    if (next === audio.fn) return
    setOpenPop(null)
    commitAudio({ ...audio, fn: next }, `节点功能 → ${audioFnName(next)}`)
  }
  /** 清空（演示 btnClear）：music 清描述+歌词；其余清词条+描述+正文。 */
  const clearAudio = (): void => {
    if (audio.fn === 'music') {
      commitAudio({ ...audio, free: '', lyrics: '', lyricsOn: false }, '已清空描述与歌词')
    } else {
      commitAudio({ ...audio, sel: {}, free: '', body: '' }, '已清空描述与正文')
    }
  }
  /** 歌词弹层「确定」（演示 lyrOk）：只剥尾空白；有词且开关关着则自动打开开关。 */
  const confirmLyrics = (): void => {
    const lyrics = lyricsDraft.replace(/\s+$/, '')
    setOpenPop(null)
    commitAudio(
      { ...audio, lyrics, lyricsOn: lyrics !== '' ? true : audio.lyricsOn },
      lyrics !== ''
        ? `歌词已保存（${stripWs(lyrics).length} 字）`
        : '未填写歌词，将生成纯音乐',
    )
  }
  /** 歌词开关（演示 lyrSw）：关 = 只写开关（歌词文本保留在卡态）；开 = 顺带弹编辑层。 */
  const toggleLyrics = (): void => {
    const next = !audio.lyricsOn
    if (next) {
      setLyricsDraft(audio.lyrics)
      setOpenPop('lyr')
    } else {
      setOpenPop(null)
    }
    commitAudio({ ...audio, lyricsOn: next })
  }
  // 双分支口径（演示 est/credit 共用同一 n）：music = 描述+歌词仅去空白（标点
  // 保留，它们对节奏有贡献）；voice/design = 正文去空白去标点（探针 139 净字真值）。
  const audioChars = audio.fn === 'music'
    ? stripWs(audio.free).length + stripWs(audio.lyrics).length
    : bodyCharCount(audio.body)
  const audioEst = estSecondsOf(audioChars)
  const audioCredit = creditCostOf(audioChars)
  // 发送前校验（产品收严：探针实证 host 重放缺 txt_prompt 直接 422 —— voice/design
  // 正文必填；music 描述必填与演示 generate 同文案）。
  const audioIssue: string | null = !isAudio ? null
    : audio.fn === 'music'
      ? (audio.free.trim() === '' ? '先描述一下这首歌的风格与情绪' : null)
      : (audio.body.trim() === '' ? '先写要合成的正文' : null)
  // 描述区条目 + 分隔符（演示 renderCaption :1247-1254）：层内「，」、跨层「；」，
  // 自由段前导自带标点则不补；自由段永远垫底。
  const audioCaptionRows: readonly { sep: string | null; item: AudioCapItem }[] = (() => {
    let prevL: AudioLayer | null = null
    return audioItems.map((item, index) => {
      let sep: string | null = null
      if (index > 0 && !(item.t === 'free' && /^[，,；;。、]/.test(item.s ?? ''))) {
        sep = item.t === 'tok' && prevL !== null && item.L !== prevL ? '；' : '，'
      }
      if (item.t === 'tok') prevL = item.L ?? null
      return { sep, item }
    })
  })()
  // 自由段前补「，」的前提是前面真有词条（只写自由段时不补前导逗号）
  const audioFreeSep = audioItems.some(item => item.t === 'tok') && audio.free !== '' && !/^[，,；;。、]/.test(audio.free)
  const audioBodyPlaceholder = audio.fn === 'design' ? '音色文案，3秒以上' : '要合成的正文。'

  // ==================== image 形态托盘（CV-281 既有路径，零改动） ====================
  const slot = referenceSlotOf(node)
  const names = useMemo(() => referenceNamesOf(node.generationPrompt), [node.generationPrompt])
  const refCap = slot?.max ?? 4
  const refCount = names.length
  const canEdit = onResolveRefs !== undefined
  // 必填单槽「只换不空」（image_fix / character 系）：删成空一定在重试时报参数错。
  const canDelete = !(slot?.required === true && refCount <= 1)
  const atMax = slot !== null && refCount >= slot.max
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /** 添加菜单：null = 关着；否则展示对应来源的候选（local 置灰见偏差登记）。 */
  const [refMenu, setRefMenu] = useState<RefSource | null>(null)
  /** 本次解析拿到的句柄 → 来源缩略图（ReferenceSlotEditor 同款兜底：解析回写后
      allNodes 还是旧的，刚加的那张会被判断链；等下一次画布载入自然收敛）。 */
  const [localThumbs, setLocalThumbs] = useState<Readonly<Record<string, { url: string; label: string }>>>({})
  const summaries = useMemo(() => resolveReferenceSummaries(names, allNodes), [names, allNodes])
  const thumbOf = (name: string): { url: string; label: string } | null => {
    const hit = summaries.find(summary => summary.name === name)
    if (hit !== undefined && hit.node !== null && hit.node.url !== undefined) {
      return { url: hit.node.url, label: hit.node.title ?? hit.node.filename ?? name }
    }
    return localThumbs[name] ?? null
  }

  /** 候选池（画布图片节点 + 资产库图片媒体）；只收图片——`<img>` 渲染视频必破图
      （ReferenceSlotEditor 同款纪律），视频/音频参考走生成参数的 videoRefs/audioRefs。 */
  const candidates = useMemo(() => {
    const taken = new Set(names)
    const fromCanvas = allNodes
      .filter(candidate => candidate.id !== node.id
        && candidate.url !== undefined
        && candidate.kind === 'image'
        && !(candidate.filename !== undefined && taken.has(candidate.filename)))
      .map(candidate => ({
        ref: candidate.id,
        label: candidate.title ?? candidate.filename ?? '未命名',
        url: candidate.url as string,
        source: 'canvas' as const,
      }))
    const fromLibrary = (libraryAssets ?? []).flatMap(asset => {
      const media = asset.media.find(entry => entry.kind === 'image')
      if (media === undefined) return []
      const handle = `lib:${asset.id}`
      if (taken.has(handle)) return []
      return [{ ref: handle, label: asset.name, url: libraryMediaUrl(asset.id, media.file), source: 'library' as const }]
    })
    return [...fromCanvas, ...fromLibrary]
  }, [allNodes, libraryAssets, node.id, names])
  const menuCandidates = refMenu === 'canvas'
    ? candidates.filter(candidate => candidate.source === 'canvas')
    : refMenu === 'library'
      ? candidates.filter(candidate => candidate.source === 'library')
      : []

  /** 唯一的写入口：归一化失败一律**不写**，并把理由说出来（红线③同款）。 */
  const commitRefs = (next: readonly string[]): boolean => {
    if (slot === null) return false
    const raw = withReferenceNames(node.generationPrompt, slot, next)
    if (raw === null) {
      setError(refCount >= slot.max && next.length > slot.max
        ? `最多 ${slot.max} 张参考，这次没有改动。`
        : slot.required && next.length === 0
          ? '这个工具的参考图是必填的（删成空会重试失败），所以只能替换。'
          : '这个节点的生成参数无法解析（老数据或被手改过），为避免写坏，本次改动已放弃。')
      return false
    }
    setError(null)
    onUpdateNode(node.id, { generationPrompt: raw })
    return true
  }

  const resolveAndCommit = async (refs: readonly string[]): Promise<void> => {
    if (onResolveRefs === undefined || refs.length === 0) return
    setBusy(true)
    try {
      const items = await onResolveRefs(refs)
      const handles: string[] = []
      const failures: string[] = []
      const learned: Record<string, { url: string; label: string }> = {}
      for (const item of items) {
        if (item.handle !== undefined) {
          handles.push(item.handle)
          const source = candidates.find(candidate => candidate.ref === item.ref)
          if (source !== undefined) learned[item.handle] = { url: source.url, label: source.label }
        } else {
          failures.push(`${candidates.find(candidate => candidate.ref === item.ref)?.label ?? item.ref}：${item.error?.message ?? '解析失败'}`)
        }
      }
      if (Object.keys(learned).length > 0) setLocalThumbs(previous => ({ ...previous, ...learned }))
      if (handles.length > 0) commitRefs([...names, ...handles])
      setError(failures.length > 0 ? failures.join('；') : null)
      setRefMenu(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '取参考图句柄失败，请重试。')
    } finally {
      setBusy(false)
    }
  }

  const removeRefAt = (index: number): void => {
    commitRefs(names.filter((_, current) => current !== index))
  }

  // ---- 底栏 chips（Step 4 转真）：参数全部挂 generationPrompt（同一写回通路）----
  const [openPop, setOpenPop] = useState<ChipPop>(null)
  const togglePop = (pop: Exclude<ChipPop, null>): void => {
    setOpenPop(previous => (previous === pop ? null : pop))
  }
  const modelOverride = promptValueOf(node, 'modelOverride')
  const modelLabel = MODEL_OPTIONS.find(option => option.value === modelOverride)?.label ?? '自动（推荐）'
  const aspectRatio = promptValueOf(node, 'aspectRatio') || '16:9'
  const resolution = promptValueOf(node, 'resolution') || '736p'
  const specLabel = `${aspectRatio} · ${resolutionDisplay(resolution).label}`
  const stylePrefix = promptValueOf(node, 'stylePrefix')
  const styleLabel = STYLE_OPTIONS.find(option => option.prefix === stylePrefix)?.name ?? '风格'
  const cameraPrefix = promptValueOf(node, 'cameraPrefix')
  const cameraOn = cameraPrefix.trim() !== ''
  // 摄像机面板的本地游标：从已保存前缀反解（值里没有「·」，按 ' · ' 拆安全）。
  const cameraParts = cameraPrefix.split(' · ')
  const cameraCursor = {
    body: Math.max(0, CAMERA_BODIES.indexOf(cameraParts[0] as typeof CAMERA_BODIES[number])),
    lens: Math.max(0, CAMERA_LENSES.indexOf(cameraParts[1] as typeof CAMERA_LENSES[number])),
    focal: Math.max(0, CAMERA_FOCALS.indexOf(cameraParts[2] as typeof CAMERA_FOCALS[number])),
    aperture: Math.max(0, CAMERA_APERTURES.indexOf(cameraParts[3] as typeof CAMERA_APERTURES[number])),
  }
  const [camera, setCamera] = useState(cameraCursor)
  const cameraText = `${CAMERA_BODIES[camera.body]} · ${CAMERA_LENSES[camera.lens]} · ${CAMERA_FOCALS[camera.focal]} · ${CAMERA_APERTURES[camera.aperture]}`
  /** 面板内步进/重置即写回（开着总开关才有值；关闭 = 清参数）。 */
  const applyCamera = (next: typeof camera, on: boolean): void => {
    setCamera(next)
    commitPrompt('cameraPrefix', on
      ? `${CAMERA_BODIES[next.body]} · ${CAMERA_LENSES[next.lens]} · ${CAMERA_FOCALS[next.focal]} · ${CAMERA_APERTURES[next.aperture]}`
      : '')
  }
  const credits = CREDIT_ESTIMATE[resolution] ?? CREDIT_ESTIMATE['736p'] ?? 25

  // ---- video 形态底栏（CV-282 Step 2）：时长读数 + 积分明细（演示 costRows 公式）----
  const durationRaw = generationParamOf(rawRef.current, 'duration')
  const duration = typeof durationRaw === 'number' ? durationRaw : 5
  const generationParamCount = (key: string): number => {
    const value = generationParamOf(rawRef.current, key)
    return Array.isArray(value) ? value.filter(item => typeof item === 'string').length : 0
  }
  const generationParamHas = (key: string): boolean => typeof generationParamOf(rawRef.current, key) === 'string'
  /** 演示 costRows() 逐行（H3 单模型口径）；明细行弹层 + 合计，数值为前端估算（拍板⑦标「预估」）。 */
  const creditRows: readonly [string, number][] = (() => {
    if (!isVideo) return []
    const rows: Array<[string, number]> = [['模型基准 · MiniMax H3', 20]]
    const durationAdd = Math.max(0, duration - 5) * 2
    if (durationAdd > 0) rows.push([`时长加长 · ${duration}s`, durationAdd])
    const resCost = VIDEO_RES_COST[resolution] ?? 0
    if (resCost > 0) rows.push([`清晰度 · ${resolutionDisplay(resolution).label}`, resCost])
    if (mode === 'fl') {
      if (generationParamHas('filename')) rows.push(['首帧参考', 2])
      if (generationParamHas('filenameTail')) rows.push(['尾帧参考', 3])
    } else {
      const images = generationParamCount('filenames')
      const videos = generationParamCount('videoRefs')
      const audios = generationParamCount('audioRefs')
      if (images > 0) rows.push([`图片参考 ×${images}`, images * 2])
      if (videos > 0) rows.push([`视频参考 ×${videos}`, videos * 6])
      if (audios > 0) rows.push([`音频参考 ×${audios}`, audios * 3])
    }
    if (audioOn) rows.push(['原生音频', 8])
    return rows
  })()
  const creditTotal = isVideo ? creditRows.reduce((sum, row) => sum + row[1], 0) : credits
  /** 摄像机弹出层（image/video 两形态共用，副文案按形态区分）。 */
  const cameraPopNode = (subtitle: string) => (
    <span className="csChipPop csChipPopCamera">
      <span className="csChipPopSection">摄像机制</span>
      <span className="csChipPopSub">{subtitle}</span>
      <span className="csCameraCols">
        {([
          ['相机', CAMERA_BODIES, camera.body, 'body'],
          ['镜头', CAMERA_LENSES, camera.lens, 'lens'],
          ['焦距', CAMERA_FOCALS, camera.focal, 'focal'],
          ['光圈', CAMERA_APERTURES, camera.aperture, 'aperture'],
        ] as const).map(([label, values, index, key]) => (
          <span className="csCameraCol" key={key}>
            <span className="csCameraColLabel">{label}</span>
            <button
              type="button"
              className="csCameraStep"
              aria-label={`上一个${label}`}
              onClick={() => { applyCamera({ ...camera, [key]: (index - 1 + values.length) % values.length }, cameraOn) }}
            >ˆ</button>
            <span className="csCameraValue">{values[index]}</span>
            <button
              type="button"
              className="csCameraStep"
              aria-label={`下一个${label}`}
              onClick={() => { applyCamera({ ...camera, [key]: (index + 1) % values.length }, cameraOn) }}
            >ˇ</button>
          </span>
        ))}
      </span>
      <span className="csCameraConfig">
        <span className="csCameraConfigLabel">当前配置</span>
        <span className="csCameraConfigValue">{cameraText}</span>
      </span>
      <span className="csCameraFoot">
        <button
          type="button"
          className="csInputPill csInputPillIconWide"
          title="恢复演示默认（潘那维申 DXL2 · 阿莱大师定焦 · 35mm · f/4）"
          onClick={() => { applyCamera({ ...CAMERA_DEFAULT }, cameraOn) }}
        >↺ 重置参数</button>
        <button
          type="button"
          className={cameraOn ? 'csCameraToggle csCameraToggleOn' : 'csCameraToggle'}
          role="switch"
          aria-checked={cameraOn}
          aria-label={cameraOn ? '关闭摄像机参数' : '启用摄像机参数'}
          onClick={() => { applyCamera(camera, !cameraOn) }}
        ><span className="csCameraToggleKnob" /></button>
      </span>
    </span>
  )

  // ---- 影片设置（CV-282 Step 3）：运镜文本插入 + 节奏前缀注入（即时生效，无确定钮）----
  const [filmTab, setFilmTab] = useState<FilmTab>('moves')
  /** 已插运镜回显（F26 唯一事实源 = 提示词文本，草稿优先——退格删除后回显即消失）。 */
  const promptDraftOrSaved = fieldDrafts['prompt'] ?? promptValueOf(node, 'prompt')
  const selectedMoves = useMemo(() => parseCameraMoves(promptDraftOrSaved), [promptDraftOrSaved])
  /** 点卡片 = 官方英文名追加进提示词草稿（拍板②；可重复、退格可删，发送时统一落字段）。 */
  const insertMove = (move: CameraMove): void => {
    fieldRefs.current.get('prompt')?.appendText(move.en)
  }
  /** 节奏档下标（已存前缀反解；「自动」= 删键即 undefined 恰好匹配。手改过的前缀
      匹配不到档位时读作自动，原值保留到用户下一次选择）。 */
  const pacingRaw = generationParamOf(rawRef.current, 'pacingPrefix')
  const paceIndex = Math.max(0, FILM_PACES.findIndex(pace => pacingPrefixOf(pace) === pacingRaw))
  const changePace = (index: number): void => {
    commitRaw('pacingPrefix', pacingPrefixOf(filmPaceAt(index)))
  }

  // ---- 发送：判据唯一走 isReplayable（红线②）；先落字段再重试（C4 同款）----
  // video 形态发送前追加官方硬规则校验（音频不能唯一 / 合计 12；时长合计由 Host 强校验）。
  // audio 形态双分支校验（body/caption 必填）+ 参数整体重写后同样落这条链。
  const canSend = onRetry !== undefined && node.isLoading !== true && isReplayable(node)
  const send = (): void => {
    if (!canSend) return
    if (isVideo) {
      const omniNames = (key: string): readonly string[] => {
        const value = generationParamOf(rawRef.current, key)
        return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
      }
      const images = mode === 'omni' ? omniNames('filenames').length : (typeof generationParamOf(rawRef.current, 'filename') === 'string' ? 1 : 0) + (typeof generationParamOf(rawRef.current, 'filenameTail') === 'string' ? 1 : 0)
      const videos = mode === 'omni' ? omniNames('videoRefs').length : 0
      const audios = mode === 'omni' ? omniNames('audioRefs').length : 0
      if (audios > 0 && images + videos === 0) {
        setError('音频不能作为唯一参考：H3 要求同时提供至少一张图或一段视频（官方硬规则）')
        return
      }
      const total = images + videos + audios
      if (total > VIDEO_CAPS.total) {
        setError(`本次共 ${total} 个参考文件（图 ${images} + 视频 ${videos} + 音频 ${audios}），超过官方合计上限 ${VIDEO_CAPS.total} 个`)
        return
      }
    }
    if (isAudio) {
      // 双分支校验（防御性；按钮禁用已拦）+ 参数整体重写（fn 切换原子性 / instruct_prompt 重算）
      if (audioIssue !== null) {
        setError(audioIssue)
        return
      }
      // 发送语义（§六）：仅 voice 携带 refaudio（design/music 隐藏槽但状态保留，
      // 发送不带）；music 带 duration（D-MusicDur：= estSeconds 估算变承诺，探针 4 证实精确生效）。
      const next: AudioCardState = audio.fn === 'music'
        ? { ...audio, duration: audioEst, ref: null }
        : audio.fn === 'voice'
          ? audio
          : { ...audio, ref: null }
      commitAudio(next)
    }
    commitAll()
    onRetry?.(node.id)
    deleteEditorDraft(node.id)
    onClose()
  }

  // ---- 放置：先量再放（浮层同款 layout effect 手法）----
  useLayoutEffect(() => {
    const el = rootRef.current
    if (el === null) return
    const next = { width: el.offsetWidth, height: el.offsetHeight }
    setSize(previous => (previous.width === next.width && previous.height === next.height ? previous : next))
  })

  const scale = view.scale
  // 比例补偿 k（CV-285）：演示节点恒 620px，其 chrome 字号/尺寸按 620 基准调观感；
  // 自然像素节点下 chrome 与节点比值 = 基准/节点宽，越看越小 —— 乘 k 拉回演示比值。
  const effScale = scale * chromeScaleOf(node.width)
  const anchorX = view.x + (node.x + node.width / 2) * scale
  const nodeBottom = view.y + (node.y + node.height) * scale
  const nodeTop = view.y + node.y * scale
  // E7 同款：节点整个滚出视野 ⇒ 卡退场。
  if (nodeBottom < 0 || nodeTop > viewport.height) return null
  // 间隙 = 演示 CHROME_GAP(12)×视觉比例（面板随视觉比例缩放，间隙同比，
  // 保持「间隙/节点」比值 = 演示 12/620）。
  const top = nodeBottom + CHROME_GAP * effScale
  // 横向夹取：卡心不越出视口两侧（按**视觉**半宽 = 布局半宽×视觉比例；演示不夹，
  // 产品保留 —— 否则节点贴边时 ×/发送钮会甩出视口，偏差登记 §九）。
  const half = size.width / 2
  const clampedLeft = size.width > 0
    ? Math.min(Math.max(anchorX, half * effScale + 8), Math.max(viewport.width - half * effScale - 8, half * effScale + 8))
    : anchorX
  // 纵向不做视口夹取（演示：钉在视口会与图脱开）——只在**详情抽屉打开时**
  // 顶夹避让（视觉高 = 布局高×视觉比例；抽屉是产品独有面，演示没有）。
  const maxTop = viewport.height - bottomInset - size.height * effScale - 8
  const clampedTop = bottomInset > 0 && size.height > 0 && maxTop > 0 ? Math.min(top, maxTop) : top
  // 布局宽按视觉比例反推：视觉宽 = 布局宽×effScale ≤ 可视区宽百分比（演示
  // min(792|760px, 93|92vw) 的同式收敛，只是 vw 要除掉 k——k>1 时不反推会整卡甩出视口）。
  // 字号不缩、只收行宽（与演示窄窗下 min() 收缩同语义）。
  const cardWidthMax = isAudio ? CHROME_CARD_WIDTH_AUDIO : CHROME_CARD_WIDTH
  const cardViewportRatio = isAudio ? 0.93 : 0.92
  const layoutWidth = Math.min(cardWidthMax, (viewport.width * cardViewportRatio) / Math.max(effScale, 1e-6))

  return (
    <div
      ref={rootRef}
      className={'csNodeInputCard' + (entered ? ' csNodeInputCardIn' : '')}
      // 随画布缩放走 CSS 独立 `scale` 属性（演示 --chrome-scale × 比例补偿 k）：
      // 不进 transform 列表，入场动画（transform translateY）与缩放互不覆盖，
      // 缩放变化也不吃 transition。width 内联反推值（见 layoutWidth 注释）。
      style={{ left: clampedLeft, top: clampedTop, width: `${Math.round(layoutWidth)}px`, scale: `${effScale}` }}
      aria-label={`节点输入框：${node.title ?? node.kind}`}
      // 与浮层同一套手势守卫：卡上的按下/双击/右键不能落进画布空白语义
      // （CV-286 起单击空白在 pointerup 清选、卸载本卡），也不能触发画布平移。
      onPointerDown={event => { event.stopPropagation() }}
      onDoubleClick={event => { event.stopPropagation() }}
      onContextMenu={event => { event.stopPropagation() }}
      onKeyDown={event => {
        // F6 同款：Esc 关卡 —— bare 编辑器**不再吞** Esc（CV-283：编辑态下 Esc
        // 直接冒泡到这里，关卡且保草稿）。弹出层开着时先收弹出层。
        if (event.key === 'Escape') {
          event.stopPropagation()
          if (refMenu !== null) { setRefMenu(null); return }
          if (videoMenuFor !== null) { setVideoMenuFor(null); return }
          if (openPop !== null) { setOpenPop(null); return }
          closeKeepingDraft()
        }
      }}
    >
      <div className="csInputCardAct">
        {/* 演示 p-act：audio 形态多一个清空钮（btnClear 逐字）；放大态已按拍板移除。 */}
        {isAudio && (
          <button
            type="button"
            className="csInputCardIb"
            title={audio.fn === 'music' ? '清空描述与歌词' : '清空描述与正文'}
            aria-label="清空"
            onClick={clearAudio}
          >{TRASH_ICON}</button>
        )}
        <button type="button" className="csInputCardIb" aria-label="关闭" onClick={closeKeepingDraft}>×</button>
      </div>

      {/* video 形态头部（演示主态）：模式 Tab + 原生音频开关 + 模式说明行。 */}
      {isVideo && (
        <div className="csInputCardHead">
          <div className="csModeTabs">
            <button
              type="button"
              className={mode === 'fl' ? 'csModeTab on' : 'csModeTab'}
              onClick={() => { switchMode('fl') }}
            >首尾帧</button>
            <button
              type="button"
              className={mode === 'omni' ? 'csModeTab on' : 'csModeTab'}
              onClick={() => { switchMode('omni') }}
            >全能参考</button>
          </div>
          <button
            type="button"
            className={audioOn ? 'csAudioChip on' : 'csAudioChip'}
            title="原生音频：生成结果自带音轨（H3 支持音频；Host 侧参数暂为占坑，接入前生成会提示）"
            aria-pressed={audioOn}
            onClick={() => { toggleAudio() }}
          >音频 <span className="csAudioDot" /></button>
          <span className="csTrayHint">
            {mode === 'omni' ? '最多 9 图 + 3 视频 + 3 音频，自由组合参考' : '给首帧与尾帧，AI 补齐中间过程'}
          </span>
        </div>
      )}

      {/* 参考托盘：image = CV-281 既有单托盘；video = 分类托盘（fl 双槽 / omni 三分类）；
          audio 不渲染托盘（参考音色 ref-slot 是 Step 3，refaudio 参数已随态透传）。 */}
      {isAudio ? null : isVideo ? (
        <div className="csInputCardRefs csVideoTray">
          {videoCategories.map(cat => {
            const items = categoryNames(cat)
            const catFull = items.length >= cat.cap
            return (
              <div className="csTrayGroup" key={cat.key}>
                <span className="csTrayGroupLabel">{cat.label} <b>{items.length}/{cat.cap}</b></span>
                <div className="csRefStrip">
                  {items.map((name, index) => {
                    const thumb = thumbOf(name)
                    const key = `${cat.key}-${name}-${index}`
                    return (
                      <div className="csRefItem" key={key} title={name}>
                        {cat.kind === 'audio'
                          ? (
                            <button
                              type="button"
                              className="csRefItemFill csAudioTile"
                              aria-label={playingKey === key ? '暂停试听' : '试听'}
                              onClick={() => { if (thumb !== null) togglePlay(key, thumb.url) }}
                            >
                              <span className="csAudioIcon">{playingKey === key ? PAUSE_ICON : PLAY_ICON}</span>
                            </button>
                          )
                          : thumb === null
                            ? <span className="csRefItemFill csRefItemBroken">参考<br />已断链</span>
                            : cat.kind === 'video'
                              ? <video className="csRefItemFill" src={thumb.url} muted preload="metadata" />
                              : <img className="csRefItemFill" src={thumb.url} alt={thumb.label} />}
                        {cat.kind !== 'audio' && (
                          <button
                            type="button"
                            className="csRefItemPv"
                            aria-label={`放大预览 ${thumb?.label ?? name}`}
                            disabled={thumb === null || onOpenPreview === undefined}
                            title={thumb?.label ?? '参考已断链'}
                            onClick={() => {
                              const source = summaries.find(summary => summary.name === name)?.node ?? null
                              if (source !== null && source.url !== undefined) onOpenPreview?.(source)
                            }}
                          >
                            <span className="csRefItemRing">{ZOOM_ICON}</span>
                          </button>
                        )}
                        <button
                          type="button"
                          className="csRefItemRm"
                          aria-label={`移除 ${cat.label} ${index + 1}`}
                          disabled={!canEdit || busy}
                          title="移除这一个"
                          onClick={() => { removeCategoryAt(cat, index) }}
                        >×</button>
                      </div>
                    )
                  })}
                  {!catFull && (
                    <button
                      type="button"
                      className="csRefAdd"
                      disabled={!canEdit || busy}
                      title={!canEdit ? '当前环境不支持解析句柄（只能查看）' : `添加${cat.label}参考`}
                      onClick={() => { setVideoMenuFor(previous => (previous === null ? cat : null)) }}
                    >
                      <span className="csRefAddPlus">+</span>
                      <span className="csRefAddCount">{items.length}/{cat.cap}</span>
                    </button>
                  )}
                  {/* 分类三来源菜单（与本地上传偏差登记同 image 形态）。 */}
                  {videoMenuFor?.key === cat.key && (
                    <div className="csRefMenuPop">
                      {(() => {
                        const pool = videoCandidates[cat.kind]
                        if (refMenu === 'canvas' || refMenu === 'library') {
                          const list = pool.filter(candidate => (refMenu === 'canvas'
                            ? !candidate.ref.startsWith('lib:')
                            : candidate.ref.startsWith('lib:')))
                          return (
                            <>
                              <div className="csRefMenuHead">
                                <span>{refMenu === 'canvas' ? '从画布导入' : '从资产库选择'}</span>
                                <button type="button" className="csInputCardIb" aria-label="返回" onClick={() => { setRefMenu(null) }}>‹</button>
                              </div>
                              {list.length === 0
                                ? <div className="csRefMenuHint">暂无可用{cat.label}素材。</div>
                                : list.map(candidate => (
                                  <button
                                    type="button"
                                    className="csRefMenuItem"
                                    key={candidate.ref}
                                    disabled={busy}
                                    title={candidate.label}
                                    onClick={() => { void resolveIntoCategory(cat, [candidate.ref]) }}
                                  >
                                    <span className="csRefMenuItemLabel">{candidate.label}</span>
                                  </button>
                                ))}
                            </>
                          )
                        }
                        return (
                          <>
                            <button type="button" className="csRefMenuItem" disabled title="本地上传通道待接线（偏差登记 §九）">本地上传</button>
                            <button
                              type="button"
                              className="csRefMenuItem"
                              disabled={!canEdit || busy || (libraryAssets ?? []).length === 0}
                              onClick={() => { setRefMenu('library') }}
                            >选择资产</button>
                            <button
                              type="button"
                              className="csRefMenuItem"
                              disabled={!canEdit || busy}
                              onClick={() => { setRefMenu('canvas') }}
                            >画布导入</button>
                            <div className="csRefMenuHint">上限 {cat.cap} 个，合计 {VIDEO_CAPS.total} 个</div>
                          </>
                        )
                      })()}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="csInputCardRefs">
          <div className="csRefStrip">
            {names.map((name, index) => {
              const thumb = thumbOf(name)
              return (
                <div className="csRefItem" key={`${name}-${index}`} title={name}>
                  {thumb === null
                    ? <span className="csRefItemFill csRefItemBroken">参考<br />已断链</span>
                    : <img className="csRefItemFill" src={thumb.url} alt={thumb.label} />}
                  <span className="csRefItemIx">参考图 {index + 1}</span>
                  <button
                    type="button"
                    className="csRefItemPv"
                    aria-label={`放大预览 ${thumb?.label ?? name}`}
                    disabled={thumb === null || onOpenPreview === undefined}
                    title={thumb?.label ?? '参考已断链'}
                    onClick={() => {
                      const source = summaries.find(summary => summary.name === name)?.node ?? null
                      if (source !== null && source.url !== undefined) onOpenPreview?.(source)
                    }}
                  >
                    <span className="csRefItemRing">{ZOOM_ICON}</span>
                  </button>
                  <button
                    type="button"
                    className="csRefItemRm"
                    aria-label={`移除 参考图 ${index + 1}`}
                    disabled={!canEdit || !canDelete || busy}
                    title={!canDelete ? '必填单槽：不能删成空，只能替换' : '移除这张'}
                    onClick={() => { removeRefAt(index) }}
                  >×</button>
                </div>
              )
            })}
          </div>
          <button
            type="button"
            className={atMax ? 'csRefAdd full' : 'csRefAdd'}
            disabled={!canEdit || busy}
            title={!canEdit
              ? '当前环境不支持解析句柄（只能查看）'
              : atMax ? `已达上限 ${refCap} 张，超出会被拦截` : '添加参考图'}
            onClick={() => { setRefMenu(previous => (previous === null ? 'canvas' : null)) }}
          >
            <span className="csRefAddPlus">+</span>
            <span className="csRefAddCount">{refCount}/{refCap}</span>
          </button>
          {refMenu !== null && (
            <div className="csRefMenuPop">
              {refMenu === 'canvas' || refMenu === 'library' ? (
                <>
                  <div className="csRefMenuHead">
                    <span>{refMenu === 'canvas' ? '从画布导入' : '从资产库选择'}</span>
                    <button type="button" className="csInputCardIb" aria-label="返回" onClick={() => { setRefMenu(null) }}>‹</button>
                  </div>
                  {menuCandidates.length === 0
                    ? <div className="csRefMenuHint">暂无可用图片素材（参考位只收图片；视频/音频参考走生成参数）。</div>
                    : menuCandidates.map(candidate => (
                      <button
                        type="button"
                        className="csRefMenuItem"
                        key={candidate.ref}
                        disabled={busy || atMax}
                        title={atMax ? `已达上限 ${refCap} 张` : candidate.label}
                        onClick={() => { void resolveAndCommit([candidate.ref]) }}
                      >
                        <img className="csRefMenuItemThumb" src={candidate.url} alt="" />
                        <span className="csRefMenuItemLabel">{candidate.label}</span>
                      </button>
                    ))}
                </>
              ) : (
                <>
                  <button type="button" className="csRefMenuItem" disabled title="本地上传通道待接线（偏差登记 §九）">本地上传</button>
                  <button
                    type="button"
                    className="csRefMenuItem"
                    disabled={!canEdit || busy || (libraryAssets ?? []).length === 0}
                    onClick={() => { setRefMenu('library') }}
                  >选择资产</button>
                  <button
                    type="button"
                    className="csRefMenuItem"
                    disabled={!canEdit || busy}
                    onClick={() => { setRefMenu('canvas') }}
                  >画布导入</button>
                  <div className="csRefMenuHint">上限 {refCap} 张，超出会被拦截</div>
                </>
              )}
            </div>
          )}
        </div>
      )}
      {busy && <div className="csRefMenuHint">解析句柄…（生成产物需要先换成可用句柄才能作参考）</div>}
      {error !== null && <div className="csRefMenuError">{error}</div>}

      {/* video 形态：摄像机标记 chip（演示 cam-chip——开启后挂在输入框上方，悬停出 × 移除）。 */}
      {isVideo && cameraOn && (
        <div className="csCamMarkerRow">
          <span className="csCamMarker">
            <span className="csCamMarkerLbl">摄像机</span>
            <span className="csCamMarkerSliders">⚙</span>
            <button
              type="button"
              className="csCamMarkerX"
              aria-label="移除摄像机标记"
              title="移除摄像机标记"
              onClick={() => { commitPrompt('cameraPrefix', '') }}
            >×</button>
          </span>
        </div>
      )}
      {/* audio 形态主体（REQ-032 Step 1，演示 .p-body 1:1）：描述区（词条 chips +
          自由段 textarea，括号括起）→ 正文 / 音乐描述。层 pill 面板 Step 2 接线。 */}
      {isAudio && (
        <div className="csAudioBody">
          {audio.fn !== 'music' ? (
            <div className="csAudioCapWrap">
              {/* 参考音色槽（演示 .ref-slot :932，住在描述框里）：+ ↔ 已选（波形 art +
                  title）；× 清除 toast；三来源内联菜单（本地上传 / 选择资产 / 画布导入）。 */}
              {refSlotVisible && (
                <span className="csAudioRefSlotWrap">
                  <button
                    type="button"
                    className={audio.ref !== null ? 'csAudioRefSlot has' : 'csAudioRefSlot'}
                    title={audio.ref !== null ? `参考音色：${audioRefLabel ?? ''}` : '添加参考音色（可选）'}
                    aria-expanded={audioRefMenu !== null}
                    onClick={() => { setAudioRefMenu(previous => (previous === null ? 'src' : null)) }}
                  >
                    {audio.ref === null
                      ? <span className="csAudioRefPlus">+</span>
                      : <span className="csAudioRefWave"><i /><i /><i /><i /><i /><i /><i /><i /></span>}
                    <span className="csAudioRefLb">参考音色</span>
                    {audio.ref !== null && (
                      <i
                        className="csAudioRefX"
                        role="button"
                        tabIndex={0}
                        title="清除参考音色"
                        aria-label="清除参考音色"
                        onClick={event => { event.stopPropagation(); clearAudioRef() }}
                        onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.stopPropagation(); clearAudioRef() } }}
                      >×</i>
                    )}
                  </button>
                  {audioRefMenu !== null && (
                    <span className="csAudioRefPop">
                      <span className="csAudioRefPopHead">参考音色 · 可选 · 不选则自由生成</span>
                      {audioRefMenu === 'src' ? (
                        <>
                          <button
                            type="button"
                            className="csAudioRefPopItem"
                            disabled={onUploadMedia === undefined}
                            title={onUploadMedia === undefined ? '本地上传通道待接线' : '支持 MP3 / WAV，单个 ≤ 50MB'}
                            onClick={() => {
                              setAudioRefMenu(null)
                              const input = document.createElement('input')
                              input.type = 'file'
                              input.accept = 'audio/*'
                              input.onchange = () => { const file = input.files?.[0]; if (file !== undefined) void uploadAudioRef(file) }
                              input.click()
                            }}
                          >本地上传</button>
                          <button
                            type="button"
                            className="csAudioRefPopItem"
                            disabled={(libraryAssets ?? []).length === 0}
                            onClick={() => { setAudioRefMenu('library') }}
                          >选择资产</button>
                          <button
                            type="button"
                            className="csAudioRefPopItem"
                            onClick={() => { setAudioRefMenu('canvas') }}
                          >画布导入</button>
                          <span className="csAudioRefPopHint">支持 MP3 / WAV，单个 ≤ 50MB</span>
                        </>
                      ) : (
                        <>
                          <span className="csAudioRefPopHead">
                            {audioRefMenu === 'canvas' ? '从画布导入' : '从资产库选择'}
                            <button type="button" className="csInputCardIb" aria-label="返回" onClick={() => { setAudioRefMenu('src') }}>‹</button>
                          </span>
                          {(() => {
                            const pool = audioRefCandidates.filter(candidate => candidate.source === audioRefMenu)
                            return pool.length === 0
                              ? <span className="csAudioRefPopEmpty">该分类下暂无可用音频</span>
                              : pool.map(candidate => (
                                <button
                                  type="button"
                                  key={candidate.ref}
                                  className={audio.ref === toLocalRef(candidate.source === 'library' ? (candidate.assetFile ?? '') : assetFileFromUrl(candidate.url)) ? 'csAudioRefPopItem on' : 'csAudioRefPopItem'}
                                  onClick={() => { pickAudioRef(candidate); setAudioRefMenu(null) }}
                                >
                                  <span className="csAudioRefWave sm"><i /><i /><i /><i /><i /><i /><i /><i /></span>
                                  <span className="csAudioRefPopLabel">{candidate.label}</span>
                                </button>
                              ))
                          })()}
                        </>
                      )}
                    </span>
                  )}
                </span>
              )}
              {audioCaptionRows.map(({ sep, item }, index) => (
                item.t === 'tok' ? (
                  <span key={`${item.dim ?? 'x'}-${item.w ?? 'x'}-${String(index)}`}>
                    {sep !== null && <span className="csAudioSep">{sep}</span>}
                    <span className="csAudioTok">
                      {item.w}
                      <button
                        type="button"
                        className="csAudioTokX"
                        aria-label={`删除词条 ${item.w ?? ''}`}
                        onClick={() => { removeAudioTok(item.dim ?? '', item.w ?? '') }}
                      >×</button>
                    </span>
                  </span>
                ) : null
              ))}
              {audioFreeSep && <span className="csAudioSep">，</span>}
              <textarea
                className="csAudioCapFree"
                value={audio.free}
                placeholder={audioItems.length === 0 ? '点下方「身份 / 声学 / 情境 / 语言」按钮挑词，或直接手写描述…' : ''}
                onChange={event => { setAudio(previous => ({ ...previous, free: event.target.value })) }}
                onBlur={() => { commitAudio(audio) }}
              />
            </div>
          ) : (
            <div className="csAudioMusicWrap">
              <textarea
                className="csAudioMusicDesc"
                value={audio.free}
                placeholder="描述歌曲风格、情绪、演唱音色、节奏和使用场景…"
                onChange={event => { setAudio(previous => ({ ...previous, free: event.target.value })) }}
                onBlur={() => { commitAudio(audio) }}
              />
            </div>
          )}
          {audio.fn !== 'music' && (
            <div className="csAudioBodyWrap">
              <textarea
                className="csAudioBodyText"
                value={audio.body}
                placeholder={audioBodyPlaceholder}
                onChange={event => { setAudio(previous => ({ ...previous, body: event.target.value })) }}
                onBlur={() => { commitAudio(audio) }}
              />
            </div>
          )}
        </div>
      )}
      {!isAudio && (
      <div className="csInputCardPromptWrap">
        {promptFields.map(field => (
          <PromptEditor
            key={field.key}
            ref={handle => {
              if (handle === null) fieldRefs.current.delete(field.key)
              else fieldRefs.current.set(field.key, handle)
            }}
            nodeId={node.id}
            label={field.label}
            value={promptValueOf(node, field.key)}
            onCommit={next => { commitPrompt(field.key, next) }}
            autoEdit
            bare
            onEnterSend={send}
            {...(seed.current !== undefined && seed.current.prompt[field.key] !== undefined
              ? { seedDraft: seed.current.prompt[field.key] }
              : {})}
            {...(node.isLoading === true ? { disabled: true } : {})}
            onDraftChange={next => { reportField(field.key, next) }}
          />
        ))}
      </div>
      )}

      {/* 底栏 chips 双分支：image = CV-281 Step 4 口径（零改动）；video = 本需求 Step 2
          （模型三选置灰 / 画幅·时长·清晰度三段 / 运镜占位 / 积分明细 costRows）。 */}
      {form === 'image' ? (
      <div className="csInputCardFoot">
        <div className="csInputCardFootLeft">
          <span className="csInputSel">
            <button
              type="button"
              className={openPop === 'model' ? 'csInputPill csInputPillOn' : 'csInputPill'}
              title="生图模型：默认自动路由（拍板②），高级展开可手动指定（仅纯文生车道生效）"
              onClick={() => { togglePop('model') }}
            >
              {modelLabel} <span className="csInputPillCaret">▾</span>
            </button>
            {openPop === 'model' && (
              <span className="csChipPop">
                {MODEL_OPTIONS.map(option => (
                  <button
                    type="button"
                    className={modelOverride === option.value ? 'csChipMenuItem csChipMenuItemOn' : 'csChipMenuItem'}
                    key={option.value || 'auto'}
                    onClick={() => { commitPrompt('modelOverride', option.value); setOpenPop(null) }}
                  >
                    <span className="csChipMenuItemLabel">{option.label}</span>
                    <span className="csChipMenuItemHint">{option.hint}</span>
                  </button>
                ))}
              </span>
            )}
          </span>
          <span className="csInputSel">
            <button
              type="button"
              className={openPop === 'spec' ? 'csInputPill csInputPillOn' : 'csInputPill'}
              title="画幅与清晰度：比例 3 种（拍板⑤）；档位展示名产品化（拍板⑥），内部键 480p/736p/2k"
              onClick={() => { togglePop('spec') }}
            >
              {specLabel} <span className="csInputPillCaret">▾</span>
            </button>
            {openPop === 'spec' && (
              <span className="csChipPop">
                <span className="csChipPopSection">画幅</span>
                {ASPECT_OPTIONS.map(option => (
                  <button
                    type="button"
                    className={aspectRatio === option.value ? 'csChipMenuItem csChipMenuItemOn' : 'csChipMenuItem'}
                    key={option.value}
                    onClick={() => { commitPrompt('aspectRatio', option.value) }}
                  >
                    <span className="csChipMenuItemLabel">{option.label}</span>
                  </button>
                ))}
                <span className="csChipPopSection">清晰度</span>
                {[...['480p', '736p', '2k']].map(value => {
                  const display = resolutionDisplay(value)
                  return (
                    <button
                      type="button"
                      className={resolution === value ? 'csChipMenuItem csChipMenuItemOn' : 'csChipMenuItem'}
                      key={value}
                      onClick={() => { commitPrompt('resolution', value) }}
                    >
                      <span className="csChipMenuItemLabel">{display.label}</span>
                      <span className="csChipMenuItemHint">{display.meta}</span>
                    </button>
                  )
                })}
              </span>
            )}
          </span>
          <span className="csInputSel">
            <button
              type="button"
              className={openPop === 'style' ? 'csInputPill csInputPillOn' : 'csInputPill'}
              title="风格：前缀注入提示词（不计费，与摄像机可叠加）；预设清单待扩充（偏差登记 §九）"
              onClick={() => { togglePop('style') }}
            >
              {styleLabel} <span className="csInputPillCaret">▾</span>
            </button>
            {openPop === 'style' && (
              <span className="csChipPop">
                {STYLE_OPTIONS.map(option => (
                  <button
                    type="button"
                    className={stylePrefix === option.prefix ? 'csChipMenuItem csChipMenuItemOn' : 'csChipMenuItem'}
                    key={option.name}
                    onClick={() => { commitPrompt('stylePrefix', option.prefix); setOpenPop(null) }}
                  >
                    <span className="csChipMenuItemLabel">{option.name}</span>
                  </button>
                ))}
              </span>
            )}
          </span>
          <span className="csInputSel">
            <button
              type="button"
              className={openPop === 'camera' ? 'csInputPill csInputPillOn' : cameraOn ? 'csInputPill csInputPillAccent' : 'csInputPill'}
              title="摄像机：参数作前缀注入提示词，与风格叠加、不计费"
              onClick={() => { togglePop('camera') }}
            >
              摄像机{cameraOn ? ' · 开' : ''}
            </button>
            {openPop === 'camera' && cameraPopNode('参数已作为标记挂在输入框，与预设风格叠加生效')}
          </span>
        </div>
        <div className="csInputCardFootRight">
          <span className="csInputPill csInputPillIcon" title="提示词增强：功能挂 REQ-003 Step 4 拍板，当前置灰（偏差登记 §九）">✦</span>
          <span className="csInputPill csInputCredits" title="积分：纯展示占位（拍板⑦），按档位前端估算，无真实结算">
            ✦ <span className="csInputCreditsNum">{credits}</span> · 预估
          </span>
          <button
            type="button"
            className="csInputSend"
            disabled={!canSend}
            title={!canSend
              ? onRetry === undefined
                ? '当前环境不支持重试链路'
                : node.isLoading === true ? '生成中…' : '该节点不可重放（缺参数或工具不支持）'
              : '发送：先落字段再走生成链路（判据唯一 isReplayable）'}
            aria-label="发送"
            onClick={send}
          >↑</button>
        </div>
      </div>
      ) : form === 'audio' ? (
        <div className="csInputCardFoot csAudioFoot">
          <div className="csAudioFootLeft">
            {/* 节点功能菜单（演示 .fmenus：向上展开，三项 + 对勾高亮，切换即重写工具名）。 */}
            <div className={openPop === 'fn' ? 'csAudioFnMenus open' : 'csAudioFnMenus'}>
              <button
                type="button"
                className="csAudioFnBtn"
                aria-haspopup="true"
                aria-expanded={openPop === 'fn'}
                title="节点功能：切换本节点产出（语音 / 音色设计 / 音乐），参数按新功能整体重写"
                onClick={() => { togglePop('fn') }}
              >
                <span className="csAudioFnIcon">{CUBE_ICON}</span>
                <span>{audioFnName(audio.fn)}</span>
                <svg className="csAudioFnCaret" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 9l7 7 7-7" /></svg>
              </button>
              {openPop === 'fn' && (
                <div className="csAudioFnPop" role="menu">
                  {AUDIO_FNS.map(item => (
                    <button
                      key={item.k}
                      type="button"
                      className={item.k === audio.fn ? 'csAudioFnItem on' : 'csAudioFnItem'}
                      role="menuitemradio"
                      aria-checked={item.k === audio.fn}
                      onClick={() => { switchAudioFn(item.k) }}
                    >{item.n}</button>
                  ))}
                </div>
              )}
            </div>
            {/* 人声歌词（仅音乐生成）：chip 开弹层 + 侧拨开关（演示 .lyr-sel）。 */}
            {audio.fn === 'music' && (
              <span className="csAudioLyricSel">
                <button
                  type="button"
                  className={audio.lyricsOn ? 'csInputPill csInputPillAccent' : 'csInputPill'}
                  onClick={() => {
                    if (openPop === 'lyr') { setOpenPop(null); return }
                    setLyricsDraft(audio.lyrics)
                    setOpenPop('lyr')
                  }}
                >
                  人声歌词 <span className="csInputPillCaret">▾</span>
                </button>
                <button
                  type="button"
                  className={audio.lyricsOn ? 'csAudioLyricSwitch on' : 'csAudioLyricSwitch'}
                  role="switch"
                  aria-checked={audio.lyricsOn}
                  title="需要人声歌词时打开"
                  onClick={toggleLyrics}
                ><i /></button>
                {openPop === 'lyr' && (
                  <span className="csAudioLyrPop">
                    <span className="csAudioLyrHead">人声歌词</span>
                    <textarea
                      className="csAudioLyrText"
                      value={lyricsDraft}
                      placeholder={'请输入完整歌词，建议换行区分歌词句、空行区分段落。\n未填写时将生成纯音乐。'}
                      onChange={event => { setLyricsDraft(event.target.value) }}
                    />
                    <span className="csAudioLyrFoot">
                      <span className="csAudioLyrHint">{lyricsDraft !== '' ? `已填 ${stripWs(lyricsDraft).length} 字 · 未填写时将生成纯音乐` : '未填写时将生成纯音乐'}</span>
                      <button type="button" className="csAudioLyrOk" onClick={confirmLyrics}>确定</button>
                    </span>
                  </span>
                )}
              </span>
            )}
            {/* 四层层 pill（演示 :991-1020）：点击开/关本层设置面板；本层已选词条则
                加 .has 高亮（accent 描边）。同一时刻只开一层 —— openPop 是单值。 */}
            {audio.fn !== 'music' && (
              <div className="csAudioLayerRow">
                {LAYER_ORDER.map(layer => {
                  const open = openPop === `layer:${layer}`
                  const has = layerDims(layer).some(d => (audio.sel[d.k] ?? []).length > 0)
                  return (
                    <span key={layer} className="csInputSel">
                      <button
                        type="button"
                        className={
                          'csInputPill csAudioLayerPill'
                          + (open ? ' csInputPillOn' : '')
                          + (has ? ' csAudioLayerPillHas' : '')
                        }
                        aria-expanded={open}
                        title={`「${LAYERS[layer as AudioLayer].name}」词库`}
                        onClick={() => { setOpenPop(open ? null : `layer:${layer}`) }}
                      >
                        {LAYERS[layer as AudioLayer].name} <span className="csInputPillCaret">▾</span>
                      </button>
                      {open && (
                        <VoiceLayerPop
                          layer={layer}
                          sel={audio.sel}
                          onChoose={chooseAudioWord}
                          onSlide={setAudioSlide}
                          onClear={() => { clearAudioLayer(layer) }}
                          onClose={() => { setOpenPop(null) }}
                        />
                      )}
                    </span>
                  )
                })}
              </div>
            )}
          </div>
          <div className="csInputCardFootRight">
            {/* 积分 chip（拍板⑤：标题附「预计约 N 秒」时长估算；0 字不消耗）。 */}
            <span
              className="csInputPill csInputCredits"
              title={audioCredit > 0
                ? `本次消耗 ${audioCredit} 积分 · 基准 2 + 文本每 20 字 1 分 · 预计约 ${audioEst} 秒（按字数估算）`
                : '填写文本后计算消耗积分'}
            >
              ✦ <span className="csInputCreditsNum">{audioCredit}</span> · 预估
            </span>
            <button
              type="button"
              className="csInputSend"
              disabled={!canSend || audioIssue !== null}
              title={!canSend
                ? onRetry === undefined
                  ? '当前环境不支持重试链路'
                  : node.isLoading === true ? '生成中…' : '该节点不可重放（缺参数或工具不支持）'
                : audioIssue ?? '发送：参数整体重写后走生成链路（判据唯一 isReplayable）'}
              aria-label="发送"
              onClick={send}
            >↑</button>
          </div>
        </div>
      ) : (
        <div className="csInputCardFoot">
          <div className="csInputCardFootLeft">
            <span className="csInputSel">
              <button
                type="button"
                className={openPop === 'model' ? 'csInputPill csInputPillOn' : 'csInputPill'}
                title="生视频模型：MiniMax H3（首尾帧/全能参考 · 支持音频 · 最长 15s）；SeedDance 系列后端未接入端点，置灰（拍板：三选保留、未上线置灰）"
                onClick={() => { togglePop('model') }}
              >
                MiniMax H3 <span className="csInputPillCaret">▾</span>
              </button>
              {openPop === 'model' && (
                <span className="csChipPop csModelPop">
                  <span className="csChipPopSection">生视频模型</span>
                  {VIDEO_MODELS.map(m => (
                    m.enabled ? (
                      <button type="button" className="csChipMenuItem csChipMenuItemOn" key={m.id} title={`基准 ${m.cost} 积分 · 最长 ${m.maxDur}s`}>
                        <span className="csModelCheck">✓</span>
                        <span className="csModelRow">
                          <span className="csChipMenuItemLabel">{m.name}</span>
                          <span className="csModelCap">{m.cap}</span>
                        </span>
                        <span className="csChipMenuItemHint">{m.cost}</span>
                      </button>
                    ) : (
                      <button type="button" className="csChipMenuItem csChipMenuItemOff" key={m.id} disabled title="后端未接入该模型端点（拍板：未上线置灰）">
                        <span className="csModelCheck" />
                        <span className="csModelRow">
                          <span className="csChipMenuItemLabel">{m.name}</span>
                          <span className="csModelCap">{m.cap}</span>
                        </span>
                        <span className="csChipMenuItemHint">即将上线</span>
                      </button>
                    )
                  ))}
                </span>
              )}
            </span>
            <span className="csInputSel">
              <button
                type="button"
                className={openPop === 'spec' ? 'csInputPill csInputPillOn' : 'csInputPill'}
                title="画幅（16:9/9:16，Host CV-136 枚举）/ 时长六档（拍板④，写 duration 走 clampDuration）/ 清晰度三档（拍板⑥产品化命名）"
                onClick={() => { togglePop('spec') }}
              >
                {aspectRatio} · {duration}s · {resolutionDisplay(resolution).label} <span className="csInputPillCaret">▾</span>
              </button>
              {openPop === 'spec' && (
                <span className="csChipPop">
                  <span className="csChipPopSection">画幅</span>
                  {VIDEO_RATIOS.map(option => (
                    <button
                      type="button"
                      className={aspectRatio === option.value ? 'csChipMenuItem csChipMenuItemOn' : 'csChipMenuItem'}
                      key={option.value}
                      onClick={() => { commitRaw('aspectRatio', option.value) }}
                    >
                      <span className="csChipMenuItemLabel">{option.label}</span>
                    </button>
                  ))}
                  <span className="csChipPopSection">时长</span>
                  {VIDEO_DURATIONS.map(d => (
                    <button
                      type="button"
                      className={duration === d ? 'csChipMenuItem csChipMenuItemOn' : 'csChipMenuItem'}
                      key={d}
                      onClick={() => { commitRaw('duration', d) }}
                    >
                      <span className="csChipMenuItemLabel">{d}s</span>
                    </button>
                  ))}
                  <span className="csChipPopSection">清晰度</span>
                  {(['480p', '736p', '2k'] as const).map(value => {
                    const display = resolutionDisplay(value)
                    return (
                      <button
                        type="button"
                        className={resolution === value ? 'csChipMenuItem csChipMenuItemOn' : 'csChipMenuItem'}
                        key={value}
                        onClick={() => { commitRaw('resolution', value) }}
                      >
                        <span className="csChipMenuItemLabel">{display.label}</span>
                        <span className="csChipMenuItemHint">{display.meta}</span>
                      </button>
                    )
                  })}
                </span>
              )}
            </span>
            <span className="csInputSel">
              <button
                type="button"
                className={openPop === 'style' ? 'csInputPill csInputPillOn' : 'csInputPill'}
                title="风格作为提示词前缀注入，可与摄像机设置叠加；不额外计费。"
                onClick={() => { togglePop('style') }}
              >
                {styleLabel} <span className="csInputPillCaret">▾</span>
              </button>
              {openPop === 'style' && (
                <span className="csChipPop">
                  {STYLE_OPTIONS.map(option => (
                    <button
                      type="button"
                      className={stylePrefix === option.prefix ? 'csChipMenuItem csChipMenuItemOn' : 'csChipMenuItem'}
                      key={option.name}
                      onClick={() => { commitPrompt('stylePrefix', option.prefix); setOpenPop(null) }}
                    >
                      <span className="csChipMenuItemLabel">{option.name}</span>
                    </button>
                  ))}
                </span>
              )}
            </span>
            <span className="csInputSel">
              <button
                type="button"
                className={openPop === 'camera' ? 'csInputPill csInputPillOn' : cameraOn ? 'csInputPill csInputPillAccent' : 'csInputPill'}
                title="开启后参数作前缀注入，悬停看说明"
                onClick={() => { togglePop('camera') }}
              >
                摄像机{cameraOn ? ' · 开' : ''}
              </button>
              {openPop === 'camera' && cameraPopNode('为整条视频设置机型、镜头、焦段与光圈')}
            </span>
            <span className="csInputSel">
              <button
                type="button"
                className={openPop === 'film' ? 'csInputPill csInputPillOn' : 'csInputPill'}
                title="影片设置：运镜（33 词条，点击插入提示词，建议一 Shot 一运镜）/ 节奏（5 档轮播，单选即时生效）"
                onClick={() => { togglePop('film') }}
              >
                运镜 <span className="csInputPillCaret">▾</span>
              </button>
              {openPop === 'film' && (
                <span className="csChipPop csFilmPop">
                  <FilmSetupPanel
                    tab={filmTab}
                    onTabChange={setFilmTab}
                    selectedMoves={selectedMoves.map(move => move.en)}
                    onInsertMove={insertMove}
                    paceIndex={paceIndex}
                    onPaceChange={changePace}
                  />
                </span>
              )}
            </span>
          </div>
          <div className="csInputCardFootRight">
            <span className="csInputPill csInputPillIcon" title="提示词增强：功能挂 REQ-003 Step 4 拍板，当前置灰（偏差登记 §九）">✦</span>
            <span className="csInputSel">
              <button
                type="button"
                className={openPop === 'credit' ? 'csInputPill csInputCredits csInputPillOn' : 'csInputPill csInputCredits'}
                title="积分：纯展示占位（拍板⑦），按演示 costRows 公式前端估算"
                onClick={() => { togglePop('credit') }}
              >
                ✦ <span className="csInputCreditsNum">{creditTotal}</span> · 预估
              </button>
              {openPop === 'credit' && (
                <span className="csChipPop csCreditPop">
                  {creditRows.map(([label, value]) => (
                    <span className="csCreditRow" key={label}>
                      <span className="csCreditRowLabel">{label}</span>
                      <span className="csCreditRowValue">{value}</span>
                    </span>
                  ))}
                  <span className="csCreditRow csCreditRowTotal">
                    <span>本次消耗</span>
                    <span>{creditTotal}</span>
                  </span>
                  <span className="csCreditFoot">数字为基准积分；时长、清晰度、参考素材与音频会另行结算。</span>
                </span>
              )}
            </span>
            <button
              type="button"
              className="csInputSend"
              disabled={!canSend}
              title={!canSend
                ? onRetry === undefined
                  ? '当前环境不支持重试链路'
                  : node.isLoading === true ? '生成中…' : '该节点不可重放（缺参数或工具不支持）'
                : '发送：先落字段再走生成链路（判据唯一 isReplayable）'}
              aria-label="发送"
              onClick={send}
            >↑</button>
          </div>
        </div>
      )}
    </div>
  )
}
