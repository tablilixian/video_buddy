/**
 * REQ-032 / CV-287 · 音频卡（语音生成 / 音色设计 / 音乐生成）词库与合成纯函数。
 *
 * 词库从演示稿 docs/assets/library-2026-10-08/canvas-audionode-inputbox.html 的
 * DIMS / FNS / LAYERS 块**逐字转录**（存档件，不许改）。tests/voice-dims-req032.test.mjs
 * 用 new Function 把演示稿同名块拆出来与本表深比对 —— 词库若要改，必须两边同批，
 * 否则守卫当场拦下。
 *
 * 三个纯函数的口径同样来自演示稿，不允许「顺手改进」：
 * - captionText（:1222）：层间「；」、层内「，」、两端已有标点则不重复补；
 *   末尾 strip 不含「。」（:1232 原样）。
 * - estSeconds（:1330）：music = 描述+歌词仅去空白；voice/design = 正文去空白去
 *   标点保留 CJK/字母/数字；n ? max(1, round(n/5)) : 0（2026-10-08 与后端
 *   139 净字 → 27.55s 真值对拍，误差 <1%）。
 * - creditCost（:1338）：同一 n，n ? 2 + ceil(n/20) : 0。
 */

/** 节点功能（画布底栏 fn 菜单三项；voice/design 共用 tts_voiceover 后端）。 */
export type AudioFn = 'voice' | 'design' | 'music'

/** 词库四个层（与演示稿 LAYERS 键一致）。 */
export type AudioLayer = 'L1' | 'L2' | 'L3' | 'L4'

/** 单个维度的描述形态；slide 用 stops，其余用 words。 */
export interface AudioDim {
  readonly L: AudioLayer
  readonly k: string
  readonly n: string
  readonly brand: 'seg' | 'grid' | 'slide'
  readonly mode?: 'one' | 'many'
  readonly max?: number
  readonly star?: boolean
  readonly excl?: 'tongue'
  readonly words?: readonly string[]
  readonly stops?: readonly string[]
}

/** fn 菜单（演示稿 FNS 原序）。 */
export const AUDIO_FNS: readonly { readonly k: AudioFn; readonly n: string }[] = [
  { k: 'voice', n: '语音生成' },
  { k: 'design', n: '音色设计' },
  { k: 'music', n: '音乐生成' },
]

/** fn 展示名（fn 菜单、toast 用）。 */
export function audioFnName(fn: AudioFn): string {
  return AUDIO_FNS.find((f) => f.k === fn)?.n ?? '语音生成'
}

/** fn → 后端工具名（voice/design 共用 TTS；music 独立）。 */
export function audioFnToolName(fn: AudioFn): 'tts_voiceover' | 'music_generation' {
  return fn === 'music' ? 'music_generation' : 'tts_voiceover'
}

/** 层元数据（演示稿 LAYERS）。 */
export const LAYERS: Readonly<Record<AudioLayer, { readonly name: string }>> = {
  L1: { name: '身份' },
  L2: { name: '语言' },
  L3: { name: '声学' },
  L4: { name: '情境' },
}

/** 层序的单一来源：chips 渲染、遍历、清空都读它（演示稿原序，≠ DIMS 声明序）。 */
export const LAYER_ORDER: readonly AudioLayer[] = ['L1', 'L2', 'L3', 'L4']

/**
 * 18 个维度（演示稿 DIMS 原序：L1 四 → L3 七 → L4 五 → L2 二；
 * 声明序与渲染序不同，渲染一律走 LAYER_ORDER）。
 */
export const DIMS: readonly AudioDim[] = [
  // ---------- L1 身份 ----------
  { L: 'L1', k: 'gender', n: '性别', brand: 'seg', words: ['男声', '女声', '中性音色'] },
  { L: 'L1', k: 'age', n: '年龄段', brand: 'grid', mode: 'one', words: ['少年', '少女', '青年男性', '三十多岁的女性', '四十岁上下的男性', '中年男声', '中老年男声', '苍老的老者'] },
  { L: 'L1', k: 'texture', n: '音色质感', brand: 'grid', mode: 'many', max: 3, star: true, words: ['低沉', '浑厚', '磁性', '沙哑', '苍老沙哑', '带气声', '明亮通透', '略带鼻音', '胸腔共鸣重', '音质偏硬有棱角', '干净无杂质', '金属感', '带颗粒感'] },
  { L: 'L1', k: 'persona', n: '身份气质', brand: 'grid', mode: 'many', max: 2, words: ['纪录片旁白', '新闻主播', '相声演员', '有声书讲述者', '深夜电台主播', '统军将领', '有文学素养的老者', '学者气质'] },

  // ---------- L3 声学 ----------
  { L: 'L3', k: 'pitch', n: '音高', brand: 'seg', words: ['低沉', '偏低', '中音区', '偏高', '高亢'] },
  { L: 'L3', k: 'tail', n: '尾音处理', brand: 'seg', words: ['尾音上扬', '尾音平收', '尾音下沉'] },
  { L: 'L3', k: 'pace', n: '语速', brand: 'slide', stops: ['极慢从容', '偏慢从容', '不疾不徐', '语速适中', '偏快', '急促'] },
  { L: 'L3', k: 'volume', n: '音量', brand: 'slide', stops: ['耳语级', '音量不大', '音量适中', '较为洪亮', '洪亮有力'] },
  { L: 'L3', k: 'power', n: '力度', brand: 'grid', mode: 'many', max: 2, words: ['中气十足', '穿透力强', '娓娓道来', '气息虚弱'] },
  { L: 'L3', k: 'clarity', n: '清晰 / 流畅', brand: 'grid', mode: 'one', words: ['字正腔圆', '吐字清晰', '一气呵成', '略有停顿'] },
  { L: 'L3', k: 'tone', n: '腔调', brand: 'seg', words: ['标准普通话', '播音腔', '戏剧腔'] },

  // ---------- L4 情境 ----------
  { L: 'L4', k: 'emotion', n: '情绪', brand: 'grid', mode: 'many', max: 2, words: ['温柔', '平和', '热情', '雀跃', '沉郁', '哀伤', '愤怒', '威严', '无奈倦怠', '若有所思', '笃定克制'] },
  { L: 'L4', k: 'style', n: '语调 / 性格', brand: 'grid', mode: 'many', max: 2, words: ['抑扬顿挫', '语气不容置疑', '情感外露', '自信果决', '知性温柔'] },
  { L: 'L4', k: 'body', n: '身体状态', brand: 'grid', mode: 'many', max: 2, words: ['强忍悲痛', '颤抖中保持平静', '带着笑意', '哭腔', '偶有哽咽停顿'] },
  { L: 'L4', k: 'scene', n: '场景', brand: 'grid', mode: 'many', max: 2, words: ['深夜电台', '昏暗录音室', '雨夜', '壁炉旁', '舞台上'] },
  { L: 'L4', k: 'noise', n: '背景噪声', brand: 'seg', words: ['无背景噪声', '室内混响', '户外环境声'] },

  // ---------- L2 语言（官方 30 语言 + 9 种中文方言）----------
  // lang 与 dialect 同属 excl:"tongue" 互斥组：一次合成只可能是其中一种。
  { L: 'L2', k: 'lang', n: '语言', brand: 'grid', mode: 'one', excl: 'tongue', words: ['中文', '英语', '日语', '韩语', '法语', '德语', '西班牙语', '葡萄牙语', '意大利语', '俄语', '阿拉伯语', '印地语', '泰语', '越南语', '印尼语', '马来语', '土耳其语', '荷兰语', '波兰语', '瑞典语', '挪威语', '芬兰语', '丹麦语', '希腊语', '希伯来语', '缅甸语', '高棉语', '老挝语', '斯瓦希里语', '他加禄语'] },
  { L: 'L2', k: 'dialect', n: '中文方言', brand: 'grid', mode: 'one', excl: 'tongue', words: ['四川话', '粤语', '吴语（上海话）', '东北话', '河南话', '陕西话', '山东话', '天津话', '闽南话'] },
]

/** dimKey → 维度定义（未知键返回 null，沿用演示稿 dimOf）。 */
export function dimOf(k: string): AudioDim | null {
  return DIMS.find((d) => d.k === k) ?? null
}

/** 某层的全部维度（演示稿 layerDims）。 */
export function layerDims(L: AudioLayer): readonly AudioDim[] {
  return DIMS.filter((d) => d.L === L)
}

/** 选中集：dimKey → 词组（顺序 = 用户操作顺序；chips 渲染走 LAYER_ORDER×DIMS）。 */
export type VoiceSel = Readonly<Record<string, readonly string[]>>

/**
 * 描述区的一个条目（词条或自由文本段）。渲染层据此画 chips 与分隔符 ——
 * 所见即投喂，与演示稿 readChunks / renderCaption 的模型一致。
 */
export interface AudioCapItem {
  readonly t: 'tok' | 'free'
  readonly dim?: string
  readonly w?: string
  readonly L?: AudioLayer
  readonly s?: string
}

/** chips 的完整条目序：层序遍历 sel，自由段永远垫底（演示稿 renderCaption）。 */
export function composeItems(sel: VoiceSel, free: string): readonly AudioCapItem[] {
  const items: AudioCapItem[] = []
  for (const L of LAYER_ORDER) {
    for (const d of layerDims(L)) {
      for (const w of sel[d.k] ?? []) items.push({ t: 'tok', dim: d.k, w, L })
    }
  }
  if (free) items.push({ t: 'free', s: free })
  return items
}

/**
 * 完整描述串（投喂 instruct_prompt / caption_prompt 的那份）：层间「；」、
 * 层内「，」；两端已有标点则不重复补；末尾 strip 掉首尾标点与空白。
 * 纯函数口径 = 演示稿 captionText（:1222-1233）逐行对应。
 */
export function composeSpeechInstruct(sel: VoiceSel, free: string): string {
  return captionTextOfItems(composeItems(sel, free))
}

function captionTextOfItems(items: readonly AudioCapItem[]): string {
  let out = ''
  let prevL: AudioLayer | null = null
  for (const c of items) {
    const txt = c.t === 'tok' ? (c.w ?? '') : (c.s ?? '').replace(/\s+/g, ' ').trim()
    if (!txt) continue
    // 两端已有标点就不重复补 —— 自由段可能自带前导标点（:1228 原样）
    if (out && !/[，,；;。、\s]$/.test(out) && !/^[，,；;。、]/.test(txt)) {
      out += c.t === 'tok' && prevL !== null && c.L !== prevL ? '；' : '，'
    }
    out += txt
    if (c.t === 'tok') prevL = c.L ?? null
  }
  // strip 正则不含「。」—— 演示稿 :1232 原样，改了就与原型对不上
  return out.replace(/^[，,；;、\s]+|[，,；;、\s]+$/, '')
}

/** 去全部空白（music 时长/积分口径只去空白，标点保留）。 */
export function stripWs(s: string): string {
  return s.replace(/\s+/g, '')
}

/** 正文净字数（voice/design 口径：去空白去标点，保留 CJK/字母/数字；演示稿 bodyChars :1328）。 */
export function bodyCharCount(s: string): number {
  return stripWs(s).replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '').length
}

/** 预计时长（秒）：与后端真值对拍误差 <1%（演示稿 estSeconds :1330）。 */
export function estSecondsOf(n: number): number {
  return n ? Math.max(1, Math.round(n / 5)) : 0
}

/** 消耗积分：基准 2 + 每 20 字 1 分；没写正文不消耗（演示稿 creditCost :1338）。 */
export function creditCostOf(n: number): number {
  return n ? 2 + Math.ceil(n / 20) : 0
}
